import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import type { AccountStore } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { type Recording, recordingHash, type SolvabilityStore } from './loesbarkeit.ts';
import { solvabilityStore } from './loesbarkeit-db.ts';
import { memorySolvabilityStore } from './loesbarkeit-memory.ts';
import { migrate } from './migrate.ts';
import { REQUESTS_PER_MINUTE, SOLUTIONS_PER_LEVEL } from './tipps.ts';

const ORIGIN = 'https://murmel.example';
const rec = (level: string, steps: number, seed = 1): Recording => ({ v: 1, level, seed, dt: 0.0025, steps, result: 'sieg', input: [[steps, 3, -2]] });
const db = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) };

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

const backends: { name: string; skip: boolean; stores: () => Promise<{ accounts: AccountStore; solvability: SolvabilityStore }> }[] = [
  { name: 'Speicher', skip: false, stores: async () => ({ accounts: memoryStore(), solvability: memorySolvabilityStore() }) },
  {
    name: 'PostgreSQL',
    skip: !sql,
    stores: async () => {
      await sql!`truncate accounts, solutions restart identity cascade`;
      return { accounts: accountStore(sql!), solvability: solvabilityStore(sql!) };
    },
  },
];

for (const backend of backends) {
  describe(`Tipps-API (${backend.name})`, { skip: backend.skip }, () => {
    let app: FastifyInstance;
    let store: SolvabilityStore;
    let accounts: AccountStore;
    let clock: Date;

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      ({ accounts, solvability: store } = await backend.stores());
      clock = new Date('2026-11-13T10:00:00Z');
      app = buildApp({ version: 'v', db, accounts: { store: accounts, mailer: { send: async () => {} }, origin: ORIGIN, adminEmails: ['admin@example.de'], now: () => clock }, solvability: store, now: () => clock });
    });

    const add = async (r: Recording, accountId: number | null = null) => store.addSolution({ level: r.level, recordingHash: recordingHash(r), recording: r, steps: r.steps, accountId });
    const get = (level: string) => app.inject({ method: 'GET', url: `/api/tipps/loesungen?${new URLSearchParams({ level })}` });

    test('liefert ohne Anmeldung die Lösungen eines Levels, kürzeste zuerst, höchstens drei', async () => {
      for (const steps of [900, 500, 700, 800]) await add(rec('enigma:m_tutor/m_tut1', steps));
      await add(rec('01', 100));

      const res = await get('enigma:m_tutor/m_tut1');

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['cache-control'], 'public, max-age=3600');
      const body = res.json() as { loesungen: Recording[] };
      assert.equal(body.loesungen.length, SOLUTIONS_PER_LEVEL);
      assert.deepEqual(body.loesungen.map((l) => l.steps), [500, 700, 800]);
      assert.deepEqual(body.loesungen[0], rec('enigma:m_tutor/m_tut1', 500));
    });

    test('nur die Aufzeichnung: kein Konto, keine ID, kein Datum, keine fremden Felder', async () => {
      const admin = await accounts.signIn({ provider: 'mail', subject: 'admin@example.de', email: 'admin@example.de' }, 'admin');
      await add({ ...rec('02', 300), extra: 'geheim' } as Recording, admin.id);

      const text = (await get('02')).body;

      assert.deepEqual(Object.keys((JSON.parse(text) as { loesungen: object[] }).loesungen[0]).sort(), ['dt', 'input', 'level', 'result', 'seed', 'steps', 'v']);
      assert.doesNotMatch(text, /admin@|geheim|createdAt|account/i);
    });

    test('ohne Lösung eine leere Liste', async () => {
      const res = await get('03');

      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), { loesungen: [] });
    });

    test('ungültige Level-Kennung: 400', async () => {
      assert.equal((await get('<script>')).statusCode, 400);
      assert.equal((await app.inject({ method: 'GET', url: '/api/tipps/loesungen' })).statusCode, 400);
    });

    test('begrenzt die Anfragen je Adresse und Minute', async () => {
      for (let i = 0; i < REQUESTS_PER_MINUTE; i++) assert.equal((await get('01')).statusCode, 200);
      assert.equal((await get('01')).statusCode, 429);
      clock = new Date(clock.getTime() + 60_000);
      assert.equal((await get('01')).statusCode, 200);
    });
  });
}
