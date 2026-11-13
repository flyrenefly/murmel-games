import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { connect, database } from './db.ts';
import { parseAdminEmails } from './konten.ts';
import { forumStore } from './forum-db.ts';
import { accountStore } from './konten-db.ts';
import { solvabilityStore } from './loesbarkeit-db.ts';
import { mailerFromEnv } from './mail.ts';
import { migrate } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt');
const version = process.env.MURMEL_VERSION ?? 'dev';
const port = Number(process.env.PORT ?? 3000);

const sql = connect(url);
const done = await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
const accounts = {
  store: accountStore(sql),
  mailer: mailerFromEnv(process.env),
  origin: process.env.PUBLIC_ORIGIN || 'https://murmel.games',
  adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
};
const app = buildApp({ version, db: database(sql), statsToken: process.env.STATS_TOKEN || undefined, accounts, forum: forumStore(sql), solvability: solvabilityStore(sql), logger: true });
if (!accounts.mailer) app.log.warn('SMTP not configured: sign-in by mail link is off');
if (done.length) app.log.info({ migrations: done }, 'migrations applied');

// docker stop sends SIGTERM: finish open requests, close the pool
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ host: '0.0.0.0', port });
