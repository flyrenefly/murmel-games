import type { Sql } from 'postgres';
import { type CloudSave, type CloudSaveStore, MAX_SAVES } from './cloudstand.ts';

/** CloudSaveStore in PostgreSQL (migrations/014_cloudstand.sql). */
export function cloudSaveStore(sql: Sql): CloudSaveStore {
  return {
    async list(id) {
      const rows = await sql<{ level: string; pack: string; steps: number; updatedAt: Date }[]>`
        select level, pack, steps, updated_at as "updatedAt" from cloud_saves where account_id = ${id} order by updated_at desc`;
      return rows.map((r) => ({ level: r.level, pack: r.pack, steps: r.steps, updatedAt: r.updatedAt.toISOString() }));
    },
    async get(id, level) {
      const [r] = await sql<(Omit<CloudSave, 'seed'> & { seed: string; updatedAt: Date })[]>`
        select level, pack, seed, leben, steps, version, pruef, daten, updated_at as "updatedAt"
        from cloud_saves where account_id = ${id} and level = ${level}`;
      return r ? { ...r, seed: Number(r.seed), updatedAt: r.updatedAt.toISOString() } : null;
    },
    async put(id, s, now) {
      await sql.begin(async (tx) => {
        // one writer per account at a time, so the limit of MAX_SAVES holds
        await tx`select pg_advisory_xact_lock(${id})`;
        await tx`
          insert into cloud_saves (account_id, level, pack, seed, leben, steps, version, pruef, daten, updated_at)
          values (${id}, ${s.level}, ${s.pack}, ${s.seed}, ${s.leben}, ${s.steps}, ${s.version}, ${s.pruef}, ${s.daten}, ${now})
          on conflict (account_id, level) do update set pack = excluded.pack, seed = excluded.seed, leben = excluded.leben,
            steps = excluded.steps, version = excluded.version, pruef = excluded.pruef, daten = excluded.daten,
            updated_at = excluded.updated_at`;
        await tx`
          delete from cloud_saves where account_id = ${id} and level in (
            select level from cloud_saves where account_id = ${id} order by updated_at desc, level offset ${MAX_SAVES})`;
      });
    },
    async delete(id, level) {
      await sql`delete from cloud_saves where account_id = ${id} and level = ${level}`;
    },
    async expire(before) {
      const r = await sql`delete from cloud_saves where updated_at < ${before}`;
      return r.count;
    },
  };
}
