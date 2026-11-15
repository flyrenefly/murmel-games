import { describe, expect, it } from 'vitest';
import shim from '../lua/enigma.lua?raw';
import packText from '../../public/levels/enigma/tutorial_basic.json?raw';
import { LuaLevel } from '../lua/runtime';
import { cellAt, type LevelFile, parseLevel } from './level';
import type { ActorDef } from './actors';
import { makeLuaHost } from './luahost';
import { ObjectWorld } from './objects';
import { PhysicsWorld } from './physics';

/** A plain imported level with the game's own Lua host and a level script of our own. */
async function withScript(code: string, kinds: Record<string, string> = {}, extra: Partial<LevelFile> = {}) {
  const file = { ...(JSON.parse(packText) as { levels: LevelFile[] }).levels[0], lua: { code, kinds, named: [] }, ...extra };
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

describe('slope floors during play (Tilt Board)', () => {
  it('pull like map slopes: direction of the shape × SlopeStrength, own strength, force_x/force_y', async () => {
    const { lua, level } = await withScript(`function f()
  wo[po(2, 2)] = {"fl_slope_ps"}
  wo[po(3, 2)] = {"fl_slope_ine", strength = 10}
  wo[po(4, 2)] = {"fl_slope_pw", force_x = 3, force_y = 4}
  wo[po(5, 2)] = {"fl_gray"}
end`, { fl_slope_ps: 'fl_slope', fl_slope_ine: 'fl_slope', fl_slope_pw: 'fl_slope', fl_gray: 'fl_gray' });
    level.cells[2 * level.width + 5].force = [0, 25];
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const at = (x: number) => level.cells[2 * level.width + x];
    expect(at(2).force).toEqual([0, 25]);
    expect(at(3).force).toEqual([7.071, -7.071]);
    expect(at(4).force).toEqual([3, 4]);
    expect(at(5).force).toBeUndefined();
  });

  it('use the world SlopeStrength of the level', async () => {
    const { lua, level } = await withScript('function f() wo["SlopeStrength"] = 40 wo[po(2, 2)] = {"fl_slope_pe"} end', { fl_slope_pe: 'fl_slope' });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    expect(level.cells[2 * level.width + 2].force).toEqual([40, 0]);
  });
});

describe('actors made during play (Out of Hand, Road to Eden)', () => {
  it('adds rotors, tops, killers at the exact position, "#" at the cell centre, plus offsets', async () => {
    const { lua, level, physics } = await withScript(`function f()
  wo[{10, 6}] = {"ac_rotor", 0, 0.5, range = 30}
  wo[po(8.7, 11.2)] = {"#ac_top", strength = 20, name = "top"}
  wo[po(3, 3)] = {"ac_killer", "scorpion#", adhesion = 0.5}
end`, { ac_rotor: 'actor', ac_top: 'actor', ac_killer: 'actor' });
    const before = physics.enemies.length;
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const added = physics.enemies.slice(before);
    expect(added.map((e) => [e.kind, e.pos.x, e.pos.y])).toEqual([['rotor', 10, 6.5], ['top', 8.5, 11.5], ['killer', 3, 3]]);
    expect([added[0].range, added[1].strength, added[2].mouseFactor]).toEqual([30, 20, 0.5]);
    // a:<n> addresses the new actor
    expect(level.actors.at(-2)?.a?.name).toBe('top');
    expect(level.actors.at(-1)?.a?.name).toMatch(/^scorpion#\d+$/);
  });

  it('refuses kinds the import did not allow and leaves actors outside the level out', async () => {
    const { lua, physics } = await withScript('function f() wo[po(2, 2)] = {"#ac_marble_black"} end function g() wo[po(-5, 2)] = {"ac_rotor"} end', { ac_rotor: 'actor' });
    const before = physics.enemies.length;
    lua.callback('f', true, '');
    expect(lua.lastError).toContain('Murmel kann ac_marble_black nicht setzen');
    lua.lastError = '';
    lua.callback('g', true, '');
    expect(lua.lastError).toBe('');
    expect(physics.enemies.length).toBe(before);
  });
});

describe('marbles addressed from Lua (The Pilgrim\'s Progress)', () => {
  it('a rubber band reaches the second white marble and a pearl, in the order the physics keeps them', async () => {
    const actors: ActorDef[] = [
      { k: 'ac_marble_white', x: 3.5, y: 3.5, a: { passive: 'true', name: 'Faithful' } },
      { k: 'ac_rotor', x: 6.5, y: 6.5 },
      { k: 'ac_marble_white', x: 4.5, y: 3.5, a: { passive: 'true', name: 'Hopeful' } },
      { k: 'ac_pearl_white', x: 5.5, y: 3.5, a: { name: 'kid' } },
    ];
    const { lua, physics } = await withScript(`function f()
  wo:add({"ot_rubberband", anchor1 = no["Hopeful"], anchor2 = no["kid"], length = 1, strength = 20})
end`, {}, { actors });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const band = physics.rubbers.at(-1)!;
    expect([band.a1, band.a2]).toEqual([physics.marbles[2], physics.marbles[3]]);
    expect([physics.marbles[2].pos.x, physics.marbles[3].pearl]).toEqual([4.5, true]);
  });
});

describe('actor adhesion from Lua (Tutoxyd\'s Pyramid)', () => {
  it('reads 1.0 for a marble, and a negative value turns the mouse force round', async () => {
    const code = 'function f() no["black"]["adhesion"] = -no["black"]["adhesion"] end';
    const { lua, physics } = await withScript(code, {}, { lua: { code, kinds: {}, named: [], marble: { name: 'black' } } });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    expect(physics.marbles[0].adhesion).toBe(-1);
  });
});

describe('rubber bands between other actors during play (4 - 8 - 4)', () => {
  it('ties two bugs together, and a marble to a rotor', async () => {
    const actors: ActorDef[] = [
      { k: 'ac_bug', x: 3.5, y: 3.5, a: { name: 'bugI' } },
      { k: 'ac_bug', x: 6.5, y: 3.5, a: { name: 'bugK' } },
      { k: 'ac_rotor', x: 8.5, y: 3.5, a: { name: 'rot' } },
    ];
    const { lua, physics } = await withScript(`function f()
  wo:add({"ot_rubberband", anchor1 = "bugI", anchor2 = "bugK", strength = 100, length = 1.5})
  wo:add({"ot_rubberband", anchor1 = no["black"], anchor2 = "rot"})
end`, {}, { actors, lua: { code: '', kinds: {}, named: [], marble: { name: 'black' } } });
    lua.callback('f', true, '');
    expect(lua.lastError).toBe('');
    const [b1, b2] = physics.rubbers.slice(-2);
    expect([b1.a1, b1.a2]).toEqual([physics.enemies[0], physics.enemies[1]]);
    expect([b2.a1, b2.a2]).toEqual([physics.marbles[0], physics.enemies[2]]);
  });
});
