import { type HerkunftRow, type HerkunftStore, MAX_DOMAINS_PER_DAY, oldestKept } from './herkunft.ts';

/** HerkunftStore in memory, for tests without PostgreSQL. */
export function memoryHerkunftStore(): HerkunftStore {
  const rows = new Map<string, HerkunftRow>();
  let lastDay = '';
  return {
    async record(day, domain, von) {
      if (day !== lastDay) {
        const oldest = oldestKept(day);
        for (const [k, r] of rows) if (r.day < oldest) rows.delete(k);
        lastDay = day;
      }
      const k = `${day}\n${domain}\n${von}`;
      const old = rows.get(k);
      if (old) old.anzahl++;
      else if ([...rows.values()].filter((r) => r.day === day).length < MAX_DOMAINS_PER_DAY) rows.set(k, { day, domain, von, anzahl: 1 });
    },
    async rows(since) {
      const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      return [...rows.values()]
        .filter((r) => r.day >= since)
        .map((r) => ({ ...r }))
        .sort((a, b) => cmp(a.day, b.day) || cmp(a.domain, b.domain) || cmp(a.von, b.von));
    },
  };
}
