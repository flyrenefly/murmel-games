import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { type AccountStore, COOKIE, hash } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { migrate } from './migrate.ts';
import { MAX_LEVELS, REQUESTS_PER_15_MIN, type SyncStore } from './sync.ts';
import { syncStore } from './sync-db.ts';
import { memorySyncStore } from './sync-memory.ts';

const ORIGIN = 'https://murmel.example';
const MINUTE = 60_000;

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

const backends: { name: string; skip: boolean; stores: () => Promise<{ accounts: AccountStore; sync: SyncStore }> }[] = [
  { name: 'Speicher', skip: false, stores: async () => ({ accounts: memoryStore(), sync: memorySyncStore() }) },
  {
    name: 'PostgreSQL',
    skip: !sql,
    stores: async () => {
      await sql!`truncate accounts, login_tokens, sessions, webauthn_challenges, passkeys, account_identities, progress_sync restart identity cascade`;
      return { accounts: accountStore(sql!), sync: syncStore(sql!) };
    },
  },
];

const BEST = { steps: 4000, falls: 1, seed: 7, date: '2026-11-13T10:00:00.000Z' };
const STAND = {
  levels: { 'enigma:rb01': { solves: 1, attempts: 3, best: BEST, lastPlayed: '2026-11-13T10:00:00.000Z', playSteps: 9000, falls: 2 } },
  solved: ['enigma:rb01'],
};

for (const backend of backends) {
  describe(`Sync (${backend.name})`, { skip: backend.skip }, () => {
    let accounts: AccountStore;
    let clock: Date;
    let app: FastifyInstance;

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      let sync: SyncStore;
      ({ accounts, sync } = await backend.stores());
      clock = new Date('2026-11-13T12:00:00Z');
      app = buildApp({
        version: 't',
        db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
        accounts: { store: accounts, mailer: null, origin: ORIGIN, adminEmails: [], now: () => clock },
        sync,
      });
    });

    async function user(email: string) {
      const a = await accounts.signIn({ provider: 'mail', subject: email, email }, 'player');
      const token = `sitzung-${email}`;
      await accounts.addSession(a.id, hash(token), new Date(clock.getTime() + 86_400_000));
      return { cookie: token, id: a.id };
    }
    const req = (method: 'GET' | 'PUT' | 'DELETE', cookie?: string, payload?: object, headers: Record<string, string> = {}) =>
      app.inject({ method, url: method === 'DELETE' ? '/api/konto' : '/api/fortschritt', payload, headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...headers } });

    test('ohne Konto: 401 beim Holen und Hochladen', async () => {
      assert.equal((await req('GET')).statusCode, 401);
      assert.equal((await req('PUT', undefined, { basis: 0, fortschritt: STAND })).statusCode, 401);
    });

    test('holen, hochladen, wieder holen; nur das eigene Konto', async () => {
      const a = await user('a@example.org');
      const b = await user('b@example.org');
      const leer = await req('GET', a.cookie);
      assert.equal(leer.statusCode, 200);
      assert.equal(leer.headers['cache-control'], 'no-store');
      assert.deepEqual(leer.json(), { version: 0, geaendert: null, fortschritt: { levels: {}, solved: [] } });

      const put = await req('PUT', a.cookie, { basis: 0, fortschritt: STAND }, { origin: ORIGIN });
      assert.equal(put.statusCode, 200, put.body);
      assert.deepEqual(put.json(), { version: 1, geaendert: clock.toISOString() });

      assert.deepEqual((await req('GET', a.cookie)).json(), { version: 1, geaendert: clock.toISOString(), fortschritt: STAND });
      assert.equal((await req('GET', b.cookie)).json().version, 0, 'B sieht nichts von A');
    });

    test('Versionskonflikt: 409 mit dem aktuellen Stand, nichts überschrieben', async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, { basis: 0, fortschritt: STAND })).statusCode, 200);
      // a second device that has not seen version 1 yet
      const alt = await req('PUT', a.cookie, { basis: 0, fortschritt: { levels: {}, solved: ['x'] } });
      assert.equal(alt.statusCode, 409);
      assert.deepEqual(alt.json().fortschritt, STAND);
      assert.equal(alt.json().version, 1);
      const weiter = await req('PUT', a.cookie, { basis: 1, fortschritt: { ...STAND, solved: ['enigma:rb01', 'x'] } });
      assert.equal(weiter.json().version, 2);
      assert.equal((await req('PUT', a.cookie, { basis: 1, fortschritt: STAND })).statusCode, 409);
    });

    test('Grenzen: ungültige Daten 400, zu viele Levels 400, unbekannte Felder fallen weg', async () => {
      const a = await user('a@example.org');
      const bad: object[] = [
        {},
        { basis: -1, fortschritt: STAND },
        { basis: 0, fortschritt: { levels: {} } },
        { basis: 0, fortschritt: { levels: { a: { solves: -1, attempts: 0 } }, solved: [] } },
        { basis: 0, fortschritt: { levels: { a: { solves: 1, attempts: 0, best: { ...BEST, steps: 0 } } }, solved: [] } },
        { basis: 0, fortschritt: { levels: { a: { solves: 1, attempts: 0, best: { ...BEST, seed: 2 ** 32 } } }, solved: [] } },
        { basis: 0, fortschritt: { levels: {}, solved: ['a\u0000b'] } },
        { basis: 0, fortschritt: { levels: {}, solved: ['x'.repeat(201)] } },
        { basis: 0, fortschritt: { levels: {}, solved: Array.from({ length: MAX_LEVELS + 1 }, (_, i) => `l${i}`) } },
      ];
      for (const b of bad) assert.equal((await req('PUT', a.cookie, b)).statusCode, 400, JSON.stringify(b).slice(0, 80));

      const extra = { basis: 0, fortschritt: { ...STAND, geheim: 1, levels: { 'enigma:rb01': { ...STAND.levels['enigma:rb01'], rang: 1 } } } };
      assert.equal((await req('PUT', a.cookie, extra)).statusCode, 200);
      assert.deepEqual((await req('GET', a.cookie)).json().fortschritt, STAND);
    });

    test('so viele Levels wie es gibt passen (1 MiB)', async () => {
      const a = await user('a@example.org');
      const levels: Record<string, object> = {};
      for (let i = 0; i < 3000; i++) levels[`enigma:paket_${i}`] = STAND.levels['enigma:rb01'];
      const r = await req('PUT', a.cookie, { basis: 0, fortschritt: { levels, solved: Object.keys(levels) } });
      assert.equal(r.statusCode, 200, r.body.slice(0, 200));
    });

    test('fremde Herkunft: 403', async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, { basis: 0, fortschritt: STAND }, { origin: 'https://boese.example' })).statusCode, 403);
    });

    test('Begrenzung je Konto: 429, ein anderes Konto und das nächste Fenster gehen wieder', async () => {
      const a = await user('a@example.org');
      const b = await user('b@example.org');
      for (let i = 0; i < REQUESTS_PER_15_MIN; i++) assert.equal((await req('GET', a.cookie)).statusCode, 200);
      assert.equal((await req('GET', a.cookie)).statusCode, 429);
      assert.equal((await req('PUT', a.cookie, { basis: 0, fortschritt: STAND })).statusCode, 429);
      assert.equal((await req('GET', b.cookie)).statusCode, 200);
      clock = new Date(clock.getTime() + 15 * MINUTE);
      assert.equal((await req('GET', a.cookie)).statusCode, 200);
    });

    test('gesperrt: lesen ja, schreiben 403', async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, { basis: 0, fortschritt: STAND })).statusCode, 200);
      await accounts.setBlocked(a.id, true, clock);
      assert.equal((await req('GET', a.cookie)).json().version, 1);
      assert.equal((await req('PUT', a.cookie, { basis: 1, fortschritt: STAND })).statusCode, 403);
    });

    test('Konto löschen löscht den Fortschritt', { skip: !sql || backend.name !== 'PostgreSQL' }, async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, { basis: 0, fortschritt: STAND })).statusCode, 200);
      assert.equal((await req('DELETE', a.cookie, undefined, { origin: ORIGIN })).statusCode, 200);
      assert.equal((await sql!`select count(*)::int as n from progress_sync`)[0].n, 0);
    });
  });
}
