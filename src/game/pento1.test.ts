import { describe, expect, it } from 'vitest';
import packText from '../../public/levels/enigma/enigma_ii.json?raw';
import api1 from '../lua/api1.lua?raw';
import shim from '../lua/enigma.lua?raw';
import { LuaLevel } from '../lua/runtime';
import { addSignal, cellAt, colorNewSignals, type LevelFile, parseLevel } from './level';
import { makeLuaHost } from './luahost';
import { ObjectWorld } from './objects';
import { PhysicsWorld } from './physics';

/**
 * Pentomino I (enigma_ii/ralf16, lib/ralf_pento, Lua API 1) with the game's own host: the boxes
 * the player pushes into a shape are placed here directly, the level's timer callback is called.
 */
async function pentominoI() {
  const pack = JSON.parse(packText) as { levels: LevelFile[] };
  const file = pack.levels.find((l) => l.id === 'enigma:ralf_pento1')!;
  const level = parseLevel(file, () => 0.3);
  const objects = new ObjectWorld(level.objects, level.width, level.texts, {
    stoneAt: (c, r) => (cellAt(level, c, r)?.stone ?? 'x') !== null,
    floorAt: (c, r) => cellAt(level, c, r)?.floor ?? 'fl_abyss',
    setFloor: () => {},
    staticStone: (c, r) => cellAt(level, c, r)?.stone ?? null,
  });
  const physics = new PhysicsWorld(level, objects);
  const world: Record<string, string> = { ...level.world };
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
    world,
    { x: 0, y: 0 },
  );
  // a helper that reports the library's area (index → cell) through world attributes
  const probe = `
function __probe()
  for i = 0, 24 do wo["area" .. i] = area[i].x .. "," .. area[i].y end
  wo["state"] = pento_state
  wo["got"] = got
end`;
  const lua = await LuaLevel.create(`${file.lua!.code}\n${probe}`, host, shim, await import('fengari'), [], api1);
  const probeArea = (): [number, number][] => {
    lua.callback('__probe', true, '');
    return Array.from({ length: 25 }, (_, i) => world[`area${i}`].split(',').map(Number) as [number, number]);
  };
  const timer = objects.objects.find((o) => o.kind === 'st_timer')!;
  const tick = () => lua.callback('tick1', true, `o:${timer.id}`);
  const stones = (cells: [number, number][]) => cells.filter(([x, y]) => objects.stoneObjectAt(x, y) || cellAt(level, x, y)?.stone);
  return { level, objects, world, lua, tick, probeArea, stones, shuffles: () => shuffles };
}

/** The 25 cells of a state id (ralf_pento weight: bit i = area index i). */
const cellsOf = (id: number, area: [number, number][]) => area.filter((_, i) => (id >> i) & 1);

describe('Pentomino I (Lua API 1, lib/ralf_pento)', () => {
  it('is imported and starts without Lua errors', async () => {
    const { lua, level } = await pentominoI();
    expect(lua.lastError).toBe('');
    expect(level.signals).toHaveLength(0);
  });

  it('plays through all twelve shapes until the Oxyd stones appear', async () => {
    const { level, objects, world, lua, tick, probeArea, stones, shuffles } = await pentominoI();
    const area = probeArea();
    expect(new Set(area.map((p) => p.join(','))).size).toBe(25);
    // picking up the document starts the game: five boxes grow in the area
    tick();
    lua.callback('__probe', true, '');
    expect(world.state).toBe('0'); // waiting for the document
    const doc = objects.objects.find((o) => o.name === 'doc')!;
    objects.marbleAt(3, 6);
    objects.marbleAt(doc.col, doc.row); // the marble rolls over it
    expect(doc.gone && doc.picked).toBe(true);
    tick();
    expect(lua.lastError).toBe('');
    const boxes = () => objects.objects.filter((o) => !o.gone && o.cls === 'box');
    expect(boxes().map((b) => b.name).sort()).toEqual(['box1', 'box2', 'box3', 'box4', 'box5']);
    const ids = [31, 47, 79, 103, 110, 167, 1063, 1126, 1249, 1250, 1252, 2274];
    for (const [n, id] of ids.entries()) {
      // the player pushes the boxes into the shape
      for (const b of boxes()) objects.remove(b);
      const shape = cellsOf(id, area);
      expect(shape).toHaveLength(5);
      for (const [x, y] of shape) objects.create('st_box_wood', x, y, {});
      // recognised: shown in the glass area, a fake Oxyd stone, then the boxes fall and new ones grow
      for (let k = 0; k < 12 && lua.lastError === ''; k++) {
        tick();
        lua.callback('__probe', true, '');
        if (world.state === '1' && Number(world.got) === n + 1) break;
      }
      expect(lua.lastError).toBe('');
      expect(Number(world.got)).toBe(n + 1);
      if (n < 11) expect(stones(area)).toHaveLength(5); // the five new boxes
    }
    // all twelve: real Oxyd stones in pairs
    expect(level.signals).toHaveLength(12);
    expect(shuffles()).toBeGreaterThan(0);
    const counts = new Map<string, number>();
    for (const s of level.signals) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
    expect([...counts.values()].every((c) => c === 2)).toBe(true);
  });
});
