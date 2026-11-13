import postgres, { type Sql } from 'postgres';
import type { Database } from './app.ts';

/** Connection from DATABASE_URL (set by compose.yml; the password lives only in /opt/murmel/.env). */
export function connect(url: string): Sql {
  return postgres(url, { max: 10, idle_timeout: 30, connect_timeout: 5, onnotice: () => {} });
}

export function database(sql: Sql): Database {
  return {
    async ping() {
      await sql`select 1`;
    },
  };
}
