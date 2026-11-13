import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Recording } from './game/session';
import { hochladen, keepNewest, listUrl, loadPlayerLevel, playerIdFromHash, pruefungAbwarten, ratingText, rememberSolution, solutionFor } from './spielerlevels';

/** A small localStorage for the node test environment. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const REC: Recording = { v: 1, steps: 100, input: [[100, 1, 0]], level: 'link:abc', seed: 3, dt: 0.0025, result: 'sieg' } as Recording;
const FILE = { id: 'spieler:7', title: 'Paar', author: 'Anna', license: 'CC-BY-SA-4.0', map: ['###'], legend: {} };
const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
afterEach(() => vi.unstubAllGlobals());

test('keepNewest: neu zuerst, ohne Doppelte, begrenzt', () => {
  const key = (x: { k: string }) => x.k;
  expect(keepNewest([{ k: 'a' }, { k: 'b' }, { k: 'c' }], { k: 'b' }, key, 2)).toEqual([{ k: 'b' }, { k: 'a' }]);
});

test('playerIdFromHash und listUrl', () => {
  expect(playerIdFromHash('#spieler=12')).toBe(12);
  expect(playerIdFromHash('#spieler=0')).toBeNull();
  expect(playerIdFromHash('#spieler=12&x')).toBeNull();
  expect(playerIdFromHash('#level=1.abc')).toBeNull();
  expect(listUrl('spieler:12')).toBe('./spielerlevels.html#level-12');
  expect(listUrl('enigma:x')).toBe('./spielerlevels.html');
});

test('ratingText', () => {
  expect(ratingText(null, 0)).toBe('Noch nicht bewertet');
  expect(ratingText(4.5, 2)).toBe('4,5 ★ (2 Bewertungen)');
  expect(ratingText(3, 1)).toBe('3,0 ★ (1 Bewertung)');
});

test('Gelöster Probelauf: nur Siege, je Linkdaten, die neuesten fünf', () => {
  rememberSolution('d1', { ...REC, result: 'offen' });
  expect(solutionFor('d1')).toBeNull();
  rememberSolution('d1', REC);
  expect(solutionFor('d1')).toEqual(REC);
  expect(solutionFor('d2')).toBeNull();
  for (let i = 2; i <= 6; i++) rememberSolution(`d${i}`, REC);
  expect(solutionFor('d1')).toBeNull();
  expect(solutionFor('d6')).toEqual(REC);
});

describe('loadPlayerLevel', () => {
  test('lädt vom Server und behält eine Kopie für offline', async () => {
    const ok = await loadPlayerLevel('#spieler=7', async () => res(200, FILE));
    expect(ok).toEqual({ ok: true, file: FILE, offline: false });
    const offline = await loadPlayerLevel('#spieler=7', async () => {
      throw new TypeError('offline');
    });
    expect(offline).toEqual({ ok: true, file: FILE, offline: true });
  });
  test('Fehler werden zu Meldungen, kein Spieler-Hash ergibt null', async () => {
    expect(await loadPlayerLevel('#x', async () => res(200, FILE))).toBeNull();
    const gone = await loadPlayerLevel('#spieler=8', async () => res(404, { error: 'nicht gefunden' }));
    expect(gone).toMatchObject({ ok: false, error: expect.stringMatching(/Freigabe/) });
    const offline = await loadPlayerLevel('#spieler=8', async () => {
      throw new TypeError('offline');
    });
    expect(offline).toMatchObject({ ok: false });
    // a foreign file with another id is not taken
    expect(await loadPlayerLevel('#spieler=9', async () => res(200, FILE))).toMatchObject({ ok: false });
  });
});

describe('hochladen und pruefungAbwarten', () => {
  const req = { level: FILE as never, loesung: REC, titel: 'Paar', beschreibung: '', version: 'abc1234' };
  test('202 ergibt die Id, mit Lizenz in der Anfrage', async () => {
    let sent: Record<string, unknown> = {};
    const r = await hochladen(req, async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return res(202, { id: 'x1' });
    });
    expect(r).toEqual({ id: 'x1' });
    expect(sent.lizenz).toBe('CC-BY-SA-4.0');
  });
  test('Fehler mit Meldung, fehlender Name, nicht erreichbar', async () => {
    expect(await hochladen(req, async () => res(400, { error: 'Der Titel braucht 3 bis 60 Zeichen.' }))).toEqual({ fehler: 'Der Titel braucht 3 bis 60 Zeichen.' });
    expect(await hochladen(req, async () => res(409, { error: 'Name fehlt', name: true }))).toEqual({ fehler: 'Name fehlt', name: true });
    expect(await hochladen(req, async () => res(401, { error: 'nicht angemeldet' }))).toEqual({ fehler: 'Bitte melde dich zuerst an.' });
    expect(await hochladen(req, async () => res(404, {}))).toMatchObject({ fehler: expect.stringMatching(/nicht erreichbar/) });
  });
  test('wartet, bis die Prüfung fertig ist', async () => {
    const answers = [res(200, { status: 'wartet' }), res(200, { status: 'angenommen', level: 4 })];
    const r = await pruefungAbwarten('x1', async () => answers.shift()!, async () => {});
    expect(r).toEqual({ status: 'angenommen', level: 4 });
    const no = await pruefungAbwarten('x1', async () => res(200, { status: 'abgelehnt', grund: 'Nicht gelöst.' }), async () => {});
    expect(no).toEqual({ status: 'abgelehnt', grund: 'Nicht gelöst.' });
  });
});
