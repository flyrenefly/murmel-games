import { describe, expect, it } from 'vitest';
import shim from './enigma.lua?raw';
import { type LuaHost, LuaLevel } from './runtime';

const startLua = async (code: string, host: LuaHost) => LuaLevel.create(code, host, shim, await import('fengari'));

/** A tiny world: named objects with layer, position and string attributes. */
function fakeHost(objs: { ref: string; l: 'st' | 'it' | 'fl' | 'ac'; x: number; y: number; a: Record<string, string> }[]) {
  const sent: string[] = [];
  const tiles: string[] = [];
  const world: Record<string, string> = {};
  const host: LuaHost = {
    find: (p) => {
      const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      return objs.filter((o) => o.a.name && re.test(o.a.name)).map((o) => o.ref);
    },
    at: (l, x, y) => objs.find((o) => o.l === l && o.x === x && o.y === y)?.ref ?? null,
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
    setTile: (x, y, k, a) => void tiles.push(`${x},${y} ${k} ${JSON.stringify(a)}`),
    world: (k) => world[k] ?? null,
    setWorld: (k, v) => {
      if (v === null) delete world[k];
      else world[k] = v;
    },
    size: () => [20, 13],
  };
  return { host, sent, tiles, force: () => world.GlobalForce };
}

describe('Lua level callbacks', () => {
  it('runs the level script once without building the world, then calls callbacks', async () => {
    const w = fakeHost([
      { ref: 'a0', l: 'ac', x: 10, y: 6.5, a: { name: 'ball', _fx: '80', _fy: '-80' } },
      { ref: 't1', l: 'it', x: 1, y: 1, a: { target: 'update_force', _comp: '_fy', _val: '40' } },
    ]);
    const code = `
wo["GlobalForce"] = po(80, -80)
ti[" "] = {"fl_bluegray"}
ti["n"] = {"it_trigger", target="update_force", _comp="_fy", _val=40}
wo(ti, " ", {"  "})
wo:shuffleOxyd({no["oxyd#*"]:sub(1), circular=true})
function update_force(value, sender)
    no["ball"][sender["_comp"]] = sender["_val"]
    wo["GlobalForce"] = po(no["ball"]["_fx"], no["ball"]["_fy"])
end`;
    const lua = await startLua(code, w.host);
    expect(lua.lastError).toBe('');
    expect(w.force()).toBe("80,-80");
    expect(w.tiles).toEqual([]);
    lua.callback('update_force', true, 't1');
    expect(lua.lastError).toBe('');
    expect(w.force()).toBe("80,40");
  });

  it('obj:is matches the kind and its super kinds; obj:kind returns it', async () => {
    const w = fakeHost([{ ref: 'a', l: 'st', x: 2, y: 2, a: { name: 'o', kind: 'st_oneway_black' } }, { ref: 's', l: 'it', x: 1, y: 1, a: {} }]);
    const lua = await startLua(`function f() if no["o"]:is("st_oneway") and no["o"]:is("st") and not no["o"]:is("st_one") and no["o"]:kind() == "st_oneway_black" then no["o"]:toggle() end end`, w.host);
    lua.callback('f', true, 's');
    expect(lua.lastError).toBe('');
    expect(w.sent).toEqual(['a toggle null']);
  });

  it('group:nearest picks the closest member, ties go south, then east', async () => {
    const w = fakeHost([
      { ref: 'a', l: 'st', x: 2, y: 2, a: { name: 'd#1' } },
      { ref: 'b', l: 'st', x: 6, y: 2, a: { name: 'd#2' } },
      { ref: 'c', l: 'st', x: 4, y: 4, a: { name: 'd#3' } },
      { ref: 's', l: 'it', x: 4, y: 2, a: { name: 'src' } },
    ]);
    const lua = await startLua(`function f(v, s) no["d#*"]:nearest(s):toggle() end`, w.host);
    lua.callback('f', true, 's');
    expect(lua.lastError).toBe('');
    expect(w.sent).toEqual(['c toggle null']); // all three 2 away: the southern one wins
  });

  it('groups: floors of named objects, intersection, toggle; positions next to the sender', async () => {
    const w = fakeHost([
      { ref: 'd1', l: 'st', x: 3, y: 2, a: { name: 'doors#1' } },
      { ref: 'd2', l: 'st', x: 5, y: 2, a: { name: 'doors#2' } },
      { ref: 'f1', l: 'fl', x: 3, y: 2, a: { name: 'red#1', _color: 'red' } },
      { ref: 'f2', l: 'fl', x: 5, y: 2, a: { name: 'green#1', _color: 'green' } },
      { ref: 'f3', l: 'fl', x: 4, y: 3, a: { name: 'red#2', _color: 'red' } },
      { ref: 't', l: 'it', x: 4, y: 3, a: {} },
      { ref: 's', l: 'st', x: 3, y: 3, a: {} },
    ]);
    const code = `
function toggle_doors(value, sender)
    st(fl(no["doors#*"]) * no[fl(sender)._color.."#*"]):toggle()
end
function left(value, sender)
    grp({st(sender + W), st(sender + E)}):open()
end`;
    const lua = await startLua(code, w.host);
    lua.callback('toggle_doors', true, 't');
    expect(lua.lastError).toBe('');
    expect(w.sent).toEqual(['d1 toggle null']);
    w.sent.length = 0;
    lua.callback('left', true, 't');
    expect(lua.lastError).toBe('');
    expect(w.sent).toEqual(['s open null']);
  });

  it('wo[group] = tile sets each cell; attributes and names travel as strings', async () => {
    const w = fakeHost([
      { ref: 'g1', l: 'st', x: 2, y: 2, a: { name: 'maze1#5' } },
      { ref: 'g2', l: 'st', x: 3, y: 2, a: { name: 'maze1#6' } },
    ]);
    const code = `
ti["G"] = {"st_rawglass", name="maze2#"}
ti["D"] = ti({"st_door", "door%1", faces="ns", _gravity=po(0.0,-20.0)}) .. {"fl_water"}
function swap(value, sender)
    wo[no["maze1#*"]] = ti["G"]
    wo[po(7, 1)] = ti["D"]
    wo[po(8, 1)] = {"st_nil"}
end`;
    const lua = await startLua(code, w.host);
    lua.callback('swap', true, 'g1');
    expect(lua.lastError).toBe('');
    expect(w.tiles).toEqual([
      '2,2 st_rawglass {"name":"maze2#"}',
      '3,2 st_rawglass {"name":"maze2#"}',
      '7,1 st_door {"name":"door%1","faces":"ns","_gravity":"0,-20"}',
      '7,1 fl_water {}',
      '8,1 st_nil {}',
    ]);
  });

  it('group and position arithmetic as in lua.cc', async () => {
    const w = fakeHost([
      { ref: 'a', l: 'fl', x: 2, y: 3, a: { name: 'court#1' } },
      { ref: 'b', l: 'fl', x: 4, y: 3, a: { name: 'court#2' } },
      { ref: 'c', l: 'st', x: 9, y: 9, a: { name: 'abyss' } },
    ]);
    const code = `
function check()
    local court = no["court#*"]
    local r = {}
    r[#r + 1] = tostring(court[fl(4, 3)])         -- index of an object
    r[#r + 1] = tostring(court[fl(7, 7)])         -- not in the group
    r[#r + 1] = tostring(court[-1].name)          -- backwards
    local around = no["abyss"] + NEIGHBORS_4      -- object + list: shifted list
    r[#r + 1] = around[1].x .. "," .. around[1].y
    local back = NEIGHBORS_4 - po(1, 1)           -- Enigma: pos - p
    r[#r + 1] = back[1].x .. "," .. back[1].y
    local n = 0
    for _ in ipairs(court) do n = n + 1 end
    r[#r + 1] = tostring(n)
    local m = 0
    for _ in court do m = m + 1 end -- a group as iterator (Lua 5.1 style)
    r[#r + 1] = tostring(m)
    wo["Result"] = table.concat(r, " ")
end`;
    const lua = await startLua(code, w.host);
    lua.callback('check', true, '');
    expect(lua.lastError).toBe('');
    expect(w.host.world('Result')).toBe('2 nil court#2 8,9 2,1 2 2');
  });

  it('po["name"] gives named positions and positions of named objects, patterns a list', async () => {
    const w = fakeHost([
      { ref: 'a', l: 'fl', x: 2, y: 3, a: { name: 'floor1#1' } },
      { ref: 'b', l: 'fl', x: 4, y: 5, a: { name: 'floor1#2' } },
      { ref: 's', l: 'it', x: 1, y: 1, a: {} },
    ]);
    const lua = await startLua(
      `po["spot"] = po(7, 8)
function f()
  local l = po["floor1#*"]
  wo["Result"] = #l .. " " .. tostring(po["floor1#2"]) .. " " .. tostring(po["spot"]) .. " " .. tostring(po["nothing"]) .. " " .. tostring(po(1, 2))
  wo[po["floor1#*"]] = {"fl_lawn"}
end`,
      w.host,
    );
    lua.callback('f', true, 's');
    expect(lua.lastError).toBe('');
    expect(w.host.world('Result')).toBe('2 po(4, 5) po(7, 8) nil po(1, 2)');
    expect(w.tiles).toEqual(['2,3 fl_lawn {}', '4,5 fl_lawn {}']);
  });

  it('reports Lua errors instead of throwing', async () => {
    const w = fakeHost([]);
    const lua = await startLua('function boom() wo:world() end', w.host);
    lua.callback('boom', true, 'x');
    expect(lua.lastError).toMatch(/wo:world/);
  });
});

describe('wo:add during play', () => {
  it('puts items into an inventory and spans rubber bands', async () => {
    const w = fakeHost([{ ref: 'a:0', l: 'st', x: 1, y: 1, a: { name: 'ball' } }, { ref: 'o:5', l: 'st', x: 4, y: 2, a: { name: 'post' } }]);
    const calls: string[] = [];
    w.host.addInventory = (p, k) => calls.push(`inv ${p} ${k}`);
    w.host.addRubber = (a1, a2, s, l) => calls.push(`rubber ${a1} ${a2} ${s} ${l}`);
    const lua = await startLua(`function f() wo:add(YIN, {"it_extralife"}); wo:add({"ot_rubberband", anchor1="ball", anchor2=no["post"], strength=20, length=2}) end`, w.host);
    lua.callback('f', true, 'o:5');
    expect(lua.lastError).toBe('');
    expect(calls).toEqual(['inv 0 it_extralife', 'rubber a:0 o:5 20 2']);
  });
});

describe('wo:drawMap during play', () => {
  it('sets the tiles of a map from ti, skipping the ignore key', async () => {
    const w = fakeHost([]);
    const set: string[] = [];
    w.host.setTile = (x, y, kind) => set.push(`${x},${y},${kind}`);
    const lua = await startLua(`ti["#"] = {"st_granite"}\nfunction f() wo:drawMap(ti, po(2, 3), " ", {"# ", " #"}) wo:drawRect(po(0, 0), 2, 1, ti["#"]) end`, w.host);
    lua.callback('f', true, 'x');
    expect(lua.lastError).toBe('');
    expect(set).toEqual(['2,3,st_granite', '3,4,st_granite', '0,0,st_granite', '1,0,st_granite']);
  });
});

describe('res.random during play', () => {
  it('replaces hit keys by a key chosen by frequency, other keys pass through', async () => {
    const w = fakeHost([]);
    const set: string[] = [];
    w.host.setTile = (x, y, kind) => set.push(`${x},${y},${kind}`);
    const lua = await startLua(
      `ti["-"] = {"fl_sand"}\nti["1"] = {"fl_red"}\nti["2"] = {"fl_blue"}\nti["#"] = {"st_granite"}
local r = res.random(ti, "-", {{"1", 0}, {"2", 1}})
local s = res.random(ti, {{"x", "#"}}, "1")
function f() wo:drawRect(po(0, 0), po(1, 0), "-", r) wo:drawRect(po(2, 0), po(2, 0), "#", r) wo:drawRect(po(3, 0), po(3, 0), "x", s) end`,
      w.host,
    );
    lua.callback('f', true, 'x');
    expect(lua.lastError).toBe('');
    // frequency 0 is never chosen; the superkey's tile comes first
    expect(set).toEqual(['0,0,fl_blue', '1,0,fl_blue', '2,0,st_granite', '3,0,st_granite', '3,0,fl_red']);
  });
});
