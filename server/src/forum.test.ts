import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { ACTIONS_PER_15_MIN, cleanName, cleanText, type ForumStore, POSTS_PER_HOUR, TOPICS_PER_HOUR } from './forum.ts';
import { forumStore } from './forum-db.ts';
import { memoryForumStore } from './forum-memory.ts';
import { type AccountStore, COOKIE, hash } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { migrate } from './migrate.ts';

const ORIGIN = 'https://murmel.example';
const MINUTE = 60_000;

test('cleanText: Zeilen bleiben, Steuerzeichen und Richtungswechsel fliegen raus', () => {
  assert.equal(cleanText('  Hallo\r\nWelt\u0000‮!  '), 'Hallo\nWelt!');
  assert.equal(cleanText('a\n\n\n\n\n\nb'), 'a\n\n\nb');
  assert.equal(cleanText('<script>alert(1)</script>'), '<script>alert(1)</script>', 'HTML bleibt Text; die Seite maskiert beim Anzeigen');
});

test('cleanName: 3–24 Zeichen, keine Rollen-Namen', () => {
  assert.equal(cleanName('  Murmel  Fan '), null, 'enthält „murmel“');
  assert.equal(cleanName('  Murmler  42 '), 'Murmler 42');
  assert.equal(cleanName('Kugel  Blitz'), 'Kugel Blitz');
  assert.equal(cleanName('Zoë_1'), 'Zoë_1');
  for (const bad of ['ab', 'x'.repeat(25), '-abc', 'abc-', 'Admin', 'Team Murmel', 'a<b>c', 42]) assert.equal(cleanName(bad), null, String(bad));
});

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

const backends: { name: string; skip: boolean; stores: () => Promise<{ accounts: AccountStore; forum: ForumStore }> }[] = [
  { name: 'Speicher', skip: false, stores: async () => ({ accounts: memoryStore(), forum: memoryForumStore() }) },
  {
    name: 'PostgreSQL',
    skip: !sql,
    stores: async () => {
      await sql!`truncate accounts, login_tokens, sessions, webauthn_challenges, passkeys, account_identities, forum_topics, forum_posts, forum_votes, forum_reports restart identity cascade`;
      return { accounts: accountStore(sql!), forum: forumStore(sql!) };
    },
  },
];

for (const backend of backends) {
  describe(`Forum (${backend.name})`, { skip: backend.skip }, () => {
    let accounts: AccountStore;
    let forum: ForumStore;
    let clock: Date;
    let app: FastifyInstance;

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      ({ accounts, forum } = await backend.stores());
      clock = new Date('2026-11-13T12:00:00Z');
      app = buildApp({
        version: 't',
        db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
        accounts: { store: accounts, mailer: null, origin: ORIGIN, adminEmails: [], now: () => clock },
        forum,
      });
    });

    /** Signs in (directly in the store) and returns the session cookie and the account id. */
    async function user(email: string, opts: { admin?: boolean; name?: string | null } = {}) {
      const a = await accounts.signIn({ provider: 'mail', subject: email, email }, opts.admin ? 'admin' : 'player');
      const token = `sitzung-${email}`;
      await accounts.addSession(a.id, hash(token), new Date(clock.getTime() + 86_400_000));
      const name = opts.name === undefined ? email.split('@')[0] : opts.name;
      if (name) assert.equal(await forum.setDisplayName(a.id, name), true);
      return { cookie: token, id: a.id };
    }
    const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie?: string, payload?: object, ip = '127.0.0.1') =>
      app.inject({ method, url, payload, remoteAddress: ip, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });
    async function newTopic(cookie: string, body: object = {}) {
      const res = await req('POST', '/api/forum/themen', cookie, { kategorie: 'fehler', titel: 'Murmel fällt durch', text: 'Im Level 3 fällt die Murmel durch den Boden.', ...body });
      assert.equal(res.statusCode, 201, res.body);
      return res.json().id as number;
    }

    test('Lesen ohne Konto, Schreiben nur mit Konto; Mailadresse taucht nirgends auf', async () => {
      const anna = await user('anna@example.de', { name: 'Anna' });
      const id = await newTopic(anna.cookie, { level: 'enigma:3', version: 'abc1234' });
      clock = new Date(clock.getTime() + MINUTE);
      assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, anna.cookie, { text: 'Nachtrag: nur mit Stil „Klassisch“.' })).statusCode, 201);

      assert.equal((await req('POST', '/api/forum/themen', undefined, { kategorie: 'frage', titel: 'Hallo', text: 'x' })).statusCode, 401);
      assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, undefined, { text: 'x' })).statusCode, 401);

      const list = await req('GET', '/api/forum/themen');
      assert.equal(list.statusCode, 200);
      const [t] = list.json().themen;
      assert.equal(t.titel, 'Murmel fällt durch');
      assert.equal(t.autor, 'Anna');
      assert.equal(t.kategorie, 'fehler');
      assert.equal(t.status, 'offen');
      assert.equal(t.antworten, 1);
      assert.equal(t.level, 'enigma:3');
      assert.equal(t.version, 'abc1234');
      assert.equal(t.kontoId, undefined, 'Konto-Id nur für Admins');

      const page = await req('GET', `/api/forum/themen/${id}`);
      assert.equal(page.statusCode, 200);
      const body = page.body;
      assert.ok(!body.includes('anna@example.de'), 'keine Mailadresse');
      assert.deepEqual(page.json().beitraege.map((p: { text: string; erster: boolean }) => [p.erster, p.text]), [
        [true, 'Im Level 3 fällt die Murmel durch den Boden.'],
        [false, 'Nachtrag: nur mit Stil „Klassisch“.'],
      ]);
      assert.equal((await req('GET', '/api/forum/themen/999')).statusCode, 404);
    });

    test('Anzeigename: nötig zum Schreiben, eindeutig ohne Groß/Klein', async () => {
      const ohne = await user('ohne@example.de', { name: null });
      const res = await req('POST', '/api/forum/themen', ohne.cookie, { kategorie: 'frage', titel: 'Frage', text: 'Wie geht das?' });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json().name, true);
      assert.deepEqual((await req('GET', '/api/forum/ich', ohne.cookie)).json(), { angemeldet: true, name: null, admin: false, gesperrt: false });

      await user('bert@example.de', { name: 'Bert' });
      assert.equal((await req('PUT', '/api/forum/name', ohne.cookie, { name: 'bERT' })).statusCode, 409);
      assert.equal((await req('PUT', '/api/forum/name', ohne.cookie, { name: 'Admin' })).statusCode, 400);
      assert.deepEqual((await req('PUT', '/api/forum/name', ohne.cookie, { name: ' Kugel  Blitz ' })).json(), { name: 'Kugel Blitz' });
      assert.equal((await req('PUT', '/api/forum/name', ohne.cookie, { name: 'Kugel Blitz' })).statusCode, 200, 'eigenen Namen erneut setzen geht');
      assert.deepEqual((await req('GET', '/api/forum/ich')).json(), { angemeldet: false });
    });

    test('Eingaben: Kategorie, Längen, Level und Version werden geprüft', async () => {
      const u = await user('u@example.de');
      const bad = async (b: object) => (await req('POST', '/api/forum/themen', u.cookie, { kategorie: 'fehler', titel: 'Titel ok', text: 'Text', ...b })).statusCode;
      assert.equal(await bad({ kategorie: 'spam' }), 400);
      assert.equal(await bad({ titel: ' a ' }), 400);
      assert.equal(await bad({ text: '   ' }), 400);
      assert.equal(await bad({ text: 'x'.repeat(5001) }), 400);
      assert.equal(await bad({ bild: 'data:image/png;base64,AAAA' }), 201, 'unbekannte Felder (z. B. Bilder) werden verworfen');
      const id = await newTopic(u.cookie, { level: '<b>x</b>', version: 'v 1' });
      const t = (await req('GET', `/api/forum/themen/${id}`)).json().thema;
      assert.equal(t.level, null);
      assert.equal(t.version, null);
    });

    test('Filter nach Kategorie und Status, Sortierung nach Stimmen', async () => {
      const u = await user('u@example.de');
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      const a = await newTopic(u.cookie, { kategorie: 'fehler', titel: 'Fehler A' });
      clock = new Date(clock.getTime() + MINUTE);
      const b = await newTopic(u.cookie, { kategorie: 'verbesserung', titel: 'Wunsch B' });
      assert.equal((await req('PUT', `/api/forum/themen/${a}/status`, admin.cookie, { status: 'geplant' })).statusCode, 200);
      const titles = async (q: string) => (await req('GET', `/api/forum/themen${q}`)).json().themen.map((t: { titel: string }) => t.titel);
      assert.deepEqual(await titles(''), ['Wunsch B', 'Fehler A']);
      assert.deepEqual(await titles('?kategorie=fehler'), ['Fehler A']);
      assert.deepEqual(await titles('?status=geplant'), ['Fehler A']);
      assert.deepEqual(await titles('?status=erledigt'), []);
      assert.equal((await req('POST', `/api/forum/themen/${a}/stimme`, admin.cookie, { an: true })).statusCode, 200);
      assert.deepEqual(await titles('?sort=stimmen'), ['Fehler A', 'Wunsch B']);
      assert.ok(b > 0);
    });

    test('Daumen hoch: ein Konto, eine Stimme; zurücknehmen geht', async () => {
      const u = await user('u@example.de');
      const v = await user('v@example.de');
      const id = await newTopic(u.cookie);
      for (let i = 0; i < 3; i++) assert.deepEqual((await req('POST', `/api/forum/themen/${id}/stimme`, v.cookie, { an: true })).json(), { stimmen: 1, gestimmt: true });
      assert.deepEqual((await req('POST', `/api/forum/themen/${id}/stimme`, u.cookie, { an: true })).json(), { stimmen: 2, gestimmt: true });
      assert.equal((await req('GET', '/api/forum/themen', v.cookie)).json().themen[0].gestimmt, true);
      assert.equal((await req('GET', '/api/forum/themen')).json().themen[0].gestimmt, false);
      assert.deepEqual((await req('POST', `/api/forum/themen/${id}/stimme`, v.cookie, { an: false })).json(), { stimmen: 1, gestimmt: false });
      assert.equal((await req('POST', `/api/forum/themen/${id}/stimme`, undefined, { an: true })).statusCode, 401);
    });

    test('Melden, Meldeliste, ausblenden und wieder einblenden (nur Admins)', async () => {
      const u = await user('u@example.de');
      const v = await user('v@example.de');
      const w = await user('w@example.de');
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      const id = await newTopic(u.cookie);
      const reply = (await req('POST', `/api/forum/themen/${id}/antworten`, v.cookie, { text: 'Kauft billige Uhren!' })).json().id;

      assert.equal((await req('POST', `/api/forum/beitraege/${reply}/melden`, u.cookie, { grund: 'Werbung' })).statusCode, 200);
      assert.equal((await req('POST', `/api/forum/beitraege/${reply}/melden`, u.cookie, { grund: 'nochmal' })).statusCode, 200);
      assert.equal((await req('POST', `/api/forum/beitraege/${reply}/melden`, w.cookie)).statusCode, 200);
      assert.equal((await req('POST', `/api/forum/beitraege/${reply}/melden`)).statusCode, 401);

      assert.equal((await req('GET', '/api/forum/meldungen', u.cookie)).statusCode, 403);
      const [m] = (await req('GET', '/api/forum/meldungen', admin.cookie)).json().meldungen;
      assert.equal(m.id, reply);
      assert.equal(m.anzahl, 2, 'eine Meldung je Konto');
      assert.deepEqual(m.gruende, ['Werbung']);
      assert.equal(m.themaId, id);
      assert.equal(m.kontoId, v.id);

      // players may not moderate, even with a forged request
      assert.equal((await req('PUT', `/api/forum/beitraege/${reply}/ausgeblendet`, u.cookie, { ausgeblendet: true })).statusCode, 403);
      assert.equal((await req('PUT', `/api/forum/themen/${id}/status`, u.cookie, { status: 'erledigt' })).statusCode, 403);
      assert.equal((await req('PUT', `/api/forum/konten/${v.id}/gesperrt`, u.cookie, { gesperrt: true })).statusCode, 403);

      assert.equal((await req('PUT', `/api/forum/beitraege/${reply}/ausgeblendet`, admin.cookie, { ausgeblendet: true })).statusCode, 200);
      assert.deepEqual((await req('GET', '/api/forum/meldungen', admin.cookie)).json().meldungen, [], 'Ausblenden erledigt die Meldungen');
      const pub = (await req('GET', `/api/forum/themen/${id}`)).json().beitraege[1];
      assert.equal(pub.ausgeblendet, true);
      assert.equal(pub.text, null, 'öffentlich ohne Text');
      assert.equal((await req('GET', `/api/forum/themen/${id}`, admin.cookie)).json().beitraege[1].text, 'Kauft billige Uhren!');

      assert.equal((await req('PUT', `/api/forum/beitraege/${reply}/ausgeblendet`, admin.cookie, { ausgeblendet: false })).statusCode, 200);
      assert.equal((await req('GET', `/api/forum/themen/${id}`)).json().beitraege[1].text, 'Kauft billige Uhren!');

      // dismiss reports without hiding
      await req('POST', `/api/forum/beitraege/${reply}/melden`, w.cookie, { grund: 'egal' });
      assert.equal((await req('GET', '/api/forum/meldungen', admin.cookie)).json().meldungen.length, 1);
      assert.equal((await req('DELETE', `/api/forum/beitraege/${reply}/meldungen`, admin.cookie)).statusCode, 200);
      assert.equal((await req('GET', '/api/forum/meldungen', admin.cookie)).json().meldungen.length, 0);
    });

    test('Erster Beitrag ausgeblendet: Thema verschwindet für alle außer Admins', async () => {
      const u = await user('u@example.de');
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      const id = await newTopic(u.cookie);
      const first = (await req('GET', `/api/forum/themen/${id}`)).json().beitraege[0].id;
      await req('PUT', `/api/forum/beitraege/${first}/ausgeblendet`, admin.cookie, { ausgeblendet: true });
      assert.deepEqual((await req('GET', '/api/forum/themen', u.cookie)).json().themen, []);
      assert.equal((await req('GET', `/api/forum/themen/${id}`, u.cookie)).statusCode, 404);
      assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, u.cookie, { text: 'x' })).statusCode, 404);
      const adminList = (await req('GET', '/api/forum/themen', admin.cookie)).json().themen;
      assert.equal(adminList[0].ausgeblendet, true);
    });

    test('Konten sperren und entsperren: gesperrt lesen ja, schreiben nein; Admins nicht sperrbar', async () => {
      const u = await user('u@example.de');
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      const id = await newTopic(u.cookie);
      assert.equal((await req('PUT', `/api/forum/konten/${u.id}/gesperrt`, admin.cookie, { gesperrt: true })).statusCode, 200);
      assert.equal((await req('GET', `/api/forum/themen/${id}`, admin.cookie)).json().beitraege[0].gesperrt, true);
      assert.equal((await req('GET', '/api/forum/ich', u.cookie)).json().gesperrt, true);
      assert.equal((await req('GET', `/api/forum/themen/${id}`, u.cookie)).statusCode, 200, 'lesen geht');
      for (const [m, path, body] of [
        ['POST', '/api/forum/themen', { kategorie: 'frage', titel: 'Titel', text: 'Text' }],
        ['POST', `/api/forum/themen/${id}/antworten`, { text: 'x' }],
        ['POST', `/api/forum/themen/${id}/stimme`, { an: true }],
        ['PUT', '/api/forum/name', { name: 'Neuer Name' }],
      ] as const) {
        assert.equal((await req(m, path, u.cookie, body)).statusCode, 403, path);
      }
      assert.equal((await req('PUT', `/api/forum/konten/${admin.id}/gesperrt`, admin.cookie, { gesperrt: true })).statusCode, 400);
      assert.equal((await req('PUT', '/api/forum/konten/9999/gesperrt', admin.cookie, { gesperrt: true })).statusCode, 404);
      assert.equal((await req('PUT', `/api/forum/konten/${u.id}/gesperrt`, admin.cookie, { gesperrt: false })).statusCode, 200);
      assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, u.cookie, { text: 'wieder da' })).statusCode, 201);
    });

    test('Eigene Beiträge löschen; der erste nimmt das Thema mit; fremde nicht', async () => {
      const u = await user('u@example.de');
      const v = await user('v@example.de');
      const id = await newTopic(u.cookie);
      const r = (await req('POST', `/api/forum/themen/${id}/antworten`, v.cookie, { text: 'Antwort' })).json().id;
      assert.equal((await req('DELETE', `/api/forum/beitraege/${r}`, u.cookie)).statusCode, 403);
      assert.deepEqual((await req('DELETE', `/api/forum/beitraege/${r}`, v.cookie)).json(), { geloescht: true, thema: false });
      const first = (await req('GET', `/api/forum/themen/${id}`)).json().beitraege[0].id;
      assert.deepEqual((await req('DELETE', `/api/forum/beitraege/${first}`, u.cookie)).json(), { geloescht: true, thema: true });
      assert.equal((await req('GET', `/api/forum/themen/${id}`)).statusCode, 404);
    });

    test('Grenzen je Konto für Stimmen und Meldungen; Längen in Zeichen wie PostgreSQL', async () => {
      const u = await user('u@example.de');
      const emoji = await req('POST', '/api/forum/themen', u.cookie, { kategorie: 'frage', titel: '😀a', text: 'x' });
      assert.equal(emoji.statusCode, 400, 'zwei Zeichen, obwohl JavaScript drei zählt');
      const id = await newTopic(u.cookie, { titel: '😀😀😀' });
      // the account window (ACTIONS_PER_15_MIN) closes before the IP window (40)
      let last = 200;
      let n = 0;
      for (; n < ACTIONS_PER_15_MIN + 1 && last === 200; n++) last = (await req('POST', `/api/forum/themen/${id}/stimme`, u.cookie, { an: n % 2 === 0 })).statusCode;
      assert.equal(last, 429);
      assert.equal(n, ACTIONS_PER_15_MIN + 1);
      assert.match((await req('POST', `/api/forum/themen/${id}/stimme`, u.cookie, { an: true })).json().error, /Klicks/);
    });

    test('Eigene Beiträge löschen gibt das Stundenfenster nicht wieder frei', async () => {
      const u = await user('u@example.de');
      const v = await user('v@example.de');
      const id = await newTopic(u.cookie);
      // a new IP for every pair of requests: only the account window may stop v
      for (let i = 0; i < POSTS_PER_HOUR; i++) {
        const ip = `203.0.113.${i + 1}`;
        const res = await req('POST', `/api/forum/themen/${id}/antworten`, v.cookie, { text: `v${i}` }, ip);
        assert.equal(res.statusCode, 201, res.body);
        assert.equal((await req('DELETE', `/api/forum/beitraege/${res.json().id}`, v.cookie, undefined, ip)).statusCode, 200);
      }
      const res = await req('POST', `/api/forum/themen/${id}/antworten`, v.cookie, { text: 'noch einer' }, '198.51.100.1');
      assert.equal(res.statusCode, 429);
      assert.match(res.json().error, /pro Stunde/);
    });

    test('Melden in einem ausgeblendeten Thema geht nicht (404)', async () => {
      const u = await user('u@example.de');
      const v = await user('v@example.de');
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      const id = await newTopic(u.cookie);
      const reply = (await req('POST', `/api/forum/themen/${id}/antworten`, v.cookie, { text: 'Antwort' })).json().id;
      const first = (await req('GET', `/api/forum/themen/${id}`)).json().beitraege[0].id;
      await req('PUT', `/api/forum/beitraege/${first}/ausgeblendet`, admin.cookie, { ausgeblendet: true });
      assert.equal((await req('POST', `/api/forum/beitraege/${reply}/melden`, u.cookie, { grund: 'x' })).statusCode, 404);
    });

    if (backend.name === 'PostgreSQL') {
      test('Konto löschen nimmt Themen (samt Antworten), Beiträge, Stimmen und Meldungen mit', async () => {
        const u = await user('u@example.de');
        const v = await user('v@example.de');
        const own = await newTopic(u.cookie, { titel: 'Von u' });
        const other = await newTopic(v.cookie, { titel: 'Von v' });
        await req('POST', `/api/forum/themen/${own}/antworten`, v.cookie, { text: 'v antwortet u' });
        const r = (await req('POST', `/api/forum/themen/${other}/antworten`, u.cookie, { text: 'u antwortet v' })).json().id;
        await req('POST', `/api/forum/themen/${other}/stimme`, u.cookie, { an: true });
        await req('POST', `/api/forum/beitraege/${r}/melden`, v.cookie, { grund: 'x' });
        await accounts.deleteAccount(u.id);
        assert.deepEqual((await req('GET', '/api/forum/themen')).json().themen.map((t: { titel: string; stimmen: number; antworten: number }) => [t.titel, t.stimmen, t.antworten]), [['Von v', 0, 0]]);
        const n = await sql!`select (select count(*)::int from forum_posts where account_id = ${u.id}) as p, (select count(*)::int from forum_reports) as r, (select count(*)::int from forum_votes) as v`;
        assert.deepEqual({ ...n[0] }, { p: 0, r: 0, v: 0 });
      });
    }

    test('Admin-Beiträge tragen das Kennzeichen Team, Status setzen nur mit gültigem Wert', async () => {
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      const id = await newTopic(admin.cookie);
      assert.equal((await req('GET', `/api/forum/themen/${id}`)).json().beitraege[0].team, true);
      assert.equal((await req('PUT', `/api/forum/themen/${id}/status`, admin.cookie, { status: 'kaputt' })).statusCode, 400);
      assert.equal((await req('PUT', '/api/forum/themen/999/status', admin.cookie, { status: 'erledigt' })).statusCode, 404);
    });

    test('Spam-Schutz: Themen und Beiträge je Konto und Stunde, Anfragen je IP, fremde Herkunft', async () => {
      const u = await user('u@example.de');
      for (let i = 0; i < TOPICS_PER_HOUR; i++) await newTopic(u.cookie, { titel: `Thema ${i}` });
      const res = await req('POST', '/api/forum/themen', u.cookie, { kategorie: 'frage', titel: 'Noch eins', text: 'x' });
      assert.equal(res.statusCode, 429);
      assert.match(res.json().error, /pro Stunde/);
      const id = (await req('GET', '/api/forum/themen')).json().themen[0].id;
      for (let i = TOPICS_PER_HOUR; i < POSTS_PER_HOUR; i++) assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, u.cookie, { text: `a${i}` })).statusCode, 201);
      assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, u.cookie, { text: 'zu viel' })).statusCode, 429);
      clock = new Date(clock.getTime() + 61 * MINUTE);
      assert.equal((await req('POST', `/api/forum/themen/${id}/antworten`, u.cookie, { text: 'wieder frei' })).statusCode, 201);

      const foreign = await app.inject({ method: 'POST', url: `/api/forum/themen/${id}/antworten`, payload: { text: 'x' }, headers: { origin: 'https://boese.example', cookie: `${COOKIE}=${u.cookie}` } });
      assert.equal(foreign.statusCode, 403);

      // the IP window counts all writes, whichever account sends them
      const many = [await user('w1@example.de'), await user('w2@example.de'), await user('w3@example.de')];
      let last = 200;
      for (let i = 0; i < 60 && last !== 429; i++) last = (await req('POST', `/api/forum/themen/${id}/stimme`, many[i % 3].cookie, { an: i % 2 === 0 })).statusCode;
      assert.equal(last, 429);
      assert.match((await req('POST', `/api/forum/themen/${id}/stimme`, many[0].cookie, { an: true })).json().error, /Zu viele Anfragen/);
      // admins moderate without the IP window (same IP in inject)
      const admin = await user('chef@example.de', { admin: true, name: 'Chef' });
      for (let i = 0; i < 45; i++) assert.equal((await req('PUT', `/api/forum/themen/${id}/status`, admin.cookie, { status: i % 2 ? 'offen' : 'geplant' })).statusCode, 200);
    });
  });
}
