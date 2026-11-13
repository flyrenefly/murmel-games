import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from './app.ts';
import { pendingMigrations } from './migrate.ts';
import { berlinDay, playerKey, type StatEvent, tokenMatches } from './stats.ts';

/** A database stand-in: answers ping, records events. */
function fakeDb(ping: () => Promise<void> = async () => {}) {
  const events: StatEvent[] = [];
  const since: string[] = [];
  return {
    events,
    since,
    ping,
    recordEvent: async (e: StatEvent) => void events.push(e),
    statistics: async (s: string) => {
      since.push(s);
      return { days: [{ day: s, players: 2, starts: 5, solved: 1 }], levels: [{ level: 'enigma:x', starts: 5, solved: 1 }] };
    },
  };
}

test('GET /api/health meldet ok, Version und erreichbare Datenbank', async () => {
  const app = buildApp({ version: 'abc123', db: fakeDb() });

  const res = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, version: 'abc123', db: 'ok' });
});

test('GET /api/health antwortet 503, wenn die Datenbank nicht erreichbar ist', async () => {
  const app = buildApp({
    version: 'abc123',
    db: fakeDb(async () => {
      throw new Error('connect ECONNREFUSED');
    }),
  });

  const res = await app.inject({ method: 'GET', url: '/api/health' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { ok: false, version: 'abc123', db: 'fehler' });
});

test('die Fehlermeldung der Datenbank gelangt nicht in die Antwort', async () => {
  const app = buildApp({
    version: 'v',
    db: fakeDb(async () => {
      throw new Error('password authentication failed for user murmel');
    }),
  });

  const res = await app.inject({ method: 'GET', url: '/api/health' });

  assert.doesNotMatch(res.body, /password|murmel/);
});

test('unbekannte API-Pfade antworten 404 als JSON', async () => {
  const app = buildApp({ version: 'v', db: fakeDb() });

  const res = await app.inject({ method: 'GET', url: '/api/gibt-es-nicht' });

  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['content-type']?.toString().startsWith('application/json'), true);
});

test('pendingMigrations liefert nur noch nicht angewendete .sql-Dateien in Namensreihenfolge', () => {
  const files = ['002_konten.sql', 'README.md', '001_init.sql', '003_zeiten.sql'];
  const applied = new Set(['001_init.sql']);

  assert.deepEqual(pendingMigrations(files, applied), ['002_konten.sql', '003_zeiten.sql']);
});

test('POST /api/event zählt einen Levelstart mit Berliner Tag, IP und Browser, ohne Cookie', async () => {
  const db = fakeDb();
  // 23:30 UTC am 13.11. ist in Berlin schon der 14.11.
  const app = buildApp({ version: 'v', db, now: () => new Date('2026-11-13T23:30:00Z') });

  const res = await app.inject({
    method: 'POST',
    url: '/api/event',
    headers: { 'user-agent': 'TestBrowser', 'x-forwarded-for': '203.0.113.7' },
    payload: { type: 'start', level: 'enigma:ralf_pento1' },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.deepEqual(db.events, [{ day: '2026-11-14', ip: '203.0.113.7', userAgent: 'TestBrowser', type: 'start', level: 'enigma:ralf_pento1' }]);
});

test('POST /api/event lehnt unbekannte Ereignisse und seltsame Level-Kennungen ab', async () => {
  const db = fakeDb();
  const app = buildApp({ version: 'v', db });

  for (const payload of [{ type: 'click', level: 'a' }, { type: 'start', level: '<script>' }, { type: 'start', level: 'x'.repeat(101) }, { type: 'start' }]) {
    const res = await app.inject({ method: 'POST', url: '/api/event', payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(db.events.length, 0);
});

test('POST /api/event antwortet 204, auch wenn die Datenbank ausfällt', async () => {
  const db = { ...fakeDb(), recordEvent: async () => Promise.reject(new Error('down')) };
  const app = buildApp({ version: 'v', db });

  const res = await app.inject({ method: 'POST', url: '/api/event', payload: { type: 'solve', level: 'murmel:1' } });

  assert.equal(res.statusCode, 204);
});

test('GET /api/statistik braucht das Token und liefert die Tage seit dem gewählten Zeitraum', async () => {
  const db = fakeDb();
  const app = buildApp({ version: 'v', db, statsToken: 'geheim-123', now: () => new Date('2026-11-13T12:00:00Z') });

  assert.equal((await app.inject({ method: 'GET', url: '/api/statistik' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/statistik', headers: { authorization: 'Bearer falsch' } })).statusCode, 401);

  const res = await app.inject({ method: 'GET', url: '/api/statistik?tage=7', headers: { authorization: 'Bearer geheim-123' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(db.since, ['2026-11-07']);
  assert.equal(res.json().days[0].players, 2);
});

test('GET /api/statistik bleibt ohne eingerichtetes Token geschlossen', async () => {
  const app = buildApp({ version: 'v', db: fakeDb() });

  const res = await app.inject({ method: 'GET', url: '/api/statistik', headers: { authorization: 'Bearer ' } });

  assert.equal(res.statusCode, 401);
});

test('playerKey: gleicher Spieler am selben Tag gleich, mit neuem Tagesschlüssel nicht mehr verknüpfbar', () => {
  const salt1 = Buffer.alloc(32, 1);
  const salt2 = Buffer.alloc(32, 2);

  assert.deepEqual(playerKey(salt1, '203.0.113.7', 'A'), playerKey(salt1, '203.0.113.7', 'A'));
  assert.notDeepEqual(playerKey(salt1, '203.0.113.7', 'A'), playerKey(salt1, '203.0.113.8', 'A'));
  assert.notDeepEqual(playerKey(salt1, '203.0.113.7', 'A'), playerKey(salt2, '203.0.113.7', 'A'));
  assert.equal(playerKey(salt1, 'ip', 'ua').length, 16);
});

test('berlinDay und tokenMatches', () => {
  assert.equal(berlinDay(new Date('2026-06-30T22:30:00Z')), '2026-07-01');
  assert.equal(berlinDay(new Date('2026-11-13T22:59:00Z')), '2026-11-13');
  assert.equal(tokenMatches(undefined, 'Bearer x'), false);
  assert.equal(tokenMatches('abc', 'Bearer abc'), true);
  assert.equal(tokenMatches('abc', 'Bearer abcd'), false);
});

test('das Anfrage-Protokoll enthält keine IP-Adresse und keine Query', async () => {
  const { LOG_OPTIONS } = await import('./app.ts');
  const logged = LOG_OPTIONS.serializers.req({ method: 'GET', url: '/api/bestenliste/level?id=murmel:01', ip: '203.0.113.7', socket: { remoteAddress: '203.0.113.7' } } as never);
  assert.deepEqual(logged, { method: 'GET', url: '/api/bestenliste/level' });
  assert.doesNotMatch(JSON.stringify(logged), /203\.0\.113/);
});
