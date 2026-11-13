import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { leaderboardStore } from './bestenliste-db.ts';
import { gameChecker } from './bestenliste-pruefer.ts';
import { connect, database } from './db.ts';
import { parseAdminEmails } from './konten.ts';
import { activeProviders, providersFromEnv } from './anbieter.ts';
import { forumStore } from './forum-db.ts';
import { ghostStore } from './geister-db.ts';
import { dailyStore } from './tageslevel-db.ts';
import { accountStore } from './konten-db.ts';
import { solvabilityStore } from './loesbarkeit-db.ts';
import { playerLevelStore } from './spielerlevels-db.ts';
import { syncStore } from './sync-db.ts';
import { vapidFromEnv } from './webpush.ts';
import { pushStore } from './webpush-db.ts';
import { mailerFromEnv } from './mail.ts';
import { migrate } from './migrate.ts';
import { RoomHub, turnUrls } from './raum.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt');
const version = process.env.MURMEL_VERSION ?? 'dev';
const port = Number(process.env.PORT ?? 3000);

const sql = connect(url);
const done = await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
// Google, Apple, GitHub (docs/SPEC-konten.md, Stufe 2): values from /opt/murmel/.env, Apple key as a read-only file
const providers = providersFromEnv(process.env);
const accounts = {
  store: accountStore(sql),
  mailer: mailerFromEnv(process.env),
  origin: process.env.PUBLIC_ORIGIN || 'https://murmel.games',
  adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
  providers: providers.config,
};
// Zu zweit spielen: TURN credentials only with the secret from /opt/murmel/.env (TURN_SECRET)
const turnSecret = process.env.TURN_SECRET;
const raum = new RoomHub({ turn: turnSecret ? { secret: turnSecret, urls: turnUrls(process.env) } : null });
const gameDir = process.env.GAME_DIR || '/game';
const checker = gameChecker(gameDir);
// Erinnerung per Web Push (docs/SPEC-webpush.md): VAPID keys from /opt/murmel/.env; without them it is off
const vapid = vapidFromEnv(process.env);
const app = buildApp({ version, db: database(sql), statsToken: process.env.STATS_TOKEN || undefined, accounts, forum: forumStore(sql), solvability: solvabilityStore(sql),
  // the game code of the active version, read-only (compose.yml); without it submitting answers 503
  leaderboard: { store: leaderboardStore(sql), checker },
  ghosts: ghostStore(sql),
  daily: dailyStore(sql),
  push: vapid.vapid ? { store: pushStore(sql), vapid: vapid.vapid, timer: true } : undefined,
  // Spieler-Levels: same checker process and queue as the leaderboard
  playerLevels: { store: playerLevelStore(sql) },
  sync: syncStore(sql),
  raum,
  logger: true,
});
if (!checker.available()) app.log.warn({ gameDir }, 'no game code: leaderboard submissions are off');
if (!turnSecret) app.log.warn('TURN_SECRET not set: rooms work, but browsers get no TURN server');
for (const w of providers.warnings) app.log.warn(w);
if (vapid.warning) app.log.warn(vapid.warning);
app.log.info({ providers: activeProviders(providers.config) }, 'sign-in providers');
if (!accounts.mailer) app.log.warn('SMTP not configured: sign-in by mail link is off');
if (done.length) app.log.info({ migrations: done }, 'migrations applied');

// docker stop sends SIGTERM: finish open requests, close the pool
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await app.close();
    checker.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port });
