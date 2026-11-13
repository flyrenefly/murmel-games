import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { connect } from './db.ts';
import { RateLimit } from './limit.ts';
import { migrate } from './migrate.ts';
import { encrypt, generateVapidKeys, WRITE_WINDOW_MS, WRITES_PER_HOUR, message, nextDelay, parseSubscription, type PushSubscription, sendDue, vapidAuthorization, vapidFromEnv, verifyVapid } from './webpush.ts';
import { pushStore } from './webpush-db.ts';
import { memoryPushStore } from './webpush-memory.ts';

const b64 = (b: Buffer) => b.toString('base64url');

/** A browser's side of a subscription: its key pair and auth secret. */
function browser(endpoint = `https://fcm.googleapis.com/fcm/send/${b64(randomBytes(8))}`) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, endpoint, keys: { p256dh: b64(ecdh.getPublicKey()), auth: b64(auth) } };
}

/** Decrypts an aes128gcm body as the browser would (RFC 8291), to check what was sent. */
function decrypt(body: Buffer, b: ReturnType<typeof browser>): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const as = body.subarray(21, 21 + idlen);
  const ua = b.ecdh.getPublicKey();
  const secret = b.ecdh.computeSecret(as);
  const h = (s: Buffer, k: Buffer, info: string | Buffer, n: number) => Buffer.from(hkdfSync('sha256', k, s, info, n));
  const ikm = h(Buffer.from(b.keys.auth, 'base64url'), secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const d = createDecipheriv('aes-128-gcm', h(salt, ikm, 'Content-Encoding: aes128gcm\0', 16), h(salt, ikm, 'Content-Encoding: nonce\0', 12));
  const data = body.subarray(21 + idlen);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last record delimiter');
  return plain.subarray(0, -1).toString();
}

const keys = generateVapidKeys();
const VAPID = { ...keys, subject: 'mailto:test@example.de' };

// ---------- pure parts ----------

test('Verschlüsselung: Beispiel aus RFC 8291 (Abschnitt 5) bytegenau', () => {
  const expected =
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
  const out = encrypt(
    Buffer.from('When I grow up, I want to be a watermelon'),
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { senderPrivate: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'), salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url') },
  );
  assert.equal(b64(out), expected);
});

test('Verschlüsselung: frisch je Nachricht, der Browser kann sie lesen', () => {
  const b = browser();
  const one = encrypt(Buffer.from('hallo'), b.keys);
  assert.notDeepEqual(one, encrypt(Buffer.from('hallo'), b.keys));
  assert.equal(decrypt(one, b), 'hallo');
});

test('VAPID: ES256-Token für den Push-Dienst, 12 Stunden gültig', () => {
  const now = new Date('2026-11-13T23:00:02Z');
  const h = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', VAPID, now);
  assert.deepEqual(verifyVapid(h, VAPID.publicKey), { aud: 'https://fcm.googleapis.com', exp: now.getTime() / 1000 + 12 * 3600, sub: VAPID.subject });
  assert.equal(verifyVapid(h, generateVapidKeys().publicKey), null);
});

test('Schlüssel aus .env: alle drei nötig und passend, sonst aus mit Warnung (ohne Werte)', () => {
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:a@b.de' };
  assert.deepEqual(vapidFromEnv(env).vapid, { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:a@b.de' });
  assert.match(vapidFromEnv({}).warning!, /off/);
  assert.equal(vapidFromEnv({ ...env, VAPID_SUBJECT: '' }).vapid, null);
  assert.equal(vapidFromEnv({ ...env, VAPID_SUBJECT: 'admin' }).vapid, null);
  const other = vapidFromEnv({ ...env, VAPID_PUBLIC_KEY: generateVapidKeys().publicKey });
  assert.equal(other.vapid, null);
  assert.ok(!other.warning!.includes(keys.privateKey) && !other.warning!.includes(keys.publicKey));
  assert.equal(vapidFromEnv({ ...env, VAPID_PRIVATE_KEY: 'kaputt' }).vapid, null);
});

test('Abo prüfen: nur bekannte Push-Dienste über https, Schlüssel in fester Länge, eine Auswahl', () => {
  const b = browser();
  const ok = { endpoint: b.endpoint, keys: b.keys, tag: true, woche: false };
  assert.deepEqual(parseSubscription(ok), { endpoint: b.endpoint, ...b.keys, tag: true, woche: false });
  for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/Q', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
    assert.equal(typeof parseSubscription({ ...ok, endpoint }), 'object', endpoint);
  }
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://169.254.169.254/x', 'https://fcm.googleapis.com.evil.de/x', 'https://evilpush.apple.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'kein url', `https://fcm.googleapis.com/${'x'.repeat(1100)}`]) {
    assert.equal(typeof parseSubscription({ ...ok, endpoint }), 'string', endpoint);
  }
  assert.equal(parseSubscription({ ...ok, keys: { ...b.keys, auth: b64(randomBytes(8)) } }), 'Schlüssel ungültig');
  assert.equal(parseSubscription({ ...ok, keys: { ...b.keys, p256dh: b64(randomBytes(65)) } }), 'Schlüssel ungültig');
  assert.equal(parseSubscription({ ...ok, tag: false }), 'Nichts ausgewählt');
  assert.equal(parseSubscription({ ...ok, woche: 'ja' }), 'Auswahl fehlt');
  assert.equal(parseSubscription(null), 'Endpoint fehlt');
});

test('Text: Tag, Woche, beides montags in einer Mitteilung; ohne Wunsch keine', () => {
  const s = (tag: boolean, woche: boolean) => ({ endpoint: 'e', p256dh: '', auth: '', tag, woche });
  assert.deepEqual(message(s(true, false), { tag: 'Brücken' }), { titel: 'Murmel', text: 'Neues Tageslevel: Brücken', url: './#tageslevel' });
  assert.equal(message(s(true, false), { tag: null })!.text, 'Neues Tageslevel');
  assert.equal(message(s(false, true), { tag: 'Brücken' }), null);
  assert.equal(message(s(false, true), { tag: 'Brücken', woche: 'Labyrinth' })!.text, 'Neue Wochenaufgabe: Labyrinth');
  assert.equal(message(s(true, true), { tag: 'Brücken', woche: 'Labyrinth' })!.text, 'Neues Tageslevel und neue Wochenaufgabe – heute: Brücken');
  assert.equal(message(s(true, true), { tag: 'Brücken' })!.text, 'Neues Tageslevel: Brücken');
});

test('Wecker: kurz nach der nächsten Berliner Mitternacht, höchstens eine Stunde voraus', () => {
  assert.equal(nextDelay(new Date('2026-11-13T22:59:00Z')), 62_000);
  assert.equal(nextDelay(new Date('2026-11-13T12:00:00Z')), 3_600_000);
});

// ---------- sending ----------

describe('Versand', () => {
  test('einmal je Zeitraum, an die richtigen Abos; 404/410 löschen das Abo, andere Fehler nicht', async () => {
    const store = memoryPushStore();
    const nurTag = browser();
    const beides = browser();
    const nurWoche = browser();
    const weg = browser();
    const kaputt = browser();
    const save = (b: ReturnType<typeof browser>, tag: boolean, woche: boolean) => store.save({ endpoint: b.endpoint, ...b.keys, tag, woche }, new Date());
    await save(nurTag, true, false);
    await save(beides, true, true);
    await save(nurWoche, false, true);
    await save(weg, true, false);
    await save(kaputt, true, false);
    const sent: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return { status: url === weg.endpoint ? 410 : url === kaputt.endpoint ? 500 : 201 };
    };
    const title = async (art: string, zeitraum: string) => `${art} ${zeitraum}`;
    // Dienstag, 17.11.2026, kurz nach Mitternacht in Berlin; die Woche 47 wurde schon montags geschickt
    await store.claim('woche', '2026-W47', new Date());
    const now = () => new Date('2026-11-16T23:00:02Z');
    assert.deepEqual(await sendDue({ store, vapid: VAPID, title, now, fetch }), { gesendet: 2, entfernt: 1 });
    assert.deepEqual(sent.map((s) => s.url).sort(), [nurTag, beides, weg, kaputt].map((b) => b.endpoint).sort());
    const h = sent[0].init.headers as Record<string, string>;
    assert.equal(h['Content-Encoding'], 'aes128gcm');
    assert.equal(h.TTL, String(86_400 - 2));
    assert.equal(h.Topic, 'tageslevel');
    assert.ok(verifyVapid(h.Authorization, VAPID.publicKey));
    const toBeides = sent.find((s) => s.url === beides.endpoint)!;
    assert.deepEqual(JSON.parse(decrypt(Buffer.from(toBeides.init.body as Uint8Array), beides)), { titel: 'Murmel', text: 'Neues Tageslevel: tag 2026-11-17', url: './#tageslevel' });
    assert.equal(store.all().length, 4); // the 410 one is gone, the 500 one stays
    // again (restart of the API): nothing new
    sent.length = 0;
    assert.deepEqual(await sendDue({ store, vapid: VAPID, title, now, fetch }), { gesendet: 0, entfernt: 0 });
    assert.equal(sent.length, 0);
  });

  test('montags: wer beides will, bekommt eine Mitteilung; ohne Levelkatalog ohne Titel', async () => {
    const store = memoryPushStore();
    const b = browser();
    const w = browser();
    await store.save({ endpoint: b.endpoint, ...b.keys, tag: true, woche: true }, new Date());
    await store.save({ endpoint: w.endpoint, ...w.keys, tag: false, woche: true }, new Date());
    const bodies = new Map<string, Buffer>();
    const fetch = async (url: string, init: RequestInit) => (bodies.set(url, Buffer.from(init.body as Uint8Array)), { status: 201 });
    const now = () => new Date('2026-11-15T23:00:02Z'); // Montag, 16.11.
    assert.deepEqual(await sendDue({ store, vapid: VAPID, title: async () => null, now, fetch }), { gesendet: 2, entfernt: 0 });
    assert.equal(JSON.parse(decrypt(bodies.get(b.endpoint)!, b)).text, 'Neues Tageslevel und neue Wochenaufgabe');
    assert.equal(JSON.parse(decrypt(bodies.get(w.endpoint)!, w)).text, 'Neue Wochenaufgabe');
  });

  test('ein Push-Dienst ohne Antwort hält den Versand nicht auf', async () => {
    const store = memoryPushStore();
    const b = browser();
    await store.save({ endpoint: b.endpoint, ...b.keys, tag: true, woche: false }, new Date());
    const fetch = async () => Promise.reject(new Error('timeout'));
    assert.deepEqual(await sendDue({ store, vapid: VAPID, title: async () => null, now: () => new Date('2026-11-13T23:00:02Z'), fetch }), { gesendet: 0, entfernt: 0 });
    assert.equal(store.all().length, 1);
  });
});

// ---------- routes ----------

const db = { ping: async () => {}, recordEvent: async () => {}, statistics: async () => ({}) as never };

describe('Push-API', () => {
  test('ohne Schlüssel gibt es die Routen nicht', async () => {
    const app = buildApp({ version: 't', db });
    assert.equal((await app.inject({ method: 'GET', url: '/api/push' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/api/push/abo', payload: {} })).statusCode, 404);
  });

  test('Schlüssel holen, anmelden, Auswahl ändern, abmelden löscht sofort', async () => {
    const store = memoryPushStore();
    const app = buildApp({ version: 't', db, accounts: undefined, push: { store, vapid: VAPID } });
    const get = await app.inject({ method: 'GET', url: '/api/push' });
    assert.deepEqual(get.json(), { schluessel: VAPID.publicKey });
    assert.equal(JSON.stringify(get.json()).includes(VAPID.privateKey), false);
    const b = browser();
    const post = (payload: object, origin = 'https://murmel.games') => app.inject({ method: 'POST', url: '/api/push/abo', headers: { origin }, payload });
    assert.equal((await post({ endpoint: b.endpoint, keys: b.keys, tag: true, woche: false })).statusCode, 204);
    assert.equal((await post({ endpoint: b.endpoint, keys: b.keys, tag: true, woche: true })).statusCode, 204);
    assert.deepEqual(store.all(), [{ endpoint: b.endpoint, ...b.keys, tag: true, woche: true }]);
    assert.equal((await post({ endpoint: b.endpoint, keys: b.keys, tag: true, woche: true }, 'https://evil.example')).statusCode, 403);
    const bad = await post({ endpoint: 'https://127.0.0.1/x', keys: b.keys, tag: true, woche: false });
    assert.deepEqual([bad.statusCode, bad.json().error], [400, 'Push-Dienst unbekannt']);
    const del = await app.inject({ method: 'DELETE', url: '/api/push/abo', headers: { origin: 'https://murmel.games' }, payload: { endpoint: b.endpoint } });
    assert.equal(del.statusCode, 204);
    assert.deepEqual(store.all(), []);
    // unknown endpoint: still 204 (nothing to tell)
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/push/abo', payload: { endpoint: 'x' } })).statusCode, 204);
  });

  test('Grenze: IP-Adressen bleiben höchstens eine Stunde im Speicher', () => {
    const l = new RateLimit(WRITES_PER_HOUR, WRITE_WINDOW_MS);
    l.take('203.0.113.7', 0);
    l.prune(WRITE_WINDOW_MS - 1);
    assert.equal(l.size, 1);
    // pruned every minute: gone at the latest one minute after the window ended
    l.prune(WRITE_WINDOW_MS);
    assert.equal(l.size, 0);
    assert.ok(WRITE_WINDOW_MS + 60_000 <= 3_600_000);
  });

  test('höchstens 20 Änderungen je Adresse und Stunde', async () => {
    const app = buildApp({ version: 't', db, push: { store: memoryPushStore(), vapid: VAPID } });
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await app.inject({ method: 'DELETE', url: '/api/push/abo', payload: { endpoint: 'x' } })).statusCode);
    assert.deepEqual(codes.slice(19), [204, 429]);
  });
});

// ---------- PostgreSQL (only with TEST_DATABASE_URL, e.g. in the CI) ----------

const url = process.env.TEST_DATABASE_URL;
const sql = url ? connect(url) : null;
after(async () => {
  await sql?.end({ timeout: 5 });
});

test('Web Push in PostgreSQL: anlegen, ändern, Auswahl, einmal je Zeitraum, löschen', { skip: !sql }, async () => {
  await migrate(sql!, fileURLToPath(new URL('../migrations', import.meta.url)));
  const store = pushStore(sql!);
  const id = `${Date.now()}`;
  const a = browser(`https://fcm.googleapis.com/fcm/send/a${id}`);
  const w = browser(`https://fcm.googleapis.com/fcm/send/w${id}`);
  const sub = (b: ReturnType<typeof browser>, tag: boolean, woche: boolean): PushSubscription => ({ endpoint: b.endpoint, ...b.keys, tag, woche });
  const before = await store.count();
  await store.save(sub(a, true, false), new Date());
  await store.save(sub(a, true, true), new Date());
  await store.save(sub(w, false, true), new Date());
  assert.equal(await store.count(), before + 2);
  const mine = (l: PushSubscription[]) => l.filter((s) => s.endpoint.endsWith(id)).map((s) => s.endpoint).sort();
  assert.deepEqual(mine(await store.list(['tag'])), [a.endpoint]);
  assert.deepEqual(mine(await store.list(['woche'])), [a.endpoint, w.endpoint].sort());
  assert.deepEqual((await store.list(['tag'])).find((s) => s.endpoint === a.endpoint), sub(a, true, true));
  // neither kind chosen is no subscription
  await assert.rejects(sql!`insert into push_subscriptions (endpoint, p256dh, auth, tag, woche) values (${'x' + id}, ${a.keys.p256dh}, ${a.keys.auth}, false, false)`);
  assert.equal(await store.claim('tag', `t${id}`, new Date()), true);
  assert.equal(await store.claim('tag', `t${id}`, new Date()), false);
  assert.equal(await store.claim('woche', `t${id}`, new Date()), true);
  await store.remove(a.endpoint);
  await store.remove(w.endpoint);
  assert.equal(await store.count(), before);
});
