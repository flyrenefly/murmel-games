import { addCounts, type AuswertungStore, type LevelCounts, oldestKept } from './auswertung.ts';

/** AuswertungStore in memory, for tests without PostgreSQL. */
export function memoryAuswertungStore(): AuswertungStore & { days(): string[] } {
  const rows = new Map<string, LevelCounts & { day: string }>();
  let lastDay = '';
  return {
    days: () => [...new Set([...rows.values()].map((r) => r.day))].sort(),
    async record(day, levels) {
      if (day !== lastDay) {
        const oldest = oldestKept(day);
        for (const [k, r] of rows) if (r.day < oldest) rows.delete(k);
        lastDay = day;
      }
      for (const l of levels) {
        const k = `${day}\n${l.pack}\n${l.level}`;
        const old = rows.get(k);
        rows.set(k, { ...(old ? addCounts(old, l) : { ...l, zeitGeloest: [...l.zeitGeloest], zeitAbbruch: [...l.zeitAbbruch] }), day });
      }
    },
    async summary(since) {
      const sums = new Map<string, LevelCounts>();
      for (const { day, ...r } of rows.values()) {
        if (day < since) continue;
        const k = `${r.pack}\n${r.level}`;
        const old = sums.get(k);
        sums.set(k, old ? addCounts(old, r) : r);
      }
      return [...sums.values()].sort((a, b) => (a.pack === b.pack ? (a.level < b.level ? -1 : 1) : a.pack < b.pack ? -1 : 1));
    },
  };
}
