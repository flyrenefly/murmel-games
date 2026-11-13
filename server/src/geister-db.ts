import type { Sql } from 'postgres';
import type { GhostStore } from './geister.ts';
import type { Recording } from './loesbarkeit.ts';

/** Ghost consent in PostgreSQL (migrations/010_geister.sql); runs come from the leaderboard table. */
export function ghostStore(sql: Sql): GhostStore {
  return {
    async consent(accountId) {
      return (await sql`select 1 from ghost_consent where account_id = ${accountId}`).length > 0;
    },
    async setConsent(accountId, on, now) {
      if (on) await sql`insert into ghost_consent (account_id, created_at) values (${accountId}, ${now}) on conflict do nothing`;
      else await sql`delete from ghost_consent where account_id = ${accountId}`;
    },
    async consenting(ids) {
      if (!ids.length) return new Set();
      const rows = await sql<{ account_id: string }[]>`select account_id from ghost_consent where account_id = any(${ids}::bigint[])`;
      return new Set(rows.map((r) => Number(r.account_id)));
    },
    async run(entryId) {
      const [r] = await sql<{ account_id: string; level: string; recording: Recording }[]>`
        select account_id, level, recording from leaderboard where id = ${entryId}`;
      return r ? { accountId: Number(r.account_id), level: r.level, recording: r.recording } : null;
    },
  };
}
