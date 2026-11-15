import { type CloudSave, type CloudSaveStore, MAX_SAVES } from './cloudstand.ts';

/** CloudSaveStore in memory, for tests; cloudstand.test.ts runs the same checks against PostgreSQL. */
export function memoryCloudSaveStore(): CloudSaveStore {
  const saves = new Map<number, Map<string, CloudSave & { updatedAt: string }>>();
  const of = (id: number) => saves.get(id) ?? saves.set(id, new Map()).get(id)!;
  return {
    async list(id) {
      return [...of(id).values()]
        .map((s) => ({ level: s.level, pack: s.pack, steps: s.steps, updatedAt: s.updatedAt }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id, level) {
      const s = of(id).get(level);
      return s ? structuredClone(s) : null;
    },
    async put(id, save, now) {
      const m = of(id);
      if (!m.has(save.level) && m.size >= MAX_SAVES) {
        const oldest = [...m.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
        m.delete(oldest.level);
      }
      m.set(save.level, { ...structuredClone(save), updatedAt: now.toISOString() });
    },
    async delete(id, level) {
      of(id).delete(level);
    },
    async expire(before) {
      let n = 0;
      for (const m of saves.values()) {
        for (const [k, s] of m) {
          if (new Date(s.updatedAt) < before) {
            m.delete(k);
            n++;
          }
        }
      }
      return n;
    },
  };
}
