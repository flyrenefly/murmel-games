import Fastify, { type FastifyInstance } from 'fastify';
import { type AccountOptions, accountRoutes } from './konten.ts';
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
  /** Bearer token for GET /api/statistik; without one the statistics stay closed. */
  statsToken?: string;
  /** Clock (tests). */
  now?: () => Date;
  /** Request log (off in tests). */
  logger?: boolean;
}

export function buildApp({ version, db, statsToken, accounts, now = () => new Date(), logger = false }: AppOptions): FastifyInstance {
  // Caddy is the only hop in front of the API: req.ip is the address it saw (X-Forwarded-For).
  const app = Fastify({ logger, bodyLimit: 64 * 1024, trustProxy: (_addr: string, hop: number) => hop === 0 });

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
