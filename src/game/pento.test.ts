import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import libpento from '../lua/lib/libpento.lua?raw';
import packText from '../../public/levels/enigma/pentomino_i.json?raw';
import { LuaLevel } from '../lua/runtime';
import { addSignal, cellAt, colorNewSignals, type LevelFile, parseLevel } from './level';
import { makeLuaHost } from './luahost';
import { ObjectWorld } from './objects';
import { PhysicsWorld } from './physics';

/** An imported Pentomino level (public/levels/enigma/pentomino_i.json) with the game's own host. */
async function pentomino(i = 0) {
  const pack = JSON.parse(packText) as { levels: LevelFile[] };
  const file = pack.levels[i];
  const level = parseLevel(file, () => 0.3);
  const objects = new ObjectWorld(level.objects, level.width, level.texts, {
    stoneAt: (c, r) => (cellAt(level, c, r)?.stone ?? 'x') !== null,
    floorAt: (c, r) => cellAt(level, c, r)?.floor ?? 'fl_abyss',
    setFloor: () => {},
    staticStone: (c, r) => cellAt(level, c, r)?.stone ?? null,
  });
  const physics = new PhysicsWorld(level, objects);
  let shuffles = 0;
  const host = makeLuaHost(
    {
      level,
      objects,
      physics,
      redraw: () => {},
      random: Math.random,
      addOxyd: (x, y, flavor) => {
        const s = addSignal(level, x, y, flavor);
        if (s) physics.addSignal(x, y, s.index);
      },
      shuffleOxyd: () => {
        shuffles++;
        colorNewSignals(level, Math.random);
      },
    },
    { ...level.world },
    { x: 0, y: 0 },
  );
  const lua = await LuaLevel.create(file.lua!.code, host, shim, await import('fengari'), [libpento]);
  const puzzles = () => objects.objects.filter((o) => !o.gone && o.cls === 'puzzle').sort((a, b) => a.row - b.row || a.col - b.col);
  return { file, level, objects, host, lua, puzzles, shuffles: () => shuffles };
}

describe('Pentomino levels in the game', () => {
  it('are imported with libpento, no Oxyd stones yet and Lua for them', async () => {
    const { file, level, lua } = await pentomino();
    expect(file.lua?.libs).toEqual(['libpento']);
    expect(file.lua?.kinds.st_oxyd).toBe('oxyd');
    expect(file.lua?.kinds.st_puzzle).toBe('object');
    expect(level.signals).toHaveLength(0);
    expect(lua.lastError).toBe('');
  });

  it('pento.next places a connected, complete puzzle cluster (Stone::autoJoinCluster)', async () => {
    const { objects, lua, puzzles } = await pentomino();
    lua.callback('pento.next', true, '');
    expect(lua.lastError).toBe('');
    const p = puzzles();
    expect(p).toHaveLength(5);
    // "OOOOO": west end east only, middle stones both ways, east end west only (W 1, E 4)
    expect(p.map((o) => o.attrs.$connections)).toEqual(['4', '5', '5', '5', '1']);
    const frag = objects.puzzleFragment(p[2]);
    expect(frag.complete).toBe(true);
    expect(frag.cluster).toHaveLength(5);
    // rotating replaces the cluster
    lua.callback('pento.rotate', 2, '');
    expect(lua.lastError).toBe('');
    expect(puzzles().map((o) => o.attrs.$connections)).toEqual(['2', '10', '10', '10', '8']);
  });

  it('check makes twelve Oxyd stones in pairs once the target area is full, and stops its timer', async () => {
    const { level, objects, host, lua, shuffles } = await pentomino();
    const timer = objects.objects.find((o) => o.kind === 'ot_timer')!;
    expect(timer.state).toBe(1);
    lua.callback('check', true, `o:${timer.id}`);
    expect(level.signals).toHaveLength(0);
    const targets = host.find('target#*');
    expect(targets).toHaveLength(60);
    for (const r of targets) {
      const [x, y] = host.pos(r);
      host.setTile(x, y, 'st_puzzle', { cluster: '%9' });
    }
    lua.callback('check', true, `o:${timer.id}`);
    expect(lua.lastError).toBe('');
    expect(level.signals).toHaveLength(12);
    expect(shuffles()).toBe(1);
    const counts = new Map<string, number>();
    for (const s of level.signals) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(counts.size).toBe(6);
    expect(level.signals.every((s) => cellAt(level, s.col, s.row)?.stone === 'st_oxyd')).toBe(true);
    expect(timer.state).toBe(0);
  });
});
