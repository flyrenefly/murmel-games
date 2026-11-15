// The larger palette (15.11.2026): every new kind loads and runs in the game, sanitizeLevel keeps only
// allowed property values, slopes get their force from the kind, meditation levels start with a pearl.
import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import beispiel from '../../server/src/spielerlevel-beispiel.json';
import { probeLevel } from '../game/check';
import { parseLevel, type LevelFile } from '../game/level';
import { LuaLevel } from '../lua/runtime';
import type { StartLua } from '../game/session';
import { decodeLevel, encodeLevel, LinkError, sanitizeLevel } from './link';
import { cellOf, type EditorLevel, fromLevelFile, MAX_H, MAX_W, newLevel, paint, toLevelFile } from './model';
import { BY_KIND, GROUPS, PALETTE } from './palette';
import { check } from './rules';

const startLua: StartLua = async (code, host) => LuaLevel.create(code, host, shim, await import('fengari'));
const P = (k: string) => BY_KIND.get(k)!;
const errors = (l: EditorLevel) => check(l).filter((p) => p.level === 'fehler').map((p) => p.text);

/** A level with one of every stone, item, actor and floor of the palette (all in a 20 × 13 room each). */
function everything(): EditorLevel[] {
  const out: EditorLevel[] = [];
  let l = newLevel();
  let i = 0;
  for (const e of PALETTE) {
    if (e.layer === 'start' || e.layer === 'oxyd') continue;
    if (i === 40) {
      out.push(l);
      l = newLevel();
      i = 0;
    }
    const x = 2 + (i % 16);
    const y = [3, 5, 8][Math.floor(i / 16)]; // the marble starts at 10, 6
    paint(l, x, y, e);
    i++;
  }
  out.push(l);
  return out;
}

describe('erweiterte Palette', () => {
  it('ordnet jede Art einer bekannten Gruppe zu', () => {
    for (const e of PALETTE) expect((GROUPS as readonly string[]).includes(e.group), e.kind).toBe(true);
  });

  it('jede Art lädt im Spiel und läuft fünf Sekunden ohne Fehler', async () => {
    for (const [n, l] of everything().entries()) {
      l.title = `Alles ${n}`;
      const file = toLevelFile(l, `alles${n}`);
      expect(() => sanitizeLevel(JSON.parse(JSON.stringify(file)), `link:alles${n}`)).not.toThrow();
      const r = await probeLevel(file, startLua, 5);
      expect(r, JSON.stringify(r)).toMatchObject({ status: 'ok' });
    }
  });

  it('Rundreise Editor → Link → Editor behält Eigenschaften, Gefälle und Start-Perle', async () => {
    const l = newLevel();
    l.title = 'Rundreise';
    paint(l, 3, 3, P('st_laser_e'));
    cellOf(l, 3, 3)!.sa!.state = '1';
    paint(l, 5, 3, P('st_mirror_slab'));
    cellOf(l, 5, 3)!.sa = { orientation: '0', movable: 'true' };
    paint(l, 7, 3, P('st_passage_white'));
    cellOf(l, 7, 3)!.sa = { flavor: 'cross' };
    paint(l, 4, 6, P('fl_slope_ps'));
    paint(l, 6, 6, P('it_meditation_hollow'));
    paint(l, 9, 9, P('start_pearl_white'));
    expect(l.mainPearl).toBe('ac_pearl_white');
    const file = toLevelFile(l, 'rt');
    expect(Object.values(file.legend!).find((d) => d.floor === 'fl_slope_ps')?.force).toEqual([0, 25]);
    const back = await decodeLevel(await encodeLevel(file));
    expect(back.mainPearl).toEqual({ k: 'ac_pearl_white' });
    expect(back.objects).toEqual(file.objects);
    const ed = fromLevelFile(back);
    expect(ed.dropped).toEqual([]);
    expect(ed.level.mainPearl).toBe('ac_pearl_white');
    expect(cellOf(ed.level, 5, 3)!.sa).toEqual({ orientation: '0', movable: 'true' });
    expect(parseLevel(back).mainPearl).toEqual({ k: 'ac_pearl_white' });
  });
});

describe('sanitizeLevel mit neuen Arten', () => {
  const base = (): LevelFile => {
    const l = newLevel();
    l.title = 'Prüfung';
    return toLevelFile(l, 'x');
  };

  it('lässt nur erlaubte Werte der Eigenschaften durch', () => {
    const f = base();
    f.objects = [
      { x: 3, y: 3, k: 'st_laser_n', a: { state: '1', name: 'laser1' } },
      { x: 4, y: 3, k: 'st_laser_s', a: { state: '7' } },
      { x: 5, y: 3, k: 'st_mirror_triangle', a: { orientation: '2', transparent: 'true', movable: 'ja', strength: '99' } },
      { x: 6, y: 3, k: 'st_passage_black', a: { flavor: 'square', text: 'Hallo' } },
      { x: 7, y: 3, k: 'st_box_wood', a: { orientation: '1' } },
    ];
    const out = sanitizeLevel(f, 'link:x');
    expect(out.objects!.map((o) => o.a ?? {})).toEqual([{ state: '1', name: 'laser1' }, {}, { orientation: '2', transparent: 'true' }, { flavor: 'square' }, {}]);
  });

  it('berechnet die Kraft eines Gefälles aus der Art, nie aus der Datei', () => {
    const f = base();
    f.legend = { ...f.legend, s: { floor: 'fl_slope_inw', force: [500, 500] }, g: { floor: 'fl_gray', force: [9, 9] } };
    f.map = [...f.map];
    f.map[2] = f.map[2].slice(0, 5) + 'sg' + f.map[2].slice(7);
    const out = sanitizeLevel(f, 'link:x');
    expect(out.legend!.s.force).toEqual([-17.678, -17.678]);
    expect(out.legend!.g.force).toBeUndefined();
  });

  it('nimmt eine Start-Perle nur als weiße oder schwarze Perle an', () => {
    expect(sanitizeLevel({ ...base(), mainPearl: { k: 'ac_pearl_black' } }, 'link:x').mainPearl).toEqual({ k: 'ac_pearl_black' });
    expect(sanitizeLevel({ ...base(), mainPearl: { k: 'ac_pearl_white', a: { velocity_x: '50' } } }, 'link:x').mainPearl).toEqual({ k: 'ac_pearl_white' });
    expect(() => sanitizeLevel({ ...base(), mainPearl: { k: 'ac_rotor' } }, 'link:x')).toThrow(LinkError);
    expect(() => sanitizeLevel({ ...base(), mainPearl: 'ac_pearl_white' }, 'link:x')).toThrow(/Start-Perle/);
  });

  it(`erlaubt Karten bis ${MAX_W}×${MAX_H}, größere nicht`, () => {
    const map = (w: number, h: number) => Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? '#'.repeat(w) : y === 1 ? `#AA${'.'.repeat(w - 4)}#` : `#${'.'.repeat(w - 2)}#`));
    const f = (w: number, h: number) => ({ ...base(), map: map(w, h), legend: { '#': { floor: 'fl_gray', stone: 'st_granite' }, '.': { floor: 'fl_gray' } }, start: { x: 2.5, y: 2.5 }, objects: [] });
    expect(sanitizeLevel(f(100, 64), 'link:x').map).toHaveLength(64);
    expect(() => sanitizeLevel(f(101, 64), 'link:x')).toThrow(/100×64/);
    expect(() => sanitizeLevel(f(100, 65), 'link:x')).toThrow(/100×64/);
  });

  it('bestehende Spieler-Levels bleiben gültig und unverändert', () => {
    const level = (beispiel as { level: LevelFile }).level ?? (beispiel as unknown as LevelFile);
    const out = sanitizeLevel(JSON.parse(JSON.stringify(level)), 'link:alt');
    expect(out.map).toEqual(level.map);
    expect(out.objects ?? []).toEqual(level.objects ?? []);
    expect(out.mainPearl).toBeUndefined();
  });
});

describe('Prüfregeln für Meditation', () => {
  const meditation = () => {
    const l = newLevel();
    l.title = 'Ruhe';
    for (let y = 0; y < l.height; y++) for (let x = 0; x < l.width; x++) if (cellOf(l, x, y)!.s === 'st_oxyd') delete cellOf(l, x, y)!.s;
    for (const c of l.cells) if (!c.s) delete c.sa;
    paint(l, 4, 4, P('start_pearl_white'));
    paint(l, 10, 6, P('it_meditation_hollow'));
    return l;
  };

  it('eine Perle und eine Mulde brauchen keine Oxyd-Steine', () => {
    expect(errors(meditation())).toEqual([]);
  });

  it('meldet zu wenige Mulden und Levels ohne Ziel', () => {
    const l = meditation();
    paint(l, 12, 8, P('ac_pearl_black'));
    expect(errors(l).join(' ')).toMatch(/Für jede Perle braucht es eine Mulde/);
    const leer = meditation();
    delete cellOf(leer, 10, 6)!.i;
    expect(errors(leer).join(' ')).toMatch(/zwei Oxyd-Steine oder für jede Perle eine Mulde/);
  });

  it('eine Meditation lädt im Spiel mit der Perle als Hauptkugel', async () => {
    const file = toLevelFile(meditation(), 'ruhe');
    const r = await probeLevel(file, startLua, 2);
    expect(r.status).toBe('ok');
  });
});
