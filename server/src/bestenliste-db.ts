import type { Sql } from 'postgres';
import type { LeaderboardStore, RankedEntry } from './bestenliste.ts';

interface RankRow {
  id: string;
  account_id: string;
  name: string | null;
  steps: number;
  created_at: Date;
  rank: string;
}
const ranked = (r: RankRow): RankedEntry => ({ id: Number(r.id), accountId: Number(r.account_id), name: r.name, steps: r.steps, createdAt: r.created_at, rank: Number(r.rank) });

/** Rankings in PostgreSQL (migrations/006_bestenliste.sql). Blocked accounts never appear in a ranking. */
export function leaderboardStore(sql: Sql): LeaderboardStore {
  return {
    async submit({ accountId, level, steps, levelHash, version, recording, now }) {
      // insert, or replace only with a better run – in one statement, so two checks cannot race
      const rows = await sql<{ steps: number }[]>`
        insert into leaderboard (account_id, level, steps, level_hash, version, recording, created_at)
        values (${accountId}, ${level}, ${steps}, ${levelHash}, ${version}, ${sql.json(recording as never)}, ${now})
        on conflict (account_id, level) do update
          set steps = excluded.steps, level_hash = excluded.level_hash, version = excluded.version,
              recording = excluded.recording, created_at = excluded.created_at
          where excluded.steps < leaderboard.steps
        returning steps`;
      if (rows.length) return { improved: true, steps: rows[0].steps };
      const [cur] = await sql<{ steps: number }[]>`select steps from leaderboard where account_id = ${accountId} and level = ${level}`;
      return { improved: false, steps: cur.steps };
    },

    async ranking(level, limit, accountId) {
      const rows = await sql<RankRow[]>`
        with r as (
          select l.id, l.account_id, a.display_name as name, l.steps, l.created_at,
                 row_number() over (order by l.steps, l.created_at, l.id) as rank
          from leaderboard l join accounts a on a.id = l.account_id
          where l.level = ${level} and a.blocked_at is null
        )
        select * from r where rank <= ${limit} or account_id = ${accountId ?? 0} order by rank`;
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from leaderboard l join accounts a on a.id = l.account_id
        where l.level = ${level} and a.blocked_at is null`;
      return { total: n, entries: rows.map(ranked) };
    },

    async mine(accountId) {
      const rows = await sql<{ level: string; steps: number; rank: string }[]>`
        with r as (
          select l.level, l.account_id, l.steps,
                 row_number() over (partition by l.level order by l.steps, l.created_at, l.id) as rank
          from leaderboard l join accounts a on a.id = l.account_id
          where a.blocked_at is null and l.level in (select level from leaderboard where account_id = ${accountId})
        )
        select level, steps, rank from r where account_id = ${accountId} order by level`;
      return rows.map((r) => ({ level: r.level, steps: r.steps, rank: Number(r.rank) }));
    },

    async entry(id) {
      const [r] = await sql<{ id: string; account_id: string; level: string }[]>`select id, account_id, level from leaderboard where id = ${id}`;
      return r ? { id: Number(r.id), accountId: Number(r.account_id), level: r.level } : null;
    },

    async remove(id) {
      return (await sql`delete from leaderboard where id = ${id}`).count > 0;
    },
  };
}
