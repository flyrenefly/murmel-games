import { describe, expect, it } from 'vitest';
import { AUS, istIOS, moeglich, schluesselBytes, schluesselLaden, standText, type Umgebung, wahlAnwenden } from './webpush';

const KEY = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const CHROME: Umgebung = { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140', platform: 'Win32', maxTouchPoints: 0, standalone: false, serviceWorker: true, pushManager: true, notification: true };
const IPHONE_SAFARI: Umgebung = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', platform: 'iPhone', maxTouchPoints: 5, standalone: false, serviceWorker: true, pushManager: false, notification: false };

/** A fake service worker registration with a push manager. */
function registrierung(vorhanden: boolean | string = false) {
  const log: string[] = [];
  let sub: { endpoint: string; options: { applicationServerKey: ArrayBuffer }; toJSON: () => PushSubscriptionJSON; unsubscribe: () => Promise<boolean> } | null = null;
  const neu = (key = KEY) => ({
    options: { applicationServerKey: schluesselBytes(key).buffer },
    endpoint: 'https://fcm.googleapis.com/fcm/send/x',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: async () => (log.push('unsubscribe'), (sub = null), true),
  });
  if (vorhanden) sub = neu(typeof vorhanden === 'string' ? vorhanden : KEY);
  const reg = {
    pushManager: {
      getSubscription: async () => sub,
      subscribe: async (o: PushSubscriptionOptionsInit) => {
        log.push(`subscribe ${o.userVisibleOnly} ${(o.applicationServerKey as Uint8Array).length}`);
        sub = neu();
        return sub;
      },
    },
  } as unknown as ServiceWorkerRegistration;
  return { reg, log };
}

function server(status = 204) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(null, { status });
  };
  return { calls, fetchFn };
}

describe('Erinnerung (Web Push) im Spiel', () => {
  it('erkennt, ob der Browser Push kann; iPhone/iPad im Browser bekommen einen Hinweis', () => {
    expect(moeglich(CHROME)).toBe('bereit');
    expect(moeglich(IPHONE_SAFARI)).toBe('ios-browser');
    // Home-Bildschirm-App ab iOS 16.4: Push da
    expect(moeglich({ ...IPHONE_SAFARI, standalone: true, pushManager: true, notification: true })).toBe('bereit');
    // als App, aber altes iOS ohne Push: kein Hinweis, der nicht hilft
    expect(moeglich({ ...IPHONE_SAFARI, standalone: true })).toBe('nein');
    expect(moeglich({ ...CHROME, pushManager: false })).toBe('nein');
    // iPadOS meldet sich als Mac
    expect(istIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(istIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false);
  });

  it('holt den Schlüssel; ohne Push auf dem Server, offline oder mit Unsinn: null', async () => {
    const json = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
    expect(await schluesselLaden(json(200, { schluessel: KEY }))).toBe(KEY);
    expect(await schluesselLaden(json(404, { error: 'nicht gefunden' }))).toBeNull();
    expect(await schluesselLaden(json(200, { schluessel: '<script>' }))).toBeNull();
    expect(await schluesselLaden(async () => Promise.reject(new TypeError('offline')))).toBeNull();
    expect(schluesselBytes(KEY)).toHaveLength(65);
    expect(schluesselBytes(KEY)[0]).toBe(4);
  });

  it('einschalten: erst die Erlaubnis, dann abonnieren und dem Server melden', async () => {
    const { reg, log } = registrierung();
    const s = server();
    const order: string[] = [];
    const r = await wahlAnwenden({ tag: true, woche: false }, KEY, {
      erlaubnis: async () => (order.push('erlaubnis'), 'granted'),
      registrierung: async () => (order.push('registrierung'), reg),
      fetchFn: s.fetchFn,
    });
    expect(r).toBe('ok');
    expect(order).toEqual(['erlaubnis', 'registrierung']);
    expect(log).toEqual(['subscribe true 65']);
    expect(s.calls).toEqual([{ url: '/api/push/abo', method: 'POST', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' }, tag: true, woche: false } }]);
  });

  it('verweigert: kein Abo, nichts an den Server; Serverfehler: fehler', async () => {
    const { reg, log } = registrierung();
    const s = server();
    expect(await wahlAnwenden({ tag: true, woche: true }, KEY, { erlaubnis: async () => 'denied', registrierung: async () => reg, fetchFn: s.fetchFn })).toBe('verweigert');
    expect(log).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(await wahlAnwenden({ tag: true, woche: true }, KEY, { erlaubnis: async () => 'granted', registrierung: async () => reg, fetchFn: server(429).fetchFn })).toBe('fehler');
    expect(await wahlAnwenden({ tag: true, woche: true }, KEY, { erlaubnis: async () => 'granted', registrierung: async () => undefined, fetchFn: s.fetchFn })).toBe('fehler');
  });

  it('Auswahl ändern nutzt das bestehende Abo; beides aus meldet ab und löscht beim Server', async () => {
    const { reg, log } = registrierung(true);
    const s = server();
    const t = { erlaubnis: async () => 'granted' as const, registrierung: async () => reg, fetchFn: s.fetchFn };
    expect(await wahlAnwenden({ tag: false, woche: true }, KEY, t)).toBe('ok');
    expect(log).toEqual([]);
    expect(await wahlAnwenden(AUS, KEY, t)).toBe('ok');
    expect(log).toEqual(['unsubscribe']);
    expect(s.calls.map((c) => [c.method, c.body])).toEqual([
      ['POST', { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' }, tag: false, woche: true }],
      ['DELETE', { endpoint: 'https://fcm.googleapis.com/fcm/send/x' }],
    ]);
  });

  it('neue Schlüssel auf dem Server: altes Abo verwerfen, neu abonnieren', async () => {
    const ALT = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8';
    const { reg, log } = registrierung(ALT);
    const s = server();
    expect(await wahlAnwenden({ tag: true, woche: false }, KEY, { erlaubnis: async () => 'granted', registrierung: async () => reg, fetchFn: s.fetchFn })).toBe('ok');
    expect(log).toEqual(['unsubscribe', 'subscribe true 65']);
    expect(s.calls).toHaveLength(1);
  });

  it('Stand in der Liste', () => {
    expect(standText(AUS)).toBe('Aus');
    expect(standText({ tag: true, woche: false })).toBe('Täglich');
    expect(standText({ tag: false, woche: true })).toBe('Wochenaufgabe');
    expect(standText({ tag: true, woche: true })).toBe('Täglich und Wochenaufgabe');
  });
});
