import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import type { LevelCounts } from './auswertung.ts';
import { auswertungStore } from './auswertung-db.ts';
import { memoryAuswertungStore } from './auswertung-memory.ts';
import { connect } from './db.ts';
import { migrate } from './migrate.ts';

const fakeDb = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) };

const counts = (pack: string, level: string, over: Partial<LevelCounts> = {}): LevelCounts => ({
  pack,
  level,
  gestartet: 2,
  geloest: 1,
  neustart: 1,
  abbruch: 0,
  abstuerze: 3,
  zeitGeloest: [0, 1, 0, 0, 0],
  zeitAbbruch: [0, 0, 0, 0, 0],
  ...over,
});

function setup(day = '2026-11-14T10:00:00Z') {
  const store = memoryAuswertungStore();
  let clock = new Date(day);
  const app = buildApp({ version: 't', db: fakeDb, auswertung: store, statsToken: 'geheim', now: () => clock });
  return { app, store, setNow: (d: string) => void (clock = new Date(d)) };
}

const post = (app: ReturnType<typeof buildApp>, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/auswertung', payload: payload as object, headers });
const read = (app: ReturnType<typeof buildApp>, tage = 30, auth = 'Bearer geheim') =>
  app.inject({ method: 'GET', url: `/api/statistik/auswertung?tage=${tage}`, headers: auth ? { authorization: auth } : {} });

test('POST /api/auswertung addiert Bündel zu Tageszählern je Paket und Level', async () => {
  const { app } = setup();
  assert.equal((await post(app, { levels: [counts('murmel', '01'), counts('enigma_i', 'enigma:a', { abbruch: 1, zeitAbbruch: [0, 0, 0, 1, 0] })] })).statusCode, 204);
  assert.equal((await post(app, { levels: [counts('murmel', '01', { geloest: 0, zeitGeloest: [0, 0, 0, 0, 0] })] })).statusCode, 204);

  const res = await read(app);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.json().levels, [
    counts('enigma_i', 'enigma:a', { abbruch: 1, zeitAbbruch: [0, 0, 0, 1, 0] }),
    counts('murmel', '01', { gestartet: 4, geloest: 1, neustart: 2, abstuerze: 6 }),
  ]);
});

test('Lesen nur mit STATS_TOKEN oder als Admin', async () => {
  const { app } = setup();
  assert.equal((await read(app, 30, '')).statusCode, 401);
  assert.equal((await read(app, 30, 'Bearer falsch')).statusCode, 401);
  assert.equal((await read(app, 30)).statusCode, 200);
});

test('ungültige oder übergroße Bündel werden abgewiesen', async () => {
  const { app, store } = setup();
  const bad = [
    {},
    { levels: [] },
    { levels: [counts('murmel', '01'), 'x'] },
    { levels: [counts('murmel', '<script>')] },
    { levels: [counts('murmel', '01', { gestartet: 501 })] },
    { levels: [counts('murmel', '01', { gestartet: -1 })] },
    { levels: [counts('murmel', '01', { abstuerze: 10_001 })] },
    { levels: [counts('murmel', '01', { zeitGeloest: [0, 0, 0, 0] })] },
    { levels: [counts('murmel', '01', { gestartet: 1.5 })] },
    { levels: Array.from({ length: 51 }, (_, i) => counts('p', `l${i}`)) },
  ];
  for (const b of bad) assert.equal((await post(app, b)).statusCode, 400, JSON.stringify(b).slice(0, 80));
  assert.deepEqual(await store.summary('2000-01-01'), []);
  assert.equal((await post(app, { levels: Array.from({ length: 50 }, (_, i) => counts('p', `l${i}`)) })).statusCode, 204);
});

test('fremde Felder (Zeit, Kennung) werden verworfen, nie gespeichert', async () => {
  const { app, store } = setup();
  assert.equal((await post(app, { zeit: '2026-11-14T10:00:00Z', levels: [{ ...counts('murmel', '01'), id: 'abc', ip: '1.2.3.4' }] })).statusCode, 204);
  assert.deepEqual(await store.summary('2000-01-01'), [counts('murmel', '01')]);
});

test('ein Datenbankfehler stört das Spiel nicht (204)', async () => {
  const app = buildApp({ version: 't', db: fakeDb, auswertung: { record: async () => Promise.reject(new Error('down')), summary: async () => [] } });
  assert.equal((await post(app, { levels: [counts('murmel', '01')] })).statusCode, 204);
});

test('Zeitraum und Aufbewahrung: Tage nach Berliner Zeit, nach 365 Tagen gelöscht', async () => {
  const { app, store, setNow } = setup('2025-11-13T12:00:00Z');
  await post(app, { levels: [counts('murmel', '01')] });
  setNow('2025-11-14T12:00:00Z');
  await post(app, { levels: [counts('murmel', '01')] });
  // 23:30 UTC on 13.11.2026 is already the 14th in Berlin
  setNow('2026-11-13T23:30:00Z');
  await post(app, { levels: [counts('murmel', '02')] });
  assert.deepEqual(store.days(), ['2025-11-14', '2026-11-14']);
  assert.deepEqual((await read(app, 1)).json().levels.map((l: LevelCounts) => l.level), ['02']);
});

test('ohne Store gibt es die Routen nicht', async () => {
  const app = buildApp({ version: 't', db: fakeDb });
  assert.equal((await post(app, { levels: [counts('murmel', '01')] })).statusCode, 404);
});

// PostgreSQL (CI: service container); without TEST_DATABASE_URL skipped.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Auswertung in PostgreSQL: addiert, summiert Zeitklassen, löscht nach einem Jahr', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  await sql!`delete from auswertung_level`;
  const store = auswertungStore(sql!);
  await store.record('2025-11-13', [counts('murmel', '01')]);
  await store.record('2026-11-13', [counts('murmel', '01'), counts('enigma_i', 'enigma:a', { abbruch: 1, zeitAbbruch: [0, 0, 0, 1, 0] })]);
  await store.record('2026-11-13', [counts('murmel', '01', { zeitGeloest: [1, 0, 0, 0, 2] })]);
  await store.record('2026-11-14', [counts('murmel', '01')]);

  assert.deepEqual(await store.summary('2026-11-01'), [
    counts('enigma_i', 'enigma:a', { abbruch: 1, zeitAbbruch: [0, 0, 0, 1, 0] }),
    counts('murmel', '01', { gestartet: 6, geloest: 3, neustart: 3, abstuerze: 9, zeitGeloest: [1, 2, 0, 0, 2] }),
  ]);
  // the 14th removed the 13th of last year (older than 365 days); the 13th of this year stays
  const days = await sql!<{ day: string }[]>`select distinct to_char(day, 'YYYY-MM-DD') as day from auswertung_level order by day`;
  assert.deepEqual(days.map((d) => d.day), ['2026-11-13', '2026-11-14']);
});
