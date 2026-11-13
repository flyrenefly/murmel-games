import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { type AccountStore, COOKIE, readCookie } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { type CheckResult, markNew, parseRecording, type Recording, runNight, type SolvabilityStore, type ToolOutput } from './loesbarkeit.ts';
import { solvabilityStore } from './loesbarkeit-db.ts';
import { runTools } from './loesbarkeit-job.ts';
import { memorySolvabilityStore } from './loesbarkeit-memory.ts';
import { migrate } from './migrate.ts';

const ORIGIN = 'https://murmel.example';
const REC: Recording = { v: 1, level: 'enigma:rb01', seed: 7, dt: 0.0025, steps: 500, result: 'sieg', input: [[400, 3, -2], [1, 'use'], [100, 0, 0]] };

// ---------- pure parts ----------

test('parseRecording: nimmt nur gewonnene Läufe im Format 1 und nur die bekannten Felder', () => {
  assert.deepEqual(parseRecording({ ...REC, extra: 'weg' }), REC);
  const bad: [object | null, RegExp][] = [
    [null, /format/i],
    [{ ...REC, v: 2 }, /format/i],
    [{ ...REC, level: '<script>' }, /Level/],
    [{ ...REC, seed: -1 }, /Startwert/],
    [{ ...REC, seed: 2 ** 32 }, /Startwert/],
    [{ ...REC, dt: 0.01 }, /Physiktakt/],
    [{ ...REC, steps: 0 }, /Schritt/],
    [{ ...REC, steps: 1e9 }, /Schritt/],
    [{ ...REC, result: 'offen' }, /gewonnene/],
    [{ ...REC, input: [] }, /Eingaben/],
    [{ ...REC, input: [[1, { x: 1 }]] }, /Eingaben/],
    [{ ...REC, input: [[1, 0.5, 0]] }, /Eingaben/],
  ];
  for (const [b, msg] of bad) assert.match(String(parseRecording(b)), msg, JSON.stringify(b));
});

const res = (level: string, kind: CheckResult['kind'], status: CheckResult['status'], ref = ''): CheckResult => ({
  level, kind, ref, status, steps: 1, recordedSteps: null, levelChanged: false, isNew: false, error: null,
});

test('markNew: neu kaputt ist nur, was vorher ging oder fehlte; Lua-Fehler der Ladeprobe zählen nicht', () => {
  const before = [res('a', 'probe', 'ok'), res('b', 'probe', 'fehler'), res('a', 'solution', 'geloest', 'repo:a.json'), res('b', 'solution', 'nicht-geloest', 'db:1')];
  const now = [
    res('a', 'probe', 'fehler'), // neu kaputt
    res('b', 'probe', 'fehler'), // war schon kaputt
    res('c', 'probe', 'lua'), // Lua-Fehler: kein Fehlschlag
    res('a', 'solution', 'fehler', 'repo:a.json'), // neu kaputt
    res('b', 'solution', 'nicht-geloest', 'db:1'), // war schon kaputt
    res('c', 'solution', 'nicht-geloest', 'db:2'), // neue Lösung, gleich kaputt
  ];
  assert.deepEqual(markNew(before, now).map((r) => r.isNew), [true, false, false, true, false, true]);
});

test('runTools: Ergebnisse der Werkzeuge, Repo- und gespeicherte Lösungen getrennt benannt', async () => {
  // a game folder whose tools write fixed results (the real tools: tools/lib/tools.test.mjs)
  const game = mkdtempSync(join(tmpdir(), 'murmel-game-'));
  try {
    mkdirSync(join(game, 'tools'));
    mkdirSync(join(game, 'solutions', 'enigma'), { recursive: true });
    const out = (json: string) => `const i = process.argv.indexOf('--json'); require('node:fs').writeFileSync(process.argv[i + 1], JSON.stringify(${json})); process.exitCode = 1;`;
    writeFileSync(join(game, 'tools', 'check-load.mjs'), `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); ${out(`{ results: [{ level: 'enigma:rb01', status: 'ok', steps: 2000 }] }`)}`);
    writeFileSync(
      join(game, 'tools', 'check-solutions.mjs'),
      `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
       const fs = require('node:fs'); const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--') && !/^\\d+$/.test(a)).slice(0, -1);
       const db = dirs.at(-1); const rec = JSON.parse(fs.readFileSync(db + '/5.json', 'utf8'));
       ${out(`{ results: [
         { file: 'solutions/enigma/rb01.json', level: 'enigma:rb01', status: 'geloest', steps: 500, recordedSteps: 500 },
         { file: '../tmp/x/db/5.json', level: rec.level, status: 'nicht-geloest', steps: 9, recordedSteps: 500, levelHash: rec.levelHash } ] }`)}`,
    );

    const out2 = await runTools(game, [{ id: 5, level: REC.level, levelHash: 'abc', steps: 500, createdAt: '', recording: REC }]);

    assert.deepEqual(out2.probes, [{ level: 'enigma:rb01', status: 'ok', steps: 2000 }]);
    assert.deepEqual(
      out2.solutions.map((s) => [s.ref, s.status, s.levelHash]),
      [['repo:enigma/rb01.json', 'geloest', undefined], ['db:5', 'nicht-geloest', 'abc']],
    );
  } finally {
    rmSync(game, { recursive: true, force: true });
  }
});

// ---------- store, nightly run and admin API: memory and (TEST_DATABASE_URL) PostgreSQL ----------

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
      await sql!`truncate accounts, login_tokens, sessions, webauthn_challenges, passkeys, account_identities, solutions, solvability_runs restart identity cascade`;
      return { accounts: accountStore(sql!), solvability: solvabilityStore(sql!) };
    },
  },
];

for (const backend of backends) {
  describe(`Lösbarkeit (${backend.name})`, { skip: backend.skip }, () => {
    let store: SolvabilityStore;
    let accounts: AccountStore;
    let sent: { to: string; subject: string; text: string }[];
    let clock: Date;
    const mailer = { send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) };

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      ({ accounts, solvability: store } = await backend.stores());
      sent = [];
      clock = new Date('2026-11-14T04:15:00Z');
    });

    const night = (out: ToolOutput | (() => never), version = 'abc123') =>
      runNight({
        store, version, mailer, admins: ['admin@example.de'], origin: ORIGIN, now: () => clock,
        check: async () => (typeof out === 'function' ? out() : out),
      });
    const probe = (level: string, status: 'ok' | 'lua' | 'fehler') => ({ level, status, steps: 2000, ...(status === 'ok' ? {} : { error: 'kaputt' }) });
    const sol = (ref: string, level: string, status: 'geloest' | 'nicht-geloest' | 'fehler', extra = {}) => ({ ref, level, status, steps: 500, recordedSteps: 500, ...extra });

    test('Nachtlauf: speichert Lauf und Ergebnisse, Mail nur bei neuen Fehlschlägen', async () => {
      const first = await night({ probes: [probe('a', 'ok'), probe('b', 'lua')], solutions: [sol('repo:a.json', 'a', 'geloest'), sol('repo:b.json', 'b', 'nicht-geloest')] });
      assert.equal(first.counts.solvedLevels, 1);
      assert.equal(sent.length, 1, 'erster Lauf: die ungelöste Lösung ist neu');
      assert.match(sent[0].subject, /1 Level neu kaputt/);
      assert.match(sent[0].text, /- b: Lösung repo:b\.json – nicht mehr gelöst/);
      assert.match(sent[0].text, new RegExp(`${ORIGIN}/loesbarkeit\\.html`));

      clock = new Date('2026-11-15T04:15:00Z');
      await night({ probes: [probe('a', 'ok'), probe('b', 'lua')], solutions: [sol('repo:a.json', 'a', 'geloest'), sol('repo:b.json', 'b', 'nicht-geloest')] });
      assert.equal(sent.length, 1, 'nichts Neues: keine Mail');

      clock = new Date('2026-11-16T04:15:00Z');
      const third = await night({ probes: [probe('a', 'fehler'), probe('b', 'lua')], solutions: [sol('repo:a.json', 'a', 'fehler', { error: 'wirft' }), sol('repo:b.json', 'b', 'nicht-geloest')] });
      assert.equal(third.fresh.length, 2);
      assert.equal(sent.length, 2);
      assert.equal(sent[1].to, 'admin@example.de');
      assert.match(sent[1].text, /- a: Ladeprobe – Fehler: kaputt/);
      assert.doesNotMatch(sent[1].text, /- b:/);

      const runs = await store.runs(10);
      assert.deepEqual(runs.map((r) => [r.id, r.newFailures, r.probeFailed, r.solved]), [[third.runId, 2, 1, 0], [2, 0, 0, 1], [1, 1, 0, 1]]);
      assert.equal(runs[0].version, 'abc123');
      assert.equal(runs[0].finishedAt, '2026-11-16T04:15:00.000Z');
      const problems = await store.problems(third.runId);
      assert.deepEqual(problems.map((p) => [p.level, p.kind, p.isNew]), [['a', 'probe', true], ['a', 'solution', true], ['b', 'probe', false], ['b', 'solution', false]]);
      const hist = await store.levelHistory('a', 30);
      assert.deepEqual(hist.map((h) => [h.runId, h.kind, h.status]), [[3, 'probe', 'fehler'], [3, 'solution', 'fehler'], [2, 'probe', 'ok'], [2, 'solution', 'geloest'], [1, 'probe', 'ok'], [1, 'solution', 'geloest']]);
    });

    test('Nachtlauf: scheitert das Werkzeug, wird der Lauf mit Fehler gespeichert und gemeldet; Vergleich mit dem letzten guten Lauf', async () => {
      await night({ probes: [probe('a', 'ok')], solutions: [sol('repo:a.json', 'a', 'geloest')] });
      clock = new Date('2026-11-15T04:15:00Z');
      await night(() => {
        throw new Error('check-load.mjs endete mit 137');
      });
      assert.equal(sent.length, 1);
      assert.match(sent[0].subject, /gescheitert/);
      assert.match(sent[0].text, /137/);
      assert.equal((await store.runs(1))[0].error, 'check-load.mjs endete mit 137');

      clock = new Date('2026-11-16T04:15:00Z');
      const r = await night({ probes: [probe('a', 'ok')], solutions: [sol('repo:a.json', 'a', 'geloest')] });
      assert.equal(r.fresh.length, 0, 'verglichen mit dem Lauf vor dem gescheiterten');
    });

    test('Nachtlauf: gespeicherte Lösungen bekommen beim ersten Lauf den Level-Prüfwert; alte Läufe werden gelöscht', async () => {
      const { id } = await store.addSolution({ level: 'a', recordingHash: Buffer.alloc(32, 1), recording: { ...REC, level: 'a' }, steps: 500, accountId: null });
      await night({ probes: [], solutions: [sol(`db:${id}`, 'a', 'geloest', { levelHash: 'h1' })] });
      await night({ probes: [], solutions: [sol(`db:${id}`, 'a', 'geloest', { levelHash: 'h2' })] });
      assert.equal((await store.solutions())[0].levelHash, 'h1');

      clock = new Date('2027-03-01T04:15:00Z'); // > 90 Tage später
      await night({ probes: [], solutions: [] });
      assert.equal((await store.runs(10)).length, 1);
    });

    // ---------- admin API ----------

    const app = (): FastifyInstance =>
      buildApp({
        version: 't',
        db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
        accounts: { store: accounts, mailer, origin: ORIGIN, adminEmails: ['admin@example.de'] },
        solvability: store,
      });
    async function signIn(a: FastifyInstance, email: string): Promise<string> {
      await a.inject({ method: 'POST', url: '/api/konto/mail', payload: { email }, headers: { origin: ORIGIN } });
      const token = /#anmelden=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!.text)![1];
      const r = await a.inject({ method: 'POST', url: '/api/konto/mail/einloesen', payload: { token }, headers: { origin: ORIGIN } });
      return readCookie(String(r.headers['set-cookie']).split(';')[0], COOKIE)!;
    }
    const call = (a: FastifyInstance, method: 'GET' | 'POST' | 'DELETE', url: string, cookie?: string, payload?: object) =>
      a.inject({ method, url, payload, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });

    test('Admin-API: nur Admins speichern, sehen, laden und löschen Lösungen; doppelt wird nicht doppelt gespeichert', async () => {
      const a = app();
      const admin = await signIn(a, 'admin@example.de');
      const player = await signIn(a, 'spieler@example.de');

      assert.equal((await call(a, 'POST', '/api/admin/loesungen', undefined, REC)).statusCode, 401);
      assert.equal((await call(a, 'POST', '/api/admin/loesungen', player, REC)).statusCode, 403);
      assert.equal((await call(a, 'GET', '/api/admin/loesbarkeit', player)).statusCode, 403);

      const saved = await call(a, 'POST', '/api/admin/loesungen', admin, { ...REC, extra: 1 });
      assert.equal(saved.statusCode, 201, saved.body);
      const { id } = saved.json();
      const again = await call(a, 'POST', '/api/admin/loesungen', admin, REC);
      assert.equal(again.statusCode, 200);
      assert.deepEqual(again.json(), { id, neu: false });
      assert.equal((await call(a, 'POST', '/api/admin/loesungen', admin, { ...REC, result: 'offen' })).statusCode, 400);

      const list = (await call(a, 'GET', '/api/admin/loesungen', admin)).json().loesungen;
      assert.deepEqual(list.map((s: { id: number; level: string; steps: number }) => [s.id, s.level, s.steps]), [[id, 'enigma:rb01', 500]]);

      const file = await call(a, 'GET', `/api/admin/loesungen/${id}`, admin);
      assert.equal(file.statusCode, 200);
      assert.match(String(file.headers['content-disposition']), /filename="rb01\.json"/);
      assert.deepEqual(file.json(), REC);
      assert.equal((await call(a, 'GET', '/api/admin/loesungen/abc', admin)).statusCode, 400);

      assert.equal((await call(a, 'DELETE', `/api/admin/loesungen/${id}`, player)).statusCode, 403);
      assert.equal((await call(a, 'DELETE', `/api/admin/loesungen/${id}`, admin)).statusCode, 200);
      assert.equal((await call(a, 'DELETE', `/api/admin/loesungen/${id}`, admin)).statusCode, 404);
      assert.equal((await call(a, 'GET', `/api/admin/loesungen/${id}`, admin)).statusCode, 404);
    });

    test('Admin-API: Übersicht mit letztem Lauf, Problemen und Verlauf; Verlauf eines Levels', async () => {
      const a = app();
      const admin = await signIn(a, 'admin@example.de');
      const empty = (await call(a, 'GET', '/api/admin/loesbarkeit', admin)).json();
      assert.deepEqual(empty, { lauf: null, verlauf: [], probleme: [], loesungen: 0 });

      await night({ probes: [probe('a', 'ok'), probe('b', 'fehler')], solutions: [sol('repo:a.json', 'a', 'geloest')] });
      const o = (await call(a, 'GET', '/api/admin/loesbarkeit', admin)).json();
      assert.equal(o.lauf.levels, 2);
      assert.equal(o.lauf.probeFailed, 1);
      assert.equal(o.verlauf.length, 1);
      assert.deepEqual(o.probleme.map((p: CheckResult) => [p.level, p.status, p.isNew]), [['b', 'fehler', true]]);

      const lv = (await call(a, 'GET', '/api/admin/loesbarkeit/level?id=a', admin)).json();
      assert.deepEqual(lv.verlauf.map((h: CheckResult) => [h.kind, h.status]), [['probe', 'ok'], ['solution', 'geloest']]);
      assert.equal((await call(a, 'GET', '/api/admin/loesbarkeit/level', admin)).statusCode, 400);
    });
  });
}
