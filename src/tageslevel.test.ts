import { describe, expect, it } from 'vitest';
import { aufgabenLaden, einreichenAufgabe, ergebnisZeile, listenZeile, titelZeile } from './tageslevel';

const json = (status: number, body?: unknown) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TAG = { art: 'tag', zeitraum: '2026-11-13', level: 'enigma:x', pack: 'enigma_ii', index: 4, titel: 'Brücken', seed: 7, bis: '2026-11-13T23:00:00.000Z', anzahl: 12, top: [], ich: { platz: 3, zeit: 900 } };
const WOCHE = { ...TAG, art: 'woche', zeitraum: '2026-W46', titel: 'Labyrinth', anzahl: 0, ich: null };

describe('Tageslevel im Spiel', () => {
  it('lädt Tag und Woche; offline, ohne API oder mit Unsinn: null', async () => {
    expect(await aufgabenLaden(json(200, { tag: TAG, woche: WOCHE }))).toEqual({ tag: TAG, woche: WOCHE });
    expect(await aufgabenLaden(json(200, { tag: { ...TAG, seed: 'x' }, woche: WOCHE }))).toEqual({ woche: WOCHE });
    expect(await aufgabenLaden(json(503, { error: 'x' }))).toBeNull();
    expect(await aufgabenLaden(async () => Promise.reject(new TypeError('offline')))).toBeNull();
  });

  it('reicht mit Art und Zeitraum ein', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const r = await einreichenAufgabe({ v: 1 } as never, TAG as never, 'abc1234', async (u, i) => (calls.push([String(u), i]), new Response(JSON.stringify({ id: 'k1' }), { status: 202 })));
    expect(r).toEqual({ id: 'k1' });
    expect(calls[0][0]).toBe('/api/tageslevel/lauf');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ v: 1, art: 'tag', zeitraum: '2026-11-13', version: 'abc1234' });
    expect(await einreichenAufgabe({} as never, TAG as never, 'v', json(400, { error: 'Diese Aufgabe ist vorbei.' }))).toEqual({ fehler: 'Diese Aufgabe ist vorbei.' });
  });

  it('Texte für Liste, Startkarte und Siegmeldung', () => {
    const z = (s: number) => `${s}s`;
    expect(listenZeile(TAG as never, 'Enigma II', z)).toEqual({ titel: 'Heute · Brücken', info: 'Enigma II · Platz 3 von 12 · 900s' });
    expect(listenZeile(WOCHE as never, 'Enigma II', z)).toEqual({ titel: 'Diese Woche · Labyrinth', info: 'Enigma II · noch keine Zeiten' });
    expect(listenZeile({ ...WOCHE, anzahl: 1 } as never, 'Enigma II', z).info).toBe('Enigma II · 1 Zeit');
    expect(titelZeile(TAG as never)).toBe('Tageslevel 13.11.');
    expect(titelZeile(WOCHE as never)).toBe('Wochenaufgabe KW 46');
    expect(ergebnisZeile({ status: 'wartet' }, 'tag', z)).toBe('Tageslevel: wird geprüft …');
    expect(ergebnisZeile({ status: 'angenommen', lauf: 1, zeit: 800, neu: true, platz: 2, von: 9 }, 'tag', z)).toBe('Tageslevel: Platz 2 von 9');
    expect(ergebnisZeile({ status: 'angenommen', lauf: 900, zeit: 800, neu: false, platz: 2, von: 9 }, 'woche', z)).toBe('Wochenaufgabe: Platz 2 von 9 (deine Bestzeit 800s)');
    expect(ergebnisZeile({ status: 'abgelehnt', grund: 'Diese Aufgabe ist vorbei.' }, 'tag', z)).toBe('Tageslevel: Diese Aufgabe ist vorbei.');
  });
});
