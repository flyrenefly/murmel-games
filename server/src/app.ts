import Fastify, { type FastifyInstance } from 'fastify';
import { type Checker, type LeaderboardStore, leaderboardRoutes } from './bestenliste.ts';
import { type ForumStore, forumRoutes } from './forum.ts';
import { type GhostStore, ghostRoutes } from './geister.ts';
import { type DailyStore, dailyRoutes } from './tageslevel.ts';
import { tipRoutes } from './tipps.ts';
import { type PushStore, pushRoutes, startPushTimer, type Vapid } from './webpush.ts';
import { type AccountOptions, accountRoutes } from './konten.ts';
import { type SolvabilityStore, solvabilityRoutes } from './loesbarkeit.ts';
import { raumRoutes, type RoomHub } from './raum.ts';
import { type PlayerLevelStore, playerFileFor, playerLevelRoutes } from './spielerlevels.ts';
import { type SyncStore, syncRoutes } from './sync.ts';
import { berlinDay, LEVEL_ID, type StatEvent, type Statistics, type StatType, tokenMatches } from './stats.ts';

/** What the API needs from the database (the real one: src/db.ts). */
export interface Database {
  /** Resolves when the database answers, rejects otherwise. */
  ping(): Promise<void>;
  /** Counts one anonymous game event (statistics). */
  recordEvent(e: StatEvent): Promise<void>;
  /** Daily counters and the most played levels since a day (YYYY-MM-DD). */
  statistics(since: string): Promise<Statistics>;
}

export interface AppOptions {
  /** Commit of the running release. */
  version: string;
  db: Database;
  /** Accounts (sign-in, account page, admin); without them the routes are absent. */
  accounts?: AccountOptions;
  /** Forum (needs accounts); without it the routes are absent. */
  forum?: ForumStore;
  /** Lösbarkeitsprüfung: solutions and nightly results for admins (needs accounts); its solutions also feed the tips. */
  solvability?: SolvabilityStore;
  /** Zu zweit spielen: rooms and the WebRTC handshake (WebSocket /api/raum); without it the route is absent. */
  raum?: RoomHub;
  /** Fortschritt auf allen Geräten (needs accounts); without it the routes are absent. */
  sync?: SyncStore;
  /** Bestenliste: rankings and the replay of submitted runs (needs accounts). */
  leaderboard?: { store: LeaderboardStore; checker: Checker };
  /** Geister: leaderboard runs as ghosts, with the players' consent (needs accounts and leaderboard). */
  ghosts?: GhostStore;
  /** Tageslevel und Wochenaufgabe (needs accounts and leaderboard: its checker and queue). */
  daily?: DailyStore;
  /**
   * Erinnerung per Web Push (docs/SPEC-webpush.md): only with VAPID keys; without them the routes are
   * absent. `timer` sends at Berlin midnight (index.ts; off in tests). Titles come from the daily tasks.
   */
  push?: { store: PushStore; vapid: Vapid; timer?: boolean };
  /** Spieler-Levels (needs accounts): upload, release, list, ratings. Uses the leaderboard's checker and queue. */
  playerLevels?: { store: PlayerLevelStore; checker?: Checker };
  /** Bearer token for GET /api/statistik; without one the statistics stay closed. */
  statsToken?: string;
  /** Clock (tests). */
  now?: () => Date;
  /** Request log (off in tests). */
  logger?: boolean;
}

/**
 * Request log without personal data (privacy policy „Hosting und Server-Protokolle“): only method and
 * path, no IP address, host, port or query string. Errors keep their message and stack.
 */
export const LOG_OPTIONS = {
  serializers: {
    req: (req: { method?: string; url?: string }) => ({ method: req.method, url: (req.url ?? '').split('?')[0] }),
  },
};

export function buildApp({ version, db, statsToken, accounts, forum, solvability, leaderboard, ghosts, daily, push, playerLevels, sync, raum, now = () => new Date(), logger = false }: AppOptions): FastifyInstance {
  // Caddy is the only hop in front of the API: req.ip is the address it saw (X-Forwarded-For).
  const app = Fastify({ logger: logger ? LOG_OPTIONS : false, bodyLimit: 64 * 1024, trustProxy: (_addr: string, hop: number) => hop === 0 });

  // Operations: is the API up and does the database answer? Details stay in the server log.
  app.get('/api/health', async (req, reply) => {
    try {
      await db.ping();
      return { ok: true, version, db: 'ok' };
    } catch (err) {
      req.log.error({ err }, 'database ping failed');
      return reply.code(503).send({ ok: false, version, db: 'fehler' });
    }
  });

  // Accounts first: their hook sets req.account for every /api route (admins see the statistics).
  if (accounts) accountRoutes(app, accounts);
  if (accounts && forum) forumRoutes(app, { store: forum, accounts: accounts.store, origin: accounts.origin, now: accounts.now ?? now });
  if (accounts && solvability) solvabilityRoutes(app, solvability);
  // Tipps: admin solutions for everyone, no account needed (docs/SPEC-tipps.md)
  if (solvability) tipRoutes(app, { store: solvability, now: () => now().getTime() });
  const clock = accounts?.now ?? now;
  const playerFile = playerLevels && playerFileFor(playerLevels.store);
  const queue = accounts && leaderboard ? leaderboardRoutes(app, { ...leaderboard, version, origin: accounts.origin, now: clock, solutions: solvability, playerFile }) : undefined;
  const taskFor = accounts && leaderboard && daily && queue ? dailyRoutes(app, { store: daily, checker: leaderboard.checker, queue, solvability, origin: accounts.origin, now: clock }) : undefined;
  if (push) {
    pushRoutes(app, { store: push.store, vapid: push.vapid, origin: accounts?.origin ?? 'https://murmel.games', now: clock });
    if (push.timer) {
      // the title of the new level; without the game code (no catalog) the message has none
      const title = async (art: 'tag' | 'woche', zeitraum: string) => (taskFor && leaderboard?.checker.catalog && leaderboard.checker.available() ? (await taskFor(art, zeitraum)).titel : null);
      let stop: (() => void) | undefined;
      app.addHook('onReady', async () => {
        stop = startPushTimer({ store: push.store, vapid: push.vapid, title, now: clock, log: app.log });
      });
      app.addHook('onClose', async () => stop?.());
    }
  }
  const levelChecker = playerLevels?.checker ?? leaderboard?.checker;
  if (accounts && playerLevels && levelChecker) {
    playerLevelRoutes(app, { store: playerLevels.store, checker: levelChecker, queue, version, origin: accounts.origin, mailer: accounts.mailer, adminEmails: accounts.adminEmails, now: clock });
  }
  if (accounts && leaderboard && ghosts) ghostRoutes(app, { store: ghosts, leaderboard: leaderboard.store, accounts: accounts.store, origin: accounts.origin, now: clock });
  if (accounts && sync) syncRoutes(app, { store: sync, origin: accounts.origin, now: accounts.now ?? now });
  if (raum) raumRoutes(app, raum);

  // Statistics: the game reports level starts and solves (navigator.sendBeacon, no cookie).
  app.post<{ Body: { type: StatType; level: string } }>(
    '/api/event',
    {
      schema: {
        body: {
          type: 'object',
          required: ['type', 'level'],
          additionalProperties: false,
          properties: { type: { enum: ['start', 'solve'] }, level: { type: 'string', pattern: LEVEL_ID } },
        },
      },
    },
    async (req, reply) => {
      try {
        await db.recordEvent({
          day: berlinDay(now()),
          ip: req.ip,
          userAgent: String(req.headers['user-agent'] ?? ''),
          type: req.body.type,
          level: req.body.level,
        });
      } catch (err) {
        // The game never waits for the answer; a lost count is no error for the player.
        req.log.error({ err }, 'statistics event failed');
      }
      return reply.code(204).send();
    },
  );

  // Reading the statistics needs the token from /opt/murmel/.env (STATS_TOKEN).
  app.get<{ Querystring: { tage?: string } }>('/api/statistik', async (req, reply) => {
    if (req.account?.role !== 'admin' && !tokenMatches(statsToken, req.headers.authorization)) return reply.code(401).send({ error: 'nicht berechtigt' });
    const days = Math.min(Math.max(Math.trunc(Number(req.query.tage ?? 30)) || 30, 1), 366);
    const since = berlinDay(new Date(now().getTime() - (days - 1) * 86_400_000));
    reply.header('Cache-Control', 'no-store');
    return db.statistics(since);
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'nicht gefunden' }));

  return app;
}
