// Lua of imported Enigma levels: extract it, run the init once on the export (world attributes
// such as wo["GlobalForce"]), and check whether the callbacks only use what Murmel's
// API shim (src/lua/enigma.lua) knows.
import { readFileSync } from 'node:fs';

const { LuaLevel } = await import(new URL('../src/lua/runtime.ts', import.meta.url).href);
LuaLevel.quiet = true;
const SHIM = readFileSync(new URL('../src/lua/enigma.lua', import.meta.url), 'utf8');

export function luaCode(xml) {
  return /<el:luamain><!\[CDATA\[([\s\S]*?)\]\]><\/el:luamain>/.exec(xml)?.[1] ?? '';
}

/** Names of the global functions a level defines. */
export function luaFunctions(code) {
  const fns = new Set();
  for (const m of code.matchAll(/^\s*function\s+([A-Za-z_][\w.]*)\s*\(/gm)) fns.add(m[1]);
  for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*function\b/gm)) fns.add(m[1]);
  return fns;
}

/** Bodies of the top-level functions (header line up to an "end" in column 0). */
function bodies(code) {
  const out = [];
  for (const m of code.matchAll(/^function\b[\s\S]*?^end\b/gm)) out.push(m[0]);
  return out.join('\n');
}

const METHODS = new Set(['open', 'close', 'toggle', 'on', 'off', 'flip', 'turn', 'signal', 'grow', 'explode', 'shovel', 'turnback', 'orientate', 'message', 'exists', 'kill', 'xy', 'sub', 'sort', 'shuffle', 'nearest', 'is', 'kind',
  // string methods
  'len', 'upper', 'lower', 'find', 'match', 'gsub', 'gmatch', 'rep', 'format', 'byte', 'reverse']);
const FUNCS = new Set(['po', 'grp', 'st', 'it', 'fl', 'ti', 'cond', 'etype', 'ipairs', 'pairs', 'type', 'tostring', 'tonumber', 'unpack', 'select', 'next',
  'error', 'assert', 'print', 'rawget', 'rawset', 'setmetatable', 'getmetatable', 'random']);
const KEYWORDS = new Set(['if', 'while', 'for', 'function', 'return', 'and', 'or', 'not', 'elseif', 'until', 'local', 'then', 'do', 'end', 'in', 'else', 'repeat']);
/** World attributes the game applies (also when set during play). */
export const RUNTIME_WORLD = new Set(['GlobalForce', 'FrictionStrength']);
const API1 = /\b(set_stone|set_floor|set_item|set_actor|set_attrib|get_attrib|fill_floor|fill_stones|draw_\w+|create_world|SendMessage|enigma\.\w+)\s*\(/;

/** What the callbacks use that the shim does not know (empty = fine). */
export function luaProblems(code, fns) {
  const problems = new Set();
  if (API1.test(code)) problems.add('API 1');
  const body = bodies(code).replace(/--[^\n]*/g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const locals = new Set([...body.matchAll(/\blocal\s+(?:function\s+)?([A-Za-z_][\w\s,]*)/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
  for (const m of body.matchAll(/:\s*([A-Za-z_]\w*)\s*\(/g)) if (!METHODS.has(m[1]) && m[1] !== 'add') problems.add(`:${m[1]}`);
  // wo:add during play: only items into an inventory (YIN/YANG) and rubber bands
  const raw = bodies(code).replace(/--[^\n]*/g, '');
  const adds = [...body.matchAll(/:\s*add\s*\(/g)].length;
  const ok = [...raw.matchAll(/wo:add\(\s*(YIN|YANG|[01])\s*,\s*\{\s*"it_\w+"\s*(,\s*connections\s*=[^}]*)?\}\s*\)/g)].length + [...raw.matchAll(/wo:add\(\s*\{\s*"ot_rubberband"/g)].length;
  if (adds > ok) problems.add(':add');
  for (const m of body.matchAll(/(^|[^.:\w])([A-Za-z_]\w*)\s*\(/g)) {
    const n = m[2];
    if (!FUNCS.has(n) && !KEYWORDS.has(n) && !fns.has(n) && !locals.has(n)) problems.add(`${n}()`);
  }
  for (const m of body.matchAll(/\b(res|lib)\.(\w+)/g)) problems.add(`${m[1]}.${m[2]}`);
  // world attributes changed during play: only those the game applies
  for (const m of bodies(code).matchAll(/wo\[\s*"(\w+)"\s*\]\s*=(?!=)/g)) if (!RUNTIME_WORLD.has(m[1])) problems.add(`wo["${m[1]}"]`);
  return [...problems];
}

/** Kinds (st_/fl_/it_/ac_) that callbacks may create: literals in the bodies and in ti entries they use. */
export function runtimeKinds(code) {
  const body = bodies(code);
  const kinds = new Set([...body.matchAll(/"((?:st|fl|it|ac)_\w+)"/g)].map((m) => m[1]));
  for (const m of body.matchAll(/ti\[\s*"([^"]+)"\s*\]/g)) {
    const key = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const d of code.matchAll(new RegExp(`ti\\[\\s*"${key}"\\s*\\]\\s*=([^\\n]*)`, 'g'))) for (const k of d[1].matchAll(/"((?:st|fl|it|ac)_\w+)"/g)) kinds.add(k[1]);
  }
  return [...kinds];
}

/**
 * Kinds of all ti entries, for callbacks that set tiles kept in their own tables
 * (floors = {[NORTH] = ti["A"], …}; wo[pos] = floors[dir]).
 */
export function allTileKinds(code) {
  if (!/wo\[[^\]]+\]\s*=(?!=)/.test(bodies(code))) return [];
  const kinds = new Set();
  for (const d of code.matchAll(/ti\[\s*"[^"]*"\s*\]\s*=([^\n]*)/g)) for (const k of d[1].matchAll(/"((?:st|fl|it)_\w+)"/g)) kinds.add(k[1]);
  return [...kinds];
}

/** Run the level script in init mode on the exported world; returns world attributes and errors. */
export async function luaInit(code, w) {
  const named = [];
  const byRef = new Map();
  const layers = ['fl', 'st', 'it'];
  for (let i = 0; i < w.cells.length; i++) {
    w.cells[i].forEach((o, l) => {
      if (!o) return;
      const ref = `c:${layers[l]}:${i % w.w}:${Math.floor(i / w.w)}`;
      byRef.set(ref, o);
      if (o.name) named.push([o.name, ref]);
    });
  }
  w.actors.forEach((a, i) => {
    byRef.set(`a:${i}`, { ...a.o, $x: a.x, $y: a.y });
    if (a.o.name) named.push([a.o.name, `a:${i}`]);
  });
  const world = {};
  const adds = [];
  const glob = (p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  const host = {
    find: (p) => named.filter(([n]) => glob(p).test(n)).map(([, r]) => r),
    at: (l, x, y) => {
      const ref = `c:${l}:${x}:${y}`;
      return byRef.has(ref) ? ref : null;
    },
    exists: (r) => byRef.has(r),
    pos: (r) => {
      if (r.startsWith('a:')) {
        const a = byRef.get(r);
        return [a.$x, a.$y];
      }
      const [, , x, y] = r.split(':');
      return [Number(x), Number(y)];
    },
    get: (r, k) => {
      const o = byRef.get(r);
      if (!o) return null;
      if (k === 'kind') return o.k;
      return o[k] ?? null;
    },
    set() {},
    send() {},
    kill() {},
    setTile() {},
    world: (k) => world[k] ?? null,
    setWorld: (k, v) => {
      if (v === null) delete world[k];
      else world[k] = v;
    },
    size: () => [w.w, w.h],
    add: (kind, attrs) => void adds.push({ kind, attrs }),
  };
  const lua = await LuaLevel.create(code, host, SHIM, await import('fengari'));
  // wo["FallenPuzzle"] = "=key": the kinds of tile ti[key]
  let fallenTile = null;
  if (typeof world.FallenPuzzle === 'string' && world.FallenPuzzle.startsWith('=')) {
    const before = adds.length;
    lua.describeTile(world.FallenPuzzle.slice(1));
    fallenTile = adds.splice(before).filter((a) => a.kind.startsWith('tile:')).map((a) => a.kind.slice(5));
  }
  return { world, adds, fallenTile, error: lua.lastError };
}
