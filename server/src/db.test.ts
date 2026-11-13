import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { connect, database } from './db.ts';
import { migrate } from './migrate.ts';
import type { StatEvent } from './stats.ts';

// Runs against a real PostgreSQL (CI: service container). Without TEST_DATABASE_URL it is skipped.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

const ev = (day: string, ip: string, type: StatEvent['type'], level = 'enigma:a'): StatEvent => ({ day, ip, userAgent: 'UA', type, level });

test('Statistik in PostgreSQL: Spieler je Tag eindeutig, alte Schlüssel und Prüfwerte gelöscht', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  const db = database(sql!);

  await db.recordEvent(ev('2026-11-13', '203.0.113.1', 'start'));
  await db.recordEvent(ev('2026-11-13', '203.0.113.1', 'start'));
  await db.recordEvent(ev('2026-11-13', '203.0.113.1', 'solve'));
  await db.recordEvent(ev('2026-11-13', '203.0.113.2', 'start', 'enigma:b'));
  await db.recordEvent(ev('2026-11-14', '203.0.113.1', 'start'));

  const stats = await db.statistics('2026-11-01');
  assert.deepEqual(stats.days, [
    { day: '2026-11-13', players: 2, starts: 3, solved: 1 },
    { day: '2026-11-14', players: 1, starts: 1, solved: 0 },
  ]);
  assert.deepEqual(stats.levels, [
    { level: 'enigma:a', starts: 3, solved: 1 },
    { level: 'enigma:b', starts: 1, solved: 0 },
  ]);
  // The new day removed the salt and the player keys of the 13th: only the counts remain.
  assert.deepEqual((await sql!`select to_char(day, 'YYYY-MM-DD') as day from stat_salt`).map((r) => r.day), ['2026-11-14']);
  assert.equal((await sql!`select count(*)::int as n from stat_player where day < '2026-11-14'`)[0].n, 0);
  assert.deepEqual((await db.statistics('2026-11-14')).days.map((d) => d.day), ['2026-11-14']);
});
