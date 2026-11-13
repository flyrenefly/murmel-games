import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import type { Checker, LevelJson } from './bestenliste.ts';
import { leaderboardStore } from './bestenliste-db.ts';
import { memoryLeaderboardStore } from './bestenliste-memory.ts';
import { gameChecker } from './bestenliste-pruefer.ts';
import { connect } from './db.ts';
import { COOKIE, hash, readCookie } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import type { Recording } from './loesbarkeit.ts';
import { migrate } from './migrate.ts';
import { notifyAdmins, parseUpload, type PlayerLevelStore, UPLOADS_PER_DAY } from './spielerlevels.ts';
import { playerLevelStore } from './spielerlevels-db.ts';
import { memoryPlayerLevelStore } from './spielerlevels-memory.ts';

const ORIGIN = 'https://murmel.example';
const REPO = fileURLToPath(new URL('../..', import.meta.url));
/** A small editor level (11×7, one Oxyd pair) and a winning run of its playtest (autopilot). */
const SAMPLE = JSON.parse(readFileSync(new URL('./spielerlevel-beispiel.json', import.meta.url), 'utf8')) as { level: LevelJson; loesung: Recording };
const upload = (extra: Record<string, unknown> = {}) => ({ level: SAMPLE.level, loesung: SAMPLE.loesung, titel: 'Erstes Paar', beschreibung: 'Zum Aufwärmen.', lizenz: 'CC-BY-SA-4.0', ...extra });

// ---------- pure parts ----------

test('parseUpload: Form, Lizenz, kein Lua, Textlängen, Lösung aus dem Editor', () => {
  const ok = parseUpload(upload());
  assert.equal(typeof ok, 'object');
  assert.equal((ok as { title: string }).title, 'Erstes Paar');
  assert.match(String(parseUpload(upload({ lizenz: 'MIT' }))), /CC BY-SA/);
  assert.match(String(parseUpload(upload({ level: { ...SAMPLE.level, license: 'GPL' } }))), /CC BY-SA/);
  assert.match(String(parseUpload(upload({ level: { ...SAMPLE.level, lua: 'os.exit()' } }))), /kein Lua/);
  assert.match(String(parseUpload(upload({ level: { ...SAMPLE.level, map: Array(41).fill('#') } }))), /60×40/);
  assert.match(String(parseUpload(upload({ level: { ...SAMPLE.level, big: 'x'.repeat(300_000) } }))), /zu groß/);
  assert.match(String(parseUpload(upload({ titel: 'ab' }))), /Titel/);
  assert.match(String(parseUpload(upload({ titel: 'x'.repeat(61) }))), /Titel/);
  assert.equal((parseUpload(upload({ titel: '  Zwei\n  Zeilen ' })) as { title: string }).title, 'Zwei Zeilen');
  assert.match(String(parseUpload(upload({ beschreibung: 'x'.repeat(501) }))), /Beschreibung/);
  assert.match(String(parseUpload(upload({ loesung: { ...SAMPLE.loesung, result: 'offen' } }))), /gewonnener Lauf/);
  assert.match(String(parseUpload(upload({ loesung: { ...SAMPLE.loesung, level: 'enigma:rb01' } }))), /Editor/);
  assert.match(String(parseUpload(upload({ ersetzt: 'eins' }))), /ersetzt/);
  assert.match(String(parseUpload({ titel: 'x' })), /Level fehlt/);
});

// ---------- API with a stand-in checker ----------

/** Checker: seed 13 = the solution does not win; an object st_lua is refused; files replay by steps. */
function fakeChecker(): Checker & { up: boolean } {
  const c = {
    up: true,
    available: () => c.up,
    check: async () => ({ status: 'unbekannt' as const, steps: 0 }),
    async checkFile(file: LevelJson, rec: Recording) {
      if (file.id !== rec.level) return { status: 'fehler' as const, steps: 0 };
      return rec.seed === 13 ? { status: 'nicht-geloest' as const, steps: rec.steps } : { status: 'geloest' as const, steps: rec.steps };
    },
    async checkLevel(raw: unknown, rec: Recording) {
      const l = raw as LevelJson;
      if (JSON.stringify(l.objects ?? []).includes('st_lua')) return { status: 'ungueltig' as const, steps: 0, error: 'Das Objekt „st_lua“ ist im Editor nicht erlaubt.' };
      if (rec.seed === 13) return { status: 'nicht-geloest' as const, steps: rec.steps };
      return { status: 'geloest' as const, steps: rec.steps, file: { ...l, id: rec.level } };
    },
  };
  return c;
}

describe('Spieler-Levels-API', () => {
  let sent: { to: string; subject: string; text: string }[] = [];
  const mailer = { send: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }) };
  let clock = new Date('2026-11-13T10:00:00Z');

  function setup(checker: Checker = fakeChecker()) {
    sent = [];
    clock = new Date('2026-11-13T10:00:00Z');
    const accounts = memoryStore();
    const names = new Map<number, string>();
    const leaderboard = memoryLeaderboardStore(accounts, names);
    const solved = async (accountId: number, level: string) => leaderboard.rows.some((r) => r.accountId === accountId && r.level === level);
    const store = memoryPlayerLevelStore(accounts, names, solved);
    const app = buildApp({
      version: 'abcdef123456',
      db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
      accounts: { store: accounts, mailer, origin: ORIGIN, adminEmails: ['admin@example.de'], now: () => clock },
      leaderboard: { store: leaderboard, checker },
      playerLevels: { store },
    });
    after(() => app.close());
    return { app, accounts, names, store, leaderboard };
  }
  async function signIn(a: FastifyInstance, email: string): Promise<string> {
    await a.inject({ method: 'POST', url: '/api/konto/mail', payload: { email }, headers: { origin: ORIGIN } });
    const token = /#anmelden=([A-Za-z0-9_-]+)/.exec(sent.filter((m) => m.to === email).at(-1)!.text)![1];
    const r = await a.inject({ method: 'POST', url: '/api/konto/mail/einloesen', payload: { token }, headers: { origin: ORIGIN } });
    return readCookie(String(r.headers['set-cookie']).split(';')[0], COOKIE)!;
  }
  const call = (a: FastifyInstance, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object) =>
    a.inject({ method, url, payload, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });

  async function wait(a: FastifyInstance, cookie: string, base: string, id: string): Promise<Record<string, unknown>> {
    for (;;) {
      const s = (await call(a, 'GET', `${base}/pruefung/${id}`, cookie)).json();
      if (s.status !== 'wartet') return s;
      await new Promise((ok) => setTimeout(ok, 2));
    }
  }
  /** Uploads and waits for the result. */
  async function publish(a: FastifyInstance, cookie: string, body: object = upload()): Promise<Record<string, unknown>> {
    const r = await call(a, 'POST', '/api/spielerlevels', cookie, body);
    assert.equal(r.statusCode, 202, r.body);
    return wait(a, cookie, '/api/spielerlevels', r.json().id);
  }
  const idOf = async (s: ReturnType<typeof setup>, cookie: string) => (await s.accounts.sessionAccount(hash(cookie), clock))!.id;
  /** Signed-in author with a display name. */
  async function author(s: ReturnType<typeof setup>, email: string, name: string): Promise<string> {
    const c = await signIn(s.app, email);
    s.names.set(await idOf(s, c), name);
    return c;
  }

  test('Hochladen: nur mit Konto und Anzeigenamen; gelöst → wartet, nur Autor und Admins sehen es', async () => {
    const s = setup();
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels', undefined, upload())).statusCode, 401);
    const nameless = await signIn(s.app, 'ohne@example.de');
    const r409 = await call(s.app, 'POST', '/api/spielerlevels', nameless, upload());
    assert.equal(r409.statusCode, 409);
    assert.equal(r409.json().name, true);
    const anna = await author(s, 'anna@example.de', 'Anna');
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels', anna, upload({ lizenz: 'frei' }))).statusCode, 400);
    assert.equal((await s.app.inject({ method: 'POST', url: '/api/spielerlevels', payload: upload(), headers: { origin: 'https://boese.example', cookie: `${COOKIE}=${anna}` } })).statusCode, 403);

    const res = await publish(s.app, anna);
    assert.deepEqual(res, { status: 'angenommen', level: 1 });
    // stored: the checked level with the upload's title, no id, no author
    const row = s.store.rows[0];
    assert.equal(row.file.title, 'Erstes Paar');
    assert.equal(row.file.id, undefined);
    assert.equal(row.file.author, undefined);
    assert.equal(row.status, 'wartet');

    const bert = await author(s, 'bert@example.de', 'Bert');
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1', bert)).statusCode, 404);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1/datei')).statusCode, 404);
    assert.deepEqual((await call(s.app, 'GET', '/api/spielerlevels')).json(), { levels: [], mehr: false });
    const own = (await call(s.app, 'GET', '/api/spielerlevels/meine', anna)).json().levels;
    assert.deepEqual(own.map((l: { id: number; status: string; autor: string }) => [l.id, l.status, l.autor]), [[1, 'wartet', 'Anna']]);
    const file = (await call(s.app, 'GET', '/api/spielerlevels/1/datei', anna)).json();
    assert.deepEqual([file.id, file.author, file.license, file.title], ['spieler:1', 'Anna', 'CC-BY-SA-4.0', 'Erstes Paar']);
    assert.doesNotMatch(JSON.stringify(own), /@/);
  });

  test('Abgelehnt: Lösung gewinnt nicht, unerlaubter Inhalt, alte Spielversion', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const lost = await publish(s.app, anna, upload({ loesung: { ...SAMPLE.loesung, seed: 13 } }));
    assert.equal(lost.status, 'abgelehnt');
    assert.match(String(lost.grund), /löst deine Aufzeichnung dieses Level nicht/);
    const bad = await publish(s.app, anna, { ...upload(), level: { ...SAMPLE.level, objects: [{ x: 1, y: 1, k: 'st_lua' }] } });
    assert.deepEqual(bad, { status: 'abgelehnt', grund: 'Das Objekt „st_lua“ ist im Editor nicht erlaubt.' });
    assert.deepEqual(await publish(s.app, anna), { status: 'angenommen', level: 1 });
    const old = await publish(s.app, anna, upload({ loesung: { ...SAMPLE.loesung, seed: 13 }, version: '1234567' }));
    assert.match(String(old.grund), /neu laden/);
    assert.equal(s.store.rows.length, 1);
  });

  test('Freigabe: Admin gibt frei (sichtbar, Mail gebündelt), lehnt mit Grund ab, Autor sieht den Grund', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    await publish(s.app, anna);
    await publish(s.app, anna, upload({ titel: 'Zweites' }));
    // one mail for the first upload; the second waits for the hour
    let mails = sent.filter((m) => m.to === 'admin@example.de' && /Freigabe/.test(m.subject));
    assert.equal(mails.length, 1);
    assert.match(mails[0].text, /Erstes Paar \(von Anna\)/);
    assert.match(mails[0].text, /spielerlevels\.html#freigabe/);
    assert.doesNotMatch(mails[0].text, /anna@example/);
    clock = new Date('2026-11-13T11:00:01Z');
    await notifyAdmins({ store: s.store, mailer, adminEmails: ['admin@example.de'], origin: ORIGIN, now: clock });
    mails = sent.filter((m) => /Freigabe/.test(m.subject));
    assert.equal(mails.length, 2);
    assert.match(mails[1].text, /Zweites/);
    assert.doesNotMatch(mails[1].text, /Erstes Paar/);

    const bert = await author(s, 'bert@example.de', 'Bert');
    assert.equal((await call(s.app, 'GET', '/api/admin/spielerlevels', bert)).statusCode, 403);
    const queue = (await call(s.app, 'GET', '/api/admin/spielerlevels', admin)).json();
    assert.deepEqual(queue.wartend.map((l: { titel: string }) => l.titel), ['Erstes Paar', 'Zweites']);
    // the admin plays it before the release
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1/datei', admin)).statusCode, 200);

    assert.equal((await call(s.app, 'PUT', '/api/admin/spielerlevels/1', bert, { entscheidung: 'frei' })).statusCode, 403);
    assert.equal((await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' })).statusCode, 204);
    assert.equal((await call(s.app, 'PUT', '/api/admin/spielerlevels/2', admin, { entscheidung: 'abgelehnt' })).statusCode, 400);
    assert.equal((await call(s.app, 'PUT', '/api/admin/spielerlevels/2', admin, { entscheidung: 'abgelehnt', grund: 'Zu leer.' })).statusCode, 204);

    const list = (await call(s.app, 'GET', '/api/spielerlevels')).json();
    assert.deepEqual(list.levels.map((l: { id: number; autor: string; lizenz: string }) => [l.id, l.autor, l.lizenz]), [[1, 'Anna', 'CC-BY-SA-4.0']]);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1/datei')).statusCode, 200);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/2', bert)).statusCode, 404);
    const own = (await call(s.app, 'GET', '/api/spielerlevels/meine', anna)).json().levels;
    assert.deepEqual(own.map((l: { titel: string; status: string; grund: string | null }) => [l.titel, l.status, l.grund]), [['Zweites', 'abgelehnt', 'Zu leer.'], ['Erstes Paar', 'frei', null]]);
  });

  test('Liste: Suche, Sortierung neu und beliebt, gesperrte Autoren ausgeblendet', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    for (const titel of ['Eis und Feuer', 'Labyrinth', 'Kleiner Garten']) {
      await publish(s.app, anna, upload({ titel }));
      clock = new Date(clock.getTime() + 60_000);
    }
    for (const id of [1, 2, 3]) {
      await call(s.app, 'PUT', `/api/admin/spielerlevels/${id}`, admin, { entscheidung: 'frei' });
      clock = new Date(clock.getTime() + 60_000);
    }
    const titles = async (q: string) => (await call(s.app, 'GET', `/api/spielerlevels${q}`)).json().levels.map((l: { titel: string }) => l.titel);
    assert.deepEqual(await titles(''), ['Kleiner Garten', 'Labyrinth', 'Eis und Feuer']);
    assert.deepEqual(await titles('?suche=LABY'), ['Labyrinth']);
    assert.deepEqual(await titles('?suche=anna'), ['Kleiner Garten', 'Labyrinth', 'Eis und Feuer']);
    assert.deepEqual(await titles('?suche=%25'), []);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels?sort=alt')).statusCode, 400);

    // two players solved level 1 (a checked leaderboard run) and rate it
    for (const [mail, stars] of [['bert@example.de', 5], ['cora@example.de', 4]] as const) {
      const c = await author(s, mail, mail.slice(0, 4));
      const me = await idOf(s, c);
      s.leaderboard.rows.push({ id: me, accountId: me, level: 'spieler:1', steps: 900, createdAt: clock, recording: SAMPLE.loesung });
      assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', c, { sterne: stars })).statusCode, 200);
    }
    assert.deepEqual(await titles('?sort=beliebt'), ['Eis und Feuer', 'Kleiner Garten', 'Labyrinth']);
    const first = (await call(s.app, 'GET', '/api/spielerlevels?sort=beliebt')).json().levels[0];
    assert.deepEqual([first.sterne, first.stimmen], [4.5, 2]);

    await s.accounts.setBlocked(1, true, clock);
    assert.deepEqual(await titles(''), []);
  });

  test('Bewertung: nur gelöst, nicht der Autor, eine Stimme je Konto', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    await publish(s.app, anna);
    const bert = await author(s, 'bert@example.de', 'Bert');
    // not released yet: 404 for others
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', bert, { sterne: 5 })).statusCode, 404);
    await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' });
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', undefined, { sterne: 5 })).statusCode, 401);
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', anna, { sterne: 5 })).statusCode, 403);
    const notSolved = await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', bert, { sterne: 5 });
    assert.equal(notSolved.statusCode, 403);
    assert.match(notSolved.json().error, /gelöst/);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1', bert)).json().darfBewerten, false);

    // Bert wins it: the leaderboard replays the run with the stored level
    const run = { ...SAMPLE.loesung, level: 'spieler:1' };
    const r = await call(s.app, 'POST', '/api/bestenliste', bert, run);
    assert.equal(r.statusCode, 202, r.body);
    const res = await wait(s.app, bert, '/api/bestenliste', r.json().id);
    assert.equal(res.status, 'angenommen', JSON.stringify(res));
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1', bert)).json().darfBewerten, true);
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', bert, { sterne: 6 })).statusCode, 400);
    assert.deepEqual((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', bert, { sterne: 2 })).json(), { sterne: 2, stimmen: 1, meineSterne: 2 });
    assert.deepEqual((await call(s.app, 'PUT', '/api/spielerlevels/1/bewertung', bert, { sterne: 4 })).json(), { sterne: 4, stimmen: 1, meineSterne: 4 });
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1', bert)).json().meineSterne, 4);
  });

  test('Bestenliste für Spieler-Levels: nur sichtbare Levels, nachgespielt mit dem gespeicherten Level', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    await publish(s.app, anna);
    const bert = await author(s, 'bert@example.de', 'Bert');
    const submit = async (cookie: string, rec: object) => {
      const r = await call(s.app, 'POST', '/api/bestenliste', cookie, rec);
      assert.equal(r.statusCode, 202, r.body);
      return wait(s.app, cookie, '/api/bestenliste', r.json().id);
    };
    // waiting: Bert cannot play it, the author can
    assert.match(String((await submit(bert, { ...SAMPLE.loesung, level: 'spieler:1' })).grund), /gibt es/);
    assert.equal((await submit(anna, { ...SAMPLE.loesung, level: 'spieler:1' })).status, 'angenommen');
    await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' });
    assert.equal((await submit(bert, { ...SAMPLE.loesung, level: 'spieler:1' })).status, 'angenommen');
    assert.equal((await submit(bert, { ...SAMPLE.loesung, level: 'spieler:1', seed: 13 })).status, 'abgelehnt');
    assert.equal((await submit(bert, { ...SAMPLE.loesung, level: 'spieler:99' })).status, 'abgelehnt');
    const board = (await call(s.app, 'GET', '/api/bestenliste/level?id=spieler%3A1')).json();
    assert.equal(board.anzahl, 2);
  });

  test('Melden: blendet aus bis zur Entscheidung; verwerfen zeigt es wieder, ablehnen nicht', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    await publish(s.app, anna);
    await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' });
    const bert = await author(s, 'bert@example.de', 'Bert');
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels/1/meldung', bert, { grund: 'x' })).statusCode, 400);
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels/1/meldung', anna, { grund: 'eigenes' })).statusCode, 400);
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels/1/meldung', bert, { grund: 'Beleidigender Titel' })).statusCode, 204);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.length, 0);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1/datei', bert)).statusCode, 404);
    // the author and admins still see it
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/1', anna)).statusCode, 200);
    const pending = (await call(s.app, 'GET', '/api/admin/spielerlevels', admin)).json();
    assert.deepEqual(pending.gemeldet.map((l: { id: number; gruende: string[] }) => [l.id, l.gruende]), [[1, ['Beleidigender Titel']]]);

    assert.equal((await call(s.app, 'DELETE', '/api/admin/spielerlevels/1/meldungen', admin)).statusCode, 204);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.length, 1);
    // once per account
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels/1/meldung', bert, { grund: 'Nochmal gemeldet' })).statusCode, 409);
    const cora = await author(s, 'cora@example.de', 'Cora');
    await call(s.app, 'POST', '/api/spielerlevels/1/meldung', cora, { grund: 'Kopie eines anderen Levels' });
    await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'abgelehnt', grund: 'Kopie' });
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.length, 0);
    assert.equal((await call(s.app, 'GET', '/api/admin/spielerlevels', admin)).json().gemeldet.length, 0);
  });

  test('Autor: zurückziehen, wieder einreichen, neue Version ersetzt nach Freigabe, löschen; Konto löschen nimmt alles mit', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    const bert = await author(s, 'bert@example.de', 'Bert');
    await publish(s.app, anna);
    await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' });

    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/status', bert, { status: 'zurueckgezogen' })).statusCode, 404);
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/status', anna, { status: 'wartet' })).statusCode, 409);
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/status', anna, { status: 'zurueckgezogen' })).statusCode, 204);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.length, 0);
    assert.equal((await call(s.app, 'PUT', '/api/spielerlevels/1/status', anna, { status: 'wartet' })).statusCode, 204);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.length, 0); // new release needed
    await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' });

    // a new version: checked and released again; until then the old one stays
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels', bert, upload({ ersetzt: 1 }))).statusCode, 400);
    assert.deepEqual(await publish(s.app, anna, upload({ titel: 'Erstes Paar 2', ersetzt: 1 })), { status: 'angenommen', level: 2 });
    assert.deepEqual((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.map((l: { id: number }) => l.id), [1]);
    await call(s.app, 'PUT', '/api/admin/spielerlevels/2', admin, { entscheidung: 'frei' });
    assert.deepEqual((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.map((l: { id: number }) => l.id), [2]);
    assert.equal(s.store.rows.find((r) => r.id === 1)!.status, 'ersetzt');

    assert.equal((await call(s.app, 'DELETE', '/api/spielerlevels/2', bert)).statusCode, 404);
    assert.equal((await call(s.app, 'DELETE', '/api/spielerlevels/2', anna)).statusCode, 204);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels/2', anna)).statusCode, 404);
    assert.equal((await call(s.app, 'DELETE', '/api/spielerlevels/1', admin)).statusCode, 204);
    assert.equal(s.store.rows.length, 0);
  });

  test('Grenzen: Uploads je Tag, gesperrte Konten, kein Spielcode', async () => {
    const s = setup();
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');
    for (let i = 0; i < UPLOADS_PER_DAY; i++) {
      await publish(s.app, anna, upload({ titel: `Level ${i}` }));
      // released at once, so the waiting limit does not count
      await call(s.app, 'PUT', `/api/admin/spielerlevels/${i + 1}`, admin, { entscheidung: 'frei' });
    }
    const r = await call(s.app, 'POST', '/api/spielerlevels', anna, upload());
    assert.equal(r.statusCode, 429);
    assert.match(r.json().error, /pro Tag/);
    clock = new Date(clock.getTime() + 25 * 3600_000);
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels', anna, upload())).statusCode, 202);

    await s.accounts.setBlocked(1, true, clock);
    assert.equal((await call(s.app, 'POST', '/api/spielerlevels', anna, upload())).statusCode, 403);

    const checker = fakeChecker();
    checker.up = false;
    const off = setup(checker);
    const cora = await author(off, 'cora@example.de', 'Cora');
    assert.equal((await call(off.app, 'POST', '/api/spielerlevels', cora, upload())).statusCode, 503);
    assert.equal((await call(off.app, 'GET', '/api/spielerlevels')).statusCode, 200);
  });

  // ---------- end to end: the real game code checks a real upload ----------

  test('Ende zu Ende: lösbares Level mit Lösung angenommen, ohne gültige Lösung abgelehnt, Freigabe macht es sichtbar', { timeout: 240_000 }, async () => {
    const checker = gameChecker(REPO, { timeoutMs: 90_000, nice: 0 });
    after(() => checker.close());
    assert.equal(checker.available(), true);
    const s = setup(checker);
    const anna = await author(s, 'anna@example.de', 'Anna');
    const admin = await author(s, 'admin@example.de', 'Chefin');

    // no valid solution: the marble never moves
    const still = { ...SAMPLE.loesung, input: (SAMPLE.loesung.input as unknown[][]).map((e) => (typeof e[1] === 'number' ? [e[0], 0, 0] : e)) };
    const lost = await publish(s.app, anna, upload({ loesung: still }));
    assert.equal(lost.status, 'abgelehnt', JSON.stringify(lost));
    // something the editor cannot make
    const foreign = await publish(s.app, anna, upload({ level: { ...SAMPLE.level, objects: [{ x: 2, y: 3, k: 'st_lua' }] } }));
    assert.equal(foreign.status, 'abgelehnt');
    assert.match(String(foreign.grund), /nicht erlaubt/);
    // a changed level: the solution no longer fits (one Oxyd stone walled in elsewhere)
    const map = (SAMPLE.level.map as string[]).slice();
    map[2] = '.##########'.slice(0, map[2].length);
    const changed = await publish(s.app, anna, upload({ level: { ...SAMPLE.level, map } }));
    assert.equal(changed.status, 'abgelehnt', JSON.stringify(changed));
    assert.equal(s.store.rows.length, 0);

    const ok = await publish(s.app, anna);
    assert.deepEqual(ok, { status: 'angenommen', level: 1 });
    assert.equal(s.store.rows[0].steps, SAMPLE.loesung.steps);
    assert.equal((await call(s.app, 'GET', '/api/spielerlevels')).json().levels.length, 0);

    assert.equal((await call(s.app, 'PUT', '/api/admin/spielerlevels/1', admin, { entscheidung: 'frei' })).statusCode, 204);
    const list = (await call(s.app, 'GET', '/api/spielerlevels')).json().levels;
    assert.deepEqual(list.map((l: { id: number; titel: string; autor: string; breite: number; hoehe: number }) => [l.id, l.titel, l.autor, l.breite, l.hoehe]), [[1, 'Erstes Paar', 'Anna', 11, 7]]);
    const file = (await call(s.app, 'GET', '/api/spielerlevels/1/datei')).json();
    assert.equal(file.id, 'spieler:1');

    // played as spieler:1, the same run goes into the leaderboard (replayed with the stored level)
    const bert = await author(s, 'bert@example.de', 'Bert');
    const r = await call(s.app, 'POST', '/api/bestenliste', bert, { ...SAMPLE.loesung, level: 'spieler:1' });
    const res = await wait(s.app, bert, '/api/bestenliste', r.json().id);
    assert.equal(res.status, 'angenommen', JSON.stringify(res));
    assert.equal(res.zeit, SAMPLE.loesung.steps);
  });
});

// ---------- PostgreSQL ----------

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Spieler-Levels in PostgreSQL: Status, Liste, Bewertung, Meldungen, Mail, Löschen mit Konto samt Bestenliste', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  await sql!`delete from player_levels`;
  await sql!`delete from player_level_mail`;
  const accounts = accountStore(sql!);
  const store: PlayerLevelStore = playerLevelStore(sql!);
  const board = leaderboardStore(sql!);
  const tag = `${Date.now()}`.slice(-8);
  const acc = async (mail: string, name: string | null) => {
    const a = await accounts.signIn({ provider: 'mail', subject: mail, email: mail }, 'player');
    await sql!`update accounts set display_name = ${name} where id = ${a.id}`;
    return a.id;
  };
  const anna = await acc(`anna-${tag}@example.de`, `Anna${tag}`);
  const bert = await acc(`bert-${tag}@example.de`, `Bert${tag}`);
  const t0 = new Date('2026-11-13T10:00:00Z');
  const make = (title: string, replaces: number | null = null, at = t0) =>
    store.create({ accountId: anna, title, description: `Beschreibung ${title}`, file: SAMPLE.level, levelHash: 'h', recording: SAMPLE.loesung, steps: 1588, replaces, now: at });

  assert.equal(await store.displayName(anna), `Anna${tag}`);
  const a = await make('Erstes Paar');
  const b = await make('Zweites 100%', null, new Date('2026-11-13T10:05:00Z'));
  assert.equal(await store.countUploads(anna, t0), 2);
  assert.equal(await store.countWaiting(anna), 2);
  const la = (await store.level(a))!;
  assert.deepEqual([la.title, la.author, la.width, la.height, la.status, la.stars, la.votes, la.reports], ['Erstes Paar', `Anna${tag}`, 11, 7, 'wartet', null, 0, 0]);
  assert.deepEqual(la.file, SAMPLE.level);
  assert.deepEqual((await store.list({ search: '', sort: 'neu', limit: 10, offset: 0 })).length, 0);

  // mail bookkeeping
  assert.equal(await store.lastNotified(), null);
  assert.deepEqual((await store.unnotified()).map((x) => x.title), ['Erstes Paar', 'Zweites 100%']);
  await store.markNotified([a, b], t0);
  assert.deepEqual(await store.unnotified(), []);
  assert.equal((await store.lastNotified())!.toISOString(), t0.toISOString());

  await store.setStatus(a, 'frei', null, new Date('2026-11-13T11:00:00Z'), true);
  await store.setStatus(b, 'frei', null, new Date('2026-11-13T12:00:00Z'), true);
  const titles = async (search: string, sort: 'neu' | 'beliebt' = 'neu') => (await store.list({ search, sort, limit: 10, offset: 0 })).map((l) => l.title);
  assert.deepEqual(await titles(''), ['Zweites 100%', 'Erstes Paar']);
  assert.deepEqual(await titles('100%'), ['Zweites 100%']);
  assert.deepEqual(await titles('_'), []);
  assert.deepEqual(await titles(`anna${tag}`), ['Zweites 100%', 'Erstes Paar']);

  // rating needs a leaderboard entry (the API checks it)
  assert.equal(await store.solved(bert, a), false);
  await board.submit({ accountId: bert, level: `spieler:${a}`, steps: 1588, levelHash: 'h', version: 'v', recording: SAMPLE.loesung, now: t0 });
  assert.equal(await store.solved(bert, a), true);
  assert.deepEqual(await store.rate(a, bert, 5, t0), { stars: 5, votes: 1 });
  assert.deepEqual(await store.rate(a, bert, 1, t0), { stars: 1, votes: 1 });
  assert.equal(await store.rating(a, bert), 1);
  assert.deepEqual(await titles('', 'beliebt'), ['Zweites 100%', 'Erstes Paar']); // (1+9)/4 = 2.5 < (0+9)/3 = 3
  await store.rate(a, anna, 5, t0);
  assert.deepEqual(await titles('', 'beliebt'), ['Erstes Paar', 'Zweites 100%']);

  // reports hide until dismissed; a review dismisses them too
  assert.equal(await store.report(a, bert, 'Grund eins', t0), true);
  assert.equal(await store.report(a, bert, 'Grund zwei', t0), false);
  assert.deepEqual(await titles(''), ['Zweites 100%']);
  assert.deepEqual((await store.pending()).map((l) => [l.title, l.reasons]), [['Erstes Paar', ['Grund eins']]]);
  await store.dismissReports(a, t0);
  assert.deepEqual(await titles(''), ['Zweites 100%', 'Erstes Paar']);

  // a new version replaces the old one on release; someone else's level cannot be replaced
  const c = await make('Erstes Paar v2', a, new Date('2026-11-13T12:30:00Z'));
  assert.equal((await store.level(c))!.replaces, a);
  await store.setStatus(c, 'frei', null, new Date('2026-11-13T13:00:00Z'), true);
  assert.equal((await store.level(a))!.status, 'ersetzt');
  await store.setStatus(b, 'abgelehnt', 'Zu leer', t0, true);
  assert.deepEqual((await store.mine(anna)).map((l) => [l.title, l.status, l.reason]), [
    ['Erstes Paar v2', 'frei', null],
    ['Zweites 100%', 'abgelehnt', 'Zu leer'],
    ['Erstes Paar', 'ersetzt', null],
  ]);

  // a blocked author disappears from the list
  await accounts.setBlocked(anna, true, t0);
  assert.deepEqual(await titles(''), []);
  await accounts.setBlocked(anna, false, t0);

  // deleting a level takes its leaderboard entries along; deleting the account takes the levels
  await board.submit({ accountId: bert, level: `spieler:${c}`, steps: 1588, levelHash: 'h', version: 'v', recording: SAMPLE.loesung, now: t0 });
  assert.equal(await store.remove(a), true);
  assert.equal((await sql!`select count(*)::int as n from leaderboard where level = ${`spieler:${a}`}`)[0].n, 0);
  assert.equal((await store.level(c))!.replaces, null);
  await accounts.deleteAccount(anna);
  assert.equal((await sql!`select count(*)::int as n from player_levels where account_id = ${anna}`)[0].n, 0);
  assert.equal((await sql!`select count(*)::int as n from leaderboard where level = ${`spieler:${c}`}`)[0].n, 0);
  await accounts.deleteAccount(bert);
});
