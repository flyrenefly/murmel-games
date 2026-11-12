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
    wo["Result"] = table.concat(r, " ")
end`;
    const lua = await startLua(code, w.host);
    lua.callback('check', true, '');
    expect(lua.lastError).toBe('');
    expect(w.host.world('Result')).toBe('2 nil court#2 8,9 2,1 2');
  });

  it('reports Lua errors instead of throwing', async () => {
    const w = fakeHost([]);
    const lua = await startLua('function boom() wo:drawMap(ti, po(0,0), "", {}) end', w.host);
    lua.callback('boom', true, 'x');
    expect(lua.lastError).toMatch(/drawMap/);
  });
});
