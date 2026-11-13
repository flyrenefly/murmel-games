import { describe, expect, it } from 'vitest';
import type { Recording } from './game/session';
import { loesungSpeichern } from './loesung';

const REC: Recording = { v: 1, level: '01', seed: 1, dt: 0.0025, steps: 10, result: 'sieg', input: [[10, 0, 0]] };
const answer = (status: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;

describe('Als Lösung speichern', () => {
  it('schickt die Aufzeichnung an die Admin-API', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response('{"id":1,"neu":true}', { status: 201 });
    }) as unknown as typeof fetch;

    expect(await loesungSpeichern(REC, f)).toMatch(/gespeichert/);
    expect(sent!.url).toBe('/api/admin/loesungen');
    expect(sent!.init.method).toBe('POST');
    expect(JSON.parse(String(sent!.init.body))).toEqual(REC);
  });

  it('meldet doppelt, fehlende Rechte, Ablehnung und keinen Server verständlich', async () => {
    expect(await loesungSpeichern(REC, answer(200))).toMatch(/schon gespeichert/);
    expect(await loesungSpeichern(REC, answer(403))).toMatch(/nur angemeldete Admins/i);
    expect(await loesungSpeichern(REC, answer(400, { error: 'Schrittzahl ungültig' }))).toBe('Nicht gespeichert: Schrittzahl ungültig');
    expect(await loesungSpeichern(REC, answer(404))).toMatch(/nicht erreichbar/);
    expect(await loesungSpeichern(REC, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).toMatch(/nicht erreichbar/);
  });

  it('schickt keinen offenen Lauf', async () => {
    expect(await loesungSpeichern({ ...REC, result: 'offen' }, answer(201))).toMatch(/Nur gewonnene/);
  });
});
