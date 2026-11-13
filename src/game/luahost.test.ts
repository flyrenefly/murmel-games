import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import packText from '../../public/levels/enigma/tutorial_basic.json?raw';
import { LuaLevel } from '../lua/runtime';
import { cellAt, type LevelFile, parseLevel } from './level';
import { makeLuaHost } from './luahost';
import { ObjectWorld } from './objects';
import { PhysicsWorld } from './physics';

/** A plain imported level with the game's own Lua host and a level script of our own. */
async function withScript(code: string) {
  const file = { ...(JSON.parse(packText) as { levels: LevelFile[] }).levels[0], lua: { code, kinds: {}, named: [] } };
  const level = parseLevel(file, () => 0.3);
  const objects = new ObjectWorld(level.objects, level.width, level.texts, {
    stoneAt: (c, r) => (cellAt(level, c, r)?.stone ?? 'x') !== null,
    floorAt: (c, r) => cellAt(level, c, r)?.floor ?? 'fl_abyss',
    setFloor: () => {},
    staticStone: (c, r) => cellAt(level, c, r)?.stone ?? null,
  });
  const physics = new PhysicsWorld(level, objects);
  const host = makeLuaHost({ level, objects, physics, redraw: () => {}, random: () => 0.5 }, { ...level.world }, { x: 0, y: 0 });
  const lua = await LuaLevel.create(code, host, shim, await import('fengari'));
  return { objects, lua };
}

describe('wo:add of gadgets during play', () => {
  it('makes timers (ON unless state is OFF) and counters without a cell', async () => {
    const { objects, lua } = await withScript(`function f()
  wo:add({"ot_timer", "t#", interval = 0.5, loop = false, target = "laser#*"})
  wo:add({"ot_timer", "off", state = OFF})
  wo:add({"ot_counter", "c", state = 2, target = "door"})
end`);
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const made = objects.objects.filter((o) => o.kind.startsWith('ot_'));
    expect(made.map((o) => [o.kind, o.name.replace(/\d+$/, ''), o.state, o.col])).toEqual([
      ['ot_timer', 't#', 1, -1],
      ['ot_timer', 'off', 0, -1],
      ['ot_counter', 'c', 2, -1],
    ]);
    expect(made[0].attrs).toMatchObject({ interval: '0.5', loop: 'false', target: 'laser#*' });
  });

  it('refuses other objects', async () => {
    const { lua } = await withScript('function f() wo:add({"ot_wire", anchor1 = "a", anchor2 = "b"}) end');
    lua.callback('f', true, '');
    expect(lua.lastError).toMatch(/wo:add/);
  });
});
