import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import type { Database } from './app.ts';
import { playerKey, type StatDay, type StatEvent, type StatLevel } from './stats.ts';

/** Connection from DATABASE_URL (set by compose.yml; the password lives only in /opt/murmel/.env). */
export function connect(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 30, connect_timeout: 5, onnotice: () => {} });
}

export function database(sql: Sql): Database {
  return {
    async ping() {
      await sql`select 1`;
    },

    async recordEvent(e: StatEvent) {
      await sql.begin(async (tx) => {
        // The day's salt; a new day first deletes the salts and player keys of the days before.
        let [row] = await tx<{ salt: Buffer }[]>`select salt from stat_salt where day = ${e.day}`;
        if (!row) {
          await tx`delete from stat_salt where day < ${e.day}`;
          await tx`delete from stat_player where day < ${e.day}`;
          await tx`insert into stat_salt (day, salt) values (${e.day}, ${randomBytes(32)}) on conflict do nothing`;
          [row] = await tx<{ salt: Buffer }[]>`select salt from stat_salt where day = ${e.day}`;
        }
        const player = playerKey(row.salt, e.ip, e.userAgent);
        const fresh = (await tx`insert into stat_player (day, player) values (${e.day}, ${player}) on conflict do nothing returning 1`).length;
        const start = e.type === 'start' ? 1 : 0;
        const solve = e.type === 'solve' ? 1 : 0;
        await tx`
          insert into stat_day (day, players, starts, solved) values (${e.day}, ${fresh}, ${start}, ${solve})
          on conflict (day) do update set players = stat_day.players + excluded.players,
            starts = stat_day.starts + excluded.starts, solved = stat_day.solved + excluded.solved`;
        await tx`
          insert into stat_level (day, level, starts, solved) values (${e.day}, ${e.level}, ${start}, ${solve})
          on conflict (day, level) do update set starts = stat_level.starts + excluded.starts,
            solved = stat_level.solved + excluded.solved`;
      });
    },

    async statistics(since: string) {
      const days = await sql<StatDay[]>`
        select to_char(day, 'YYYY-MM-DD') as day, players, starts, solved
        from stat_day where day >= ${since} order by day`;
      const levels = await sql<StatLevel[]>`
        select level, sum(starts)::int as starts, sum(solved)::int as solved
        from stat_level where day >= ${since} group by level order by starts desc, level limit 30`;
      return { days: [...days], levels: [...levels] };
    },
  };
}
