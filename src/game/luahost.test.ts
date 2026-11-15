import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import packText from '../../public/levels/enigma/tutorial_basic.json?raw';
import { LuaLevel } from '../lua/runtime';
import { cellAt, type LevelFile, parseLevel } from './level';
import { makeLuaHost } from './luahost';
import { ObjectWorld } from './objects';
import { PhysicsWorld } from './physics';

/** A plain imported level with the game's own Lua host and a level script of our own. */
async function withScript(code: string, kinds: Record<string, string> = {}) {
  const file = { ...(JSON.parse(packText) as { levels: LevelFile[] }).levels[0], lua: { code, kinds, named: [] } };
  const level = parseLevel(file, () => 0.3);
  const objects = new ObjectWorld(level.objects, level.width, level.texts, {
    stoneAt: (c, r) => (cellAt(level, c, r)?.stone ?? 'x') !== null,
    floorAt: (c, r) => cellAt(level, c, r)?.floor ?? 'fl_abyss',
    setFloor: () => {},
    staticStone: (c, r) => cellAt(level, c, r)?.stone ?? null,
  });
  const physics = new PhysicsWorld(level, objects);
  const oxyds: string[] = [];
  const addOxyd = (x: number, y: number, flavor: string) => void oxyds.push(`${x},${y},${flavor}`);
  const host = makeLuaHost({ level, objects, physics, redraw: () => {}, random: () => 0.5, addOxyd }, { ...level.world }, { x: 0, y: 0 });
  const lua = await LuaLevel.create(code, host, shim, await import('fengari'));
  return { objects, lua, oxyds, physics, level };
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
    const { lua } = await withScript('function f() wo:add({"ot_cannon"}) end');
    lua.callback('f', true, '');
    expect(lua.lastError).toMatch(/wo:add/);
  });
});

describe('Oxyd stones made during play', () => {
  it('get the flavor of their kind (st_oxyd_d), plain st_oxyd flavor a', async () => {
    const { lua, oxyds } = await withScript('function f() wo[po(2, 2)] = {"st_oxyd_d"} wo[po(3, 2)] = {"st_oxyd"} end', { st_oxyd_d: 'oxyd', st_oxyd: 'oxyd' });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    expect(oxyds).toEqual(['2,2,d', '3,2,a']);
  });
});

describe('hollow stones made during play', () => {
  it('look like their stone, let actors pass and become solid again when replaced', async () => {
    const { lua, physics, level } = await withScript(
      'function f() wo[po(2, 2)] = {"st_lightglass_hollow"} end function g() wo[po(2, 2)] = {"st_lightglass"} end',
      { st_lightglass_hollow: 'st_lightglass', st_lightglass: 'st_lightglass' },
    );
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    expect([cellAt(level, 2, 2)?.stone, cellAt(level, 2, 2)?.hollow, physics['solidAt'](2, 2)]).toEqual(['st_lightglass', true, -1]);
    lua.callback('g', true, '');
    expect([cellAt(level, 2, 2)?.stone, cellAt(level, 2, 2)?.hollow, physics['solidAt'](2, 2)]).toEqual(['st_lightglass', undefined, -2]);
  });
});

describe('ot_wire during play', () => {
  it('makes both stones fellows; a named wire can be found and killed', async () => {
    const { lua, objects } = await withScript(`function f()
  wo[po(2, 2)] = {"st_box", "b1"}
  wo[po(4, 2)] = {"st_box", "b2"}
  wo:add({"ot_wire", "wire1_2", anchor1 = "b1", anchor2 = no["b2"]})
  wo:add({"ot_wire", anchor1 = "b1", anchor2 = "b2"})
end
function g()
  if -no["wire1_2"] then no["wire1_2"]:kill() end
end`, { st_box: 'object' });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const [b1, b2] = ['b1', 'b2'].map((n) => objects.objects.find((o) => o.name === n)!);
    expect(b1.attrs.fellows).toBe(`#${b2.id}`);
    expect(b2.attrs.fellows).toBe(`#${b1.id}`);
    expect(objects.resolve(`#${b2.id}`)).toEqual([b2]);
    expect(objects.wireLines()).toEqual([2.5, 2.5, 4.5, 2.5]);
    lua.callback('g', true, '');
    expect(lua.lastError).toBe('');
    expect(b1.attrs.fellows).toBe('');
    expect(objects.wireLines()).toEqual([]);
  });

  it('refuses plain stones as anchors', async () => {
    const { lua } = await withScript('function f() wo:add({"ot_wire", anchor1 = "nix", anchor2 = "auch_nix"}) end');
    lua.callback('f', true, '');
    expect(lua.lastError).toMatch(/Draht/);
  });
});

describe('wo["SlopeStrength"] during play', () => {
  it('scales the force of slope floors from the old strength (default 25) to the new one', async () => {
    const { lua, level } = await withScript('function f() wo["SlopeStrength"] = 10 end');
    const slope = level.cells[2 * level.width + 2];
    slope.floor = 'fl_slope';
    slope.force = [0, 25];
    const other = level.cells[2 * level.width + 3];
    other.force = [5, 0]; // a force floor that is no slope stays
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    expect(slope.force).toEqual([0, 10]);
    expect(other.force).toEqual([5, 0]);
  });
});

describe('fl_bridge during play (Bizarro World)', () => {
  it('makes the bridge floor with its state object; another floor removes both', async () => {
    const { lua, level, objects } = await withScript(`function f()
  wo[po(3, 3)] = {"fl_bridge_bw", "trap", state = CLOSED}
end
function g()
  if no["trap"]:is("fl_bridge") then wo[no["trap"]] = {"fl_fake_abyss", "trap"} end
end`, { fl_bridge_bw: 'object', fl_fake_abyss: 'fl_fake_abyss' });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const cell = level.cells[3 * level.width + 3];
    expect(cell.floor).toBe('fl_bridge_bw_closed');
    const bridge = objects.objects.find((o) => o.kind === 'fl_bridge' && !o.gone)!;
    expect([bridge.name, bridge.attrs.flavor, bridge.state]).toEqual(['trap', 'bw', 0]);
    lua.callback('g', true, '');
    expect(lua.lastError).toBe('');
    expect(cell.floor).toBe('fl_fake_abyss');
    expect(bridge.gone).toBe(true);
  });
});

describe('wo:add(YIN, {"it_document", text = …}) during play', () => {
  it('shows the text at once (Murmel reads documents when picked up) instead of carrying it', async () => {
    const { lua, objects } = await withScript('function f() wo:add(YIN, {"it_document", text = "failed"}) end');
    const before = objects.inventories[0].length;
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    expect(objects.inventories[0].length).toBe(before);
    expect(objects.events).toContainEqual({ type: 'text', text: 'failed' });
  });
});
