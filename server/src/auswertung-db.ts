import type { Sql } from 'postgres';
import { type AuswertungStore, type LevelCounts, oldestKept } from './auswertung.ts';

/** Auswertung in PostgreSQL (migrations/015_auswertung.sql): only daily counters per pack and level. */
export function auswertungStore(sql: Sql): AuswertungStore {
  // the day whose old rows were already deleted (one container; a restart only deletes once more)
  let prunedFor = '';
  return {
    async record(day, levels) {
      await sql.begin(async (tx) => {
        if (day !== prunedFor) await tx`delete from auswertung_level where day < ${oldestKept(day)}`;
        for (const l of levels) {
          await tx`
            insert into auswertung_level (day, pack, level, gestartet, geloest, neustart, abbruch, abstuerze, zeit_geloest, zeit_abbruch)
            values (${day}, ${l.pack}, ${l.level}, ${l.gestartet}, ${l.geloest}, ${l.neustart}, ${l.abbruch}, ${l.abstuerze},
              ${l.zeitGeloest}::int[], ${l.zeitAbbruch}::int[])
            on conflict (day, pack, level) do update set
              gestartet = auswertung_level.gestartet + excluded.gestartet,
              geloest = auswertung_level.geloest + excluded.geloest,
              neustart = auswertung_level.neustart + excluded.neustart,
              abbruch = auswertung_level.abbruch + excluded.abbruch,
              abstuerze = auswertung_level.abstuerze + excluded.abstuerze,
              zeit_geloest = array(select a + b from unnest(auswertung_level.zeit_geloest, excluded.zeit_geloest) as t(a, b)),
              zeit_abbruch = array(select a + b from unnest(auswertung_level.zeit_abbruch, excluded.zeit_abbruch) as t(a, b))`;
        }
      });
      prunedFor = day;
    },

    async summary(since) {
      // Postgres arrays count from 1: the five time classes summed one by one
      const rows = await sql<(Omit<LevelCounts, 'zeitGeloest' | 'zeitAbbruch'> & { zg: number[]; za: number[] })[]>`
        select pack, level, sum(gestartet)::int as gestartet, sum(geloest)::int as geloest, sum(neustart)::int as neustart,
          sum(abbruch)::int as abbruch, sum(abstuerze)::int as abstuerze,
          array[sum(zeit_geloest[1])::int, sum(zeit_geloest[2])::int, sum(zeit_geloest[3])::int, sum(zeit_geloest[4])::int, sum(zeit_geloest[5])::int] as zg,
          array[sum(zeit_abbruch[1])::int, sum(zeit_abbruch[2])::int, sum(zeit_abbruch[3])::int, sum(zeit_abbruch[4])::int, sum(zeit_abbruch[5])::int] as za
        from auswertung_level where day >= ${since}
        group by pack, level order by pack, level`;
      return rows.map(({ zg, za, ...r }) => ({ ...r, zeitGeloest: zg, zeitAbbruch: za }));
    },
  };
}
