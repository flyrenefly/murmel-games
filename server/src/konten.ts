import { createHash, randomBytes } from 'node:crypto';
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RateLimit } from './limit.ts';

// ---------- data model ----------

export type Role = 'player' | 'admin';
/** Sign-in methods. Only 'mail' (and passkeys, which belong to an account) exist yet; the others follow via OpenID Connect/OAuth. */
export type Provider = 'mail' | 'google' | 'apple' | 'github';

export interface Account {
  id: number;
  email: string;
  role: Role;
  createdAt: Date;
  /** Blocked by an admin: may sign in, sign out and delete the account, but write nothing (requireAccount). */
  blocked: boolean;
}

export interface Passkey {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** A verified identity from a sign-in method: who the provider says this is. */
export interface Identity {
  provider: Provider;
  /** Stable id at the provider (mail: the address). */
  subject: string;
  /** Verified address (all providers give one; Apple may give a relay address). */
  email: string;
}

/** Storage for accounts (PostgreSQL: src/konten-db.ts). Secret values arrive only as SHA-256 hashes. */
export interface AccountStore {
  addLoginToken(email: string, hash: Buffer, now: Date, expires: Date): Promise<void>;
  /** Links requested for this address since a time (limit per address). */
  countLoginTokens(email: string, since: Date): Promise<number>;
  /** Marks the link used and returns its address, or null if unknown, used or expired. */
  redeemLoginToken(hash: Buffer, now: Date): Promise<string | null>;
  /** Finds the account by identity, else by address (linking the identity), else creates it; sets the role. */
  signIn(identity: Identity, role: Role): Promise<Account>;
  /** The account by id, or null (admins, e.g. blocking in the forum). */
  account(accountId: number): Promise<Account | null>;
  setRole(accountId: number, role: Role): Promise<void>;
  /** Blocks or unblocks an account (admins, e.g. in the forum). */
  setBlocked(accountId: number, blocked: boolean, now: Date): Promise<void>;
  addSession(accountId: number, hash: Buffer, expires: Date): Promise<void>;
  sessionAccount(hash: Buffer, now: Date): Promise<Account | null>;
  deleteSession(hash: Buffer): Promise<void>;
  deleteSessions(accountId: number): Promise<void>;
  deleteAccount(accountId: number): Promise<void>;
  passkeys(accountId: number): Promise<Passkey[]>;
  addPasskey(accountId: number, p: Omit<Passkey, 'createdAt' | 'lastUsedAt'>): Promise<void>;
  passkey(id: string): Promise<{ passkey: Passkey; account: Account } | null>;
  usePasskey(id: string, counter: number, now: Date): Promise<void>;
  deletePasskey(accountId: number, id: string): Promise<boolean>;
  addChallenge(hash: Buffer, purpose: 'register' | 'login', challenge: string, accountId: number | null, expires: Date): Promise<void>;
  /** Removes and returns a challenge that is still valid. */
  takeChallenge(hash: Buffer, purpose: 'register' | 'login', now: Date): Promise<{ challenge: string; accountId: number | null } | null>;
  /** Deletes expired links, sessions and challenges. */
  cleanup(now: Date): Promise<void>;
  overview(): Promise<{ accounts: number; admins: number; passkeys: number }>;
}

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface AccountOptions {
  store: AccountStore;
  /** null: SMTP not configured (the login says so). */
  mailer: Mailer | null;
  /** Public address of the game, e.g. https://murmel.games (WebAuthn origin, links, CSRF check). */
  origin: string;
  /** Addresses that get the admin role (ADMIN_EMAILS in /opt/murmel/.env). */
  adminEmails: string[];
  now?: () => Date;
}

// ---------- constants and helpers ----------

export const COOKIE = '__Host-murmel';
const LINK_MINUTES = 15;
const SESSION_DAYS = 90;
const CHALLENGE_MINUTES = 5;
/** Links per address and hour. */
const LINKS_PER_ADDRESS = 3;
const MINUTE = 60_000;
/** ES256, EdDSA, RS256: what passkeys use (no experimental post-quantum algorithms yet). */
const ALGORITHMS = [-7, -8, -257];

export const hash = (secret: string): Buffer => createHash('sha256').update(secret).digest();
const secret = (): string => randomBytes(32).toString('base64url');

const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** ADMIN_EMAILS: comma separated, case and spaces ignored. */
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((e) => normalizeEmail(e)).filter((e): e is string => e !== null);
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

function sessionCookie(value: string, maxAge: number): string {
  // __Host-: only over HTTPS, only for this host, path /. Strict: the API is only called by the game itself.
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function accountJson(a: Account, passkeys: Passkey[]) {
  return {
    email: a.email,
    rolle: a.role,
    gesperrt: a.blocked,
    erstellt: a.createdAt.toISOString(),
    passkeys: passkeys.map((p) => ({ id: p.id, name: p.name, erstellt: p.createdAt.toISOString(), zuletzt: p.lastUsedAt?.toISOString() ?? null })),
  };
}

/** Readable passkey name from the browser's user agent, e.g. "Chrome auf Windows". */
export function passkeyName(userAgent: string | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} auf ${os}` : browser;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Signed-in account (or null), for every /api route except /api/health. */
    account: Account | null;
  }
}

/** Any signed-in account, blocked ones too: managing one's own account (sign out, delete). */
export async function requireSignedIn(req: FastifyRequest, reply: FastifyReply) {
  if (!req.account) return reply.code(401).send({ error: 'nicht angemeldet' });
}

/** Signed in and not blocked: for routes that write (forum posts, levels, times). Use as preHandler. */
export async function requireAccount(req: FastifyRequest, reply: FastifyReply) {
  if (!req.account) return reply.code(401).send({ error: 'nicht angemeldet' });
  if (req.account.blocked) return reply.code(403).send({ error: 'Dieses Konto ist gesperrt.' });
}

/** Signed-in admin (role from ADMIN_EMAILS). Use as preHandler. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!req.account) return reply.code(401).send({ error: 'nicht angemeldet' });
  if (req.account.role !== 'admin') return reply.code(403).send({ error: 'nur für Admins' });
}

// ---------- routes ----------

/** Accounts: /api/konto (sign-in, account page) and /api/admin (admins only). */
export function accountRoutes(app: FastifyInstance, opts: AccountOptions): void {
  const { store, mailer, origin, now = () => new Date() } = opts;
  const admins = new Set(opts.adminEmails);
  const rpID = new URL(origin).hostname;
  const roleOf = (email: string): Role => (admins.has(email.toLowerCase()) ? 'admin' : 'player');
  // Per IP: mail links are expensive (sending), the other steps cheap.
  const mailLimit = new RateLimit(5, 15 * MINUTE);
  const stepLimit = new RateLimit(60, 15 * MINUTE);

  app.decorateRequest('account', null);

  const scoped = (url: string) => url.startsWith('/api/konto') || url.startsWith('/api/admin');

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/health')) return;
    const token = readCookie(req.headers.cookie, COOKIE);
    req.account = token ? await store.sessionAccount(hash(token), now()) : null;
    if (!scoped(req.url)) return;
    // CSRF: state-changing calls only from the game's own page (SameSite=Strict as a second fence).
    if (req.method !== 'GET' && req.headers.origin !== undefined && req.headers.origin !== origin) {
      return reply.code(403).send({ error: 'fremde Herkunft' });
    }
    if (req.method !== 'GET' && !stepLimit.take(req.ip, now().getTime())) {
      return reply.code(429).send({ error: 'Zu viele Anfragen. Bitte warte ein paar Minuten.' });
    }
  });

  async function startSession(reply: FastifyReply, account: Account) {
    const token = secret();
    await store.addSession(account.id, hash(token), new Date(now().getTime() + SESSION_DAYS * 86_400_000));
    reply.header('Set-Cookie', sessionCookie(token, SESSION_DAYS * 86_400));
    return { angemeldet: true, konto: accountJson(account, await store.passkeys(account.id)) };
  }

  // Who am I? Always 200, so the game can ask without errors in the console.
  app.get('/api/konto', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const mail = mailer !== null;
    if (!req.account) return { angemeldet: false, mail };
    return { angemeldet: true, mail, konto: accountJson(req.account, await store.passkeys(req.account.id)) };
  });

  // Step 1 of the mail link: send a one-time link (also the way back in, "Passwort vergessen").
  app.post<{ Body: { email: string } }>(
    '/api/konto/mail',
    { schema: { body: { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', maxLength: 254 } } } } },
    async (req, reply) => {
      if (!mailer) return reply.code(503).send({ error: 'Der Mailversand ist noch nicht eingerichtet. Anmelden per Mail geht deshalb gerade nicht.' });
      const email = normalizeEmail(req.body.email);
      if (!email) return reply.code(400).send({ error: 'Bitte gib eine gültige Mailadresse ein.' });
      const t = now();
      if (!mailLimit.take(req.ip, t.getTime())) return reply.code(429).send({ error: 'Zu viele Anmeldelinks von hier. Bitte warte ein paar Minuten.' });
      if ((await store.countLoginTokens(email, new Date(t.getTime() - 60 * MINUTE))) >= LINKS_PER_ADDRESS) {
        return reply.code(429).send({ error: 'Für diese Adresse wurden gerade schon mehrere Links verschickt. Bitte schau in dein Postfach oder versuch es in einer Stunde wieder.' });
      }
      await store.cleanup(t);
      const token = secret();
      await store.addLoginToken(email, hash(token), t, new Date(t.getTime() + LINK_MINUTES * MINUTE));
      const link = `${origin}/#anmelden=${token}`;
      try {
        await mailer.send(
          email,
          'Dein Anmeldelink für Murmel',
          `Hallo,\n\nmit diesem Link meldest du dich bei Murmel an:\n\n${link}\n\n` +
            `Der Link gilt ${LINK_MINUTES} Minuten und nur einmal. Murmel speichert keine Passwörter – ` +
            `wenn du wieder hinein willst, forderst du einfach einen neuen Link an.\n\n` +
            `Du hast keinen Link angefordert? Dann ignoriere diese Mail; ohne Klick passiert nichts.\n\nMurmel – ${origin}\n`,
        );
      } catch (err) {
        req.log.error({ err }, 'login mail failed');
        return reply.code(502).send({ error: 'Die Mail konnte gerade nicht verschickt werden. Bitte versuch es später noch einmal.' });
      }
      return reply.code(202).send({ ok: true });
    },
  );

  // Step 2: the page opened from the mail redeems the token (POST, so mail scanners that fetch links do not use it up).
  app.post<{ Body: { token: string } }>(
    '/api/konto/mail/einloesen',
    { schema: { body: { type: 'object', required: ['token'], additionalProperties: false, properties: { token: { type: 'string', minLength: 20, maxLength: 100 } } } } },
    async (req, reply) => {
      const email = await store.redeemLoginToken(hash(req.body.token), now());
      if (!email) return reply.code(400).send({ error: 'Dieser Anmeldelink ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.' });
      const account = await store.signIn({ provider: 'mail', subject: email, email }, roleOf(email));
      return startSession(reply, account);
    },
  );

  // Passkey on this device: options for navigator.credentials.create (signed in only).
  app.post('/api/konto/passkey/registrieren', { preHandler: requireSignedIn }, async (req) => {
    const account = req.account!;
    const existing = await store.passkeys(account.id);
    const options = await generateRegistrationOptions({
      rpName: 'Murmel',
      rpID,
      userName: account.email,
      userDisplayName: account.email,
      attestationType: 'none',
      supportedAlgorithmIDs: ALGORITHMS,
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
      // discoverable: later sign-in without typing the address
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const id = secret();
    await store.addChallenge(hash(id), 'register', options.challenge, account.id, new Date(now().getTime() + CHALLENGE_MINUTES * MINUTE));
    return { vorgang: id, optionen: options };
  });

  app.post<{ Body: { vorgang: string; antwort: RegistrationResponseJSON } }>(
    '/api/konto/passkey/registrieren/abschliessen',
    {
      preHandler: requireSignedIn,
      schema: { body: { type: 'object', required: ['vorgang', 'antwort'], properties: { vorgang: { type: 'string', maxLength: 100 }, antwort: { type: 'object' } } } },
    },
    async (req, reply) => {
      const account = req.account!;
      const c = await store.takeChallenge(hash(req.body.vorgang), 'register', now());
      if (!c || c.accountId !== account.id) return reply.code(400).send({ error: 'Der Vorgang ist abgelaufen. Bitte noch einmal versuchen.' });
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: req.body.antwort,
          expectedChallenge: c.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: false,
          supportedAlgorithmIDs: ALGORITHMS,
        });
      } catch (err) {
        req.log.info({ err }, 'passkey registration rejected');
        return reply.code(400).send({ error: 'Der Passkey konnte nicht geprüft werden.' });
      }
      if (!result.verified) return reply.code(400).send({ error: 'Der Passkey konnte nicht geprüft werden.' });
      const cred = result.registrationInfo.credential;
      await store.addPasskey(account.id, {
        id: cred.id,
        publicKey: cred.publicKey,
        counter: cred.counter,
        transports: cred.transports ?? [],
        name: passkeyName(req.headers['user-agent']),
      });
      return { angemeldet: true, konto: accountJson(account, await store.passkeys(account.id)) };
    },
  );

  // Sign in with a passkey: no address needed (discoverable credential).
  app.post('/api/konto/passkey/anmelden', async () => {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
    const id = secret();
    await store.addChallenge(hash(id), 'login', options.challenge, null, new Date(now().getTime() + CHALLENGE_MINUTES * MINUTE));
    return { vorgang: id, optionen: options };
  });

  app.post<{ Body: { vorgang: string; antwort: AuthenticationResponseJSON } }>(
    '/api/konto/passkey/anmelden/abschliessen',
    { schema: { body: { type: 'object', required: ['vorgang', 'antwort'], properties: { vorgang: { type: 'string', maxLength: 100 }, antwort: { type: 'object' } } } } },
    async (req, reply) => {
      const fail = () => reply.code(400).send({ error: 'Anmelden mit Passkey hat nicht geklappt. Hast du auf diesem Gerät einen Passkey für Murmel?' });
      const c = await store.takeChallenge(hash(req.body.vorgang), 'login', now());
      const credId = typeof req.body.antwort?.id === 'string' ? req.body.antwort.id : '';
      const found = c && credId ? await store.passkey(credId) : null;
      if (!c || !found) return fail();
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response: req.body.antwort,
          expectedChallenge: c.challenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          credential: { id: found.passkey.id, publicKey: found.passkey.publicKey, counter: found.passkey.counter, transports: found.passkey.transports },
          requireUserVerification: false,
        });
      } catch (err) {
        req.log.info({ err }, 'passkey sign-in rejected');
        return fail();
      }
      if (!result.verified) return fail();
      await store.usePasskey(found.passkey.id, result.authenticationInfo.newCounter, now());
      // Role follows ADMIN_EMAILS at every sign-in.
      const role = roleOf(found.account.email);
      if (role !== found.account.role) await store.setRole(found.account.id, role);
      return startSession(reply, { ...found.account, role });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/konto/passkey/:id', { preHandler: requireSignedIn }, async (req, reply) => {
    if (!(await store.deletePasskey(req.account!.id, req.params.id))) return reply.code(404).send({ error: 'Passkey nicht gefunden' });
    return { angemeldet: true, konto: accountJson(req.account!, await store.passkeys(req.account!.id)) };
  });

  // Sign out here, or everywhere ({ alle: true }).
  app.post<{ Body: { alle?: boolean } | undefined }>('/api/konto/abmelden', async (req, reply) => {
    const token = readCookie(req.headers.cookie, COOKIE);
    if (req.account && req.body?.alle) await store.deleteSessions(req.account.id);
    else if (token) await store.deleteSession(hash(token));
    reply.header('Set-Cookie', sessionCookie('', 0));
    return { angemeldet: false };
  });

  // Delete the account with everything that belongs to it (sessions, passkeys, sign-in methods).
  app.delete('/api/konto', { preHandler: requireSignedIn }, async (req, reply) => {
    await store.deleteAccount(req.account!.id);
    reply.header('Set-Cookie', sessionCookie('', 0));
    return { angemeldet: false };
  });

  app.get('/api/admin/uebersicht', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return store.overview();
  });
}
