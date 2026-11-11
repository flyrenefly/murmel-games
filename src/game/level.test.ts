import { describe, expect, it } from 'vitest';
import { cellAt, LevelError, parseLevel, type LevelFile } from './level';
import { LEVELS } from '../levels';

const base = (map: string[]): LevelFile => ({ id: 't', title: 'T', author: 'x', license: 'GPL', map });

describe('parseLevel', () => {
  it('reads walls, floor, abyss, start and signal stones', () => {
    const l = parseLevel(base(['#####', '#@.A#', '#oA.#', '#####']));
    expect(l.width).toBe(5);
    expect(l.height).toBe(4);
    expect(l.start).toEqual({ col: 1, row: 1 });
    expect(cellAt(l, 1, 2)?.floor).toBe('abyss');
    expect(cellAt(l, 0, 0)?.stone).toBe('wall');
    expect(l.signals.map((s) => [s.col, s.row, s.symbol])).toEqual([
      [3, 1, 'A'],
      [2, 2, 'A'],
    ]);
    expect(cellAt(l, 9, 9)).toBeNull();
  });

  it('rejects a symbol that does not occur exactly twice', () => {
    expect(() => parseLevel(base(['#####', '#@AA#', '#A..#', '#####']))).toThrow(LevelError);
  });

  it('rejects missing start and unknown characters', () => {
    expect(() => parseLevel(base(['####', '#AA#', '####']))).toThrow(/Startpunkt/);
    expect(() => parseLevel(base(['####', '#@?#', '#AA#', '####']))).toThrow(/unbekanntes Zeichen/);
  });

  it('all shipped levels are valid', () => {
    expect(LEVELS.length).toBeGreaterThan(0);
    for (const f of LEVELS) expect(() => parseLevel(f)).not.toThrow();
  });
});
