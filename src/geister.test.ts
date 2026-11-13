import { describe, expect, it } from 'vitest';
import { auswahl, freigabeLaden, freigabeSetzen, geistLaden, geisterListe } from './geister';

const antwort = (status: number, body?: unknown) => async () =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Geister im Spiel', () => {
  it('Liste vom Server; offline, ohne API oder mit Unsinn leer', async () => {
    const g = { id: 4, name: 'Bert', zeit: 400, platz: 1, ich: false };
    expect(await geisterListe('enigma:x', antwort(200, { geister: [g, { id: 'x' }] }))).toEqual([g]);
    expect(await geisterListe('enigma:x', antwort(404))).toEqual([]);
    expect(await geisterListe('enigma:x', async () => Promise.reject(new TypeError('offline')))).toEqual([]);
  });

  it('Lauf laden: Aufzeichnung oder null', async () => {
    expect(await geistLaden(4, antwort(200, { v: 1, steps: 400 }))).toEqual({ v: 1, steps: 400 });
    expect(await geistLaden(4, antwort(404, { error: 'x' }))).toBeNull();
    expect(await geistLaden(4, async () => Promise.reject(new TypeError('offline')))).toBeNull();
  });

  it('Freigabe lesen und setzen', async () => {
    expect(await freigabeLaden(antwort(200, { an: true }))).toBe(true);
    expect(await freigabeLaden(antwort(401))).toBeNull();
    const calls: [string, RequestInit | undefined][] = [];
    const ok = await freigabeSetzen(false, async (u, i) => (calls.push([String(u), i]), new Response(null, { status: 204 })));
    expect(ok).toBe(true);
    expect(calls[0][0]).toBe('/api/geister/freigabe');
    expect(calls[0][1]?.method).toBe('PUT');
    expect(calls[0][1]?.body).toBe('{"an":false}');
  });

  it('Auswahl: eigene Bestzeit (die bessere von lokal und Server), dann fremde nach Platz', () => {
    const lokal = { steps: 500 };
    const server = [
      { id: 1, name: 'Bert', zeit: 400, platz: 1, ich: false },
      { id: 2, name: null, zeit: 450, platz: 2, ich: false },
      { id: 3, name: 'Anna', zeit: 600, platz: 3, ich: true },
    ];
    const z = (s: number) => String(s);

    expect(auswahl(lokal, server, z).map((o) => [o.titel, o.quelle])).toEqual([
      ['Deine Bestzeit 500', 'lokal'],
      ['Platz 1 · Bert · 400', 1],
      ['Platz 2 · Spieler ohne Namen · 450', 2],
    ]);
    // the server's own run is better: it is offered instead of the local one
    expect(auswahl({ steps: 700 }, server, z)[0]).toEqual({ titel: 'Deine Bestzeit 600', quelle: 3 });
    expect(auswahl(null, [], z)).toEqual([]);
  });
});
