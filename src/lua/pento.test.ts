import { describe, expect, it } from 'vitest';
import shim from './enigma.lua?raw';
import libpento from './lib/libpento.lua?raw';
import { type LuaHost, LuaLevel } from './runtime';

/**
 * A small stateful world for Enigma's libpento (Pentomino levels): named floors of a 5×5 source
 * area and a 60-cell target area, stones that Lua sets and kills, puzzle clusters by attribute.
 */
function pentoWorld() {
  type Thing = { ref: string; l: 'fl' | 'st' | 'it'; x: number; y: number; a: Record<string, string> };
  const things: Thing[] = [];
  let n = 0;
  const add = (l: Thing['l'], x: number, y: number, a: Record<string, string>) => {
    const t = { ref: `${l}:${++n}`, l, x, y, a };
    things.push(t);
    return t;
  };
  for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) add('fl', x, y, { name: `source#${n}`, kind: 'fl_bluegreen' });
  for (let y = 2; y < 7; y++) for (let x = 8; x < 20; x++) add('fl', x, y, { name: `target#${n}`, kind: 'fl_lawn' });
  for (let x = 0; x < 14; x++) add('st', x, 0, { name: `oxyd#${n}`, kind: 'st_bluesand' });
  add('fl', 1, 8, { name: 'pullers', kind: 'fl_plank' });
  const timer = add('it', -1, -1, { kind: 'ot_timer', state: '1' });
  const live = () => things.filter((t) => !t.a.$gone);
  const stoneAt = (x: number, y: number) => live().find((t) => t.l === 'st' && t.x === x && t.y === y);
  let shuffles = 0;
  const glob = (p: string) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  const host: LuaHost = {
    find: (p) => live().filter((t) => t.a.name && glob(p).test(t.a.name)).map((t) => t.ref),
    at: (l, x, y) => live().find((t) => t.l === l && t.x === x && t.y === y)?.ref ?? null,
    exists: (r) => live().some((t) => t.ref === r),
    pos: (r) => {
      const t = things.find((x) => x.ref === r)!;
      return [t.x, t.y];
    },
    get: (r, k) => things.find((t) => t.ref === r)?.a[k] ?? null,
    set: (r, k, v) => {
      const t = things.find((x) => x.ref === r)!;
      if (v === null) delete t.a[k];
      else t.a[k] = v;
    },
    send: () => {},
    kill: (r) => {
      const t = things.find((x) => x.ref === r);
      if (t) t.a.$gone = 'true';
    },
    setTile: (x, y, kind, a) => {
      if (kind.startsWith('st_')) {
        const old = stoneAt(x, y);
        if (old) old.a.$gone = 'true';
        add('st', x, y, { ...a, kind, ...(a.name?.endsWith('#') ? { name: `${a.name}${n}` } : {}) });
      } else if (kind.startsWith('it_')) add('it', x, y, { ...a, kind });
    },
    world: () => null,
    setWorld: () => {},
    size: () => [20, 13],
    // a fragment: stones of the same cluster touching each other
    cluster: (r) => {
      const first = things.find((t) => t.ref === r)!;
      const seen = new Set([first]);
      const todo = [first];
      while (todo.length) {
        const t = todo.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const q = stoneAt(t.x + dx, t.y + dy);
          if (q && q.a.cluster === first.a.cluster && !seen.has(q)) {
            seen.add(q);
            todo.push(q);
          }
        }
      }
      return [...seen].map((t) => t.ref);
    },
    shuffleOxyd: () => void shuffles++,
  };
  const source = () => live().filter((t) => t.l === 'st' && t.x >= 2 && t.x < 7 && t.y >= 2 && t.y < 7);
  return { host, things, live, source, timer, add, shuffles: () => shuffles };
}

// The Lua of Enigma's Pentomino levels (pentomino_i, identical apart from the map).
const LEVEL = `
ti[" "] = {"fl_plank"}
ti["+"] = {"fl_bluegreen", "source#"}
ti["."] = {"fl_lawn", "target#"}
ti["#"] = {"st_bluesand", cluster=1}
ti["%"] = {"st_bluesand", name="oxyd#", cluster=2}
ti["&"] = {"st_switch", target="pento.next"}
ti["/"] = {"st_fourswitch", target="pento.rotate"}
ti["|"] = {"st_switch", target="pento.mirror"}
ti["*"] = {"st_oxyd"}
ti["n"] = {"it_puller_n"}
ti["e"] = {"it_puller_e"}
ti["s"] = {"it_puller_s"}
ti["w"] = {"it_puller_w"}
ti["N"] = ti["n"] .. ti({"fl_plank","pullers"})
ti["!"] = {"it_sensor", target="addpullers", invisible=true}
ti["@"] = {"#ac_marble"}

pento = res.pento(ti, "source", "target")

wo(pento, " ", {"%%%%", "%@ %"})

wo:add({"ot_timer", interval=0.5, target="check"})

function check(value, sender)
    if pento.check() then
        sender.state=OFF
        wo[no["oxyd#*"]:shuffle():sub(12)] = ti["*"]
        wo:shuffleOxyd()
    end
end

function addpullers()
    wo:drawMap(ti, no["pullers"], " ", {"nesw"})
end
`;

const cells = (ts: { x: number; y: number }[]) => ts.map((t) => `${t.x},${t.y}`).sort();

describe('libpento (Pentomino levels)', () => {
  it('finalizes the areas from the exported world and knows the dotted callbacks', async () => {
    const w = pentoWorld();
    const lua = await LuaLevel.create(LEVEL, w.host, shim, await import('fengari'), [libpento]);
    expect(lua.lastError).toBe('');
    for (const f of ['pento.next', 'pento.rotate', 'pento.mirror', 'check', 'addpullers']) expect(lua.isFunction(f)).toBe(true);
    expect(lua.isFunction('pento.nothing')).toBe(false);
  });

  it('pento.next draws the next shape as a puzzle cluster centred in the source area', async () => {
    const w = pentoWorld();
    const lua = await LuaLevel.create(LEVEL, w.host, shim, await import('fengari'), [libpento]);
    lua.callback('pento.next', true, 'it:0');
    expect(lua.lastError).toBe('');
    // shape 1 "OOOOO": width 5, height 1 → offset (0.5, 2.5) → row 4
    expect(cells(w.source())).toEqual(['2,4', '3,4', '4,4', '5,4', '6,4']);
    for (const s of w.source()) {
      expect(s.a.kind).toBe('st_puzzle');
      expect(s.a.cluster).toBe('%1');
      expect(s.a.name).toMatch(/^shape%1#\d+$/);
      expect(s.a.intensity).toBe('0');
    }
    // the next one: the previous stones go, shape 2 ("PP", "PPP") appears
    lua.callback('pento.next', true, 'it:0');
    expect(lua.lastError).toBe('');
    expect(w.source()).toHaveLength(5);
    expect(new Set(w.source().map((s) => s.a.cluster))).toEqual(new Set(['%2']));
    // offset (3 - 3/2, 3 - 2/2) = (1.5, 2): "PP " in row 4 from x 3, "PPP" in row 5
    expect(cells(w.source())).toEqual(['3,4', '3,5', '4,4', '4,5', '5,5']);
  });

  it('skips shapes already placed elsewhere and stops when all twelve are out', async () => {
    const w = pentoWorld();
    const lua = await LuaLevel.create(LEVEL, w.host, shim, await import('fengari'), [libpento]);
    // shape 1 and 2 lie in the target area already
    w.add('st', 10, 3, { kind: 'st_puzzle', name: 'shape%1#77', cluster: '%1' });
    w.add('st', 12, 3, { kind: 'st_puzzle', name: 'shape%2#78', cluster: '%2' });
    lua.callback('pento.next', true, 'it:0');
    expect(lua.lastError).toBe('');
    expect(new Set(w.source().map((s) => s.a.cluster))).toEqual(new Set(['%3']));
  });

  it('pento.rotate and pento.mirror redraw the shape transformed and remember the transformation', async () => {
    const w = pentoWorld();
    const lua = await LuaLevel.create(LEVEL, w.host, shim, await import('fengari'), [libpento]);
    lua.callback('pento.next', true, 'it:0');
    lua.callback('pento.rotate', 2, 'it:0');
    expect(lua.lastError).toBe('');
    // the line stands upright now (MAP_ROT_CW), offset (2.5, 0.5)
    expect(cells(w.source())).toEqual(['4,2', '4,3', '4,4', '4,5', '4,6']);
    expect(w.source().every((s) => s.a._transform === '2')).toBe(true);
    lua.callback('pento.next', true, 'it:0'); // shape 2: "PP" / "PPP"
    lua.callback('pento.mirror', true, 'it:0');
    expect(lua.lastError).toBe('');
    // mirrored horizontally: "PP" / "PPP" → " PP" / "PPP"
    expect(cells(w.source())).toEqual(['3,5', '4,4', '4,5', '5,4', '5,5']);
    expect(w.source().every((s) => s.a._transform === '6')).toBe(true);
    // rotating a mirrored shape composes: FLIP_HORIZONTAL * ROT_CW = FLIP_BACKSLASH (5)
    lua.callback('pento.rotate', 2, 'it:0');
    expect(lua.lastError).toBe('');
    expect(w.source().every((s) => s.a._transform === '5')).toBe(true);
    expect(w.source()).toHaveLength(5);
  });

  it('check turns twelve stones into Oxyd stones once the target area is full and stops its timer', async () => {
    const w = pentoWorld();
    const lua = await LuaLevel.create(LEVEL, w.host, shim, await import('fengari'), [libpento]);
    lua.callback('check', true, w.timer.ref);
    expect(lua.lastError).toBe('');
    expect(w.live().filter((t) => t.a.kind === 'st_oxyd')).toHaveLength(0);
    for (let y = 2; y < 7; y++) for (let x = 8; x < 20; x++) w.add('st', x, y, { kind: 'st_puzzle', cluster: '%1' });
    lua.callback('check', true, w.timer.ref);
    expect(lua.lastError).toBe('');
    expect(w.live().filter((t) => t.a.kind === 'st_oxyd')).toHaveLength(12);
    expect(w.live().filter((t) => t.a.kind === 'st_bluesand')).toHaveLength(2);
    expect(w.shuffles()).toBe(1);
    expect(w.timer.a.state).toBe('0');
  });

  it('addpullers draws the pullers with ti at the named floor', async () => {
    const w = pentoWorld();
    const lua = await LuaLevel.create(LEVEL, w.host, shim, await import('fengari'), [libpento]);
    lua.callback('addpullers', true, 'it:0');
    expect(lua.lastError).toBe('');
    expect(w.live().filter((t) => t.l === 'it' && t.y === 8).map((t) => `${t.x} ${t.a.kind}`)).toEqual(['1 it_puller_n', '2 it_puller_e', '3 it_puller_s', '4 it_puller_w']);
  });
});

describe('maps (libmap subset)', () => {
  it('wo:newMap fills lines, ^ transforms like lib.map.transform, * composes', async () => {
    const out: string[] = [];
    const host = pentoWorld().host;
    host.setWorld = (k, v) => void out.push(`${k}=${v}`);
    const lua = await LuaLevel.create(
      `
function f()
  local m = wo:newMap(" ", {"ab", "c"})
  wo["w"] = m.width .. "x" .. m.height .. ":" .. m[1] .. "|" .. m[2] .. "|" .. m[{1, 0}]
  local r = m ^ MAP_ROT_CW
  wo["r"] = r[1] .. "|" .. r[2]
  local f = m ^ MAP_FLIP_SLASH
  wo["s"] = f[1] .. "|" .. f[2]
  wo["c"] = (MAP_ROT_CW * MAP_ROT_CW).index .. "," .. (MAP_FLIP_HORIZONTAL * MAP_ROT_CW).index .. "," .. (-MAP_ROT_CW).index .. "," .. (MAP_ROT_CW ^ 3).index
end`,
      host,
      shim,
      await import('fengari'),
    );
    lua.callback('f', true, 'it:0');
    expect(lua.lastError).toBe('');
    expect(out).toEqual(['w=2x2:ab|c |b', 'r=ca| b', 's=ac|b ', 'c=3,5,4,4']);
  });
});
