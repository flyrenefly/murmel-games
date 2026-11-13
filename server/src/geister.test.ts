import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Checker } from './bestenliste.ts';
import { leaderboardStore } from './bestenliste-db.ts';
import { memoryLeaderboardStore } from './bestenliste-memory.ts';
import { connect } from './db.ts';
import { GHOSTS_PER_LEVEL } from './geister.ts';
import { ghostStore } from './geister-db.ts';
import { memoryGhostStore } from './geister-memory.ts';
import { COOKIE, readCookie } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import type { Recording } from './loesbarkeit.ts';
import { migrate } from './migrate.ts';

const ORIGIN = 'https://murmel.example';
const REC: Recording = { v: 1, level: 'enigma:g1', seed: 7, dt: 0.0025, steps: 500, result: 'sieg', input: [[500, 3, -2]] };
const noChecker: Checker = { available: () => false, check: async () => ({ status: 'fehler', steps: 0 }) };

describe('Geister-API', () => {
  let sent: string[] = [];
  const mailer = { send: async (_to: string, _s: string, text: string) => void sent.push(text) };
  const clock = new Date('2026-11-13T10:00:00Z');

  function setup() {
    sent = [];
    const accounts = memoryStore();
    const names = new Map<number, string>();
    const board = memoryLeaderboardStore(accounts, names);
    const ghosts = memoryGhostStore(board);
    const app = buildApp({
      version: 'v',
      db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
      accounts: { store: accounts, mailer, origin: ORIGIN, adminEmails: [], now: () => clock },
      leaderboard: { store: board, checker: noChecker },
      ghosts,
    });
    const run = (accountId: number, steps: number, level = REC.level) =>
      board.submit({ accountId, level, steps, levelHash: 'h', version: 'v', recording: { ...REC, level, steps }, now: clock });
    return { app, accounts, names, board, ghosts, run };
  }
  async function signIn(a: FastifyInstance, email: string): Promise<string> {
    await a.inject({ method: 'POST', url: '/api/konto/mail', payload: { email }, headers: { origin: ORIGIN } });
    const token = /#anmelden=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!)![1];
    const r = await a.inject({ method: 'POST', url: '/api/konto/mail/einloesen', payload: { token }, headers: { origin: ORIGIN } });
    return readCookie(String(r.headers['set-cookie']).split(';')[0], COOKIE)!;
  }
  const call = (a: FastifyInstance, method: 'GET' | 'PUT', url: string, cookie?: string, payload?: object) =>
    a.inject({ method, url, payload, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });

  test('Freigabe: Standard aus, nur mit Konto, ein- und ausschaltbar', async () => {
    const { app } = setup();
    assert.equal((await call(app, 'GET', '/api/geister/freigabe')).statusCode, 401);
    const anna = await signIn(app, 'anna@example.de');

    assert.deepEqual((await call(app, 'GET', '/api/geister/freigabe', anna)).json(), { an: false });
    assert.equal((await call(app, 'PUT', '/api/geister/freigabe', anna, { an: true })).statusCode, 204);
    assert.deepEqual((await call(app, 'GET', '/api/geister/freigabe', anna)).json(), { an: true });
    assert.equal((await call(app, 'PUT', '/api/geister/freigabe', anna, { an: 'ja' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/geister/freigabe', payload: { an: false }, headers: { origin: 'https://boese.example', cookie: `${COOKIE}=${anna}` } })).statusCode, 403);
  });

  test('Liste je Level: eigener Lauf immer, fremde nur mit Freigabe, nach Platz, ohne Mailadressen', async () => {
    const { app, names, run } = setup();
    const anna = await signIn(app, 'anna@example.de');
    const bert = await signIn(app, 'bert@example.de');
    await signIn(app, 'cora@example.de');
    names.set(1, 'Anna');
    names.set(2, 'Bert');
    await run(1, 600);
    await run(2, 400);
    await run(3, 500);
    await call(app, 'PUT', '/api/geister/freigabe', bert, { an: true });

    const r = await call(app, 'GET', `/api/geister/level?id=${REC.level}`, anna);
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().geister.map((g: { name: string; zeit: number; platz: number; ich: boolean }) => [g.platz, g.name, g.zeit, g.ich]), [
      [1, 'Bert', 400, false],
      [3, 'Anna', 600, true],
    ]);
    assert.doesNotMatch(r.body, /@/);
    // without account: only consented runs
    assert.deepEqual((await call(app, 'GET', `/api/geister/level?id=${REC.level}`)).json().geister.map((g: { platz: number }) => g.platz), [1]);
    assert.equal((await call(app, 'GET', '/api/geister/level?id=<x>')).statusCode, 400);
  });

  test(`höchstens ${GHOSTS_PER_LEVEL} fremde Geister je Level`, async () => {
    const { app, accounts, ghosts, run } = setup();
    for (let i = 1; i <= GHOSTS_PER_LEVEL + 2; i++) {
      const a = await accounts.signIn({ provider: 'mail', subject: `s${i}@example.de`, email: `s${i}@example.de` }, 'player');
      await ghosts.setConsent(a.id, true, clock);
      await run(a.id, 1000 + i);
    }
    assert.equal((await call(app, 'GET', `/api/geister/level?id=${REC.level}`)).json().geister.length, GHOSTS_PER_LEVEL);
  });

  test('Lauf abrufen: eigener immer, fremder nur mit Freigabe und ungesperrt, sonst 404', async () => {
    const { app, accounts, board, run } = setup();
    const anna = await signIn(app, 'anna@example.de');
    const bert = await signIn(app, 'bert@example.de');
    await run(1, 600);
    await run(2, 400);
    const [annaId, bertId] = [1, 2].map((a) => board.rows.find((r) => r.accountId === a)!.id);

    const own = await call(app, 'GET', `/api/geister/lauf/${annaId}`, anna);
    assert.equal(own.statusCode, 200);
    assert.equal(own.json().steps, 600);
    assert.equal(own.headers['cache-control'], 'private, max-age=300');
    assert.equal((await call(app, 'GET', `/api/geister/lauf/${bertId}`, anna)).statusCode, 404);
    assert.equal((await call(app, 'GET', `/api/geister/lauf/${annaId}`)).statusCode, 404);

    await call(app, 'PUT', '/api/geister/freigabe', bert, { an: true });
    assert.equal((await call(app, 'GET', `/api/geister/lauf/${bertId}`)).json().steps, 400);

    await accounts.setBlocked(2, true, new Date());
    assert.equal((await call(app, 'GET', `/api/geister/lauf/${bertId}`)).statusCode, 404);
    assert.equal((await call(app, 'GET', '/api/geister/lauf/abc')).statusCode, 400);
    assert.equal((await call(app, 'GET', '/api/geister/lauf/999')).statusCode, 404);
  });
});

// ---------- PostgreSQL (only with TEST_DATABASE_URL, e.g. in the CI) ----------

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Geister in PostgreSQL: Freigabe, Abfrage mehrerer Konten, Lauf, Löschen mit dem Konto', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  const accounts = accountStore(sql!);
  const board = leaderboardStore(sql!);
  const ghosts = ghostStore(sql!);
  const tag = `${Date.now()}`;
  const a = (await accounts.signIn({ provider: 'mail', subject: `ga-${tag}@example.de`, email: `ga-${tag}@example.de` }, 'player')).id;
  const b = (await accounts.signIn({ provider: 'mail', subject: `gb-${tag}@example.de`, email: `gb-${tag}@example.de` }, 'player')).id;
  const level = `enigma:geist${tag}`;
  await board.submit({ accountId: a, level, steps: 450, levelHash: 'h', version: 'v', recording: { ...REC, level, steps: 450 }, now: new Date() });

  assert.equal(await ghosts.consent(a), false);
  await ghosts.setConsent(a, true, new Date());
  await ghosts.setConsent(a, true, new Date()); // twice is fine
  assert.equal(await ghosts.consent(a), true);
  assert.deepEqual([...(await ghosts.consenting([a, b]))], [a]);
  assert.deepEqual(await ghosts.consenting([]), new Set());

  const { entries } = await board.ranking(level, 10, null);
  const r = await ghosts.run(entries[0].id);
  assert.equal(r?.accountId, a);
  assert.equal(r?.recording.steps, 450);
  assert.equal(await ghosts.run(-1), null);

  await ghosts.setConsent(a, false, new Date());
  assert.equal(await ghosts.consent(a), false);
  await ghosts.setConsent(a, true, new Date());
  await accounts.deleteAccount(a);
  assert.deepEqual([...(await ghosts.consenting([a]))], []);
});
