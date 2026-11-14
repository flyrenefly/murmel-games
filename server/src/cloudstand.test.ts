import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { type CloudSaveStore, KEEP_DAYS, MAX_DATA, MAX_SAVES, MAX_STEPS, REQUESTS_PER_15_MIN } from './cloudstand.ts';
import { cloudSaveStore } from './cloudstand-db.ts';
import { memoryCloudSaveStore } from './cloudstand-memory.ts';
import { connect } from './db.ts';
import { type AccountStore, COOKIE, hash } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { migrate } from './migrate.ts';

const ORIGIN = 'https://murmel.example';
const MINUTE = 60_000;
const DAY = 86_400_000;

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

const backends: { name: string; skip: boolean; stores: () => Promise<{ accounts: AccountStore; saves: CloudSaveStore }> }[] = [
  { name: 'Speicher', skip: false, stores: async () => ({ accounts: memoryStore(), saves: memoryCloudSaveStore() }) },
  {
    name: 'PostgreSQL',
    skip: !sql,
    stores: async () => {
      await sql!`truncate accounts, login_tokens, sessions, webauthn_challenges, passkeys, account_identities, cloud_saves restart identity cascade`;
      return { accounts: accountStore(sql!), saves: cloudSaveStore(sql!) };
    },
  },
];

const LEVEL = 'enigma:rb01';
const STAND = { pack: 'enigma_i', seed: 4_000_000_000, leben: 2, steps: 4000, version: 'abc1234', pruef: '4000|0|1,0|a:b|12.345:6.789', daten: 'H4sIAAAAAAAAA6tWKkktLlGyUlAqzy/KSVFIL8osSU1RKMnILFIoyUxPVQIA/7YiPh0AAAA=' };

for (const backend of backends) {
  describe(`Cloudstand (${backend.name})`, { skip: backend.skip }, () => {
    let accounts: AccountStore;
    let saves: CloudSaveStore;
    let clock: Date;
    let app: FastifyInstance;

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      ({ accounts, saves } = await backend.stores());
      clock = new Date('2026-11-14T12:00:00Z');
      app = buildApp({
        version: 't',
        db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
        accounts: { store: accounts, mailer: null, origin: ORIGIN, adminEmails: [], now: () => clock },
        cloudSaves: { store: saves },
      });
    });

    async function user(email: string) {
      const a = await accounts.signIn({ provider: 'mail', subject: email, email }, 'player');
      const token = `sitzung-${email}`;
      await accounts.addSession(a.id, hash(token), new Date(clock.getTime() + 365 * DAY));
      return { cookie: token, id: a.id };
    }
    const req = (method: 'GET' | 'PUT' | 'DELETE', cookie: string | undefined, level?: string, payload?: object, headers: Record<string, string> = {}) =>
      app.inject({
        method,
        url: level === undefined ? '/api/spielstand' : `/api/spielstand?level=${encodeURIComponent(level)}`,
        payload,
        headers: { ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}), ...headers },
      });
    const tick = (ms = 1000) => (clock = new Date(clock.getTime() + ms));

    test('ohne Konto: 401 überall', async () => {
      assert.equal((await req('GET', undefined)).statusCode, 401);
      assert.equal((await req('GET', undefined, LEVEL)).statusCode, 401);
      assert.equal((await req('PUT', undefined, LEVEL, STAND)).statusCode, 401);
      assert.equal((await req('DELETE', undefined, LEVEL)).statusCode, 401);
    });

    test('sichern, auflisten, holen, überschreiben, löschen; nur das eigene Konto', async () => {
      const a = await user('a@example.org');
      const b = await user('b@example.org');
      const leer = await req('GET', a.cookie);
      assert.equal(leer.statusCode, 200);
      assert.equal(leer.headers['cache-control'], 'no-store');
      assert.deepEqual(leer.json(), { staende: [] });
      assert.equal((await req('GET', a.cookie, LEVEL)).statusCode, 404);

      const put = await req('PUT', a.cookie, LEVEL, STAND, { origin: ORIGIN });
      assert.equal(put.statusCode, 200, put.body);
      assert.deepEqual(put.json(), { gespeichert: clock.toISOString() });
      const gespeichert = clock.toISOString();

      assert.deepEqual((await req('GET', a.cookie)).json(), { staende: [{ level: LEVEL, pack: STAND.pack, steps: STAND.steps, gespeichert }] });
      assert.deepEqual((await req('GET', a.cookie, LEVEL)).json(), { level: LEVEL, ...STAND, gespeichert });
      assert.equal((await req('GET', b.cookie, LEVEL)).statusCode, 404, 'B sieht nichts von A');
      assert.deepEqual((await req('GET', b.cookie)).json(), { staende: [] });

      // the newest save wins; without lives (null) too
      tick();
      assert.equal((await req('PUT', a.cookie, LEVEL, { ...STAND, steps: 9000, leben: null })).statusCode, 200);
      const neu = (await req('GET', a.cookie, LEVEL)).json();
      assert.equal(neu.steps, 9000);
      assert.equal(neu.leben, null);
      assert.equal((await req('GET', a.cookie)).json().staende.length, 1);

      assert.equal((await req('DELETE', b.cookie, LEVEL)).statusCode, 204, 'B löscht nichts von A');
      assert.equal((await req('GET', a.cookie, LEVEL)).statusCode, 200);
      assert.equal((await req('DELETE', a.cookie, LEVEL, undefined, { origin: ORIGIN })).statusCode, 204);
      assert.equal((await req('GET', a.cookie, LEVEL)).statusCode, 404);
      assert.equal((await req('DELETE', a.cookie, LEVEL)).statusCode, 204, 'löschen ohne Stand geht auch');
    });

    test('Level-Kennungen mit / und : im Query', async () => {
      const a = await user('a@example.org');
      const id = 'enigma_iv/ant03_3:x y';
      assert.equal((await req('PUT', a.cookie, id, STAND)).statusCode, 200);
      assert.equal((await req('GET', a.cookie, id)).json().level, id);
    });

    test('Grenzen: ungültige Daten 400', async () => {
      const a = await user('a@example.org');
      const bad: [string | undefined, object][] = [
        [undefined, STAND],
        ['', STAND],
        ['x'.repeat(201), STAND],
        ['a\u0001b', STAND],
        [LEVEL, {}],
        [LEVEL, { ...STAND, seed: 2 ** 32 }],
        [LEVEL, { ...STAND, seed: -1 }],
        [LEVEL, { ...STAND, leben: 100 }],
        [LEVEL, { ...STAND, steps: 0 }],
        [LEVEL, { ...STAND, steps: MAX_STEPS + 1 }],
        [LEVEL, { ...STAND, version: '' }],
        [LEVEL, { ...STAND, version: 'a b' }],
        [LEVEL, { ...STAND, pruef: '<script>' }],
        [LEVEL, { ...STAND, pack: '' }],
        [LEVEL, { ...STAND, daten: '' }],
        [LEVEL, { ...STAND, daten: 'kein base64!' }],
        [LEVEL, { ...STAND, daten: 'A'.repeat(MAX_DATA + 4) }],
      ];
      for (const [level, b] of bad) assert.equal((await req('PUT', a.cookie, level, b)).statusCode, 400, `${level} ${JSON.stringify(b).slice(-120)}`);
      assert.deepEqual((await req('GET', a.cookie)).json(), { staende: [] });
      // unknown fields are dropped (as in sync)
      assert.equal((await req('PUT', a.cookie, LEVEL, { ...STAND, geheim: 1 })).statusCode, 200);
      assert.equal((await req('GET', a.cookie, LEVEL)).json().geheim, undefined);
    });

    test('ein großer Stand (knapp 2 MB) passt', async () => {
      const a = await user('a@example.org');
      const r = await req('PUT', a.cookie, LEVEL, { ...STAND, daten: 'A'.repeat(MAX_DATA) });
      assert.equal(r.statusCode, 200, r.body.slice(0, 200));
      assert.equal((await req('GET', a.cookie, LEVEL)).json().daten.length, MAX_DATA);
    });

    test(`höchstens ${MAX_SAVES} Stände: der älteste fällt weg`, async () => {
      const a = await user('a@example.org');
      for (let i = 0; i < MAX_SAVES; i++) {
        tick();
        assert.equal((await req('PUT', a.cookie, `l${i}`, STAND)).statusCode, 200);
      }
      // l0 saved again: now l1 is the oldest
      tick();
      assert.equal((await req('PUT', a.cookie, 'l0', STAND)).statusCode, 200);
      tick();
      assert.equal((await req('PUT', a.cookie, 'neu', STAND)).statusCode, 200);
      const levels = (await req('GET', a.cookie)).json().staende.map((s: { level: string }) => s.level);
      assert.equal(levels.length, MAX_SAVES);
      assert.equal(levels[0], 'neu', 'neueste zuerst');
      assert.ok(levels.includes('l0'));
      assert.ok(!levels.includes('l1'));
    });

    test(`nach ${KEEP_DAYS} Tagen unsichtbar und vom Aufräumen gelöscht`, async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, LEVEL, STAND)).statusCode, 200);
      tick(KEEP_DAYS * DAY - MINUTE);
      assert.equal((await req('GET', a.cookie, LEVEL)).statusCode, 200);
      assert.equal((await req('PUT', a.cookie, 'jung', STAND)).statusCode, 200);
      tick(2 * MINUTE);
      assert.equal((await req('GET', a.cookie, LEVEL)).statusCode, 404);
      assert.deepEqual((await req('GET', a.cookie)).json().staende.map((s: { level: string }) => s.level), ['jung']);
      assert.equal(await saves.expire(new Date(clock.getTime() - KEEP_DAYS * DAY)), 1);
      assert.equal(await saves.get(a.id, LEVEL), null);
      assert.ok(await saves.get(a.id, 'jung'));
    });

    test('fremde Herkunft: 403 beim Schreiben und Löschen', async () => {
      const a = await user('a@example.org');
      const evil = { origin: 'https://boese.example' };
      assert.equal((await req('PUT', a.cookie, LEVEL, STAND, evil)).statusCode, 403);
      assert.equal((await req('DELETE', a.cookie, LEVEL, undefined, evil)).statusCode, 403);
    });

    test('Begrenzung je Konto: 429, ein anderes Konto und das nächste Fenster gehen wieder', async () => {
      const a = await user('a@example.org');
      const b = await user('b@example.org');
      for (let i = 0; i < REQUESTS_PER_15_MIN; i++) assert.equal((await req('GET', a.cookie)).statusCode, 200);
      assert.equal((await req('GET', a.cookie)).statusCode, 429);
      assert.equal((await req('PUT', a.cookie, LEVEL, STAND)).statusCode, 429);
      assert.equal((await req('GET', b.cookie)).statusCode, 200);
      tick(15 * MINUTE);
      assert.equal((await req('GET', a.cookie)).statusCode, 200);
    });

    test('gesperrt: lesen und löschen ja, sichern 403', async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, LEVEL, STAND)).statusCode, 200);
      await accounts.setBlocked(a.id, true, clock);
      assert.equal((await req('GET', a.cookie, LEVEL)).statusCode, 200);
      assert.equal((await req('PUT', a.cookie, LEVEL, STAND)).statusCode, 403);
      assert.equal((await req('DELETE', a.cookie, LEVEL)).statusCode, 204);
    });

    test('Konto löschen löscht die Stände', { skip: !sql || backend.name !== 'PostgreSQL' }, async () => {
      const a = await user('a@example.org');
      assert.equal((await req('PUT', a.cookie, LEVEL, STAND)).statusCode, 200);
      const del = await app.inject({ method: 'DELETE', url: '/api/konto', headers: { cookie: `${COOKIE}=${a.cookie}`, origin: ORIGIN } });
      assert.equal(del.statusCode, 200);
      assert.equal((await sql!`select count(*)::int as n from cloud_saves`)[0].n, 0);
    });
  });
}
