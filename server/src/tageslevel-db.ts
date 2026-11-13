import type { Sql } from 'postgres';
import type { RankedEntry } from './bestenliste.ts';
import type { Art, DailyStore, DailyTask } from './tageslevel.ts';

interface TaskRow {
  art: Art;
  zeitraum: string;
  level: string;
  pack: string;
  index: number;
  titel: string;
  seed: string;
}
const task = (r: TaskRow): DailyTask => ({ art: r.art, zeitraum: r.zeitraum, level: r.level, pack: r.pack, index: r.index, titel: r.titel, seed: Number(r.seed) });

/** Tageslevel in PostgreSQL (migrations/011_tageslevel.sql). Blocked accounts never appear in a ranking. */
export function dailyStore(sql: Sql): DailyStore {
  return {
    async task(art, zeitraum) {
      const [r] = await sql<TaskRow[]>`select art, zeitraum, level, pack, index, titel, seed from daily_tasks where art = ${art} and zeitraum = ${zeitraum}`;
      return r ? task(r) : null;
    },

    async saveTask(t) {
      await sql`
        insert into daily_tasks (art, zeitraum, level, pack, index, titel, seed)
        values (${t.art}, ${t.zeitraum}, ${t.level}, ${t.pack}, ${t.index}, ${t.titel}, ${t.seed})
        on conflict do nothing`;
      return (await this.task(t.art, t.zeitraum))!;
    },

    async recentLevels(since) {
      const rows = await sql<{ level: string }[]>`select distinct level from daily_tasks where created_at >= ${since}`;
      return new Set(rows.map((r) => r.level));
    },

    async leaderboardLevels() {
      const rows = await sql<{ level: string }[]>`select distinct level from leaderboard`;
      return new Set(rows.map((r) => r.level));
    },

    async submit({ art, zeitraum, accountId, steps, recording, now }) {
      // insert, or replace only with a better run – in one statement, so two checks cannot race
      const rows = await sql<{ steps: number }[]>`
        insert into daily_runs (art, zeitraum, account_id, steps, recording, created_at)
        values (${art}, ${zeitraum}, ${accountId}, ${steps}, ${sql.json(recording as never)}, ${now})
        on conflict (art, zeitraum, account_id) do update
          set steps = excluded.steps, recording = excluded.recording, created_at = excluded.created_at
          where excluded.steps < daily_runs.steps
        returning steps`;
      if (rows.length) return { improved: true, steps: rows[0].steps };
      const [cur] = await sql<{ steps: number }[]>`select steps from daily_runs where art = ${art} and zeitraum = ${zeitraum} and account_id = ${accountId}`;
      return { improved: false, steps: cur.steps };
    },

    async ranking(art, zeitraum, limit, accountId) {
      const rows = await sql<{ id: string; account_id: string; name: string | null; steps: number; created_at: Date; rank: string }[]>`
        with r as (
          select d.id, d.account_id, a.display_name as name, d.steps, d.created_at,
                 row_number() over (order by d.steps, d.created_at, d.id) as rank
          from daily_runs d join accounts a on a.id = d.account_id
          where d.art = ${art} and d.zeitraum = ${zeitraum} and a.blocked_at is null
        )
        select * from r where rank <= ${limit} or account_id = ${accountId ?? 0} order by rank`;
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from daily_runs d join accounts a on a.id = d.account_id
        where d.art = ${art} and d.zeitraum = ${zeitraum} and a.blocked_at is null`;
      const entries: RankedEntry[] = rows.map((r) => ({ id: Number(r.id), accountId: Number(r.account_id), name: r.name, steps: r.steps, createdAt: r.created_at, rank: Number(r.rank) }));
      return { total: n, entries };
    },

    async prune(before) {
      await sql`delete from daily_tasks where created_at < ${before}`;
    },
  };
}
