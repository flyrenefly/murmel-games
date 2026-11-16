import type { Sql } from 'postgres';
import { type HerkunftRow, type HerkunftStore, MAX_DOMAINS_PER_DAY, oldestKept } from './herkunft.ts';

/** Herkunft in PostgreSQL (migrations/018_herkunft.sql): only daily counts per domain and campaign. */
export function herkunftStore(sql: Sql): HerkunftStore {
  // the day whose old rows were already deleted (one container; a restart only deletes once more)
  let prunedFor = '';
  return {
    async record(day, domain, von) {
      if (day !== prunedFor) {
        await sql`delete from herkunft_tag where day < ${oldestKept(day)}`;
        prunedFor = day;
      }
      // a new row only while the day has fewer than MAX_DOMAINS_PER_DAY (two requests at once may pass by one)
      await sql`
        insert into herkunft_tag (day, domain, von, anzahl)
        select ${day}, ${domain}, ${von}, 1
        where exists (select 1 from herkunft_tag where day = ${day} and domain = ${domain} and von = ${von})
           or (select count(*) from herkunft_tag where day = ${day}) < ${MAX_DOMAINS_PER_DAY}
        on conflict (day, domain, von) do update set anzahl = herkunft_tag.anzahl + 1`;
    },

    async rows(since) {
      // "C" collation: the same order as the JavaScript comparison of the memory store
      const rows = await sql<HerkunftRow[]>`
        select to_char(day, 'YYYY-MM-DD') as day, domain, von, anzahl from herkunft_tag
        where day >= ${since} order by day, domain collate "C", von collate "C"`;
      // a plain array of plain rows (the driver's result carries count, command, …)
      return rows.map((r) => ({ day: r.day, domain: r.domain, von: r.von, anzahl: r.anzahl }));
    },
  };
}
