import { describe, expect, it } from 'vitest';
import { startLuaNode } from '../lua/node';
import type { LevelFile } from './level';
import { GameSession, type StartLua } from './session';

const startLua: StartLua = (code, host, libs, oldApi) => startLuaNode(code, host, libs, oldApi);

/**
 * Oxyd-Puzzle (enigma_v/raoul05_2): a switch callback draws puzzle stones with Enigma's res.puzzle
 * (lib/libpuzzle): the stones of a drawMap join by their cluster, then the finalizer shuffles each
 * huddle with pull_rotate, intensity × stones times.
 */
const level = (intensity: string) =>
  ({
    id: 'test:libpuzzle',
    title: 'Puzzle',
    author: 'test',
    license: 'GPL',
    map: ['#########', '#.......#', '#.......#', '#.......#', '#......a#', '#a.....@#', '#########'],
    legend: { a: { stone: 'st_oxyd', symbol: 'A' } },
    objects: [],
    actors: [],
    lua: {
      code: [
        `ti["P"] = {"st_puzzle_yellow", cluster=1${intensity}}`,
        'wo(res.puzzle(ti, "P"), " ", {"    "})',
        'function draw()',
        '  wo:drawMap(res.puzzle(ti, "P"), po(2, 1), " ", {"PP ", "P  ", "PPP"})',
        '  wo["_n"] = #st(po(2, 1)):get_adjacents() .. "," .. #st(po(2, 1)):get_cluster()',
        'end',
        // Push? Pull? Rotate!: a stone's connections (n, e, s, w) and hollowness, set again rotated
        'function turn()',
        '  wo[po(5, 1)] = {"st_puzzle_yellow", connections = "sw", hollow = true}',
        '  wo["_c"] = st(po(2, 2)).connections .. "/" .. st(po(5, 1)).connections .. "/" .. tostring(st(po(5, 1)).hollow) .. "/" .. tostring(st(po(2, 2)).hollow)',
        'end',
      ].join('\n'),
      kinds: { st_puzzle_yellow: 'object' },
      named: [],
      libs: ['libpuzzle'],
    },
  }) as unknown as LevelFile;

const CELLS = ['2,1', '2,2', '2,3', '3,1', '3,3', '4,3'];
const puzzles = (s: GameSession) => s.objects.objects.filter((o) => o.cls === 'puzzle' && !o.gone);

describe('res.puzzle during play (lib/libpuzzle, Oxyd-Puzzle)', () => {
  it('joins the stones of the map by their cluster (intensity 0: no shuffle)', async () => {
    const s = await GameSession.create(level(', intensity=0'), { seed: 1, startLua });
    s.lua!.callback('draw', true, '');
    expect(s.lua!.lastError).toBe('');
    const conn = Object.fromEntries(puzzles(s).map((o) => [`${o.col},${o.row}`, o.attrs.$connections]));
    // W 1, S 2, E 4, N 8
    expect(conn).toEqual({ '2,1': '6', '3,1': '1', '2,2': '10', '2,3': '12', '3,3': '5', '4,3': '1' });
    expect(s.luaHost!.world('_n')).toBe('6,6');
    expect(s.objects.puzzleFragment(puzzles(s)[0]).complete).toBe(true);
    s.lua!.callback('turn', true, '');
    expect(s.lua!.lastError).toBe('');
    expect(s.luaHost!.world('_c')).toBe('ns/sw/true/false');
  });

  // (Lua's math.random is not tied to the session seed: each run shuffles differently)
  it('shuffles the huddle in place with pull_rotate (default intensity 3)', async () => {
    const layout = async () => {
      const s = await GameSession.create(level(''), { seed: 1, startLua });
      s.lua!.callback('draw', true, '');
      expect(s.lua!.lastError).toBe('');
      expect(puzzles(s).map((o) => `${o.col},${o.row}`).sort()).toEqual(CELLS);
      return puzzles(s).map((o) => `${o.col},${o.row}:${o.attrs.$connections}`).sort().join(' ');
    };
    const unshuffled = '2,1:6 2,2:10 2,3:12 3,1:1 3,3:5 4,3:1';
    const runs = await Promise.all([1, 2, 3, 4, 5].map(layout));
    expect(runs.some((l) => l !== unshuffled)).toBe(true);
  });

  it('the init may build its world with res.puzzle (the export holds those stones)', async () => {
    const s = await GameSession.create(level(''), { seed: 1, startLua });
    expect(s.lua!.lastError).toBe('');
    expect(puzzles(s)).toEqual([]);
  });
});
