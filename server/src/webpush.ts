import { createCipheriv, createECDH, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, verify } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { RateLimit } from './limit.ts';
import { type Art, periods } from './tageslevel.ts';

/**
 * Erinnerung an das Tageslevel (docs/SPEC-webpush.md): browsers subscribe without an account; at
 * Berlin midnight the API sends one message per subscription. Web Push by hand with node:crypto:
 * RFC 8291 (aes128gcm), RFC 8292 (VAPID), RFC 8030 (the request).
 */

export interface PushSubscription {
  endpoint: string;
  /** Receiver key (uncompressed P-256 point, 65 bytes) and auth secret (16 bytes), base64url. */
  p256dh: string;
  auth: string;
  tag: boolean;
  woche: boolean;
}

export interface PushStore {
  /** Creates the subscription or replaces its keys and choice. */
  save(s: PushSubscription, now: Date): Promise<void>;
  remove(endpoint: string): Promise<void>;
  count(): Promise<number>;
  /** Subscriptions that want at least one of the kinds. */
  list(arts: Art[]): Promise<PushSubscription[]>;
  /** Records that the period was sent; true only for the first caller. */
  claim(art: Art, zeitraum: string, now: Date): Promise<boolean>;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export const MAX_SUBSCRIPTIONS = 100_000;
export const WRITES_PER_HOUR = 20;
/**
 * The window of that limit: 55 minutes, and ended windows are dropped every minute, so an IP address
 * stays in memory at most an hour (privacy policy „Erinnerung an das Tageslevel“).
 */
export const WRITE_WINDOW_MS = 55 * 60_000;
const ENDPOINT_MAX = 1024;

const b64 = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/** VAPID keys from /opt/murmel/.env; null (push off) when one is missing or they do not fit together. */
export function vapidFromEnv(env: Record<string, string | undefined>): { vapid: Vapid | null; warning?: string } {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey && !privateKey && !subject) return { vapid: null, warning: 'VAPID keys not set: reminders (web push) are off' };
  if (!publicKey || !privateKey || !subject) return { vapid: null, warning: 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are all needed: reminders (web push) are off' };
  if (!/^(mailto:|https:\/\/)/.test(subject)) return { vapid: null, warning: 'VAPID_SUBJECT must start with mailto: or https://: reminders (web push) are off' };
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(unb64(privateKey));
    if (!ecdh.getPublicKey().equals(unb64(publicKey))) throw new Error('mismatch');
  } catch {
    return { vapid: null, warning: 'VAPID keys are invalid or do not match: reminders (web push) are off' };
  }
  return { vapid: { publicKey, privateKey, subject } };
}

/** A new key pair in the format of vapidFromEnv. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()) };
}

// ---------- RFC 8291: message encryption ----------

const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

/**
 * The encrypted body (one record, aes128gcm). `sender` and `salt` only for the RFC test; normally fresh.
 */
export function encrypt(plaintext: Buffer, sub: { p256dh: string; auth: string }, fixed?: { senderPrivate: Buffer; salt: Buffer }): Buffer {
  const ua = unb64(sub.p256dh);
  const ecdh = createECDH('prime256v1');
  if (fixed) ecdh.setPrivateKey(fixed.senderPrivate);
  else ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const salt = fixed?.salt ?? randomBytes(16);
  const secret = ecdh.computeSecret(ua);
  const ikm = hkdf(unb64(sub.auth), secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(as.length, 20);
  return Buffer.concat([header, as, body]);
}

// ---------- RFC 8292: VAPID ----------

/** The Authorization header for one push service (audience = origin of the endpoint), valid 12 h. */
export function vapidAuthorization(endpoint: string, vapid: Vapid, now: Date): string {
  const pub = unb64(vapid.publicKey);
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const part = (o: object) => b64(Buffer.from(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: vapid.subject })}`;
  const sig = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64(sig)}, k=${vapid.publicKey}`;
}

/** For tests: checks a VAPID JWT against the public key. */
export function verifyVapid(header: string, publicKey: string): Record<string, unknown> | null {
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (!m || m[4] !== publicKey) return null;
  const pub = unb64(publicKey);
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1, 33)), y: b64(pub.subarray(33, 65)) }, format: 'jwk' });
  return verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, unb64(m[3])) ? JSON.parse(unb64(m[2]).toString()) : null;
}

// ---------- subscriptions ----------

/** Push services of the browsers (Chrome/Edge/Opera via FCM, Firefox, Safari, Edge on Windows). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

/** A subscription from the game, or what is wrong with it. */
export function parseSubscription(body: unknown): PushSubscription | string {
  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; tag?: unknown; woche?: unknown } | null;
  const endpoint = b?.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX) return 'Endpoint fehlt';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'Endpoint ungültig';
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password || !PUSH_HOSTS.some((h) => h.test(url.hostname))) return 'Push-Dienst unbekannt';
  const p256dh = b?.keys?.p256dh;
  const auth = b?.keys?.auth;
  const b64url = /^[\w-]+$/;
  if (typeof p256dh !== 'string' || !b64url.test(p256dh) || unb64(p256dh).length !== 65 || unb64(p256dh)[0] !== 4) return 'Schlüssel ungültig';
  if (typeof auth !== 'string' || !b64url.test(auth) || unb64(auth).length !== 16) return 'Schlüssel ungültig';
  if (typeof b?.tag !== 'boolean' || typeof b?.woche !== 'boolean') return 'Auswahl fehlt';
  if (!b.tag && !b.woche) return 'Nichts ausgewählt';
  return { endpoint, p256dh, auth, tag: b.tag, woche: b.woche };
}

export interface PushOptions {
  store: PushStore;
  vapid: Vapid;
  origin: string;
  now: () => Date;
}

export function pushRoutes(app: FastifyInstance, { store, vapid, origin, now }: PushOptions): void {
  const writes = new RateLimit(WRITES_PER_HOUR, WRITE_WINDOW_MS);
  const pruning = setInterval(() => writes.prune(now().getTime()), 60_000);
  pruning.unref();
  app.addHook('onClose', async () => clearInterval(pruning));

  app.get('/api/push', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { schluessel: vapid.publicKey };
  });

  /** Origin check and the per-IP limit (the address is only counted in memory, never stored). */
  const guard = (req: { headers: { origin?: string }; ip: string }): [number, string] | null => {
    if (req.headers.origin !== undefined && req.headers.origin !== origin) return [403, 'fremde Herkunft'];
    if (!writes.take(req.ip, now().getTime())) return [429, 'Zu viele Änderungen. Bitte versuch es später noch einmal.'];
    return null;
  };

  app.post('/api/push/abo', async (req, reply) => {
    const bad = guard(req);
    if (bad) return reply.code(bad[0]).send({ error: bad[1] });
    const sub = parseSubscription(req.body);
    if (typeof sub === 'string') return reply.code(400).send({ error: sub });
    if ((await store.count()) >= MAX_SUBSCRIPTIONS) return reply.code(503).send({ error: 'Erinnerungen sind gerade voll. Bitte versuch es später noch einmal.' });
    await store.save(sub, now());
    return reply.code(204).send();
  });

  app.delete('/api/push/abo', async (req, reply) => {
    const bad = guard(req);
    if (bad) return reply.code(bad[0]).send({ error: bad[1] });
    const endpoint = (req.body as { endpoint?: unknown } | null)?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX) return reply.code(400).send({ error: 'Endpoint fehlt' });
    await store.remove(endpoint);
    return reply.code(204).send();
  });
}

// ---------- sending ----------

type Fetch = (url: string, init: RequestInit) => Promise<{ status: number }>;

/** One message; the status of the push service (0 = no answer). */
export async function sendPush(sub: PushSubscription, payload: object, opts: { vapid: Vapid; ttl: number; now: Date; fetch?: Fetch }): Promise<number> {
  const body = encrypt(Buffer.from(JSON.stringify(payload)), sub);
  try {
    const res = await (opts.fetch ?? fetch)(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, opts.vapid, opts.now),
        TTL: String(Math.max(0, Math.round(opts.ttl))),
        Urgency: 'normal',
        Topic: 'tageslevel',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

/** The text of the message for a subscription, or null when it wants none of the due kinds. */
export function message(sub: PushSubscription, due: { tag?: string | null; woche?: string | null }): { titel: string; text: string; url: string } | null {
  const tag = sub.tag && due.tag !== undefined;
  const woche = sub.woche && due.woche !== undefined;
  if (!tag && !woche) return null;
  const name = (t: string | null | undefined) => (t ? `: ${t}` : '');
  const text = tag && woche ? 'Neues Tageslevel und neue Wochenaufgabe' + (due.tag ? ` – heute: ${due.tag}` : '') : tag ? `Neues Tageslevel${name(due.tag)}` : `Neue Wochenaufgabe${name(due.woche)}`;
  return { titel: 'Murmel', text, url: './#tageslevel' };
}

export interface SenderOptions {
  store: PushStore;
  vapid: Vapid;
  /** Title of the period's level (chooses the task if needed); null when the catalog is missing. */
  title: (art: Art, zeitraum: string) => Promise<string | null>;
  now: () => Date;
  fetch?: Fetch;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

/** Sends what is due now (each period once); returns the number of messages and removed subscriptions. */
export async function sendDue({ store, vapid, title, now, fetch: f, log }: SenderOptions): Promise<{ gesendet: number; entfernt: number }> {
  const t = now();
  const p = periods(t);
  const due: { tag?: string | null; woche?: string | null } = {};
  for (const art of ['tag', 'woche'] as const) {
    if (await store.claim(art, p[art].zeitraum, t)) due[art] = await title(art, p[art].zeitraum).catch(() => null);
  }
  const arts = (Object.keys(due) as Art[]);
  if (!arts.length) return { gesendet: 0, entfernt: 0 };
  const subs = await store.list(arts);
  let gesendet = 0;
  let entfernt = 0;
  const ttl = (Math.min(...arts.map((a) => p[a].bis.getTime())) - t.getTime()) / 1000;
  for (let i = 0; i < subs.length; i += 10) {
    await Promise.all(
      subs.slice(i, i + 10).map(async (s) => {
        const msg = message(s, due);
        if (!msg) return;
        const status = await sendPush(s, msg, { vapid, ttl: Math.min(ttl, 86_400), now: t, fetch: f });
        if (status >= 200 && status < 300) gesendet++;
        else if (status === 404 || status === 410) {
          await store.remove(s.endpoint);
          entfernt++;
        }
      }),
    );
  }
  log?.info({ arten: arts, abos: subs.length, gesendet, entfernt }, 'web push sent');
  return { gesendet, entfernt };
}

/** Delay until the next check: just after the next Berlin midnight, at most one hour. */
export function nextDelay(now: Date): number {
  return Math.min(periods(now).tag.bis.getTime() - now.getTime() + 2000, 3_600_000);
}

/** Checks now and then after every Berlin midnight; returns a stop function. */
export function startPushTimer(opts: SenderOptions): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const run = async () => {
    try {
      await sendDue(opts);
    } catch (err) {
      opts.log?.warn({ err }, 'web push failed');
    }
    if (!stopped) timer = setTimeout(run, nextDelay(opts.now()));
  };
  timer = setTimeout(run, 5000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
