import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from 'postgres';

/** Migration files not yet applied, in name order (001_…, 002_…). */
export function pendingMigrations(files: string[], applied: Set<string>): string[] {
  return files.filter((f) => f.endsWith('.sql') && !applied.has(f)).sort();
}

/** Applies every pending migration in its own transaction and records it in schema_migrations. */
export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const todo = pendingMigrations(readdirSync(dir), applied);
  for (const name of todo) {
    const text = readFileSync(join(dir, name), 'utf8');
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${name})`;
    });
  }
  return todo;
}
