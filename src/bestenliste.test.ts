import { describe, expect, it } from 'vitest';
import { abwarten, einreichen, ergebnisText, lohntSich, meineLaden, NICHT_ERREICHBAR, ranglistenUrl } from './bestenliste';
import type { Recording } from './game/session';

const REC = { v: 1, level: 'enigma:rb01', seed: 1, dt: 0.0025, steps: 900, result: 'sieg', input: [[900, 0, 0]] } as unknown as Recording;
const reply = (status: number, body?: unknown) => async () => new Response(body === undefined ? 'x' : JSON.stringify(body), { status });
const zeit = (s: number) => `${s}s`;
const now = async () => {};

describe('bestenliste (Spiel)', () => {
  it('einreichen: Id bei 202, Spielversion mitgeschickt, verständliche Meldungen sonst', async () => {
    let body = '';
    const f = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ id: 'abc' }), { status: 202 });
    }) as unknown as typeof fetch;
    expect(await einreichen(REC, '1234567', f)).toEqual({ id: 'abc' });
    expect(JSON.parse(body)).toMatchObject({ level: 'enigma:rb01', version: '1234567' });
    expect(await einreichen(REC, 'v', reply(401, { error: 'nicht angemeldet' }) as typeof fetch)).toEqual({ fehler: 'Anmelden, um in die Bestenliste zu kommen.' });
    expect(await einreichen(REC, 'v', reply(429, { error: 'Höchstens 30' }) as typeof fetch)).toEqual({ fehler: 'Höchstens 30' });
    expect(await einreichen(REC, 'v', reply(404) as typeof fetch)).toEqual({ fehler: NICHT_ERREICHBAR });
    expect(await einreichen(REC, 'v', (async () => Promise.reject(new Error('offline'))) as typeof fetch)).toEqual({ fehler: NICHT_ERREICHBAR });
  });

  it('abwarten: fragt bis zum Ergebnis, übersteht Netzlücken, 404 = abgebrochen', async () => {
    const answers: (() => Promise<Response>)[] = [
      async () => Promise.reject(new Error('weg')),
      reply(200, { status: 'wartet' }),
      reply(200, { status: 'angenommen', lauf: 900, zeit: 900, neu: true, platz: 2, von: 5 }),
    ];
    const f = (async () => answers.shift()!()) as unknown as typeof fetch;
    expect(await abwarten('abc', f, now)).toEqual({ status: 'angenommen', lauf: 900, zeit: 900, neu: true, platz: 2, von: 5 });
    expect((await abwarten('abc', reply(404, { error: 'x' }) as typeof fetch, now)).status).toBe('abgelehnt');
    expect(await abwarten('abc', reply(200, { status: 'wartet' }) as typeof fetch, now, 3)).toMatchObject({ status: 'abgelehnt', grund: expect.stringMatching(/zu lange/) });
  });

  it('meineLaden: nur gültige Einträge, leer ohne API', async () => {
    const m = await meineLaden(reply(200, { levels: { a: { zeit: 10, platz: 1 }, b: { zeit: 'x' } } }) as typeof fetch);
    expect([...m]).toEqual([['a', { zeit: 10, platz: 1 }]]);
    expect((await meineLaden(reply(401, { error: 'x' }) as typeof fetch)).size).toBe(0);
  });

  it('lohntSich, ergebnisText, ranglistenUrl', () => {
    expect(lohntSich(10, undefined)).toBe(true);
    expect(lohntSich(10, { zeit: 10 })).toBe(false);
    expect(lohntSich(9, { zeit: 10 })).toBe(true);
    expect(ergebnisText({ status: 'wartet' }, zeit)).toBe('Bestenliste: wird geprüft …');
    expect(ergebnisText({ status: 'angenommen', lauf: 5, zeit: 5, neu: true, platz: 3, von: 57 }, zeit)).toBe('Bestenliste: Platz 3 von 57 · neue persönliche Bestzeit');
    expect(ergebnisText({ status: 'angenommen', lauf: 9, zeit: 5, neu: false, platz: 3, von: 57 }, zeit)).toBe('Bestenliste: Platz 3 von 57 (deine Bestzeit 5s)');
    expect(ergebnisText({ status: 'abgelehnt', grund: 'Nein.' }, zeit)).toBe('Bestenliste: Nein.');
    expect(ranglistenUrl('enigma:a b', 'Tür & Tor')).toBe('bestenliste.html?level=enigma%3Aa+b&titel=T%C3%BCr+%26+Tor');
  });
});
