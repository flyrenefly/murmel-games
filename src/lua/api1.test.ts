import { describe, expect, it } from 'vitest';
import api1 from './api1.lua?raw';
import shim from './enigma.lua?raw';
import { api1Source, type LuaHost, LuaLevel } from './runtime';

const startLua = async (code: string, host: LuaHost) => LuaLevel.create(code, host, shim, await import('fengari'), [], api1);

/** A tiny exported world: objects with ref, layer, position and string attributes (kind among them). */
function fakeHost(objs: { ref: string; l: 'st' | 'it' | 'fl'; x: number; y: number; a: Record<string, string> }[]) {
  const sent: string[] = [];
  const tiles: string[] = [];
  const world: Record<string, string> = {};
  const host: LuaHost = {
    find: (p) => objs.filter((o) => o.a.name === p).map((o) => o.ref),
    at: (l, x, y) => objs.find((o) => o.l === l && o.x === x && o.y === y)?.ref ?? (l === 'fl' ? `fl:${x}:${y}` : null),
    exists: (r) => objs.some((o) => o.ref === r),
    pos: (r) => {
      const o = objs.find((x) => x.ref === r)!;
      return [o.x, o.y];
    },
    get: (r, k) => objs.find((o) => o.ref === r)?.a[k] ?? null,
    set: (r, k, v) => {
      const o = objs.find((x) => x.ref === r)!;
      if (v === null) delete o.a[k];
      else o.a[k] = v;
    },
    send: (r, m, v) => void sent.push(`${r} ${m} ${v}`),
    kill: (r) => void sent.push(`${r} kill`),
    setTile: (x, y, k, a) => {
      tiles.push(`${x},${y} ${k} ${JSON.stringify(a)}`);
      // the new object is now in the world
      const l = k.slice(0, 2) as 'st' | 'it' | 'fl';
      objs.push({ ref: `new${tiles.length}`, l, x, y, a: { ...a, kind: k } });
    },
    world: (k) => world[k] ?? null,
    setWorld: (k, v) => {
      if (v === null) delete world[k];
      else world[k] = v;
    },
    size: () => [20, 13],
  };
  return { host, sent, tiles, world };
}

describe('Lua API 1 (old levels)', () => {
  it('builds nothing in the init, but keeps the exported objects the level stores', async () => {
    const w = fakeHost([
      { ref: 'door', l: 'st', x: 5, y: 3, a: { kind: 'st_door_d', name: 'door1' } },
      { ref: 'sw', l: 'st', x: 2, y: 2, a: { kind: 'st_switch' } },
    ]);
    const lua = await startLua(
      `
create_world(20, 13)
fill_floor("fl-normal", 0, 0, 20, 13)
draw_border("st-rock1")
door = doorh(5, 3, {name = "door1"})
switch(2, 2, "", "callback")
oxyd(1, 1)
oxyd_shuffle()
enigma.ConserveLevel = FALSE
function opendoor(on)
  if strlen("ab") == 2 and getn({1, 2}) == 2 and enigma.GetKind(door) == "st-door" then
    SendMessage(door, "open")
    SendMessage("door1", "close")
    enigma.SendMessage(enigma.GetNamedObject("door1"), "toggle")
  end
end`,
      w.host,
    );
    expect(lua.lastError).toBe('');
    expect(w.tiles).toEqual([]);
    expect(w.world.ConserveLevel).toBe('false');
    lua.callback('opendoor', true, 'sw');
    expect(lua.lastError).toBe('');
    expect(w.sent).toEqual(['door open null', 'door close null', 'door toggle null']);
  });

  it('places objects during play with their new kind and attributes', async () => {
    const w = fakeHost([{ ref: 'sw', l: 'st', x: 2, y: 2, a: { kind: 'st_switch' } }]);
    const lua = await startLua(
      `
function build()
  set_stone("st-wood", 3, 4)
  local d = set_stone("st-door", 6, 1, {type = "v", name = "gate"})
  set_item("it-key_b", 7, 7)
  set_floor("fl-gradient", 8, 8, {type = SLOPE_N})
  set_stone("st-switch", 9, 9, {on = TRUE})
  if enigma.GetKind(d) ~= "st-door" then error("kind " .. tostring(enigma.GetKind(d))) end
  if enigma.GetKind(enigma.GetStone(3, 4)) ~= "st-wood" then error("wood") end
  if enigma.GetStone(0, 0) ~= nil then error("nil stone") end
end`,
      w.host,
    );
    lua.callback('build', true, 'sw');
    expect(lua.lastError).toBe('');
    expect(w.tiles).toEqual([
      '3,4 st_box_wood {}',
      '6,1 st_door_d {"name":"gate","faces":"ew"}',
      '7,7 it_key {"code":"2"}',
      '8,8 fl_slope_pn {}',
      '9,9 st_switch {"instant":"true","state":"1"}',
    ]);
  });

  it('gives a wormhole made during play its destination from targetx/targety (Lost in Time and Space)', async () => {
    const w = fakeHost([{ ref: 'sw', l: 'st', x: 2, y: 2, a: { kind: 'st_switch' } }]);
    const lua = await startLua(
      `
function build()
  set_item("it-wormhole", 13, 9, {targetx = 17.5, targety = "9.5"})
end`,
      w.host,
    );
    lua.callback('build', true, 'sw');
    expect(lua.lastError).toBe('');
    expect(w.tiles).toHaveLength(1);
    expect(w.tiles[0]).toMatch(/^13,9 it_wormhole(_on)? /);
    expect(JSON.parse(w.tiles[0].replace(/^\S+ \S+ /, ''))).toMatchObject({ dest: '17.5,9.5' });
  });

  it('reads Lua 5.0 code: arg in vararg functions, unknown string escapes', async () => {
    expect(api1Source('function f(a, ...)\n  return getn(arg)\nend')).toBe('function f(a, ...) local arg = {n = select("#", ...), ...};\n  return getn(arg)\nend');
    expect(api1Source('s = "\\(x\\)\\n\\\\("')).toBe('s = "(x)\\n\\\\("');
    const w = fakeHost([{ ref: 'sw', l: 'st', x: 2, y: 2, a: { kind: 'st_switch', name: 's' } }]);
    const lua = await startLua(
      `
function count(...) return getn(arg) end
pattern = "\\(%d\\)"
function f()
  if count(1, 2, 3) == 3 and pattern == "(%d)" then SendMessage("s", "on") end
end`,
      w.host,
    );
    expect(lua.lastError).toBe('');
    lua.callback('f', true, 'sw');
    expect(w.sent).toEqual(['sw on null']);
  });

  it('stops an init that never ends on the exported world', async () => {
    const w = fakeHost([]);
    const before = LuaLevel.INIT_STEPS;
    LuaLevel.INIT_STEPS = 100_000;
    try {
      const lua = await startLua('repeat x = random(1, 3) until enigma.GetItem(x, 1) ~= nil\nfunction f() end', w.host);
      expect(lua.lastError).toContain('endlos');
    } finally {
      LuaLevel.INIT_STEPS = before;
    }
  });
});
