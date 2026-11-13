import { describe, expect, it } from 'vitest';
import { cellAt, LevelError, parseLevel, type LevelFile } from './level';
import { LEVELS } from '../levels';

const base = (map: string[]): LevelFile => ({ id: 't', title: 'T', author: 'x', license: 'GPL', map });

describe('parseLevel', () => {
  it('reads walls, floor, abyss, start and signal stones', () => {
    const l = parseLevel(base(['#####', '#@.A#', '#oA.#', '#####']));
    expect(l.width).toBe(5);
    expect(l.height).toBe(4);
    expect(l.start).toEqual({ x: 1.5, y: 1.5 });
    expect(cellAt(l, 1, 2)?.floor).toBe('fl_abyss');
    expect(cellAt(l, 0, 0)?.stone).toBe('st_greenbrown');
    expect(l.signals.map((s) => [s.col, s.row, s.symbol])).toEqual([
      [3, 1, 'A'],
      [2, 2, 'A'],
    ]);
    expect(cellAt(l, 9, 9)).toBeNull();
  });

  it('rejects a symbol that does not occur in pairs', () => {
    expect(() => parseLevel(base(['#####', '#@AA#', '#A..#', '#####']))).toThrow(LevelError);
  });

  it('rejects missing start and unknown characters', () => {
    expect(() => parseLevel(base(['####', '#AA#', '####']))).toThrow(/Startpunkt/);
    expect(() => parseLevel(base(['####', '#@?#', '#AA#', '####']))).toThrow(/unbekanntes Zeichen/);
  });

  it('gives "?" Oxyd stones random colours in pairs, avoiding fixed colours', () => {
    const file: LevelFile = {
      ...base(['#######', '#@QQQQ#', '#.AA..#', '#######']),
      legend: { Q: { floor: 'fl_samba', stone: 'st_oxyd', symbol: '?', flavor: 'b' } },
    };
    for (const seed of [0.1, 0.5, 0.9]) {
      const l = parseLevel(file, () => seed);
      const auto = l.signals.filter((s) => s.flavor === 'b').map((s) => s.symbol);
      expect(auto).toHaveLength(4);
      expect(auto).not.toContain('A');
      const counts = new Map<string, number>();
      for (const s of auto) counts.set(s, (counts.get(s) ?? 0) + 1);
      expect([...counts.values()].every((n) => n === 2)).toBe(true);
      expect(cellAt(l, 2, 1)?.floor).toBe('fl_samba');
    }
  });

  it('an odd number of "?" Oxyd stones leaves one fake stone', () => {
    const file: LevelFile = { ...base(['#####', '#@QQQ', '#####']), legend: { Q: { stone: 'st_oxyd', symbol: '?' } } };
    const syms = parseLevel(file).signals.map((x) => x.symbol).sort();
    expect(syms.filter((x) => x === '-').length).toBe(1);
    expect(syms.filter((x) => x !== '-')[0]).toBe(syms.filter((x) => x !== '-')[1]);
  });

  it('"?" stones first complete a fixed colour that has no partner', () => {
    const file: LevelFile = { ...base(['#####', '#@AQQ', '#####']), legend: { A: { stone: 'st_oxyd', symbol: 'A' }, Q: { stone: 'st_oxyd', symbol: '?' } } };
    expect(parseLevel(file).signals.map((x) => x.symbol).sort()).toEqual(['-', 'A', 'A']);
  });

  it('uses an exact start position when given', () => {
    const l = parseLevel({ ...base(['#####', '#..A#', '#A..#', '#####']), start: { x: 2.25, y: 1.75 } });
    expect(l.start).toEqual({ x: 2.25, y: 1.75 });
  });

  it('all shipped levels are valid', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
    for (const f of LEVELS) expect(() => parseLevel(f)).not.toThrow();
  });
});

describe('meditation levels with a main pearl', () => {
  it('a level without Oxyd stones loads when its main pearl and hollows make it a meditation', () => {
    const file: LevelFile = { id: 't', title: 'T', author: 'x', license: 'GPL', map: ['####', '#@.#', '####'], mainPearl: { k: 'ac_pearl_white' }, objects: [{ x: 2, y: 1, k: 'it_meditation_hollow' }] };
    expect(() => parseLevel(file)).not.toThrow();
  });
});
