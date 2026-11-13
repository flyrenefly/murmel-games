import type { SyncRecord, SyncStore } from './sync.ts';

/** SyncStore in memory, for tests; sync.test.ts runs the same checks against PostgreSQL. */
export function memorySyncStore(): SyncStore {
  const records = new Map<number, SyncRecord>();
  const copy = (r: SyncRecord | undefined): SyncRecord | null => (r ? structuredClone(r) : null);
  return {
    async get(accountId) {
      return copy(records.get(accountId));
    },
    async put(accountId, basis, data, now) {
      const old = records.get(accountId);
      if ((old?.version ?? 0) !== basis) return { ok: false, current: copy(old) };
      const rec = { version: basis + 1, updatedAt: now.toISOString(), data: structuredClone(data) };
      records.set(accountId, rec);
      return { ok: true, version: rec.version, updatedAt: rec.updatedAt };
    },
  };
}
