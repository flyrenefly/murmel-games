// Konten Stufe 2: Google, GitHub and Apple against fake provider endpoints (own RSA keys and JWKS).
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, type KeyObject, sign, verify } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { appleClientSecret, BIND_COOKIE, ENDPOINTS, Jwks, type ProviderConfig, ProviderError, providersFromEnv, verifyIdToken } from './anbieter.ts';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { type AccountStore, COOKIE, readCookie } from './konten.ts';
import { accountStore } from './konten-db.ts';
import { memoryStore } from './konten-memory.ts';
import { migrate } from './migrate.ts';

const ORIGIN = 'https://murmel.example';
const APPLE_ORIGIN = 'https://appleid.apple.com';

// ---------- fake providers ----------

const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const rsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 });
const googleKey = rsa();
const appleKey = rsa();
const strangerKey = rsa();
const appleP8 = generateKeyPairSync('ec', { namedCurve: 'P-256' });

function jwt(key: KeyObject, claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }): string {
  const data = `${b64(header)}.${b64(claims)}`;
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), key).toString('base64url')}`;
}
const jwks = (key: KeyObject) => ({ keys: [{ ...key.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] });

interface FakeUser {
  sub: string;
  email: string;
  verified?: boolean;
}

/** One fake for all three providers; tests change `claims` (or the GitHub answers) to break things. */
class Fake {
  google: FakeUser = { sub: 'g-123', email: 'spieler@gmail.example' };
  apple: FakeUser = { sub: 'a.456', email: 'abc123@privaterelay.appleid.com' };
  github = { id: 789 as unknown, emails: [{ email: 'Dev@Example.de', primary: true, verified: true }] as unknown[] };
  /** Overrides for the next ID token's claims (aud, iss, nonce, exp …). */
  claims: Record<string, unknown> = {};
  signWith: KeyObject | null = null;
  calls: string[] = [];
  appleSecrets: string[] = [];
  /** Codes handed out at the authorize step: code → nonce, PKCE challenge. */
  private codes = new Map<string, { nonce: string; challenge: string | null }>();
  now = () => Date.now();

  authorize(location: string): { state: string; code: string } {
    const u = new URL(location);
    const code = `code-${this.codes.size + 1}`;
    this.codes.set(code, { nonce: u.searchParams.get('nonce') ?? '', challenge: u.searchParams.get('code_challenge') });
    return { state: u.searchParams.get('state')!, code };
  }

  private idToken(key: KeyObject, iss: string, aud: string, user: FakeUser, nonce: string, extra: Record<string, unknown>) {
    const iat = Math.floor(this.now() / 1000);
    return jwt(this.signWith ?? key, { iss, aud, sub: user.sub, email: user.email, email_verified: user.verified ?? true, nonce, iat, exp: iat + 600, ...extra, ...this.claims });
  }

  fetch: typeof fetch = async (input, init) => {
    const target = String(input);
    this.calls.push(target);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const form = new URLSearchParams(String(init?.body ?? ''));
    const grant = () => {
      const c = this.codes.get(form.get('code') ?? '');
      this.codes.delete(form.get('code') ?? '');
      if (!c) return null;
      // PKCE: the verifier must fit the challenge from the authorize step
      if (c.challenge && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return null;
      return c;
    };
    switch (target) {
      case ENDPOINTS.google.jwks:
        return json(jwks(googleKey.publicKey));
      case ENDPOINTS.apple.jwks:
        return json(jwks(appleKey.publicKey));
      case ENDPOINTS.google.token: {
        const c = grant();
        if (!c || form.get('client_secret') !== 'google-geheim') return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: 'x', id_token: this.idToken(googleKey.privateKey, 'https://accounts.google.com', 'google-id', this.google, c.nonce, { azp: 'google-id' }) });
      }
      case ENDPOINTS.apple.token: {
        const c = grant();
        this.appleSecrets.push(form.get('client_secret') ?? '');
        if (!c) return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: 'x', id_token: this.idToken(appleKey.privateKey, APPLE_ORIGIN, 'games.murmel.signin', this.apple, c.nonce, { is_private_email: 'true' }) });
      }
      case ENDPOINTS.github.token: {
        const c = grant();
        if (!c || form.get('client_secret') !== 'github-geheim') return json({ error: 'bad_verification_code' });
        return json({ access_token: 'gho_test', token_type: 'bearer' });
      }
      case ENDPOINTS.github.user:
        return json({ id: this.github.id, login: 'dev' });
      case ENDPOINTS.github.emails:
        return json(this.github.emails);
    }
    return json({ error: 'unbekannt' }, 404);
  };
}

const CONFIG: ProviderConfig = {
  google: { clientId: 'google-id', clientSecret: 'google-geheim' },
  github: { clientId: 'github-id', clientSecret: 'github-geheim' },
  apple: { servicesId: 'games.murmel.signin', teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: appleP8.privateKey },
};

// ---------- pure parts ----------

describe('ID-Token-Prüfung', () => {
  const fake = new Fake();
  const now = Date.parse('2026-11-13T12:00:00Z');
  const keys = new Jwks(ENDPOINTS.google.jwks, fake.fetch);
  const good = { iss: 'https://accounts.google.com', aud: 'google-id', sub: 's1', nonce: 'n1', iat: now / 1000, exp: now / 1000 + 600 };
  const check = (token: string, nonce = 'n1') => verifyIdToken(token, { jwks: keys, issuers: ENDPOINTS.google.issuers, audience: 'google-id', nonce, now });
  const rejects = async (token: string, why: RegExp, nonce?: string) => {
    await assert.rejects(check(token, nonce), (err: unknown) => err instanceof ProviderError && err.code === 'pruefung' && why.test(err.message));
  };

  test('gültiges Token geht durch', async () => {
    assert.equal((await check(jwt(googleKey.privateKey, good))).sub, 's1');
  });
  test('falsches aud, iss, nonce, abgelaufen werden abgelehnt', async () => {
    await rejects(jwt(googleKey.privateKey, { ...good, aud: 'fremde-app' }), /aud/);
    await rejects(jwt(googleKey.privateKey, { ...good, aud: ['google-id', 'fremde-app'] }), /aud/);
    await rejects(jwt(googleKey.privateKey, { ...good, iss: 'https://evil.example' }), /iss/);
    await rejects(jwt(googleKey.privateKey, { ...good, nonce: 'anders' }), /nonce/);
    await rejects(jwt(googleKey.privateKey, good), /nonce/, '');
    await rejects(jwt(googleKey.privateKey, { ...good, exp: now / 1000 - 61 }), /abgelaufen/);
    await rejects(jwt(googleKey.privateKey, { ...good, iat: now / 1000 + 3600 }), /iat/);
  });
  test('fremde Signatur, alg none, HS256 und unbekannte kid werden abgelehnt', async () => {
    await rejects(jwt(strangerKey.privateKey, good), /Signatur/);
    await rejects(`${b64({ alg: 'none', kid: 'k1' })}.${b64(good)}.`, /Algorithmus/);
    await rejects(`${b64({ alg: 'HS256', kid: 'k1' })}.${b64(good)}.abc`, /Algorithmus/);
    await rejects(jwt(googleKey.privateKey, good, { alg: 'RS256', kid: 'k9' }), /unbekannter Schlüssel/);
    await rejects('kein.token', /Form/);
  });
});

test('Apple Client Secret: ES256-JWT mit Team-ID, Services ID und Key-ID, 5 Minuten gültig', () => {
  const t = new Date('2026-11-13T12:00:00Z');
  const token = appleClientSecret(CONFIG.apple!, t);
  const [h, p, s] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.deepEqual(claims, { iss: 'TEAM123456', iat: t.getTime() / 1000, exp: t.getTime() / 1000 + 300, aud: APPLE_ORIGIN, sub: 'games.murmel.signin' });
  assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: appleP8.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
});

test('providersFromEnv: nur vollständige Anbieter sind an, Warnungen ohne Werte', () => {
  const pem = appleP8.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const full = providersFromEnv(
    { GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', GITHUB_CLIENT_ID: 'h', GITHUB_CLIENT_SECRET: 't', APPLE_SERVICES_ID: 'x', APPLE_TEAM_ID: 'y', APPLE_KEY_ID: 'z' },
    () => pem,
  );
  assert.deepEqual(Object.keys(full.config).sort(), ['apple', 'github', 'google']);
  assert.deepEqual(full.warnings, []);

  const none = providersFromEnv({}, () => pem);
  assert.deepEqual(none, { config: {}, warnings: [] });

  const half = providersFromEnv({ GOOGLE_CLIENT_ID: 'g', APPLE_SERVICES_ID: 'x', APPLE_TEAM_ID: 'y', APPLE_KEY_ID: 'z' }, () => {
    throw new Error('ENOENT');
  });
  assert.deepEqual(half.config, {});
  assert.equal(half.warnings.length, 2);
  assert.ok(!half.warnings.join().includes('g,'), 'keine Werte in Warnungen');
  assert.equal(providersFromEnv({ APPLE_SERVICES_ID: 'x', APPLE_TEAM_ID: 'y', APPLE_KEY_ID: 'z' }, () => '').config.apple, undefined);
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

const cookies = (res: LightMyRequestResponse): string[] => {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
};
const cookieValue = (res: LightMyRequestResponse, name: string): string | null => {
  const line = cookies(res).find((c) => c.startsWith(`${name}=`));
  return line ? (readCookie(line.split(';')[0], name) ?? '') : null;
};

for (const backend of backends) {
  describe(`Anmeldung mit Anbietern (${backend.name})`, { skip: backend.skip }, () => {
    let store: AccountStore;
    let fake: Fake;
    const app = (opts: { config?: ProviderConfig; admins?: string[] } = {}): FastifyInstance =>
      buildApp({
        version: 't',
        db: { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({ days: [], levels: [] }) },
        accounts: { store, mailer: null, origin: ORIGIN, adminEmails: opts.admins ?? [], providers: opts.config ?? CONFIG, fetch: fake.fetch },
      });

    before(async () => {
      if (sql) await migrate(sql, fileURLToPath(new URL('../migrations', import.meta.url)));
    });
    beforeEach(async () => {
      store = await backend.store();
      fake = new Fake();
    });

    const cookieHeader = (c: Record<string, string | undefined>) =>
      Object.entries(c)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

    /** Start → provider → callback; returns the redirect fragment and the binding cookie. */
    async function toProvider(a: FastifyInstance, p: 'google' | 'github' | 'apple', session?: string) {
      const start = await a.inject({ method: 'GET', url: `/api/konto/${p}/start`, headers: { cookie: cookieHeader({ [COOKIE]: session }) } });
      assert.equal(start.statusCode, 302, start.body);
      const bind = cookieValue(start, BIND_COOKIE);
      assert.ok(bind);
      return { location: String(start.headers.location), bind, ...fake.authorize(String(start.headers.location)) };
    }
    async function callback(a: FastifyInstance, p: 'google' | 'github' | 'apple', params: Record<string, string>, bind: string | null) {
      const cookie = cookieHeader({ [BIND_COOKIE]: bind ?? undefined });
      const res =
        p === 'apple'
          ? await a.inject({
              method: 'POST',
              url: '/api/konto/apple/zurueck',
              headers: { origin: APPLE_ORIGIN, 'content-type': 'application/x-www-form-urlencoded', cookie },
              payload: new URLSearchParams(params).toString(),
            })
          : await a.inject({ method: 'GET', url: `/api/konto/${p}/zurueck?${new URLSearchParams(params)}`, headers: { cookie } });
      assert.equal(res.statusCode, 303, res.body);
      const loc = String(res.headers.location);
      assert.ok(loc.startsWith(`${ORIGIN}/#`), loc);
      return loc.slice(ORIGIN.length + 2);
    }
    const finish = (a: FastifyInstance, vorgang: string, bind: string | null, session?: string, origin = ORIGIN) =>
      a.inject({ method: 'POST', url: '/api/konto/anbieter/abschliessen', payload: { vorgang }, headers: { origin, cookie: cookieHeader({ [BIND_COOKIE]: bind ?? undefined, [COOKIE]: session }) } });

    /** Whole flow; returns the session cookie and the account JSON. */
    async function signInWith(a: FastifyInstance, p: 'google' | 'github' | 'apple', session?: string) {
      const f = await toProvider(a, p, session);
      const fragment = await callback(a, p, { code: f.code, state: f.state }, f.bind);
      assert.match(fragment, /^anbieter=[A-Za-z0-9_-]{20,}$/);
      const res = await finish(a, fragment.slice('anbieter='.length), f.bind, session);
      return res;
    }
    const me = async (a: FastifyInstance, session?: string) => (await a.inject({ method: 'GET', url: '/api/konto', headers: { cookie: cookieHeader({ [COOKIE]: session }) } })).json();

    test('GET /api/konto meldet die aktiven Anbieter; abgeschaltete haben keine Routen', async () => {
      assert.deepEqual((await me(app())).anbieter, ['google', 'apple', 'github']);
      const nurGoogle = app({ config: { google: CONFIG.google } });
      assert.deepEqual((await me(nurGoogle)).anbieter, ['google']);
      for (const path of ['/api/konto/github/start', '/api/konto/apple/start', '/api/konto/github/zurueck']) {
        assert.equal((await nurGoogle.inject({ method: 'GET', url: path })).statusCode, 404, path);
      }
      assert.equal((await nurGoogle.inject({ method: 'POST', url: '/api/konto/apple/zurueck', headers: { origin: APPLE_ORIGIN } })).statusCode, 403);
    });

    test('Google: Start mit PKCE, state und nonce; Rücksprung meldet an, keine Tokens gespeichert', async () => {
      const a = app();
      const f = await toProvider(a, 'google');
      const u = new URL(f.location);
      assert.equal(u.origin + u.pathname, ENDPOINTS.google.authorize);
      assert.equal(u.searchParams.get('scope'), 'openid email profile');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(u.searchParams.get('redirect_uri'), `${ORIGIN}/api/konto/google/zurueck`);
      assert.ok(u.searchParams.get('nonce') && u.searchParams.get('state'));
      const start = await a.inject({ method: 'GET', url: '/api/konto/google/start' });
      const bindLine = cookies(start)[0];
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=None', 'Path=/', 'Max-Age=600']) assert.ok(bindLine.includes(attr), attr);

      const fragment = await callback(a, 'google', { code: f.code, state: f.state }, f.bind);
      const res = await finish(a, fragment.slice('anbieter='.length), f.bind);
      assert.equal(res.statusCode, 200, res.body);
      const session = cookieValue(res, COOKIE)!;
      assert.ok(session);
      assert.equal(cookieValue(res, BIND_COOKIE), '', 'Bindungs-Cookie wird gelöscht');
      assert.ok(cookies(res).find((c) => c.startsWith(`${COOKIE}=`))!.includes('SameSite=Strict'));
      const konto = (await me(a, session)).konto;
      assert.equal(konto.email, 'spieler@gmail.example');
      assert.deepEqual(
        konto.anmeldewege.map((w: { anbieter: string; kennung: string; email: string }) => [w.anbieter, w.kennung, w.email]),
        [['google', 'g-123', 'spieler@gmail.example']],
      );
      // second time: same account
      const again = await signInWith(a, 'google');
      assert.equal((await me(a, cookieValue(again, COOKIE)!)).konto.email, 'spieler@gmail.example');
      assert.equal((await store.overview()).accounts, 1);
    });

    test('State-Prüfung: fremder state, fehlendes oder fremdes Bindungs-Cookie, zweiter Rücksprung', async () => {
      const a = app();
      const f = await toProvider(a, 'google');
      const other = await toProvider(a, 'google');
      assert.equal(await callback(a, 'google', { code: f.code, state: 'erfunden' }, f.bind), 'anbieter-fehler=abgelaufen');
      assert.equal(await callback(a, 'google', { code: f.code, state: f.state }, null), 'anbieter-fehler=abgelaufen');
      // the state was used up by the failed try: a second callback cannot reuse it
      assert.equal(await callback(a, 'google', { code: f.code, state: f.state }, f.bind), 'anbieter-fehler=abgelaufen');
      assert.equal(await callback(a, 'google', { code: other.code, state: other.state }, f.bind), 'anbieter-fehler=abgelaufen');
      // state of one provider does not work at another
      const g = await toProvider(a, 'google');
      assert.equal(await callback(a, 'github', { code: g.code, state: g.state }, g.bind), 'anbieter-fehler=abgelaufen');
      // cancelled at the provider
      const c = await toProvider(a, 'google');
      assert.equal(await callback(a, 'google', { error: 'access_denied', state: c.state }, c.bind), 'anbieter-fehler=abgebrochen');
      assert.equal((await store.overview()).accounts, 0);
    });

    test('Abschluss nur mit demselben Bindungs-Cookie, einmalig und nur von der eigenen Seite', async () => {
      const a = app();
      const f = await toProvider(a, 'google');
      const vorgang = (await callback(a, 'google', { code: f.code, state: f.state }, f.bind)).slice('anbieter='.length);
      assert.equal((await finish(a, vorgang, f.bind, undefined, 'https://evil.example')).statusCode, 403);
      // an attacker who sends the victim their own result has a different binding cookie
      assert.equal((await finish(a, vorgang, 'anderes-geraet')).statusCode, 400);
      assert.equal((await finish(a, vorgang, f.bind)).statusCode, 400, 'nach einem Fehlversuch verbraucht');
      assert.equal((await store.overview()).accounts, 0);
    });

    test('Token-Prüfung im Ablauf: falsches aud, iss, nonce, abgelaufen, fremde Signatur, unbestätigte Adresse', async () => {
      const a = app();
      for (const [claims, code] of [
        [{ aud: 'fremde-app' }, 'pruefung'],
        [{ iss: 'https://evil.example' }, 'pruefung'],
        [{ nonce: 'alt' }, 'pruefung'],
        [{ exp: Math.floor(Date.now() / 1000) - 120 }, 'pruefung'],
        [{ email_verified: false }, 'adresse'],
      ] as const) {
        fake.claims = claims;
        const f = await toProvider(a, 'google');
        assert.equal(await callback(a, 'google', { code: f.code, state: f.state }, f.bind), `anbieter-fehler=${code}`, JSON.stringify(claims));
      }
      fake.claims = {};
      fake.signWith = strangerKey.privateKey;
      const f = await toProvider(a, 'apple');
      assert.equal(await callback(a, 'apple', { code: f.code, state: f.state }, f.bind), 'anbieter-fehler=pruefung');
      fake.signWith = null;
      // a code that the provider refuses (e.g. PKCE verifier does not fit)
      const g = await toProvider(a, 'google');
      assert.equal(await callback(a, 'google', { code: 'falsch', state: g.state }, g.bind), 'anbieter-fehler=pruefung');
      assert.equal((await store.overview()).accounts, 0);
    });

    test('GitHub: numerische ID, nur primäre bestätigte Adresse', async () => {
      const a = app();
      const f = await toProvider(a, 'github');
      const u = new URL(f.location);
      assert.equal(u.searchParams.get('scope'), 'user:email');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      const fragment = await callback(a, 'github', { code: f.code, state: f.state }, f.bind);
      const res = await finish(a, fragment.slice('anbieter='.length), f.bind);
      assert.equal(res.statusCode, 200, res.body);
      const konto = (await me(a, cookieValue(res, COOKIE)!)).konto;
      assert.equal(konto.email, 'dev@example.de');
      assert.equal(konto.anmeldewege[0].kennung, '789');

      fake.github.emails = [
        { email: 'neben@example.de', primary: false, verified: true },
        { email: 'haupt@example.de', primary: true, verified: false },
      ];
      const g = await toProvider(a, 'github');
      assert.equal(await callback(a, 'github', { code: g.code, state: g.state }, g.bind), 'anbieter-fehler=adresse');
    });

    test('Apple: form_post von appleid.apple.com, Client Secret als ES256-JWT, Relay-Adresse, Name wird nicht gespeichert', async () => {
      const a = app();
      const f = await toProvider(a, 'apple');
      const u = new URL(f.location);
      assert.equal(u.searchParams.get('response_mode'), 'form_post');
      assert.equal(u.searchParams.get('client_id'), 'games.murmel.signin');
      const user = JSON.stringify({ name: { firstName: 'Erika', lastName: 'Muster' }, email: 'abc123@privaterelay.appleid.com' });
      const fragment = await callback(a, 'apple', { code: f.code, state: f.state, user }, f.bind);
      const res = await finish(a, fragment.slice('anbieter='.length), f.bind);
      assert.equal(res.statusCode, 200, res.body);
      const konto = (await me(a, cookieValue(res, COOKIE)!)).konto;
      assert.equal(konto.email, 'abc123@privaterelay.appleid.com');
      assert.ok(!JSON.stringify(konto).includes('Erika'));
      const [h, p, s] = fake.appleSecrets[0].split('.');
      assert.equal(JSON.parse(Buffer.from(p, 'base64url').toString()).sub, 'games.murmel.signin');
      assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: appleP8.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
      // cancelled at Apple
      const c = await toProvider(a, 'apple');
      assert.equal(await callback(a, 'apple', { error: 'user_cancelled_authorize', state: c.state }, c.bind), 'anbieter-fehler=abgebrochen');
    });

    test('Verknüpfen über die bestätigte Adresse und Admin-Rolle aus ADMIN_EMAILS', async () => {
      const a = app({ admins: ['spieler@gmail.example'] });
      const mail = await store.signIn({ provider: 'mail', subject: 'spieler@gmail.example', email: 'spieler@gmail.example' }, 'player');
      const res = await signInWith(a, 'google');
      const konto = (await me(a, cookieValue(res, COOKIE)!)).konto;
      assert.equal(konto.rolle, 'admin');
      assert.deepEqual(konto.anmeldewege.map((w: { anbieter: string }) => w.anbieter).sort(), ['google', 'mail']);
      assert.equal((await store.overview()).accounts, 1);
      assert.equal((await store.account(mail.id))!.role, 'admin');
      // Apple relay address is a different address: its own account, no admin
      const apple = await signInWith(a, 'apple');
      assert.equal((await me(a, cookieValue(apple, COOKIE)!)).konto.rolle, 'player');
      assert.equal((await store.overview()).accounts, 2);
    });

    test('Rolle folgt der Kontoadresse, nicht der Adresse beim Anbieter', async () => {
      const a = app({ admins: ['chef@example.de'] });
      const first = await signInWith(a, 'google');
      assert.equal((await me(a, cookieValue(first, COOKIE)!)).konto.rolle, 'player');
      // the Google account now reports the admin address; the Murmel account keeps its own address
      fake.google = { sub: 'g-123', email: 'chef@example.de' };
      const again = await signInWith(a, 'google');
      const konto = (await me(a, cookieValue(again, COOKIE)!)).konto;
      assert.equal(konto.email, 'spieler@gmail.example');
      assert.equal(konto.rolle, 'player');
      assert.equal(konto.anmeldewege[0].email, 'chef@example.de');
    });

    test('Verbinden auf der Kontoseite; ein Weg eines anderen Kontos wird nicht umgehängt', async () => {
      const a = app();
      const gh = await signInWith(a, 'github');
      const session = cookieValue(gh, COOKIE)!;
      const res = await signInWith(a, 'apple', session);
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.json().verbunden, 'apple');
      assert.equal(cookieValue(res, COOKIE), null, 'keine neue Sitzung beim Verbinden');
      const konto = (await me(a, session)).konto;
      assert.equal(konto.email, 'dev@example.de');
      assert.deepEqual(konto.anmeldewege.map((w: { anbieter: string }) => w.anbieter).sort(), ['apple', 'github']);

      // a Google account that already has its own Murmel account
      await store.signIn({ provider: 'google', subject: 'g-123', email: 'spieler@gmail.example' }, 'player');
      const taken = await signInWith(a, 'google', session);
      assert.equal(taken.statusCode, 409);
      assert.match(taken.json().error, /anderen Murmel-Konto/);

      // connecting needs the same account at the end as at the start
      const f = await toProvider(a, 'google', session);
      const fragment = await callback(a, 'google', { code: f.code, state: f.state }, f.bind);
      assert.equal((await finish(a, fragment.slice('anbieter='.length), f.bind)).statusCode, 400);
    });

    test('Trennen: nie den letzten Anmeldeweg, auch nicht über den letzten Passkey', async () => {
      const a = app();
      const res = await signInWith(a, 'google');
      const session = cookieValue(res, COOKIE)!;
      const trennen = (anbieter: string, kennung: string) =>
        a.inject({ method: 'POST', url: '/api/konto/anbieter/trennen', payload: { anbieter, kennung }, headers: { origin: ORIGIN, cookie: `${COOKIE}=${session}` } });
      const last = await trennen('google', 'g-123');
      assert.equal(last.statusCode, 409);
      assert.match(last.json().error, /letzter Anmeldeweg/);
      assert.equal((await trennen('github', '1')).statusCode, 404);
      assert.equal((await trennen('mail', 'spieler@gmail.example')).statusCode, 400, 'Mail wird nicht getrennt');

      const account = (await store.sessionAccount(createHash('sha256').update(session).digest(), new Date()))!;
      await store.addPasskey(account.id, { id: 'pk1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: [], name: 'Test' });
      const ok = await trennen('google', 'g-123');
      assert.equal(ok.statusCode, 200, ok.body);
      assert.deepEqual(ok.json().konto.anmeldewege, []);
      const pk = await a.inject({ method: 'DELETE', url: '/api/konto/passkey/pk1', headers: { origin: ORIGIN, cookie: `${COOKIE}=${session}` } });
      assert.equal(pk.statusCode, 409);
      assert.equal((await store.passkeys(account.id)).length, 1);
    });

    test('Begrenzung: 10 Starts je IP und 15 Minuten', async () => {
      const a = app();
      for (let i = 0; i < 10; i++) assert.equal((await a.inject({ method: 'GET', url: '/api/konto/google/start' })).statusCode, 302);
      const res = await a.inject({ method: 'GET', url: '/api/konto/github/start' });
      assert.equal(res.statusCode, 303);
      assert.equal(res.headers.location, `${ORIGIN}/#anbieter-fehler=zuviele`);
    });
  });
}
