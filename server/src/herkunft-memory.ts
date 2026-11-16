import { type HerkunftRow, type HerkunftStore, MAX_DOMAINS_PER_DAY, oldestKept } from './herkunft.ts';

/** HerkunftStore in memory, for tests without PostgreSQL. */
export function memoryHerkunftStore(): HerkunftStore {
  const rows = new Map<string, HerkunftRow>();
  let lastDay = '';
  return {
    async record(day, domain) {
      if (day !== lastDay) {
        const oldest = oldestKept(day);
        for (const [k, r] of rows) if (r.day < oldest) rows.delete(k);
        lastDay = day;
      }
      const k = `${day}\n${domain}`;
      const old = rows.get(k);
      if (old) old.anzahl++;
      else if ([...rows.values()].filter((r) => r.day === day).length < MAX_DOMAINS_PER_DAY) rows.set(k, { day, domain, anzahl: 1 });
    },
    async rows(since) {
      return [...rows.values()]
        .filter((r) => r.day >= since)
        .map((r) => ({ ...r }))
        .sort((a, b) => (a.day === b.day ? (a.domain < b.domain ? -1 : 1) : a.day < b.day ? -1 : 1));
    },
  };
}
