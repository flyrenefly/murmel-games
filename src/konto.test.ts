import { describe, expect, test } from 'vitest';
import { KontoApi, loginTokenFromHash, OFFLINE, passkeyFehler } from './konto';

describe('loginTokenFromHash', () => {
  test('liest das Token aus #anmelden=…', () => {
    const t = 'aB3_-'.repeat(9);
    expect(loginTokenFromHash(`#anmelden=${t}`)).toBe(t);
  });
  test('ignoriert andere Anker und Unsinn', () => {
    expect(loginTokenFromHash('')).toBeNull();
    expect(loginTokenFromHash('#level=3')).toBeNull();
    expect(loginTokenFromHash('#anmelden=kurz')).toBeNull();
    expect(loginTokenFromHash('#anmelden=<script>alert(1)</script>xxxxxxxxxxxx')).toBeNull();
  });
});

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const c = { url, init };
    calls.push(c);
    return respond(c);
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('KontoApi', () => {
  test('schickt JSON mit Cookie der eigenen Seite an /api/konto', async () => {
    const f = fakeFetch(() => json(202, { ok: true }));
    const r = await new KontoApi('/api/konto', f.fn).linkSchicken('a@b.de');
    expect(r).toEqual({ ok: true, daten: { ok: true } });
    expect(f.calls[0].url).toBe('/api/konto/mail');
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.credentials).toBe('same-origin');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ email: 'a@b.de' });
  });

  test('gibt die Meldung des Servers weiter (z. B. Mailversand nicht eingerichtet)', async () => {
    const f = fakeFetch(() => json(503, { error: 'Der Mailversand ist noch nicht eingerichtet.' }));
    expect(await new KontoApi('/api/konto', f.fn).linkSchicken('a@b.de')).toEqual({ ok: false, fehler: 'Der Mailversand ist noch nicht eingerichtet.', status: 503 });
  });

  test('offline oder ohne Server: freundliche Meldung, das Spiel läuft weiter', async () => {
    const offline = fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await new KontoApi('/api/konto', offline.fn).stand()).toEqual({ ok: false, fehler: OFFLINE, status: 0 });
    const html = fakeFetch(() => new Response('<html>', { status: 404 }));
    expect(await new KontoApi('/api/konto', html.fn).stand()).toEqual({ ok: false, fehler: OFFLINE, status: 404 });
  });

  test('Passkey entfernen kodiert die ID im Pfad', async () => {
    const f = fakeFetch(() => json(200, { angemeldet: true }));
    await new KontoApi('/api/konto', f.fn).passkeyEntfernen('a/b');
    expect(f.calls[0].url).toBe('/api/konto/passkey/a%2Fb');
    expect(f.calls[0].init.method).toBe('DELETE');
  });
});

test('passkeyFehler: Abbruch und vorhandener Passkey verständlich', () => {
  expect(passkeyFehler({ name: 'NotAllowedError' })).toMatch(/Abgebrochen/);
  expect(passkeyFehler({ name: 'InvalidStateError' })).toMatch(/schon einen Passkey/);
  expect(passkeyFehler(new Error('x'))).toMatch(/Mail-Link/);
});
