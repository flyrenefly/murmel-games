import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { type AccountStore, COOKIE, type Mailer, normalizeEmail, parseAdminEmails, passkeyName, readCookie, requireAccount, requireAdmin } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { RateLimit } from './limit.ts';
import { migrate } from './migrate.ts';
import { SoftAuthenticator } from './soft-authenticator.ts';

const ORIGIN = 'https://murmel.example';
const MINUTE = 60_000;

// ---------- helpers ----------

test('normalizeEmail: trimmt, macht klein, lehnt Unsinn ab', () => {
  assert.equal(normalizeEmail('  Rene@Example.DE '), 'rene@example.de');
  for (const bad of ['', 'kein-at', 'a@b', 'a b@c.de', '<x>@y.de', 42, null]) assert.equal(normalizeEmail(bad), null, String(bad));
});

test('parseAdminEmails: kommagetrennt, Groß/Klein und Leerzeichen egal, leer = niemand', () => {
  assert.deepEqual(parseAdminEmails(' A@x.de, b@Y.de ,,kaputt'), ['a@x.de', 'b@y.de']);
  assert.deepEqual(parseAdminEmails(undefined), []);
  assert.deepEqual(parseAdminEmails(''), []);
});

test('readCookie findet das Sitzungs-Cookie zwischen anderen', () => {
  assert.equal(readCookie(`a=1; ${COOKIE}=abc; b=2`, COOKIE), 'abc');
  assert.equal(readCookie('a=1', COOKIE), null);
  assert.equal(readCookie(undefined, COOKIE), null);
});

test('RateLimit: höchstens max je Fenster und Schlüssel, danach wieder frei', () => {
  const l = new RateLimit(2, 1000);
  assert.equal(l.take('ip', 0), true);
  assert.equal(l.take('ip', 10), true);
  assert.equal(l.take('ip', 20), false);
  assert.equal(l.take('anders', 20), true);
  assert.equal(l.take('ip', 1000), true);
});

test('passkeyName nennt Browser und System', () => {
  assert.equal(passkeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'), 'Chrome auf Windows');
  assert.equal(passkeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'), 'Safari auf iOS');
  assert.equal(passkeyName(undefined), 'Browser');
});

// ---------- flows, against memory and (with TEST_DATABASE_URL) PostgreSQL ----------

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

const backends: { name: string; skip: boolean; store: () => Promise<AccountStore> }[] = [
  { name: 'Speicher', skip: false, store: async () => memoryStore() },
  {
    name: 'PostgreSQL',
    skip: !sql,
    store: async () => {
      await sql!`truncate accounts, login_tokens, sessions, webauthn_challenges, passkeys, account_identities, signin_day, signin_seen restart identity cascade`;
      return accountStore(sql!);
    },
  },
];

for (const backend of backends) {
  describe(`Konten (${backend.name})`, { skip: backend.skip }, () => {
    let store: AccountStore;
    let clock: Date;
    let sent: { to: string; subject: string; text: string }[];
    const mailer: Mailer = {
      async send(to, subject, text) {
        sent.push({ to, subject, text });
      },
    };
    const app = (opts: { mail?: boolean; admins?: string[] } = {}): FastifyInstance =>
      buildApp({
        version: 't',
        db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
        statsToken: 'geheim',
        accounts: { store, mailer: opts.mail === false ? null : mailer, origin: ORIGIN, adminEmails: opts.admins ?? [], now: () => clock },
      });

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      store = await backend.store();
      clock = new Date('2026-11-13T12:00:00Z');
      sent = [];
    });

    const cookieOf = (res: LightMyRequestResponse): string | null => {
      const raw = res.headers['set-cookie'];
      const line = (Array.isArray(raw) ? raw : [raw ?? '']).find((c) => c.startsWith(`${COOKIE}=`));
      return line ? (readCookie(line.split(';')[0], COOKIE) ?? '') : null;
    };
    const post = (a: FastifyInstance, url: string, payload?: object, cookie?: string) =>
      a.inject({ method: 'POST', url, payload, headers: { origin: ORIGIN, ...(cookie ? { cookie: `${COOKIE}=${cookie}` } : {}) } });
    const me = async (a: FastifyInstance, cookie?: string) =>
      (await a.inject({ method: 'GET', url: '/api/konto', headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} })).json();

    /** Requests a link for the address and returns the token from the mail. */
    async function requestLink(a: FastifyInstance, email: string): Promise<string> {
      const res = await post(a, '/api/konto/mail', { email });
      assert.equal(res.statusCode, 202, res.body);
      const m = /#anmelden=([A-Za-z0-9_-]+)/.exec(sent.at(-1)!.text);
      assert.ok(m, 'Link in der Mail');
      return m[1];
    }
    async function signInByMail(a: FastifyInstance, email: string): Promise<string> {
      const res = await post(a, '/api/konto/mail/einloesen', { token: await requestLink(a, email) });
      assert.equal(res.statusCode, 200, res.body);
      return cookieOf(res)!;
    }

    test('Mail-Link: anfordern, einlösen, angemeldet mit sicherem Cookie; Link nur einmal gültig', async () => {
      const a = app();
      assert.deepEqual(await me(a), { angemeldet: false, mail: true, anbieter: [] });

      const token = await requestLink(a, ' Spieler@Example.de ');
      assert.equal(sent[0].to, 'spieler@example.de');
      assert.match(sent[0].text, new RegExp(`${ORIGIN}/#anmelden=`));
      assert.match(sent[0].text, /15 Minuten/);

      const res = await post(a, '/api/konto/mail/einloesen', { token });
      assert.equal(res.statusCode, 200);
      const setCookie = String(res.headers['set-cookie']);
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(setCookie.includes(attr), attr);
      const cookie = cookieOf(res)!;
      const konto = await me(a, cookie);
      assert.equal(konto.angemeldet, true);
      assert.equal(konto.konto.email, 'spieler@example.de');
      assert.equal(konto.konto.rolle, 'player');
      assert.deepEqual(konto.konto.passkeys, []);

      const again = await post(a, '/api/konto/mail/einloesen', { token });
      assert.equal(again.statusCode, 400);
      assert.match(again.json().error, /abgelaufen oder wurde schon benutzt/);
    });

    test('Mail-Link verfällt nach 15 Minuten; erneutes Anmelden landet im selben Konto', async () => {
      const a = app();
      const old = await requestLink(a, 'zeit@example.de');
      clock = new Date(clock.getTime() + 16 * MINUTE);
      assert.equal((await post(a, '/api/konto/mail/einloesen', { token: old })).statusCode, 400);

      const first = await me(a, await signInByMail(a, 'zeit@example.de'));
      const second = await me(a, await signInByMail(a, 'ZEIT@example.de'));
      assert.equal(first.konto.erstellt, second.konto.erstellt);
      assert.deepEqual((await store.overview()).accounts, 1);
    });

    test('ohne SMTP-Werte meldet die Anmeldung klar, dass der Mailversand fehlt', async () => {
      const a = app({ mail: false });
      assert.deepEqual(await me(a), { angemeldet: false, mail: false, anbieter: [] });
      const res = await post(a, '/api/konto/mail', { email: 'x@example.de' });
      assert.equal(res.statusCode, 503);
      assert.match(res.json().error, /Mailversand ist noch nicht eingerichtet/);
    });

    test('ungültige Adresse und ungültiger Link werden abgelehnt', async () => {
      const a = app();
      assert.equal((await post(a, '/api/konto/mail', { email: 'kein-at' })).statusCode, 400);
      assert.equal((await post(a, '/api/konto/mail/einloesen', { token: 'x'.repeat(43) })).statusCode, 400);
      assert.equal(sent.length, 0);
    });

    test('Begrenzung: 3 Links je Adresse und Stunde, 5 Mail-Anfragen je IP in 15 Minuten', async () => {
      const a = app();
      for (let i = 0; i < 3; i++) await requestLink(a, 'viel@example.de');
      const res = await post(a, '/api/konto/mail', { email: 'viel@example.de' });
      assert.equal(res.statusCode, 429);
      assert.equal(sent.length, 3);

      const b = app(); // fresh IP window
      for (let i = 0; i < 5; i++) assert.equal((await post(b, '/api/konto/mail', { email: `p${i}@example.de` })).statusCode, 202);
      assert.equal((await post(b, '/api/konto/mail', { email: 'p9@example.de' })).statusCode, 429);
      clock = new Date(clock.getTime() + 61 * MINUTE);
      assert.equal((await post(b, '/api/konto/mail', { email: 'viel@example.de' })).statusCode, 202);
    });

    test('Anfragen von fremder Herkunft (CSRF) werden abgewiesen', async () => {
      const a = app();
      const res = await a.inject({ method: 'POST', url: '/api/konto/mail', payload: { email: 'x@example.de' }, headers: { origin: 'https://boese.example' } });
      assert.equal(res.statusCode, 403);
      assert.equal(sent.length, 0);
    });

    test('Admin-Rolle aus ADMIN_EMAILS: Übersicht nur für Admins, Rolle folgt der Liste bei jeder Anmeldung', async () => {
      const admins = ['chef@example.de'];
      const a = app({ admins });
      const chef = await signInByMail(a, 'Chef@Example.de');
      const spieler = await signInByMail(a, 'spieler@example.de');
      assert.equal((await me(a, chef)).konto.rolle, 'admin');
      assert.equal((await me(a, spieler)).konto.rolle, 'player');

      const view = (cookie?: string) => a.inject({ method: 'GET', url: '/api/admin/uebersicht', headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} });
      assert.equal((await view()).statusCode, 401);
      assert.equal((await view(spieler)).statusCode, 403);
      const ok = await view(chef);
      assert.equal(ok.statusCode, 200);
      assert.deepEqual(ok.json(), { accounts: 2, admins: 1, passkeys: 0 });

      // Statistics: admins without STATS_TOKEN, players not
      const stats = (cookie?: string) => a.inject({ method: 'GET', url: '/api/statistik', headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} });
      assert.equal((await stats()).statusCode, 401);
      assert.equal((await stats(spieler)).statusCode, 401);
      assert.deepEqual((await stats(chef)).json(), { days: [], levels: [] });

      // Removed from ADMIN_EMAILS: the next sign-in takes the role away.
      const later = app({ admins: [] });
      const again = await signInByMail(later, 'chef@example.de');
      assert.equal((await me(later, again)).konto.rolle, 'player');
    });

    test('Admin-Statistik der Konten: Anmeldungen je Tag, verschiedene Konten, neue Konten', async () => {
      const a = app({ admins: ['chef@example.de'] });
      const chef = await signInByMail(a, 'chef@example.de');
      await signInByMail(a, 'chef@example.de'); // same account again
      await signInByMail(a, 'spieler@example.de');
      clock = new Date('2026-11-14T08:00:00Z');
      await signInByMail(a, 'spieler@example.de');

      const view = (cookie?: string) => a.inject({ method: 'GET', url: '/api/admin/konten?tage=366', headers: cookie ? { cookie: `${COOKIE}=${cookie}` } : {} });
      assert.equal((await view()).statusCode, 401);
      const res = await view(chef);
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.accounts, 2);
      assert.equal(body.blocked, 0);
      assert.deepEqual(body.signIns, [
        { day: '2026-11-13', signIns: 3, accounts: 2 },
        { day: '2026-11-14', signIns: 1, accounts: 1 },
      ]);
      // created_at is the real time of the database: only the total is checked
      assert.equal(body.created.reduce((n: number, d: { count: number }) => n + d.count, 0), 2);
      // the overview is unchanged
      assert.deepEqual(Object.keys(body).sort(), ['accounts', 'admins', 'blocked', 'created', 'passkeys', 'signIns']);
    });

    test('Passkey: nach Mail-Login einrichten, abmelden, mit Passkey wieder anmelden', async () => {
      const a = app({ admins: ['chef@example.de'] });
      const cookie = await signInByMail(a, 'chef@example.de');
      const device = new SoftAuthenticator(ORIGIN);

      assert.equal((await post(a, '/api/konto/passkey/registrieren')).statusCode, 401);
      const start = await post(a, '/api/konto/passkey/registrieren', {}, cookie);
      assert.equal(start.statusCode, 200);
      const { vorgang, optionen } = start.json();
      assert.equal(optionen.rp.id, 'murmel.example');
      assert.equal(optionen.authenticatorSelection.residentKey, 'required');
      const done = await a.inject({
        method: 'POST',
        url: '/api/konto/passkey/registrieren/abschliessen',
        payload: { vorgang, antwort: device.create(optionen) },
        headers: { origin: ORIGIN, cookie: `${COOKIE}=${cookie}`, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0' },
      });
      assert.equal(done.statusCode, 200, done.body);
      assert.equal(done.json().konto.passkeys.length, 1);
      assert.equal(done.json().konto.passkeys[0].name, 'Chrome auf Windows');

      const out = await post(a, '/api/konto/abmelden', {}, cookie);
      assert.match(String(out.headers['set-cookie']), /Max-Age=0/);
      assert.equal((await me(a, cookie)).angemeldet, false);

      const login = await post(a, '/api/konto/passkey/anmelden', {});
      const challenge = login.json();
      const res = await post(a, '/api/konto/passkey/anmelden/abschliessen', { vorgang: challenge.vorgang, antwort: device.get(challenge.optionen) });
      assert.equal(res.statusCode, 200, res.body);
      const fresh = cookieOf(res)!;
      const konto = await me(a, fresh);
      assert.equal(konto.konto.email, 'chef@example.de');
      assert.equal(konto.konto.rolle, 'admin');
      assert.ok(konto.konto.passkeys[0].zuletzt);

      // The challenge is single use.
      const replay = await post(a, '/api/konto/passkey/anmelden/abschliessen', { vorgang: challenge.vorgang, antwort: device.get(challenge.optionen) });
      assert.equal(replay.statusCode, 400);
    });

    test('Passkey einer fremden Seite (falsche Herkunft) und unbekannter Passkey werden abgelehnt', async () => {
      const a = app();
      const cookie = await signInByMail(a, 'x@example.de');
      const device = new SoftAuthenticator(ORIGIN);
      const start = (await post(a, '/api/konto/passkey/registrieren', {}, cookie)).json();
      const bad = await post(a, '/api/konto/passkey/registrieren/abschliessen', { vorgang: start.vorgang, antwort: device.create(start.optionen, 'https://boese.example') }, cookie);
      assert.equal(bad.statusCode, 400);
      assert.equal((await me(a, cookie)).konto.passkeys.length, 0);

      const login = (await post(a, '/api/konto/passkey/anmelden', {})).json();
      const unknown = await post(a, '/api/konto/passkey/anmelden/abschliessen', { vorgang: login.vorgang, antwort: device.get(login.optionen) });
      assert.equal(unknown.statusCode, 400);
      assert.equal(cookieOf(unknown), null);
    });

    test('Passkey entfernen und auf allen Geräten abmelden', async () => {
      const a = app();
      const one = await signInByMail(a, 'x@example.de');
      const two = await signInByMail(a, 'x@example.de');
      const device = new SoftAuthenticator(ORIGIN);
      const start = (await post(a, '/api/konto/passkey/registrieren', {}, one)).json();
      await post(a, '/api/konto/passkey/registrieren/abschliessen', { vorgang: start.vorgang, antwort: device.create(start.optionen) }, one);
      const id = (await me(a, one)).konto.passkeys[0].id;

      const del = await a.inject({ method: 'DELETE', url: `/api/konto/passkey/${id}`, headers: { origin: ORIGIN, cookie: `${COOKIE}=${two}` } });
      assert.equal(del.statusCode, 200);
      assert.deepEqual(del.json().konto.passkeys, []);

      await post(a, '/api/konto/abmelden', { alle: true }, one);
      assert.equal((await me(a, one)).angemeldet, false);
      assert.equal((await me(a, two)).angemeldet, false);
    });

    test('Konto löschen entfernt Konto, Sitzungen und Passkeys', async () => {
      const a = app();
      const cookie = await signInByMail(a, 'weg@example.de');
      const device = new SoftAuthenticator(ORIGIN);
      const start = (await post(a, '/api/konto/passkey/registrieren', {}, cookie)).json();
      await post(a, '/api/konto/passkey/registrieren/abschliessen', { vorgang: start.vorgang, antwort: device.create(start.optionen) }, cookie);

      assert.equal((await a.inject({ method: 'DELETE', url: '/api/konto' })).statusCode, 401);
      const res = await a.inject({ method: 'DELETE', url: '/api/konto', headers: { origin: ORIGIN, cookie: `${COOKIE}=${cookie}` } });
      assert.equal(res.statusCode, 200);
      assert.match(String(res.headers['set-cookie']), /Max-Age=0/);
      assert.equal((await me(a, cookie)).angemeldet, false);
      assert.deepEqual(await store.overview(), { accounts: 0, admins: 0, passkeys: 0 });

      const login = (await post(a, '/api/konto/passkey/anmelden', {})).json();
      assert.equal((await post(a, '/api/konto/passkey/anmelden/abschliessen', { vorgang: login.vorgang, antwort: device.get(login.optionen) })).statusCode, 400);
    });

    test('Gesperrtes Konto: angemeldet und löschbar, aber requireAccount verweigert; requireAdmin nur für Admins', async () => {
      const a = app({ admins: ['chef@example.de'] });
      // later endpoints (forum) use the exported guards
      a.post('/api/forum/beitrag', { preHandler: requireAccount }, async (req) => ({ von: req.account!.email }));
      a.post('/api/forum/sperren', { preHandler: requireAdmin }, async () => ({ ok: true }));
      const spieler = await signInByMail(a, 'spieler@example.de');
      const chef = await signInByMail(a, 'chef@example.de');

      assert.equal((await post(a, '/api/forum/beitrag', {})).statusCode, 401);
      assert.deepEqual((await post(a, '/api/forum/beitrag', {}, spieler)).json(), { von: 'spieler@example.de' });
      assert.equal((await post(a, '/api/forum/sperren', {}, spieler)).statusCode, 403);
      assert.equal((await post(a, '/api/forum/sperren', {}, chef)).statusCode, 200);

      const id = (await store.signIn({ provider: 'mail', subject: 'spieler@example.de', email: 'spieler@example.de' }, 'player')).id;
      await store.setBlocked(id, true, clock);
      assert.equal((await me(a, spieler)).konto.gesperrt, true);
      const blocked = await post(a, '/api/forum/beitrag', {}, spieler);
      assert.equal(blocked.statusCode, 403);
      assert.match(blocked.json().error, /gesperrt/);
      // still signs in again (to see why, or to delete the account)
      assert.equal((await me(a, await signInByMail(a, 'spieler@example.de'))).konto.gesperrt, true);

      await store.setBlocked(id, false, clock);
      assert.equal((await post(a, '/api/forum/beitrag', {}, spieler)).statusCode, 200);
      await store.setBlocked(id, true, clock);
      const del = await a.inject({ method: 'DELETE', url: '/api/konto', headers: { origin: ORIGIN, cookie: `${COOKIE}=${spieler}` } });
      assert.equal(del.statusCode, 200);
    });

    test('Fremdanmeldung (später Google/Apple/GitHub) mit derselben Adresse landet im selben Konto', async () => {
      const viaMail = await store.signIn({ provider: 'mail', subject: 'x@example.de', email: 'x@example.de' }, 'player');
      const viaGithub = await store.signIn({ provider: 'github', subject: '12345', email: 'X@example.de' }, 'player');
      const again = await store.signIn({ provider: 'github', subject: '12345', email: 'neu@example.de' }, 'player');
      assert.equal(viaGithub.id, viaMail.id);
      assert.equal(again.id, viaMail.id);
      assert.equal((await store.overview()).accounts, 1);
    });
  });
}
