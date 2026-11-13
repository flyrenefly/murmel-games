import type { Sql } from 'postgres';
import type { SyncProgress, SyncRecord, SyncStore } from './sync.ts';

/** SyncStore in PostgreSQL (migrations/007_sync.sql). */
export function syncStore(sql: Sql): SyncStore {
  async function get(accountId: number): Promise<SyncRecord | null> {
    const [row] = await sql<{ version: number; updatedAt: Date; data: SyncProgress }[]>`
      select version, updated_at as "updatedAt", data from progress_sync where account_id = ${accountId}`;
    return row ? { version: row.version, updatedAt: row.updatedAt.toISOString(), data: row.data } : null;
  }
  return {
    get,
    async put(accountId, basis, data, now) {
      const rows =
        basis === 0
          ? await sql<{ version: number }[]>`
              insert into progress_sync (account_id, version, data, updated_at) values (${accountId}, 1, ${sql.json(data as never)}, ${now})
              on conflict (account_id) do nothing returning version`
          : await sql<{ version: number }[]>`
              update progress_sync set version = version + 1, data = ${sql.json(data as never)}, updated_at = ${now}
              where account_id = ${accountId} and version = ${basis} returning version`;
      if (rows.length) return { ok: true, version: rows[0].version, updatedAt: now.toISOString() };
      return { ok: false, current: await get(accountId) };
    },
  };
}
