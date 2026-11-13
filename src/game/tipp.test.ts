import { describe, expect, it } from 'vitest';
import basic from '../../public/levels/enigma/tutorial_basic.json';
import solution01 from '../../solutions/murmel/01.json';
import tut1 from '../../solutions/enigma/m_tutor/m_tut1.json';
import l01 from '../levels/01.json';
import l02 from '../levels/02.json';
import { startLuaNode } from '../lua/node';
import { LuaLevel } from '../lua/runtime';
import type { LevelFile } from './level';
import { replay } from './replay';
import { abschnitt, type Fahrplan, fahrplan, fenster, type Lage, lageSchluessel, lageVon, NACHLAUF_SCHRITTE, satz, TippGeist, ZEIGEN_SCHRITTE } from './tipp';

LuaLevel.quiet = true;
const level01 = l01 as LevelFile;
const tutLevel = (basic.levels as unknown as LevelFile[]).find((l) => l.id === 'enigma:m_tutor/m_tut1')!;

/** The solution cut after `steps` steps, replayed: the situation of a player who got that far. */
async function lageNach(file: LevelFile, data: { input: unknown[] } & Record<string, unknown>, steps: number) {
  const input: unknown[] = [];
  let n = 0;
  for (const e of data.input as (number | string)[][]) {
    if (n >= steps) break;
    if (e.length === 2 && typeof e[1] === 'string') input.push(e);
    else {
      const take = Math.min(e[0] as number, steps - n);
      input.push([take, ...e.slice(1)]);
      n += take;
    }
  }
  const s = await replay(file, { ...data, input, steps: n }, { startLua: startLuaNode });
  return { session: s, lage: lageVon(s) };
}

const leer = (symbole: string[] = []): Lage => ({ geloest: new Set(), paare: 0, inventar: [], perlen: 0, symbole });

describe('Fahrplan', () => {
  it('spielt die Lösung bis zum Sieg und notiert die Oxyd-Paare, das Ziel zuletzt', async () => {
    const f = (await fahrplan(level01, solution01, startLuaNode))!;

    expect(f.schritte).toBe(solution01.steps);
    const paare = f.stationen.filter((s) => s.art === 'paar');
    expect(paare.length).toBeGreaterThan(0);
    expect(paare.map((p) => p.nr)).toEqual(paare.map((_, i) => i + 1));
    expect(f.stationen.at(-1)).toEqual({ art: 'ziel', schritt: solution01.steps });
    const schritte = f.stationen.map((s) => s.schritt);
    expect([...schritte].sort((a, b) => a - b)).toEqual(schritte);
  });

  it('auch für ein Enigma-Level aus einem Paket', async () => {
    const f = (await fahrplan(tutLevel, tut1, startLuaNode))!;

    expect(f.schritte).toBe(tut1.steps);
    expect(f.stationen.map((s) => s.art)).toEqual(['paar', 'paar', 'paar', 'ziel']);
  });

  it('kein Fahrplan ohne passende Lösung: anderes Level, kaputt oder ohne Sieg', async () => {
    expect(await fahrplan(l02 as LevelFile, solution01, startLuaNode)).toBeNull();
    expect(await fahrplan(level01, { ...solution01, seed: -1 }, startLuaNode)).toBeNull();
    expect(await fahrplan(level01, { ...solution01, input: solution01.input.slice(0, 20), steps: 100 }, startLuaNode)).toBeNull();
    expect(await fahrplan(level01, null, startLuaNode)).toBeNull();
  });

  it('wartet zwischendurch, damit die Seite nicht hängt', async () => {
    let pausen = 0;
    await fahrplan(level01, solution01, startLuaNode, async () => void pausen++);

    expect(pausen).toBe(Math.floor(solution01.steps / 4000));
  });
});

describe('Fortschritt und Abschnitt', () => {
  it('am Levelanfang beginnt der Tipp vorn und zeigt bis zur ersten Station', async () => {
    const f = (await fahrplan(level01, solution01, startLuaNode))!;
    const { lage } = await lageNach(level01, solution01, 0);

    expect(abschnitt(f, lage)).toEqual({ von: 0, bis: f.stationen[0].schritt, station: f.stationen[0] });
  });

  it('nach dem ersten Paar beginnt der Tipp dort, wo die Lösung das Paar hatte', async () => {
    const f = (await fahrplan(level01, solution01, startLuaNode))!;
    const erstes = f.stationen.find((s) => s.art === 'paar')!;
    const i = f.stationen.indexOf(erstes);
    const { lage } = await lageNach(level01, solution01, erstes.schritt);

    expect(lage.paare).toBe(1);
    const a = abschnitt(f, lage);
    expect(a.von).toBe(erstes.schritt);
    expect(a.station).toBe(f.stationen[i + 1]);
  });

  it('alles erreicht: der letzte Abschnitt führt ins Ziel', async () => {
    const f = (await fahrplan(level01, solution01, startLuaNode))!;
    const vorZiel = f.stationen.at(-2)!;
    const { lage } = await lageNach(level01, solution01, vorZiel.schritt);

    expect(abschnitt(f, lage).station.art).toBe('ziel');
  });

  it('ein anderes Paar zuerst gelöst: der Tipp zeigt das fehlende erste Paar', () => {
    const f: Fahrplan = {
      loesung: null,
      schritte: 900,
      breite: 20,
      hoehe: 12,
      steine: [{ col: 1, row: 1, symbol: 'A' }, { col: 18, row: 10, symbol: 'A' }, { col: 10, row: 6, symbol: 'B' }, { col: 11, row: 6, symbol: 'B' }],
      stationen: [
        { art: 'paar', schritt: 300, steine: [0, 1], nr: 1 },
        { art: 'paar', schritt: 600, steine: [2, 3], nr: 2 },
        { art: 'ziel', schritt: 900 },
      ],
    };
    const lage: Lage = { ...leer(['A', 'A', 'B', 'B']), geloest: new Set([2, 3]), paare: 1 };

    const a = abschnitt(f, lage);
    expect(a).toEqual({ von: 0, bis: 300, station: f.stationen[0] });
    expect(satz(f, a, lage)).toBe('Als Nächstes: ein Oxyd-Paar – oben links und unten rechts.');
  });

  it('zufällige Farben: zählt die Paare und nennt keine Orte', () => {
    const f: Fahrplan = {
      loesung: null,
      schritte: 900,
      breite: 20,
      hoehe: 12,
      steine: [{ col: 1, row: 1, symbol: 'A' }, { col: 18, row: 10, symbol: 'A' }, { col: 10, row: 6, symbol: 'B' }, { col: 11, row: 6, symbol: 'B' }],
      stationen: [
        { art: 'paar', schritt: 300, steine: [0, 1], nr: 1 },
        { art: 'paar', schritt: 600, steine: [2, 3], nr: 2 },
        { art: 'ziel', schritt: 900 },
      ],
    };
    // in the player's run the colours were dealt differently: 0+2 and 1+3 are the pairs
    const lage: Lage = { ...leer(['A', 'B', 'A', 'B']), geloest: new Set([0, 2]), paare: 1 };

    const a = abschnitt(f, lage);
    expect(a.station).toBe(f.stationen[1]);
    expect(satz(f, a, lage)).toBe('Als Nächstes: ein weiteres Oxyd-Paar.');
  });

  it('ein verbrauchter Gegenstand zählt, wenn ein späteres Paar erreicht ist', () => {
    const f: Fahrplan = {
      loesung: null,
      schritte: 900,
      breite: 20,
      hoehe: 12,
      steine: [{ col: 1, row: 1, symbol: 'A' }, { col: 2, row: 1, symbol: 'A' }],
      stationen: [
        { art: 'gegenstand', schritt: 100, name: 'it_key' },
        { art: 'paar', schritt: 500, steine: [0, 1], nr: 1 },
        { art: 'gegenstand', schritt: 600, name: 'it_hammer' },
        { art: 'ziel', schritt: 900 },
      ],
    };

    expect(abschnitt(f, leer(['A', 'A'])).station).toBe(f.stationen[0]);
    expect(satz(f, abschnitt(f, leer(['A', 'A'])), leer(['A', 'A']))).toBe('Als Nächstes: Schlüssel einsammeln.');
    expect(abschnitt(f, { ...leer(['A', 'A']), inventar: ['it_key'] }).station).toBe(f.stationen[1]);
    const paarDa: Lage = { ...leer(['A', 'A']), geloest: new Set([0, 1]), paare: 1 };
    expect(abschnitt(f, paarDa)).toEqual({ von: 500, bis: 600, station: f.stationen[2] });
    expect(satz(f, abschnitt(f, paarDa), paarDa)).toBe('Als Nächstes: Hammer einsammeln.');
  });

  it('Perlen und Ziel haben eigene Sätze; beide Steine an einem Ort', () => {
    const f: Fahrplan = {
      loesung: null,
      schritte: 900,
      breite: 21,
      hoehe: 12,
      steine: [{ col: 10, row: 5, symbol: 'A' }, { col: 11, row: 6, symbol: 'A' }],
      stationen: [
        { art: 'perle', schritt: 100, nr: 1 },
        { art: 'paar', schritt: 500, steine: [0, 1], nr: 1 },
        { art: 'ziel', schritt: 900 },
      ],
    };
    const l = leer(['A', 'A']);

    expect(satz(f, abschnitt(f, l), l)).toBe('Als Nächstes: eine Perle in eine Mulde.');
    const p = { ...l, perlen: 1 };
    expect(satz(f, abschnitt(f, p), p)).toBe('Als Nächstes: ein Oxyd-Paar – beide Steine in der Mitte.');
    const z = { ...p, geloest: new Set([0, 1]), paare: 1 };
    expect(satz(f, abschnitt(f, z), z)).toBe('Als Nächstes: der Weg ins Ziel.');
  });

  it('der Schlüssel der Lage ändert sich nur mit Fortschritt', () => {
    const a = leer(['A', 'A']);
    expect(lageSchluessel(a)).toBe(lageSchluessel({ ...a, inventar: [] }));
    expect(lageSchluessel(a)).not.toBe(lageSchluessel({ ...a, geloest: new Set([0]) }));
    expect(lageSchluessel(a)).not.toBe(lageSchluessel({ ...a, inventar: ['it_key'] }));
    expect(lageSchluessel(a)).not.toBe(lageSchluessel({ ...a, perlen: 1 }));
    expect(lageSchluessel({ ...a, inventar: ['it_key', 'it_key'] })).toBe(lageSchluessel({ ...a, inventar: ['it_key'] }));
  });
});

describe('Fenster', () => {
  const f = { schritte: 30000 } as Fahrplan;

  it('kurzer Abschnitt: bis zur Station und einen Moment weiter', () => {
    expect(fenster(f, { von: 1000, bis: 3000, station: { art: 'ziel', schritt: 3000 } }, null)).toEqual({ start: 1000, ende: 3000 + NACHLAUF_SCHRITTE });
  });

  it('langer Abschnitt: höchstens 15 s, der nächste Tipp zeigt das nächste Stück, dann wieder vorn', () => {
    const a = { von: 0, bis: 20000, station: { art: 'ziel' as const, schritt: 20000 } };
    const w1 = fenster(f, a, null);
    expect(w1).toEqual({ start: 0, ende: ZEIGEN_SCHRITTE });
    const w2 = fenster(f, a, w1.ende);
    expect(w2).toEqual({ start: ZEIGEN_SCHRITTE, ende: 2 * ZEIGEN_SCHRITTE });
    let w = w2;
    while (w.ende < a.bis) w = fenster(f, a, w.ende);
    expect(w.ende).toBe(a.bis + NACHLAUF_SCHRITTE);
    expect(fenster(f, a, w.ende).start).toBe(0);
  });

  it('nie über das Ende der Lösung hinaus', () => {
    expect(fenster(f, { von: 29000, bis: 30000, station: { art: 'ziel', schritt: 30000 } }, null).ende).toBe(30000);
  });
});

describe('Tipp-Geist', () => {
  it('beginnt am Anfang des Fensters und läuft im Gleichschritt mit dem eigenen Lauf', async () => {
    const f = (await fahrplan(level01, solution01, startLuaNode))!;
    const w = { start: 2000, ende: 2600 };
    const g = await TippGeist.create(level01, f, w, 50, startLuaNode);

    expect(g.schritte).toBe(2000);
    g.folgen(50); // own run has not moved yet
    expect(g.schritte).toBe(2000);
    g.folgen(150);
    expect(g.schritte).toBe(2100);
    const { session } = await lageNach(level01, solution01, 2100);
    const m = session.physics.marbles[session.physics.current];
    expect(g.sprite(1)).toMatchObject({ ghost: true, x: m.pos.x, y: m.pos.y });
  });

  it('hört am Ende des Fensters auf und verschwindet', async () => {
    const f = (await fahrplan(level01, solution01, startLuaNode))!;
    const g = await TippGeist.create(level01, f, { start: 0, ende: 300 }, 0, startLuaNode);

    g.folgen(1000);

    expect(g.schritte).toBe(300);
    expect(g.fertig).toBe(true);
    expect(g.sprite(1)).toBeNull();
  });
});
