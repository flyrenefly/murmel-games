import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { CatalogEntry, Checker } from './bestenliste.ts';
import { memoryLeaderboardStore } from './bestenliste-memory.ts';
import { connect } from './db.ts';
import { COOKIE, readCookie } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import type { CheckResult, Recording } from './loesbarkeit.ts';
import { memorySolvabilityStore } from './loesbarkeit-memory.ts';
import { migrate } from './migrate.ts';
import { isOpen, periods, pick, seedFor } from './tageslevel.ts';
import { dailyStore } from './tageslevel-db.ts';
import { memoryDailyStore } from './tageslevel-memory.ts';

const cat = (ids: string[]): CatalogEntry[] => ids.map((id, i) => ({ id, pack: 'p', index: i, title: `T ${id}` }));

// ---------- pure parts ----------

test('Zeiträume: Berliner Tag und ISO-Woche, Ende in Berliner Zeit (auch bei Zeitumstellung)', () => {
  // 23:30 UTC am 13.11. ist in Berlin schon Samstag, der 14.11.
  const p = periods(new Date('2026-11-13T23:30:00Z'));
  assert.equal(p.tag.zeitraum, '2026-11-14');
  assert.equal(p.tag.bis.toISOString(), '2026-11-14T23:00:00.000Z');
  assert.equal(p.woche.zeitraum, '2026-W46');
  assert.equal(p.woche.bis.toISOString(), '2026-11-15T23:00:00.000Z');
  // Sommerzeit endet am 25.10.2026: der Tag hat 25 Stunden, endet um 23:00 UTC
  assert.equal(periods(new Date('2026-10-25T10:00:00Z')).tag.bis.toISOString(), '2026-10-25T23:00:00.000Z');
  assert.equal(periods(new Date('2026-03-29T10:00:00Z')).tag.bis.toISOString(), '2026-03-29T22:00:00.000Z');
  // Jahreswechsel: der 1.1.2027 (Freitag) gehört zur Woche 53 von 2026, der 4.1.2027 zur Woche 1
  assert.equal(periods(new Date('2027-01-01T12:00:00Z')).woche.zeitraum, '2026-W53');
  assert.equal(periods(new Date('2027-01-04T12:00:00Z')).woche.zeitraum, '2027-W01');
});

test('isOpen: aktuell oder höchstens 15 Minuten vorbei', () => {
  const at = (s: string) => new Date(s);
  assert.equal(isOpen('tag', '2026-11-13', at('2026-11-13T12:00:00Z')), true);
  assert.equal(isOpen('tag', '2026-11-13', at('2026-11-13T23:10:00Z')), true); // 00:10 in Berlin
  assert.equal(isOpen('tag', '2026-11-13', at('2026-11-13T23:20:00Z')), false);
  assert.equal(isOpen('tag', '2026-11-14', at('2026-11-13T12:00:00Z')), false); // future
  assert.equal(isOpen('woche', '2026-W46', at('2026-11-13T12:00:00Z')), true);
  assert.equal(isOpen('woche', '2026-W45', at('2026-11-13T12:00:00Z')), false);
});

test('pick: gelöste zuerst, 60 Tage frei; sonst Ladeprobe; immer gleich für denselben Zeitraum', () => {
  const all = cat(['a', 'b', 'c', 'd', 'e', 'f']);
  const probeOk = new Set(['a', 'b', 'c', 'd', 'e']);

  const p1 = pick('tag', '2026-11-13', all, { proven: new Set(['b', 'c']), probeOk, recent: new Set(['c']) });
  assert.equal(p1.id, 'b');
  // all proven ones were recent: any probe-ok level that was not
  const p2 = pick('tag', '2026-11-13', all, { proven: new Set(['b']), probeOk, recent: new Set(['b', 'a']) });
  assert.ok(['c', 'd', 'e'].includes(p2.id));
  // everything recent: still a probe-ok level, never one that failed the probe
  const p3 = pick('woche', '2026-W46', all, { proven: new Set(), probeOk, recent: new Set(['a', 'b', 'c', 'd', 'e', 'f']) });
  assert.ok(probeOk.has(p3.id));
  // no nightly run: every level counts as probed
  assert.ok(all.some((e) => e.id === pick('tag', 'x', all, { proven: new Set(), probeOk: null, recent: new Set() }).id));
  // deterministic
  const again = () => pick('tag', '2026-11-20', all, { proven: new Set(), probeOk, recent: new Set() }).id;
  assert.equal(again(), again());
  assert.equal(seedFor('tag', '2026-11-13'), seedFor('tag', '2026-11-13'));
  assert.notEqual(seedFor('tag', '2026-11-13'), seedFor('woche', '2026-11-13'));
  assert.ok(Number.isInteger(seedFor('tag', 'x')) && seedFor('tag', 'x') >= 0 && seedFor('tag', 'x') < 2 ** 32);
});

// ---------- API ----------

function fakeChecker(levels: string[]): Checker & { calls: number } {
  const c = {
    calls: 0,
    available: () => true,
    catalog: async () => cat(levels),
    async check(rec: Recording) {
      c.calls++;
      if (rec.steps === 13) return { status: 'nicht-geloest' as const, steps: 13 };
      return { status: 'geloest' as const, steps: rec.steps + 1, levelHash: 'h' };
    },
  };
  return c;
}

describe('Tageslevel-API', () => {
  let sent: string[] = [];
  const mailer = { send: async (_to: string, _s: string, text: string) => void sent.push(text) };
  let clock = new Date('2026-11-13T10:00:00Z');

  function setup(levels = ['01', 'enigma:a', 'enigma:b']) {
    sent = [];
    const accounts = memoryStore();
    const names = new Map<number, string>();
    const board = memoryLeaderboardStore(accounts, names);
    const solvability = memorySolvabilityStore();
    const daily = memoryDailyStore(accounts, names, board);
    const checker = fakeChecker(levels);
    const app = buildApp({
      version: 'abcdef123456',
      db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
      accounts: { store: accounts, mailer, origin: ORIGIN, adminEmails: [], now: () => clock },
      leaderboard: { store: board, checker },
      solvability,
      daily,
    });
    return { app, accounts, names, daily, checker, solvability };
  }
  async function signIn(a: FastifyInstance, email: string): Promise<string> {
    await a.inject({ method: 'POST', url: '/api/konto/mail', payload: { email }, headers: { origin: ORIGIN } });
    const token = /#anmelden=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!)![1];
    const r = await a.inject({ method: 'POST', url: '/api/konto/mail/einloesen', payload: { token }, headers: { origin: ORIGIN } });
    return readCookie(String(r.headers['set-cookie']).split(';')[0], COOKIE)!;
  }
  const call = (a: FastifyInstance, method: 'GET' | 'POST', url: string, cookie?: string, payload?: object) =>
    a.inject({ method, url, payload, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });
  async function submit(a: FastifyInstance, cookie: string, body: object) {
    const r = await call(a, 'POST', '/api/tageslevel/lauf', cookie, body);
    if (r.statusCode !== 202) return { code: r.statusCode, error: r.json().error };
    for (;;) {
      const s = (await call(a, 'GET', `/api/bestenliste/pruefung/${r.json().id}`, cookie)).json();
      if (s.status !== 'wartet') return s;
      await new Promise((ok) => setTimeout(ok, 2));
    }
  }

  test('GET wählt Tag und Woche einmal und bleibt dabei; gelöste Levels bevorzugt', async () => {
    clock = new Date('2026-11-13T10:00:00Z');
    const { app, solvability } = setup();
    // only enigma:b has a winning solution in the newest nightly run
    const res: CheckResult[] = ['01', 'enigma:a', 'enigma:b'].map((level) => ({ level, kind: 'probe', ref: '', status: 'ok', steps: 2000, recordedSteps: null, levelChanged: false, isNew: false, error: null }));
    res.push({ level: 'enigma:b', kind: 'solution', ref: 'repo:x', status: 'geloest', steps: 900, recordedSteps: 900, levelChanged: false, isNew: false, error: null });
    await solvability.saveRun({ startedAt: clock, finishedAt: clock, version: 'v', error: null, levels: 3, probeOk: 3, probeLua: 0, probeFailed: 0, solutions: 1, solved: 1, unsolved: 0, failed: 0, solvedLevels: 1, newFailures: 0 }, res);

    const r = await call(app, 'GET', '/api/tageslevel');
    assert.equal(r.statusCode, 200, r.body);
    const { tag, woche } = r.json();
    assert.equal(tag.art, 'tag');
    assert.equal(tag.zeitraum, '2026-11-13');
    assert.equal(tag.level, 'enigma:b');
    assert.deepEqual([tag.pack, tag.index, tag.titel], ['p', 2, 'T enigma:b']);
    assert.equal(tag.seed, seedFor('tag', '2026-11-13'));
    assert.equal(tag.bis, '2026-11-13T23:00:00.000Z');
    assert.deepEqual([tag.anzahl, tag.top, tag.ich], [0, [], null]);
    // the week avoids the level the day already took (recent)
    assert.equal(woche.zeitraum, '2026-W46');
    assert.notEqual(woche.level, 'enigma:b');
    assert.equal(r.headers['cache-control'], 'no-store');

    // the choice stays, even if the solution disappears
    await solvability.saveRun({ startedAt: clock, finishedAt: clock, version: 'v', error: null, levels: 3, probeOk: 3, probeLua: 0, probeFailed: 0, solutions: 0, solved: 0, unsolved: 0, failed: 0, solvedLevels: 0, newFailures: 0 }, res.slice(0, 3));
    assert.equal((await call(app, 'GET', '/api/tageslevel')).json().tag.level, 'enigma:b');
  });

  test('Einreichen: nur mit Konto, passendes Level und Startwert, nachgespielte Zeit, Rangliste', async () => {
    clock = new Date('2026-11-13T10:00:00Z');
    const { app, names, accounts } = setup();
    const { tag } = (await call(app, 'GET', '/api/tageslevel')).json();
    const rec = { art: 'tag', zeitraum: tag.zeitraum, v: 1, level: tag.level, seed: tag.seed, dt: 0.0025, steps: 500, result: 'sieg', input: [[500, 0, 0]] };

    assert.equal((await call(app, 'POST', '/api/tageslevel/lauf', undefined, rec)).statusCode, 401);
    const anna = await signIn(app, 'anna@example.de');
    const bert = await signIn(app, 'bert@example.de');
    names.set(1, 'Anna');
    names.set(2, 'Bert');

    assert.match((await submit(app, anna, { ...rec, seed: tag.seed ^ 1 })).error, /Startwert/);
    assert.match((await submit(app, anna, { ...rec, level: 'anderes' })).error, /Level/);
    assert.equal((await submit(app, anna, { ...rec, zeitraum: '2026-11-12' })).code, 404);
    assert.equal((await submit(app, anna, { ...rec, art: 'jahr' })).code, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/tageslevel/lauf', payload: rec, headers: { origin: 'https://boese.example', cookie: `${COOKIE}=${anna}` } })).statusCode, 403);

    assert.deepEqual(await submit(app, anna, rec), { status: 'angenommen', lauf: 501, zeit: 501, neu: true, platz: 1, von: 1 });
    assert.deepEqual(await submit(app, bert, { ...rec, steps: 400 }), { status: 'angenommen', lauf: 401, zeit: 401, neu: true, platz: 1, von: 2 });
    assert.deepEqual(await submit(app, anna, { ...rec, steps: 600 }), { status: 'angenommen', lauf: 601, zeit: 501, neu: false, platz: 2, von: 2 });
    assert.deepEqual(await submit(app, anna, { ...rec, steps: 13 }), { status: 'abgelehnt', grund: 'Beim Nachspielen wurde das Level nicht gelöst.' });

    const day = (await call(app, 'GET', '/api/tageslevel', anna)).json().tag;
    assert.deepEqual(day.top, [{ platz: 1, name: 'Bert', zeit: 401 }, { platz: 2, name: 'Anna', zeit: 501 }]);
    assert.deepEqual(day.ich, { platz: 2, zeit: 501 });
    assert.equal(day.anzahl, 2);
    assert.doesNotMatch(JSON.stringify(day), /@/);

    // blocked accounts drop out of the ranking
    await accounts.setBlocked(2, true, new Date());
    assert.deepEqual((await call(app, 'GET', '/api/tageslevel')).json().tag.top.map((e: { name: string }) => e.name), ['Anna']);

    // after midnight (+15 min grace) the day is closed
    clock = new Date('2026-11-13T23:20:00Z');
    assert.match((await submit(app, anna, { ...rec, steps: 300 })).error, /vorbei/);
  });

  test('ohne Levelkatalog antwortet GET mit 503', async () => {
    const accounts = memoryStore();
    const board = memoryLeaderboardStore(accounts);
    const app = buildApp({
      version: 'v',
      db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
      accounts: { store: accounts, mailer, origin: ORIGIN, adminEmails: [] },
      leaderboard: { store: board, checker: { available: () => false, check: async () => ({ status: 'fehler', steps: 0 }) } },
      daily: memoryDailyStore(accounts, new Map(), board),
    });
    assert.equal((await call(app, 'GET', '/api/tageslevel')).statusCode, 503);
  });
});

const ORIGIN = 'https://murmel.example';

// ---------- PostgreSQL (only with TEST_DATABASE_URL, e.g. in the CI) ----------

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Tageslevel in PostgreSQL: Aufgabe einmal, Rangliste, gesperrte Konten, Aufräumen', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  const accounts = accountStore(sql!);
  const store = dailyStore(sql!);
  const tag = `${Date.now()}`;
  const zeitraum = `t${tag}`;
  const task = { art: 'tag' as const, zeitraum, level: `enigma:t${tag}`, pack: 'p', index: 3, titel: 'T', seed: 42 };

  assert.equal(await store.task('tag', zeitraum), null);
  assert.deepEqual(await store.saveTask(task), task);
  // a second choice for the same period loses: the stored one stays
  assert.deepEqual(await store.saveTask({ ...task, level: 'anders' }), task);
  assert.ok((await store.recentLevels(new Date(Date.now() - 60_000))).has(task.level));

  const a = (await accounts.signIn({ provider: 'mail', subject: `ta-${tag}@example.de`, email: `ta-${tag}@example.de` }, 'player')).id;
  const b = (await accounts.signIn({ provider: 'mail', subject: `tb-${tag}@example.de`, email: `tb-${tag}@example.de` }, 'player')).id;
  await sql!`update accounts set display_name = ${`A${tag}`} where id = ${a}`;
  const rec = { v: 1 as const, level: task.level, seed: 42, dt: 0.0025, steps: 500, result: 'sieg' as const, input: [[500, 0, 0]] };
  const run = (accountId: number, steps: number) => store.submit({ art: 'tag', zeitraum, accountId, steps, recording: rec, now: new Date() });
  assert.deepEqual(await run(a, 500), { improved: true, steps: 500 });
  assert.deepEqual(await run(a, 600), { improved: false, steps: 500 });
  assert.deepEqual(await run(b, 400), { improved: true, steps: 400 });
  const r = await store.ranking('tag', zeitraum, 10, a);
  assert.equal(r.total, 2);
  assert.deepEqual(r.entries.map((e) => [e.rank, e.accountId, e.steps]), [[1, b, 400], [2, a, 500]]);
  assert.equal(r.entries[1].name, `A${tag}`);
  await accounts.setBlocked(b, true, new Date());
  assert.deepEqual((await store.ranking('tag', zeitraum, 10, null)).entries.map((e) => e.accountId), [a]);
  assert.ok(Array.isArray([...(await store.leaderboardLevels())]));

  await store.prune(new Date(Date.now() + 60_000));
  assert.equal(await store.task('tag', zeitraum), null);
  assert.equal((await store.ranking('tag', zeitraum, 10, null)).total, 0);
});

test('Levelkatalog aus dem echten Spielcode: Paket und Position wie in den Levellisten des Spiels', async () => {
  const { gameChecker } = await import('./bestenliste-pruefer.ts');
  const { readFileSync } = await import('node:fs');
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const checker = gameChecker(repo);
  try {
    const list = await checker.catalog!();
    assert.deepEqual(list[0], { id: '01', pack: 'murmel', index: 0, title: list[0].title });
    const ii = JSON.parse(readFileSync(`${repo}/public/levels/enigma/enigma_ii.json`, 'utf8')).levels;
    const e = list.find((x) => x.id === ii[4].id)!;
    assert.deepEqual([e.pack, e.index, e.title], ['enigma_ii', 4, ii[4].title]);
    assert.ok(list.length > 1000);
  } finally {
    checker.close();
  }
});
