import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { CheckQueue, type Checker, type JobState, type LeaderboardStore, MAX_STEPS, OPEN_PER_ACCOUNT, parseRun, SUBMISSIONS_PER_HOUR } from './bestenliste.ts';
import { leaderboardStore } from './bestenliste-db.ts';
import { memoryLeaderboardStore } from './bestenliste-memory.ts';
import { gameChecker } from './bestenliste-pruefer.ts';
import { connect } from './db.ts';
import { type AccountStore, COOKIE, readCookie } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import type { Recording } from './loesbarkeit.ts';
import { migrate } from './migrate.ts';

const ORIGIN = 'https://murmel.example';
const REC: Recording = { v: 1, level: 'enigma:rb01', seed: 7, dt: 0.0025, steps: 500, result: 'sieg', input: [[400, 3, -2], [1, 'use'], [100, 0, 0]] };
const REPO = fileURLToPath(new URL('../..', import.meta.url));

// ---------- pure parts ----------

test('parseRun: Format wie bei Lösungen, höchstens eine Stunde, auch gezählte Eingaben', () => {
  assert.deepEqual(parseRun({ ...REC, extra: 1 }), REC);
  assert.match(String(parseRun({ ...REC, result: 'offen' })), /Bestenliste/);
  assert.match(String(parseRun({ ...REC, steps: MAX_STEPS + 1 })), /Stunde/);
  // a small declared step count with a huge counted input
  assert.match(String(parseRun({ ...REC, input: [[2 * MAX_STEPS, 0, 0]] })), /Stunde/);
  assert.match(String(parseRun({ ...REC, input: [[0, 0, 0]] })), /Eingaben/);
});

test('CheckQueue: der Reihe nach, höchstens N zugleich, Fehler werden zur Ablehnung', async () => {
  const q = new CheckQueue(1);
  const order: number[] = [];
  let running = 0;
  let most = 0;
  const job = (n: number) => async (): Promise<JobState> => {
    running++;
    most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    order.push(n);
    running--;
    if (n === 2) throw new Error('kaputt');
    return { status: 'abgelehnt', grund: String(n) };
  };
  const ids = [1, 2, 3].map((n) => q.add(9, job(n)));
  assert.equal(q.open(9), 3);
  await q.idle();
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(most, 1);
  assert.deepEqual(q.get(ids[1])!.state, { status: 'abgelehnt', grund: 'Die Prüfung ist fehlgeschlagen. Bitte versuch es später noch einmal.' });
  assert.equal(q.open(), 0);
});

// ---------- API with a stand-in checker ----------

/** Checker that "replays" by reading the steps from the recording; seed 13 = does not win. */
function fakeChecker(): Checker & { up: boolean; calls: number } {
  const c = {
    up: true,
    calls: 0,
    available: () => c.up,
    async check(rec: Recording) {
      c.calls++;
      if (rec.level === 'gibtsnicht') return { status: 'unbekannt' as const, steps: 0 };
      if (rec.seed === 13) return { status: 'nicht-geloest' as const, steps: rec.steps };
      // the replayed time differs from the reported one: the server's counts
      return { status: 'geloest' as const, steps: rec.steps + 1, levelHash: 'h' };
    },
  };
  return c;
}

describe('Bestenliste-API', () => {
  let sent: string[] = [];
  const mailer = { send: async (_to: string, _s: string, text: string) => void sent.push(text) };
  let clock = new Date('2026-11-13T10:00:00Z');

  function setup(checker: Checker = fakeChecker()) {
    sent = [];
    const accounts = memoryStore();
    const names = new Map<number, string>();
    const store = memoryLeaderboardStore(accounts, names);
    const app = buildApp({
      version: 'abcdef123456',
      db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
      accounts: { store: accounts, mailer, origin: ORIGIN, adminEmails: ['admin@example.de'], now: () => clock },
      leaderboard: { store, checker },
    });
    return { app, accounts, names, store };
  }
  async function signIn(a: FastifyInstance, email: string): Promise<string> {
    await a.inject({ method: 'POST', url: '/api/konto/mail', payload: { email }, headers: { origin: ORIGIN } });
    const token = /#anmelden=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!)![1];
    const r = await a.inject({ method: 'POST', url: '/api/konto/mail/einloesen', payload: { token }, headers: { origin: ORIGIN } });
    return readCookie(String(r.headers['set-cookie']).split(';')[0], COOKIE)!;
  }
  const call = (a: FastifyInstance, method: 'GET' | 'POST' | 'DELETE', url: string, cookie?: string, payload?: object) =>
    a.inject({ method, url, payload, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });

  /** Submits and waits for the result. */
  async function submit(a: FastifyInstance, cookie: string, rec: object): Promise<JobState & Record<string, unknown>> {
    const r = await call(a, 'POST', '/api/bestenliste', cookie, rec);
    assert.equal(r.statusCode, 202, r.body);
    const { id } = r.json();
    for (;;) {
      const s = (await call(a, 'GET', `/api/bestenliste/pruefung/${id}`, cookie)).json();
      if (s.status !== 'wartet') return s;
      await new Promise((ok) => setTimeout(ok, 2));
    }
  }

  test('Einreichen: nur mit Konto; die nachgespielte Zeit zählt; Platz und Anzahl in der Antwort', async () => {
    const { app, names } = setup();
    assert.equal((await call(app, 'POST', '/api/bestenliste', undefined, REC)).statusCode, 401);
    const anna = await signIn(app, 'anna@example.de');
    names.set(1, 'Anna');
    assert.equal((await call(app, 'POST', '/api/bestenliste', anna, { ...REC, v: 2 })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/bestenliste', payload: REC, headers: { origin: 'https://boese.example', cookie: `${COOKIE}=${anna}` } })).statusCode, 403);

    assert.deepEqual(await submit(app, anna, REC), { status: 'angenommen', lauf: 501, zeit: 501, neu: true, platz: 1, von: 1 });
    // slower: no change; faster: replaces
    assert.deepEqual(await submit(app, anna, { ...REC, steps: 600 }), { status: 'angenommen', lauf: 601, zeit: 501, neu: false, platz: 1, von: 1 });
    assert.deepEqual(await submit(app, anna, { ...REC, steps: 400 }), { status: 'angenommen', lauf: 401, zeit: 401, neu: true, platz: 1, von: 1 });

    const rejected = await submit(app, anna, { ...REC, seed: 13 });
    assert.deepEqual(rejected, { status: 'abgelehnt', grund: 'Beim Nachspielen wurde das Level nicht gelöst.' });
    const old = await submit(app, anna, { ...REC, seed: 13, version: '1234567' });
    assert.match(String(old.grund), /neu laden/);
    assert.match(String((await submit(app, anna, { ...REC, level: 'gibtsnicht' })).grund), /gibt es/);

    // someone else's check is not visible
    const bert = await signIn(app, 'bert@example.de');
    const r = await call(app, 'POST', '/api/bestenliste', anna, REC);
    assert.equal((await call(app, 'GET', `/api/bestenliste/pruefung/${r.json().id}`, bert)).statusCode, 404);
  });

  test('Rangliste: Top 100 und eigener Platz, Gleichstand nach Zeitpunkt, Anzeigename statt Mailadresse, gesperrte Konten ausgeblendet', async () => {
    const { app, names, accounts } = setup();
    const anna = await signIn(app, 'anna@example.de');
    const bert = await signIn(app, 'bert@example.de');
    const cora = await signIn(app, 'cora@example.de');
    names.set(1, 'Anna');
    names.set(2, 'Bert');
    clock = new Date('2026-11-13T10:00:00Z');
    await submit(app, bert, { ...REC, steps: 300 });
    clock = new Date('2026-11-13T10:05:00Z');
    await submit(app, anna, { ...REC, steps: 300 }); // same time, later: behind Bert
    const c = await submit(app, cora, { ...REC, steps: 200 });
    assert.deepEqual([c.platz, c.von], [1, 3]);

    const list = (await call(app, 'GET', '/api/bestenliste/level?id=enigma%3Arb01', anna)).json();
    assert.equal(list.anzahl, 3);
    assert.deepEqual(list.eintraege.map((e: { platz: number; name: string | null; zeit: number; ich: boolean }) => [e.platz, e.name, e.zeit, e.ich]), [
      [1, null, 201, false],
      [2, 'Bert', 301, false],
      [3, 'Anna', 301, true],
    ]);
    assert.deepEqual([list.ich.platz, list.ich.zeit], [3, 301]);
    assert.doesNotMatch(JSON.stringify(list), /@/);
    // open without account
    const open = (await call(app, 'GET', '/api/bestenliste/level?id=enigma%3Arb01')).json();
    assert.equal(open.ich, null);
    assert.equal((await call(app, 'GET', '/api/bestenliste/level?id=%3Cx%3E')).statusCode, 400);

    assert.deepEqual((await call(app, 'GET', '/api/bestenliste/meine', anna)).json(), { levels: { 'enigma:rb01': { zeit: 301, platz: 3 } } });
    assert.equal((await call(app, 'GET', '/api/bestenliste/meine')).statusCode, 401);

    // blocked: no new runs, and out of the rankings
    await accounts.setBlocked(3, true, clock);
    assert.equal((await call(app, 'POST', '/api/bestenliste', cora, REC)).statusCode, 403);
    const after = (await call(app, 'GET', '/api/bestenliste/level?id=enigma%3Arb01', anna)).json();
    assert.deepEqual([after.anzahl, after.ich.platz], [2, 2]);
  });

  test('Löschen: eigener Eintrag und Admin, sonst niemand', async () => {
    const { app, names } = setup();
    const anna = await signIn(app, 'anna@example.de');
    const bert = await signIn(app, 'bert@example.de');
    const admin = await signIn(app, 'admin@example.de');
    names.set(1, 'Anna');
    await submit(app, anna, REC);
    await submit(app, bert, { ...REC, steps: 900 });
    const [a, b] = (await call(app, 'GET', '/api/bestenliste/level?id=enigma%3Arb01')).json().eintraege;
    assert.equal((await call(app, 'DELETE', `/api/bestenliste/eintrag/${a.id}`)).statusCode, 401);
    assert.equal((await call(app, 'DELETE', `/api/bestenliste/eintrag/${a.id}`, bert)).statusCode, 403);
    assert.equal((await call(app, 'DELETE', `/api/bestenliste/eintrag/${a.id}`, anna)).statusCode, 204);
    assert.equal((await call(app, 'DELETE', `/api/bestenliste/eintrag/${b.id}`, admin)).statusCode, 204);
    assert.equal((await call(app, 'DELETE', `/api/bestenliste/eintrag/${b.id}`, admin)).statusCode, 404);
    assert.equal((await call(app, 'GET', '/api/bestenliste/level?id=enigma%3Arb01')).json().anzahl, 0);
  });

  test('Grenzen: offene Prüfungen je Konto, Einreichungen je Stunde, kein Spielcode', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const slow: Checker = { available: () => true, check: async (rec) => (await gate, { status: 'geloest', steps: rec.steps, levelHash: 'h' }) };
    const s = setup(slow);
    const anna = await signIn(s.app, 'anna@example.de');
    for (let i = 0; i < OPEN_PER_ACCOUNT; i++) assert.equal((await call(s.app, 'POST', '/api/bestenliste', anna, REC)).statusCode, 202);
    assert.equal((await call(s.app, 'POST', '/api/bestenliste', anna, REC)).statusCode, 429);
    release();

    const fast = setup();
    const bert = await signIn(fast.app, 'bert@example.de');
    for (let i = 0; i < SUBMISSIONS_PER_HOUR; i++) await submit(fast.app, bert, REC);
    assert.equal((await call(fast.app, 'POST', '/api/bestenliste', bert, REC)).statusCode, 429);

    const checker = fakeChecker();
    checker.up = false;
    const off = setup(checker);
    const cora = await signIn(off.app, 'cora@example.de');
    assert.equal((await call(off.app, 'POST', '/api/bestenliste', cora, REC)).statusCode, 503);
    assert.equal((await call(off.app, 'GET', '/api/bestenliste/level?id=a')).statusCode, 200);
  });

  // ---------- end to end: the real game code replays a real recording ----------

  test('Ende zu Ende: echte Lösung aus solutions/ wird angenommen, eine manipulierte abgelehnt', { timeout: 180_000 }, async () => {
    const checker = gameChecker(REPO, { timeoutMs: 90_000, nice: 0 });
    after(() => checker.close());
    assert.equal(checker.available(), true);
    const { app, store } = setup(checker);
    const anna = await signIn(app, 'anna@example.de');
    const real = JSON.parse(readFileSync(new URL('../../solutions/murmel/01.json', import.meta.url), 'utf8')) as Recording;

    const ok = await submit(app, anna, real);
    assert.equal(ok.status, 'angenommen', JSON.stringify(ok));
    assert.equal(ok.lauf, real.steps);
    assert.deepEqual([ok.platz, ok.von, ok.neu], [1, 1, true]);
    assert.equal((store as ReturnType<typeof memoryLeaderboardStore>).rows[0].steps, real.steps);

    // manipulated: the same inputs with a faster time claimed – the replay does not accept it
    assert.equal((await submit(app, anna, { ...real, steps: 100 })).status, 'abgelehnt');

    // manipulated: same length, but every push removed – the marble never gets there
    const still = { ...real, input: (real.input as unknown[][]).map((e) => (typeof e[1] === 'number' ? [e[0], 0, 0] : e)) };
    const bad = await submit(app, anna, still);
    assert.deepEqual(bad, { status: 'abgelehnt', grund: 'Beim Nachspielen wurde das Level nicht gelöst.' });
    // manipulated: a level that does not exist
    assert.equal((await submit(app, anna, { ...real, level: 'enigma:gibt_es_nicht' })).status, 'abgelehnt');
  });
});

// ---------- PostgreSQL ----------

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Bestenliste in PostgreSQL: nur bessere Läufe ersetzen, Rangfolge, gesperrte Konten, Löschen mit dem Konto', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  await sql!`delete from leaderboard`;
  const accounts: AccountStore = accountStore(sql!);
  const store: LeaderboardStore = leaderboardStore(sql!);
  const acc = async (mail: string, name: string | null) => {
    const a = await accounts.signIn({ provider: 'mail', subject: mail, email: mail }, 'player');
    await sql!`update accounts set display_name = ${name} where id = ${a.id}`;
    return a.id;
  };
  const tag = `${Date.now()}`;
  const anna = await acc(`anna-${tag}@example.de`, `Anna${tag}`);
  const bert = await acc(`bert-${tag}@example.de`, null);
  const cora = await acc(`cora-${tag}@example.de`, `Cora${tag}`);
  const run = (accountId: number, steps: number, at: string) => store.submit({ accountId, level: 'enigma:db', steps, levelHash: 'h', version: 'v', recording: REC, now: new Date(at) });

  assert.deepEqual(await run(anna, 500, '2026-11-13T10:00:00Z'), { improved: true, steps: 500 });
  assert.deepEqual(await run(anna, 600, '2026-11-13T10:01:00Z'), { improved: false, steps: 500 });
  assert.deepEqual(await run(bert, 500, '2026-11-13T09:00:00Z'), { improved: true, steps: 500 });
  assert.deepEqual(await run(cora, 400, '2026-11-13T11:00:00Z'), { improved: true, steps: 400 });

  const all = await store.ranking('enigma:db', 100, anna);
  assert.equal(all.total, 3);
  assert.deepEqual(all.entries.map((e) => [e.rank, e.accountId, e.name, e.steps]), [
    [1, cora, `Cora${tag}`, 400],
    [2, bert, null, 500],
    [3, anna, `Anna${tag}`, 500],
  ]);
  // only the own entry beyond the limit
  assert.deepEqual((await store.ranking('enigma:db', 1, anna)).entries.map((e) => e.rank), [1, 3]);
  assert.deepEqual(await store.mine(anna), [{ level: 'enigma:db', steps: 500, rank: 3 }]);

  await accounts.setBlocked(cora, true, new Date());
  assert.deepEqual((await store.ranking('enigma:db', 100, null)).entries.map((e) => e.accountId), [bert, anna]);
  assert.deepEqual(await store.mine(anna), [{ level: 'enigma:db', steps: 500, rank: 2 }]);

  const e = all.entries.find((x) => x.accountId === bert)!;
  assert.deepEqual(await store.entry(e.id), { id: e.id, accountId: bert, level: 'enigma:db' });
  assert.equal(await store.remove(e.id), true);
  assert.equal(await store.remove(e.id), false);
  await accounts.deleteAccount(anna);
  assert.equal((await sql!`select count(*)::int as n from leaderboard where account_id = ${anna}`)[0].n, 0);
});
