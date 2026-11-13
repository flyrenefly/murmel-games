// Konten Stufe 2 (docs/SPEC-konten.md): sign in with Google (OpenID Connect + PKCE), GitHub (OAuth +
// PKCE) and Apple (Sign in with Apple, form_post). No provider tokens are stored: only the provider's
// stable id (subject) and the verified address end up in account_identities.
import { createHash, createPrivateKey, createPublicKey, type KeyObject, randomBytes, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Account, AccountStore, Identity, Provider, Role } from './konten.ts';
import { normalizeEmail, readCookie, requireSignedIn } from './konten.ts';
import { RateLimit } from './limit.ts';

export type External = Exclude<Provider, 'mail'>;
export const EXTERNAL: readonly External[] = ['google', 'apple', 'github'];

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}
export interface AppleClient {
  servicesId: string;
  teamId: string;
  keyId: string;
  /** EC P-256 key from the .p8 file (Apple Developer: Keys, "Sign in with Apple"). */
  privateKey: KeyObject;
}
/** Configured providers; a missing one is off (no button, its routes answer 404). */
export interface ProviderConfig {
  google?: OAuthClient;
  github?: OAuthClient;
  apple?: AppleClient;
}

export const APPLE_KEY_FILE = '/run/murmel/apple-signin.p8';

/** Providers from /opt/murmel/.env (compose.yml). Warnings name what is missing, never a value. */
export function providersFromEnv(
  env: Record<string, string | undefined>,
  readKey: (path: string) => string = (p) => readFileSync(p, 'utf8'),
): { config: ProviderConfig; warnings: string[] } {
  const config: ProviderConfig = {};
  const warnings: string[] = [];
  const pair = (name: 'GOOGLE' | 'GITHUB'): OAuthClient | undefined => {
    const clientId = env[`${name}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${name}_CLIENT_SECRET`]?.trim();
    if (clientId && clientSecret) return { clientId, clientSecret };
    if (clientId || clientSecret) warnings.push(`${name}: CLIENT_ID und CLIENT_SECRET werden beide gebraucht – Anmeldung aus`);
    return undefined;
  };
  config.google = pair('GOOGLE');
  config.github = pair('GITHUB');

  const servicesId = env.APPLE_SERVICES_ID?.trim();
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_KEY_ID?.trim();
  if (servicesId && teamId && keyId) {
    const file = env.APPLE_PRIVATE_KEY_FILE?.trim() || APPLE_KEY_FILE;
    try {
      const pem = readKey(file);
      if (!pem.trim()) throw new Error('leer');
      config.apple = { servicesId, teamId, keyId, privateKey: createPrivateKey(pem) };
    } catch {
      warnings.push(`APPLE: Schlüsseldatei ${file} fehlt, ist leer oder nicht lesbar – Anmeldung aus`);
    }
  } else if (servicesId || teamId || keyId) {
    warnings.push('APPLE: SERVICES_ID, TEAM_ID und KEY_ID werden alle gebraucht – Anmeldung aus');
  }
  for (const k of EXTERNAL) if (!config[k]) delete config[k];
  return { config, warnings };
}

export const activeProviders = (config: ProviderConfig): External[] => EXTERNAL.filter((p) => config[p] !== undefined);

// ---------- JWT (ID tokens, Apple client secret) ----------

const MINUTE = 60_000;
const SKEW_S = 60;

/** Something about the provider's answer is wrong; `code` goes to the page as #anbieter-fehler=<code>. */
export class ProviderError extends Error {
  readonly code: 'abgebrochen' | 'pruefung' | 'adresse' | 'anbieter';
  constructor(code: ProviderError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

const b64json = (part: string): Record<string, unknown> => {
  const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('kein Objekt');
  return v as Record<string, unknown>;
};
const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

type Fetch = typeof fetch;

/** A provider's signing keys (JWKS), cached for an hour; an unknown kid reloads at most once a minute. */
export class Jwks {
  private readonly url: string;
  private readonly fetchFn: Fetch;
  private keys = new Map<string, KeyObject>();
  private loadedAt = Number.NEGATIVE_INFINITY;

  constructor(url: string, fetchFn: Fetch) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  async key(kid: string, now: number): Promise<KeyObject | null> {
    const age = now - this.loadedAt;
    if (age > 60 * MINUTE || (!this.keys.has(kid) && age > MINUTE)) await this.load(now);
    return this.keys.get(kid) ?? null;
  }

  private async load(now: number): Promise<void> {
    const res = await this.fetchFn(this.url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new ProviderError('anbieter', `JWKS ${res.status}`);
    const body = (await res.json()) as { keys?: unknown };
    const keys = new Map<string, KeyObject>();
    for (const k of Array.isArray(body.keys) ? body.keys : []) {
      const jwk = k as { kid?: unknown; kty?: unknown; use?: unknown };
      if (typeof jwk.kid !== 'string' || jwk.kty !== 'RSA' || (jwk.use !== undefined && jwk.use !== 'sig')) continue;
      try {
        keys.set(jwk.kid, createPublicKey({ key: k as JsonWebKey, format: 'jwk' }));
      } catch {
        /* skip keys node cannot read */
      }
    }
    this.keys = keys;
    this.loadedAt = now;
  }
}

export interface IdTokenCheck {
  jwks: Jwks;
  issuers: readonly string[];
  audience: string;
  nonce: string;
  now: number;
}

/** Verifies an OpenID Connect ID token: RS256 signature from the JWKS, iss, aud, exp/iat, nonce. */
export async function verifyIdToken(token: unknown, check: IdTokenCheck): Promise<Record<string, unknown>> {
  const bad = (why: string) => new ProviderError('pruefung', `ID-Token: ${why}`);
  if (typeof token !== 'string') throw bad('fehlt');
  const parts = token.split('.');
  if (parts.length !== 3) throw bad('Form');
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = b64json(parts[0]);
    payload = b64json(parts[1]);
  } catch {
    throw bad('Form');
  }
  // only RS256: never "none" or HMAC with a public key as secret
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw bad('Algorithmus');
  const key = await check.jwks.key(header.kid, check.now);
  if (!key) throw bad('unbekannter Schlüssel');
  if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw bad('Signatur');
  if (typeof payload.iss !== 'string' || !check.issuers.includes(payload.iss)) throw bad('iss');
  const aud = payload.aud;
  if (!(aud === check.audience || (Array.isArray(aud) && aud.length === 1 && aud[0] === check.audience))) throw bad('aud');
  const nowS = check.now / 1000;
  if (typeof payload.exp !== 'number' || payload.exp < nowS - SKEW_S) throw bad('abgelaufen');
  if (typeof payload.iat === 'number' && payload.iat > nowS + SKEW_S) throw bad('iat');
  if (!check.nonce || payload.nonce !== check.nonce) throw bad('nonce');
  if (typeof payload.sub !== 'string' || !payload.sub) throw bad('sub');
  return payload;
}

/** Apple's client secret: an ES256 JWT signed with the .p8 key, valid for 5 minutes. */
export function appleClientSecret(apple: AppleClient, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const head = b64({ alg: 'ES256', kid: apple.keyId, typ: 'JWT' });
  const body = b64({ iss: apple.teamId, iat, exp: iat + 300, aud: 'https://appleid.apple.com', sub: apple.servicesId });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: apple.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

// ---------- providers ----------

export const ENDPOINTS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  github: {
    authorize: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    user: 'https://api.github.com/user',
    emails: 'https://api.github.com/user/emails',
  },
  apple: {
    authorize: 'https://appleid.apple.com/auth/authorize',
    token: 'https://appleid.apple.com/auth/token',
    jwks: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
  },
} as const;

interface Flow {
  provider: External;
  verifier: string;
  nonce: string;
  /** SHA-256 (hex) of the binding cookie set at the start. */
  bind: string;
  /** Signed in at the start: connect to this account instead of signing in. */
  accountId: number | null;
  expires: number;
}

interface ProviderImpl {
  authorizeUrl(state: string, nonce: string, challenge: string, redirectUri: string): string;
  /** Exchanges the code and returns the verified identity (throws ProviderError). */
  finish(params: Record<string, unknown>, flow: Flow, redirectUri: string): Promise<Identity>;
}

const url = (base: string, q: Record<string, string>) => `${base}?${new URLSearchParams(q)}`;

function cancelled(params: Record<string, unknown>): void {
  const e = params.error;
  if (e === undefined) return;
  if (e === 'access_denied' || e === 'user_cancelled_authorize') throw new ProviderError('abgebrochen', String(e));
  throw new ProviderError('anbieter', `Fehler vom Anbieter: ${String(e).slice(0, 60)}`);
}

function codeOf(params: Record<string, unknown>): string {
  cancelled(params);
  const code = params.code;
  if (typeof code !== 'string' || !code || code.length > 2048) throw new ProviderError('anbieter', 'kein Code');
  return code;
}

async function postForm(fetchFn: Fetch, target: string, form: Record<string, string>): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new ProviderError('anbieter', `Token-Abruf: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body || typeof body.error === 'string') throw new ProviderError('pruefung', `Token-Abruf ${res.status} ${typeof body?.error === 'string' ? body.error : ''}`);
  return body;
}

function verifiedEmail(payload: Record<string, unknown>): string {
  // Apple sends "true" as a string, Google a boolean
  const ok = payload.email_verified === true || payload.email_verified === 'true';
  const email = normalizeEmail(payload.email);
  if (!ok || !email) throw new ProviderError('adresse', 'keine bestätigte Adresse');
  return email;
}

function google(c: OAuthClient, fetchFn: Fetch, now: () => Date): ProviderImpl {
  const jwks = new Jwks(ENDPOINTS.google.jwks, fetchFn);
  return {
    authorizeUrl: (state, nonce, challenge, redirectUri) =>
      url(ENDPOINTS.google.authorize, {
        client_id: c.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }),
    async finish(params, flow, redirectUri) {
      const body = await postForm(fetchFn, ENDPOINTS.google.token, {
        code: codeOf(params),
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: flow.verifier,
      });
      const p = await verifyIdToken(body.id_token, { jwks, issuers: ENDPOINTS.google.issuers, audience: c.clientId, nonce: flow.nonce, now: now().getTime() });
      return { provider: 'google', subject: p.sub as string, email: verifiedEmail(p) };
    },
  };
}

function github(c: OAuthClient, fetchFn: Fetch): ProviderImpl {
  const api = async (target: string, token: string): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetchFn(target, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'murmel.games', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new ProviderError('anbieter', `GitHub-API: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ProviderError('anbieter', `GitHub-API ${res.status}`);
    return res.json();
  };
  return {
    authorizeUrl: (state, _nonce, challenge, redirectUri) =>
      url(ENDPOINTS.github.authorize, {
        client_id: c.clientId,
        redirect_uri: redirectUri,
        scope: 'user:email',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }),
    async finish(params, flow, redirectUri) {
      const body = await postForm(fetchFn, ENDPOINTS.github.token, {
        client_id: c.clientId,
        client_secret: c.clientSecret,
        code: codeOf(params),
        redirect_uri: redirectUri,
        code_verifier: flow.verifier,
      });
      const token = body.access_token;
      if (typeof token !== 'string' || !token) throw new ProviderError('pruefung', 'kein Zugangstoken');
      // the token is used for these two calls only and never stored
      const user = (await api(ENDPOINTS.github.user, token)) as { id?: unknown };
      if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id)) throw new ProviderError('pruefung', 'keine GitHub-ID');
      const emails = await api(ENDPOINTS.github.emails, token);
      const primary = (Array.isArray(emails) ? emails : []).find((e: { primary?: unknown; verified?: unknown }) => e?.primary === true && e?.verified === true) as
        | { email?: unknown }
        | undefined;
      const email = normalizeEmail(primary?.email);
      if (!email) throw new ProviderError('adresse', 'keine bestätigte Hauptadresse');
      return { provider: 'github', subject: String(user.id), email };
    },
  };
}

function apple(c: AppleClient, fetchFn: Fetch, now: () => Date): ProviderImpl {
  const jwks = new Jwks(ENDPOINTS.apple.jwks, fetchFn);
  return {
    // Apple has no PKCE for the web; state, nonce and the binding cookie protect the flow
    authorizeUrl: (state, nonce, _challenge, redirectUri) =>
      url(ENDPOINTS.apple.authorize, {
        client_id: c.servicesId,
        redirect_uri: redirectUri,
        response_type: 'code',
        response_mode: 'form_post',
        scope: 'name email',
        state,
        nonce,
      }),
    async finish(params, flow, redirectUri) {
      // params.user (name, only the first time) is ignored on purpose: Murmel keeps no names
      const body = await postForm(fetchFn, ENDPOINTS.apple.token, {
        client_id: c.servicesId,
        client_secret: appleClientSecret(c, now()),
        code: codeOf(params),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
      const p = await verifyIdToken(body.id_token, { jwks, issuers: ENDPOINTS.apple.issuers, audience: c.servicesId, nonce: flow.nonce, now: now().getTime() });
      return { provider: 'apple', subject: p.sub as string, email: verifiedEmail(p) };
    },
  };
}

// ---------- routes ----------

/** Binding cookie: ties the provider's answer to the browser that started. None, because Apple POSTs back cross-site. */
export const BIND_COOKIE = '__Host-murmel-anbieter';
const bindCookie = (value: string, maxAge: number) => `${BIND_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None`;
const FLOW_MINUTES = 10;
const RESULT_MINUTES = 2;
const hex = (secret: string) => createHash('sha256').update(secret).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

/** Short-lived one-time entries in memory (one API container; a restart only cancels open sign-ins). */
class Pending<T extends { expires: number }> {
  private readonly map = new Map<string, T>();
  put(key: string, v: T, now: number): void {
    if (this.map.size >= 10_000) {
      for (const [k, e] of this.map) if (e.expires <= now) this.map.delete(k);
      // still full: drop the oldest (insertion order)
      for (const k of this.map.keys()) {
        if (this.map.size < 10_000) break;
        this.map.delete(k);
      }
    }
    this.map.set(key, v);
  }
  take(key: string, now: number): T | null {
    const v = this.map.get(key);
    this.map.delete(key);
    return v && v.expires > now ? v : null;
  }
}

export const NAMES: Record<Provider, string> = { mail: 'Mail', google: 'Google', apple: 'Apple', github: 'GitHub' };

export interface ProviderRouteOptions {
  store: AccountStore;
  config: ProviderConfig;
  origin: string;
  now: () => Date;
  fetch: Fetch;
  /** Role for an address (ADMIN_EMAILS). */
  roleOf(email: string): Role;
  /** Corrects the role to the account's own address, sets the session cookie; returns the status. */
  signedIn(reply: FastifyReply, account: Account): Promise<unknown>;
  /** Account page JSON. */
  accountJson(account: Account): Promise<unknown>;
}

/** Routes of Konten Stufe 2; called from accountRoutes (src/konten.ts). */
export function providerRoutes(app: FastifyInstance, o: ProviderRouteOptions): void {
  const { store, origin, now } = o;
  const startLimit = new RateLimit(10, 15 * MINUTE);
  const flows = new Pending<Flow>();
  const results = new Pending<{ identity: Identity; bind: string; accountId: number | null; expires: number }>();
  const impls: Partial<Record<External, ProviderImpl>> = {};
  if (o.config.google) impls.google = google(o.config.google, o.fetch, now);
  if (o.config.github) impls.github = github(o.config.github, o.fetch);
  if (o.config.apple) impls.apple = apple(o.config.apple, o.fetch, now);
  const redirectUri = (p: External) => `${origin}/api/konto/${p}/zurueck`;
  const back = (reply: FastifyReply, fragment: string) => reply.code(303).header('Cache-Control', 'no-store').redirect(`${origin}/#${fragment}`);

  async function callback(p: External, impl: ProviderImpl, params: Record<string, unknown>, req: FastifyRequest, reply: FastifyReply) {
    const t = now().getTime();
    const flow = typeof params.state === 'string' && params.state.length <= 100 ? flows.take(hex(params.state), t) : null;
    const bind = readCookie(req.headers.cookie, BIND_COOKIE);
    if (!flow || flow.provider !== p || !bind || hex(bind) !== flow.bind) {
      req.log.info({ provider: p }, 'provider sign-in: unknown state or binding');
      return back(reply.header('Set-Cookie', bindCookie('', 0)), 'anbieter-fehler=abgelaufen');
    }
    let identity: Identity;
    try {
      identity = await impl.finish(params, flow, redirectUri(p));
    } catch (err) {
      const code = err instanceof ProviderError ? err.code : 'anbieter';
      req.log.info({ provider: p, code, why: (err as Error).message }, 'provider sign-in failed');
      return back(reply.header('Set-Cookie', bindCookie('', 0)), `anbieter-fehler=${code}`);
    }
    // The account changes only in the same-origin POST below (sets the SameSite=Strict session reliably).
    const done = secret();
    results.put(hex(done), { identity, bind: flow.bind, accountId: flow.accountId, expires: t + RESULT_MINUTES * MINUTE }, t);
    return back(reply, `anbieter=${done}`);
  }

  for (const p of EXTERNAL) {
    const impl = impls[p];
    if (!impl) continue; // off: no routes, so 404

    app.get(`/api/konto/${p}/start`, async (req, reply) => {
      const t = now().getTime();
      if (!startLimit.take(req.ip, t)) return back(reply, 'anbieter-fehler=zuviele');
      const state = secret();
      const nonce = secret();
      const verifier = secret();
      const bind = secret();
      flows.put(hex(state), { provider: p, verifier, nonce, bind: hex(bind), accountId: req.account?.id ?? null, expires: t + FLOW_MINUTES * MINUTE }, t);
      return reply
        .code(302)
        .header('Cache-Control', 'no-store')
        .header('Set-Cookie', bindCookie(bind, FLOW_MINUTES * 60))
        .redirect(impl.authorizeUrl(state, nonce, s256(verifier), redirectUri(p)));
    });

    if (p === 'apple') {
      // Apple answers with a form POST from appleid.apple.com: urlencoded only here, not for the whole API.
      app.register(async (sub) => {
        sub.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16_384 }, (_req, body, done) => {
          done(null, Object.fromEntries(new URLSearchParams(body as string)));
        });
        sub.post('/api/konto/apple/zurueck', async (req, reply) => callback(p, impl, (req.body ?? {}) as Record<string, unknown>, req, reply));
      });
    } else {
      app.get(`/api/konto/${p}/zurueck`, async (req, reply) => callback(p, impl, req.query as Record<string, unknown>, req, reply));
    }
  }

  // Step 3, from the game page: sign in (or connect) with the result of the provider's answer.
  app.post<{ Body: { vorgang: string } }>(
    '/api/konto/anbieter/abschliessen',
    { schema: { body: { type: 'object', required: ['vorgang'], additionalProperties: false, properties: { vorgang: { type: 'string', minLength: 20, maxLength: 100 } } } } },
    async (req, reply) => {
      const r = results.take(hex(req.body.vorgang), now().getTime());
      const bind = readCookie(req.headers.cookie, BIND_COOKIE);
      reply.header('Set-Cookie', bindCookie('', 0));
      if (!r || !bind || hex(bind) !== r.bind) return reply.code(400).send({ error: 'Die Anmeldung ist abgelaufen. Bitte versuch es noch einmal.' });
      const name = NAMES[r.identity.provider];
      if (r.accountId !== null) {
        // connect: only for the account that was signed in at the start
        if (req.account?.id !== r.accountId) return reply.code(400).send({ error: `Bitte melde dich wieder an und verbinde ${name} dann noch einmal.` });
        if ((await store.linkIdentity(r.accountId, r.identity)) === 'vergeben') {
          return reply.code(409).send({ error: `Dieses ${name}-Konto gehört schon zu einem anderen Murmel-Konto. Trenne es dort, dann kannst du es hier verbinden.` });
        }
        return { angemeldet: true, verbunden: r.identity.provider, konto: await o.accountJson(req.account) };
      }
      return o.signedIn(reply, await store.signIn(r.identity, o.roleOf(r.identity.email)));
    },
  );

  // Disconnect a provider – never the last way in (providers, mail, passkeys).
  app.post<{ Body: { anbieter: External; kennung: string } }>(
    '/api/konto/anbieter/trennen',
    {
      preHandler: requireSignedIn,
      schema: {
        body: {
          type: 'object',
          required: ['anbieter', 'kennung'],
          additionalProperties: false,
          properties: { anbieter: { type: 'string', enum: [...EXTERNAL] }, kennung: { type: 'string', minLength: 1, maxLength: 255 } },
        },
      },
    },
    async (req, reply) => {
      const account = req.account!;
      const ids = await store.identities(account.id);
      if (!ids.some((i) => i.provider === req.body.anbieter && i.subject === req.body.kennung)) return reply.code(404).send({ error: 'Dieser Anmeldeweg ist nicht verbunden.' });
      if (ids.length + (await store.passkeys(account.id)).length <= 1) return reply.code(409).send({ error: LAST_WAY });
      await store.unlinkIdentity(account.id, req.body.anbieter, req.body.kennung);
      return { angemeldet: true, konto: await o.accountJson(account) };
    },
  );
}

export const LAST_WAY = 'Das ist dein letzter Anmeldeweg. Richte zuerst einen anderen ein (zum Beispiel einen Passkey), dann kannst du diesen entfernen.';
