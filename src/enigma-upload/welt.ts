// Build mode (docs/SPEC-enigma-upload.md U2): runs an Enigma level script (Lua API 2) in Murmel's
// fengari sandbox and records the world it builds. The game's shim (src/lua/enigma.lua) skips world
// building because imported levels come from the engine export; here it runs with INIT off and a small
// addon that implements wo(…) like createWorld in Enigma's lua.cc. Plain TypeScript: runs in Node
// (vitest, fengari) and in the browser worker (fengari-web).

import { MAX_H, MAX_W } from '../editor/model';
import { type Fengari, type LuaHost, LuaLevel } from '../lua/runtime';
import { UploadError } from './datei';

/** Tile declarations a script may set (a 60×40 world with three layers needs 7 200). */
export const MAX_TILES = 20_000;
/** Lua instructions of the whole build. */
export const BUILD_STEPS = 20_000_000;

export interface Decl {
  k: string;
  a: Record<string, string>;
}
export interface Zelle {
  fl?: Decl;
  st?: Decl;
  it?: Decl;
}
export interface Welt {
  w: number;
  h: number;
  /** Row by row. */
  cells: Zelle[];
  /** Actors at their cell centre. */
  actors: (Decl & { x: number; y: number })[];
  /** World attributes the script set (wo["ConserveLevel"] …). */
  world: Record<string, string>;
  /** Things the build could not take over (wo:add of gadgets, inventory items …). */
  unsupported: string[];
  /** Notes for the person (messages sent while building …). */
  hints: string[];
  /** Whether a name is a Lua function of the level (callback targets). */
  isFunction: (name: string) => boolean;
}

const SIZE = '_murmel_size';
const FLOOR_ONLY = '_murmel_floor';

/** Lua run after the shim: no file access, wo(…) builds the world, unknown resolvers fail. */
const ADDON = `
dofile, loadfile, require, collectgarbage = nil, nil, nil, nil
do
  local tiles_mt = getmetatable(ti)
  local function rawevaluate(resolver, key, x, y)
    if getmetatable(resolver) == tiles_mt then return rawget(resolver, key) end
    if type(resolver) == "function" then return resolver(key, x, y) end
    if type(resolver) == "table" and type(rawget(resolver, 1)) == "function" then
      return resolver[1](resolver, rawevaluate, key, x, y)
    end
    if type(resolver) == "table" then return resolver[key] end
    error("Resolver mit falschem Typ", 3)
  end
  local function finalize(context)
    if type(context) == "table" and getmetatable(context) ~= tiles_mt then
      finalize(rawget(context, 3))
      local f = rawget(context, 2)
      if type(f) == "function" then f(context) end
    end
  end
  local function tile(resolver, key, x, y)
    local t = rawevaluate(resolver, key, x, y)
    if t == nil then error("Die Kachel '" .. tostring(key) .. "' bei " .. x .. ", " .. y .. " ist nicht definiert", 3) end
    return t
  end
  local built = false
  getmetatable(wo).__call = function(_, resolver, defaultkey, a4, a5)
    if built then error("Die Welt wurde schon erstellt", 2) end
    built = true
    local map, w, h
    if type(defaultkey) == "table" then
      map = defaultkey
      defaultkey = map.defaultkey
    elseif type(a4) == "table" then
      map = a4
    else
      w, h = tonumber(a4), tonumber(a5)
    end
    if type(defaultkey) ~= "string" or defaultkey == "" then error("wo(...) ohne gültigen Standardschlüssel", 2) end
    local len = string.len(defaultkey)
    if map then
      h, w = #map, 0
      for i = 1, h do
        if type(map[i]) ~= "string" then error("Die Karte enthält Zeilen, die keine Zeichenketten sind", 2) end
        w = math.max(w, string.len(map[i]))
      end
      if w % len ~= 0 then error("Eine Kartenzeile hat eine unpassende Länge", 2) end
      w = w // len
    end
    if not w or not h or w <= 0 or h <= 0 then error("wo(...) mit ungültiger Größe", 2) end
    wo["${SIZE}"] = math.floor(w) .. " " .. math.floor(h)
    for y = 0, h - 1 do
      local line = map and map[y + 1] or ""
      local n = string.len(line) // len
      for x = 0, w - 1 do
        local p = po(x, y)
        -- the default tile's floor first: a key tile with its own floor replaces it (lua.cc setObjectByKey)
        wo["${FLOOR_ONLY}"] = "1"
        wo[p] = tile(resolver, defaultkey, x, y)
        wo["${FLOOR_ONLY}"] = "0"
        if x < n then wo[p] = tile(resolver, string.sub(line, x * len + 1, (x + 1) * len), x, y) end
      end
    end
    finalize(resolver)
    return w, h
  end
  local res_mt = getmetatable(res)
  res_mt.__index = function(_, name) error("Murmel kennt res." .. tostring(name) .. " noch nicht", 2) end
end
`;

/** The shim with INIT off from the start: world building runs. */
export function buildShim(shim: string): string {
  const marker = 'local INIT = true';
  if (!shim.includes(marker)) throw new Error('enigma.lua: INIT-Marke fehlt');
  return `${shim.replace(marker, 'local INIT = false')}\n${ADDON}`;
}

/**
 * Builds the world of an API 2 level script. `libs`: library code in load order.
 * Throws UploadError with the reason (Lua error with line, size, limits).
 */
export async function baueWelt(code: string, f: Fengari, shim: string, libs: readonly string[] = []): Promise<Welt> {
  let w = 0;
  let h = 0;
  let cells: Zelle[] = [];
  let floorOnly = false;
  let tiles = 0;
  const actors: Welt['actors'] = [];
  const world: Record<string, string> = {};
  const unsupported: string[] = [];
  const hints: string[] = [];
  const hint = (t: string): void => void (hints.includes(t) || hints.push(t));
  const layerOf = (k: string): 'fl' | 'st' | 'it' | null => (k.startsWith('fl_') ? 'fl' : k.startsWith('st_') ? 'st' : k.startsWith('it_') ? 'it' : null);
  const cell = (x: number, y: number): Zelle | null => (x >= 0 && y >= 0 && x < w && y < h ? cells[y * w + x] : null);
  const parse = (ref: string): { l: 'fl' | 'st' | 'it'; x: number; y: number } | { a: number } | null => {
    const m = /^c:(fl|st|it):(-?\d+):(-?\d+)$/.exec(ref);
    if (m) return { l: m[1] as 'fl', x: Number(m[2]), y: Number(m[3]) };
    const a = /^a:(\d+)$/.exec(ref);
    return a ? { a: Number(a[1]) } : null;
  };
  const declOf = (ref: string): Decl | null => {
    const p = parse(ref);
    if (!p) return null;
    if ('a' in p) return actors[p.a] ?? null;
    return cell(p.x, p.y)?.[p.l] ?? null;
  };
  const glob = (p: string): RegExp => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

  const host: LuaHost = {
    find(pattern) {
      const re = glob(pattern);
      const out: string[] = [];
      cells.forEach((c, i) => {
        for (const l of ['fl', 'st', 'it'] as const) if (c[l]?.a.name !== undefined && re.test(c[l]!.a.name)) out.push(`c:${l}:${i % w}:${Math.floor(i / w)}`);
      });
      actors.forEach((a, i) => a.a.name !== undefined && re.test(a.a.name) && out.push(`a:${i}`));
      return out;
    },
    at: (l, x, y) => (cell(x, y)?.[l] ? `c:${l}:${x}:${y}` : null),
    exists: (ref) => declOf(ref) !== null,
    pos(ref) {
      const p = parse(ref);
      if (!p) return [0, 0];
      if ('a' in p) return [actors[p.a].x, actors[p.a].y];
      return [p.x, p.y];
    },
    get(ref, key) {
      const d = declOf(ref);
      if (!d) return null;
      return key === 'kind' ? d.k : (d.a[key] ?? null);
    },
    set(ref, key, value) {
      const d = declOf(ref);
      if (!d) return;
      if (value === null) delete d.a[key];
      else d.a[key] = value;
    },
    send(_ref, msg) {
      hint(`Die Nachricht „${msg}“ beim Aufbau wurde nicht ausgeführt.`);
    },
    kill(ref) {
      const p = parse(ref);
      if (!p) return;
      if ('a' in p) actors.splice(p.a, 1);
      else {
        const c = cell(p.x, p.y);
        if (c) delete c[p.l];
      }
    },
    setTile(x, y, kind, attrs) {
      if (w === 0) throw new Error('Das Level setzt Kacheln, bevor es mit wo(...) die Welt erstellt');
      if (++tiles > MAX_TILES) throw new Error(`Das Level setzt mehr als ${MAX_TILES} Kacheln`);
      const c = cell(x, y);
      if (!c) return; // Enigma ignores positions outside the world
      const k = kind.startsWith('#') ? kind.slice(1) : kind;
      if (k === 'nil') return;
      if (floorOnly && !k.startsWith('fl_')) return;
      if (k === 'fl_nil' || k === 'st_nil' || k === 'it_nil') {
        delete c[k.slice(0, 2) as 'fl'];
        return;
      }
      if (k.startsWith('ac_')) {
        actors.push({ k, a: { ...attrs }, x: x + 0.5, y: y + 0.5 });
        return;
      }
      const l = layerOf(k);
      if (!l) {
        unsupported.push(k);
        return;
      }
      c[l] = { k, a: { ...attrs } };
    },
    world: (k) => world[k] ?? null,
    setWorld(k, v) {
      if (k === FLOOR_ONLY) {
        floorOnly = v === '1';
        return;
      }
      if (k === SIZE) {
        const [nw, nh] = (v ?? '').split(' ').map(Number);
        if (nw > MAX_W || nh > MAX_H) throw new Error(`Das Level ist ${nw}×${nh} groß; erlaubt sind höchstens ${MAX_W}×${MAX_H}`);
        w = nw;
        h = nh;
        cells = Array.from({ length: w * h }, () => ({}));
        return;
      }
      if (v === null) delete world[k];
      else world[k] = v;
    },
    size: () => [w, h],
    addInventory(_player, kind) {
      unsupported.push(`${kind} (im Inventar)`);
    },
    addObject(kind) {
      unsupported.push(kind);
    },
    addRubber() {
      unsupported.push('ot_rubberband');
    },
    shuffleOxyd() {},
  };

  const quiet = LuaLevel.quiet;
  const steps = LuaLevel.INIT_STEPS;
  LuaLevel.quiet = true;
  LuaLevel.INIT_STEPS = BUILD_STEPS;
  let lua: LuaLevel;
  try {
    lua = await LuaLevel.create(code, host, buildShim(shim), f, libs);
  } finally {
    LuaLevel.quiet = quiet;
    LuaLevel.INIT_STEPS = steps;
  }
  if (lua.lastError) throw new UploadError(luaMessage(lua.lastError));
  if (w === 0) throw new UploadError('Das Level erstellt keine Welt (wo(...) fehlt).');
  return { w, h, cells, actors, world, unsupported, hints, isFunction: (name) => lua.isFunction(name) };
}

/** A Lua error as a sentence for the person ("level:12: …" keeps its line). */
export function luaMessage(err: string): string {
  if (/Level-Init läuft endlos/.test(err)) return 'Der Lua-Teil läuft zu lange (Endlosschleife?).';
  const m = /^(?:\[string "[^"]*"\]|level|lib\d+|enigma\.lua):(\d+): ([\s\S]*)$/.exec(err);
  const text = (m ? m[2] : err).replace(/^Error: /, '').replace(/^(?:level|lib\d+|enigma\.lua):\d+: /, '');
  const where = m && /^level:/.test(err) ? ` (Zeile ${m[1]})` : '';
  return `Fehler im Lua-Teil${where}: ${text}`;
}
