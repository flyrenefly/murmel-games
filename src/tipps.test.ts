import { describe, expect, it } from 'vitest';
import solution01 from '../solutions/murmel/01.json';
import solution02 from '../solutions/murmel/02.json';
import l01 from './levels/01.json';
import l02 from './levels/02.json';
import type { LevelFile } from './game/level';
import { startLuaNode } from './lua/node';
import { fahrplanFuer, fahrplanSuchen, Haengen, HAENGEN_SCHRITTE, HAENGEN_STUERZE, levelIdAusPfad, serverLoesungen } from './tipps';

const level01 = l01 as LevelFile;
const level02 = l02 as LevelFile;

/** A fetch that answers /api/tipps/loesungen with these solutions and counts its calls. */
function api(loesungen: unknown[], status = 200) {
  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ loesungen }), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetchFn };
}

const offline = async (): Promise<Response> => {
  throw new TypeError('offline');
};

describe('Lösungen aus dem Build', () => {
  it('ordnet Dateien den Levels zu wie tools/lib/solutions.mjs', () => {
    expect(levelIdAusPfad('../solutions/murmel/01.json')).toBe('01');
    expect(levelIdAusPfad('../solutions/enigma/a_tut06.json')).toBe('enigma:a_tut06');
    expect(levelIdAusPfad('../solutions/enigma/m_tutor/m_tut1.json')).toBe('enigma:m_tutor/m_tut1');
    expect(levelIdAusPfad('../solutions/README.md')).toBeNull();
  });

  it('nimmt offline die Lösung aus dem Build', async () => {
    const f = await fahrplanSuchen(level01, { fetchFn: offline, startLua: startLuaNode });

    expect(f?.schritte).toBe(solution01.steps);
  });
});

describe('Lösungen vom Server', () => {
  it('fragt nur nach dem Level und liest die Liste', async () => {
    const { calls, fetchFn } = api([solution02]);

    expect(await serverLoesungen('enigma:m_tutor/m_tut1', fetchFn)).toEqual([solution02]);
    expect(calls).toEqual(['/api/tipps/loesungen?level=enigma%3Am_tutor%2Fm_tut1']);
  });

  it('offline, Fehler oder fremde Antwort: keine Lösungen', async () => {
    expect(await serverLoesungen('01', offline)).toEqual([]);
    expect(await serverLoesungen('01', api([], 500).fetchFn)).toEqual([]);
    expect(await serverLoesungen('01', async () => new Response('<html>'))).toEqual([]);
  });

  it('ohne Lösung im Build: die erste Server-Lösung, die gewinnt', async () => {
    const kaputt = { ...solution02, input: solution02.input.slice(0, 10), steps: 50 };
    const { fetchFn } = api([kaputt, solution01, solution02]);

    const f = await fahrplanSuchen(level02, { build: new Map(), fetchFn, startLua: startLuaNode });

    expect(f?.schritte).toBe(solution02.steps);
  });
});

describe('kein Tipp ohne Lösung', () => {
  it('weder im Build noch auf dem Server: null', async () => {
    expect(await fahrplanSuchen(level02, { build: new Map(), fetchFn: api([]).fetchFn, startLua: startLuaNode })).toBeNull();
    expect(await fahrplanSuchen(level02, { build: new Map(), fetchFn: offline, startLua: startLuaNode })).toBeNull();
  });

  it('nur Lösungen, die nicht zum Level passen: null', async () => {
    const f = await fahrplanSuchen(level02, { build: new Map([['02', async () => solution01]]), fetchFn: api([solution01]).fetchFn, startLua: startLuaNode });

    expect(f).toBeNull();
  });

  it('sucht je Level nur einmal, ohne Fund später wieder (dann vielleicht online)', async () => {
    const { calls, fetchFn } = api([solution02]);
    const file = { ...level02 };
    const q = { build: new Map(), fetchFn, startLua: startLuaNode };
    await fahrplanFuer(file, q);
    await fahrplanFuer(file, q);
    expect(calls).toHaveLength(1);

    const leer = api([]);
    const other = { ...level02 };
    expect(await fahrplanFuer(other, { ...q, fetchFn: leer.fetchFn })).toBeNull();
    expect(await fahrplanFuer(other, q)).not.toBeNull();
  });
});

describe('Hängen', () => {
  it('nach 3 Minuten ohne Fortschritt', () => {
    const h = new Haengen();
    expect(h.pruefen('a', 0, 0)).toBe(false);
    expect(h.pruefen('a', HAENGEN_SCHRITTE - 1, 0)).toBe(false);
    expect(h.pruefen('a', HAENGEN_SCHRITTE, 0)).toBe(true);
  });

  it('nach 5 Abstürzen ohne Fortschritt', () => {
    const h = new Haengen();
    h.pruefen('a', 0, 2);
    expect(h.pruefen('a', 100, 2 + HAENGEN_STUERZE - 1)).toBe(false);
    expect(h.pruefen('a', 200, 2 + HAENGEN_STUERZE)).toBe(true);
  });

  it('Fortschritt oder Neustart setzen die Uhr zurück', () => {
    const h = new Haengen();
    h.pruefen('a', 0, 0);
    expect(h.pruefen('b', HAENGEN_SCHRITTE, 0)).toBe(false);
    expect(h.pruefen('b', HAENGEN_SCHRITTE * 2 - 1, 0)).toBe(false);
    expect(h.pruefen('b', 10, 0)).toBe(false); // restart: steps start at 0 again
    expect(h.pruefen('b', HAENGEN_SCHRITTE + 9, 0)).toBe(false);
    expect(h.pruefen('b', HAENGEN_SCHRITTE + 10, 0)).toBe(true);
  });
});
