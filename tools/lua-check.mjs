// Lua of imported Enigma levels: extract it, run the init once on the export (world attributes
// such as wo["GlobalForce"]), and check whether the callbacks only use what Murmel's
// API shim (src/lua/enigma.lua) knows.
import { readFileSync } from 'node:fs';

const { LuaLevel } = await import(new URL('../src/lua/runtime.ts', import.meta.url).href);
LuaLevel.quiet = true;
const SHIM = readFileSync(new URL('../src/lua/enigma.lua', import.meta.url), 'utf8');
/** Murmel's layer for Enigma's old Lua API 1 (levels with compatibility below 1.10). */
const API1_SHIM = readFileSync(new URL('../src/lua/api1.lua', import.meta.url), 'utf8');
/** Global names api1.lua defines (function f(…), f = …, a, b = …). */
const API1_GLOBALS = new Set([
  ...[...API1_SHIM.matchAll(/^function\s+([A-Za-z_]\w*)\s*\(/gm)].map((m) => m[1]),
  ...[...API1_SHIM.matchAll(/^([A-Za-z_][\w, ]*?)\s*=(?!=)/gm)].flatMap((m) => m[1].split(',').map((n) => n.trim())),
]);
/** API 1 kind names (api1.lua NEW2OLD and SPECIAL): old name → new kind. */
const API1_KINDS = new Map([
  ...[...API1_SHIM.matchAll(/^\s+(\w+) = "([\w-]+)",?\r?$/gm)].map((m) => [m[2], m[1]]),
  ...[...API1_SHIM.matchAll(/^\s+\["([\w-]+)"\] = \{"(\w+)"/gm)].map((m) => [m[1], m[2]]),
]);
/** Old kind names the helper functions of api1.lua set (abyss → "fl-abyss"). */
const API1_HELPER_KINDS = new Map(
  API1_SHIM.split(/^(?=function\s)/m)
    .map((chunk) => [/^function\s+(\w+)/.exec(chunk)?.[1], [...chunk.matchAll(/"((?:st|fl|it|ac)-[\w-]+)"/g)].map((m) => m[1])])
    .filter(([n, kinds]) => n && kinds.length),
);
/** The new kind of an API 1 kind name ("st-rock1" → "st_granite"), or null. */
export const api1Kind = (name) => API1_KINDS.get(name) ?? null;

/**
 * Enigma libraries Murmel ships (src/lua/lib): dependency path → name in lua.libs, and the kinds
 * the library itself may set during play. lib/libmap: the shim has the part libpento uses.
 */
export const LIBS = {
  'lib/libpento': { name: 'libpento', kinds: ['st_puzzle'] },
  // plain Lua helpers (tables, digits, permutations; natmaze: a maze kept in a table)
  'lib/liblua': { name: 'liblua', kinds: [] },
  'lib/libmath': { name: 'libmath', kinds: [], deps: ['lib/liblua'] },
  'lib/natmaze': { name: 'natmaze', kinds: [] },
  // maps (wo:newMap, map .. map, "k" * map, map:sub/paste/replace …): replaces the shim's subset
  'lib/libmap': { name: 'libmap', kinds: [], deps: ['lib/liblua'] },
};
export function libCode(name) {
  return readFileSync(new URL(`../src/lua/lib/${name}.lua`, import.meta.url), 'utf8');
}
/** The supported libraries a level depends on (el:dependency), in order, each after its own dependencies. */
export function levelLibs(xml) {
  const out = [];
  const add = (path) => {
    const lib = LIBS[path];
    if (!lib || out.includes(lib)) return;
    for (const d of lib.deps ?? []) add(d);
    out.push(lib);
  };
  for (const m of xml.matchAll(/<el:dependency el:path="([^"]+)"/g)) add(m[1]);
  return out;
}
/**
 * What loaded libraries give a level's callbacks: their global functions ("new_kruskal_maze",
 * "lib.math.digits") and, as ":name", the methods they put into tables (maze.can_go_east = …).
 */
export function libFunctions(libs) {
  const names = new Set();
  for (const l of libs) {
    const code = libCode(l.name);
    for (const f of luaFunctions(code)) names.add(f);
    for (const m of code.matchAll(/^\s*[A-Za-z_]\w*\.([A-Za-z_]\w*)\s*=(?!=)/gm)) names.add(`:${m[1]}`);
  }
  return names;
}
/** Resolvers that really work during play (the rest only pass their argument on). */
const RESOLVERS = new Set(['autotile', 'pento', 'random']);

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

/**
 * Bodies of the top-level functions (header line up to an "end" in column 0). With entries
 * (API 1: the callbacks the level's objects name) only the functions they reach: old levels
 * build their world with functions that run in the init only.
 */
function bodies(code, entries) {
  const all = [...code.matchAll(/^function\b[\s\S]*?^end\b/gm)].map((m) => m[0]);
  if (!entries) return all.join('\n');
  // old levels do not indent: a function ends at its matching "end" (blocks counted)
  const bare = code.replace(/--\[\[[\s\S]*?\]\]|--[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, (s) => s.replace(/[^\n]/g, ' '));
  const byName = new Map();
  for (const h of bare.matchAll(/^function\s+([A-Za-z_][\w.]*)/gm)) {
    let depth = 0;
    let end = bare.length;
    for (const w of bare.slice(h.index).matchAll(/\b(function|if|do|repeat|end|until)\b/g)) {
      depth += w[1] === 'end' || w[1] === 'until' ? -1 : 1;
      if (depth === 0) {
        end = h.index + w.index + w[0].length;
        break;
      }
    }
    byName.set(h[1], code.slice(h.index, end));
  }
  const seen = new Set();
  const todo = [...entries];
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n) || !byName.has(n)) continue;
    seen.add(n);
    for (const m of byName.get(n).matchAll(/[A-Za-z_][\w.]*/g)) if (byName.has(m[0]) && !seen.has(m[0])) todo.push(m[0]);
  }
  return [...seen].map((n) => byName.get(n)).join('\n');
}

const METHODS = new Set(['shuffleOxyd', 'open', 'close', 'toggle', 'on', 'off', 'flip', 'turn', 'signal', 'grow', 'explode', 'shovel', 'turnback', 'orientate', 'closeall', 'peepall', 'setfire', 'forcefire', 'stopfire', 'heat', 'ignite','set', 'fl', 'st', 'it', 'message', 'exists', 'kill', 'xy', 'sub', 'sort', 'shuffle', 'nearest', 'is', 'kind',
  // string methods
  'len', 'upper', 'lower', 'find', 'match', 'gsub', 'gmatch', 'rep', 'format', 'byte', 'reverse']);
const FUNCS = new Set(['po', 'grp', 'st', 'it', 'fl', 'ti', 'cond', 'etype', 'ipairs', 'pairs', 'type', 'tostring', 'tonumber', 'unpack', 'select', 'next',
  'error', 'assert', 'print', 'rawget', 'rawset', 'setmetatable', 'getmetatable', 'random']);
const KEYWORDS = new Set(['if', 'while', 'for', 'function', 'return', 'and', 'or', 'not', 'elseif', 'until', 'local', 'then', 'do', 'end', 'in', 'else', 'repeat']);
/** World attributes the game applies (also when set during play). */
export const RUNTIME_WORLD = new Set(['GlobalForce', 'FrictionStrength', 'ElectricStrength']);
const API1 = /\b(set_stone|set_floor|set_item|set_actor|set_attrib|get_attrib|fill_floor|fill_stones|draw_\w+|create_world|SendMessage|enigma\.\w+)\s*\(/;

/**
 * What the callbacks use that the shim does not know (empty = fine).
 * api1: the level uses API 1 (api1.lua); entries: its callbacks (only what they reach counts).
 */
export function luaProblems(code, fns, api1 = false, entries = undefined) {
  const problems = new Set();
  if (!api1 && API1.test(code)) problems.add('API 1');
  const reached = bodies(code, api1 ? entries : undefined);
  // API 1: globals the level assigns may hold one of its functions (ferry_movement = ferry_move_left)
  const assigned = new Set(api1 ? [...code.matchAll(/^\s*([A-Za-z_]\w*)\s*=(?!=)/gm)].map((m) => m[1]) : []);
  const body = reached.replace(/--[^\n]*/g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const locals = new Set([...body.matchAll(/\blocal\s+(?:function\s+)?([A-Za-z_][\w\s,]*)/g)].flatMap((m) => m[1].split(',').map((s) => s.trim())));
  // methods the level (or an API 1 library before it) puts into its tables: maze.can_go_east = maze_can_go_east
  const fields = new Set();
  for (const m of code.matchAll(/^\s*[A-Za-z_][\w.]*\.([A-Za-z_]\w*)\s*=\s*(?:function\b|([A-Za-z_]\w*)\s*$)/gm)) if (!m[2] || fns.has(m[2])) fields.add(m[1]);
  for (const m of body.matchAll(/:\s*([A-Za-z_]\w*)\s*\(/g)) if (!METHODS.has(m[1]) && !fields.has(m[1]) && !fns.has(`:${m[1]}`) && m[1] !== 'add' && !/^draw(Map|Rect|Border)$/.test(m[1])) problems.add(`:${m[1]}`);
  // wo:drawMap/drawRect/drawBorder during play: only with resolvers the shim builds (ti, res.autotile,
  // res.random, res.pento; wo:newMap with map ^ transformation), no libmap, and only keys ti knows
  for (const d of drawCalls(reached.replace(/--[^\n]*/g, ''))) if (!drawOk(d, code, fns)) problems.add(`:${d.method}`);
  // wo:add during play: only items into an inventory (YIN/YANG), rubber bands, timers and counters
  const raw = reached.replace(/--[^\n]*/g, '');
  const adds = [...body.matchAll(/:\s*add\s*\(/g)].length;
  const ok = [...raw.matchAll(/wo:add\(\s*(YIN|YANG|[01])\s*,\s*\{\s*"it_\w+"\s*(,\s*connections\s*=[^}]*)?\}\s*\)/g)].length + [...raw.matchAll(/wo:add\(\s*\{\s*"ot_(rubberband|timer|counter)"/g)].length;
  if (adds > ok) problems.add(':add');
  // function parameters may hold functions (local f in "function scan(f)")
  for (const m of body.matchAll(/\bfunction\b[\w\s.:]*\(([^)]*)\)/g)) for (const p of m[1].split(',')) locals.add(p.trim());
  for (const m of body.matchAll(/(^|[^.:\w])([A-Za-z_]\w*)\s*\(/g)) {
    const n = m[2];
    if (/:\s*$/.test(body.slice(0, m.index + m[1].length))) continue; // obj: close() is a method call
    if (!FUNCS.has(n) && !KEYWORDS.has(n) && !fns.has(n) && !locals.has(n) && !(api1 && (API1_GLOBALS.has(n) || assigned.has(n)))) problems.add(`${n}()`);
  }
  // lib.math.permutation is provided (enigma.lua), functions of loaded libraries too; other libraries and resolvers are not
  for (const m of body.matchAll(/\b(res|lib)\.(\w+)(?:\.(\w+))?/g)) if (!(m[2] === 'math' && m[3] === 'permutation') && !(m[1] === 'lib' && fns.has(`lib.${m[2]}.${m[3]}`))) problems.add(`${m[1]}.${m[2]}`);
  // world attributes changed during play: only those the game applies
  for (const m of reached.matchAll(/wo\[\s*"(\w+)"\s*\]\s*=(?!=)/g)) if (!RUNTIME_WORLD.has(m[1]) && m[1] !== 'ConserveLevel') problems.add(`wo["${m[1]}"]`);
  return [...problems];
}

/** The wo:drawMap/drawRect/drawBorder calls in a piece of Lua: method, argument text, drawn keys. */
export function drawCalls(text) {
  const calls = [];
  for (const m of text.matchAll(/:\s*(draw(?:Map|Rect|Border))\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '"') i = text.indexOf('"', i + 1);
      else if (text[i] === '(' || text[i] === '{') depth++;
      else if (text[i] === ')' || text[i] === '}') depth--;
      if (i < 0) break;
      i++;
    }
    const args = text.slice(start, i < 0 ? text.length : i - 1);
    // the arguments' own strings: without index expressions (sender["_pos"]) and calls (ti({…}))
    let flat = args;
    while (/[[(][^[\]()]*[\])]/.test(flat)) flat = flat.replace(/[[(][^[\]()]*[\])]/g, '');
    const own = [...flat.replace(/\{[^{}]*\}/g, '').matchAll(/"([^"]*)"/g)].map((s) => s[1]);
    const keys = [];
    if (m[1] !== 'drawMap') keys.push(...own); // drawRect/drawBorder: a tile key, not a string inside a tile {…}
    else if (own.length && own[0].length > 0) {
      // drawMap(resolver, anchor, ignore, {rows}): the rows cut into keys as long as the ignore key
      const len = own[0].length;
      const rows = /\{([^{}]*)\}/.exec(flat)?.[1] ?? '';
      for (const r of rows.matchAll(/"([^"]*)"/g)) {
        for (let k = 0; k + len <= r[1].length; k += len) if (r[1].slice(k, k + len) !== own[0]) keys.push(r[1].slice(k, k + len));
      }
    }
    calls.push({ method: m[1], args, keys: [...new Set(keys)] });
  }
  return calls;
}

/** Whether the shim can run a draw call during play: its resolvers are built and ti knows its keys. */
export function drawOk(call, code, fns = new Set()) {
  // libmap's functions only with libmap loaded (lib.map.get among the level's functions)
  const libmap = fns.has('lib.map.get');
  if (!libmap && /\blib\.map\b/.test(call.args)) return false;
  const names = new Set([...call.args.matchAll(/\bres\.(\w+)/g)].map((r) => r[1]));
  let plainTi = true;
  for (const id of new Set(call.args.replace(/"[^"]*"/g, '').match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
    // a resolver kept in a variable (local resolver = res.random(ti, …)) or a map from wo:newMap
    for (const d of code.matchAll(new RegExp(`(?:^|[^.\\w])${id}\\s*=(?!=)\\s*([^\\n]*)`, 'g'))) {
      if (!libmap && /\blib\.map\b/.test(d[1])) return false;
      for (const r of d[1].matchAll(/\bres\.(\w+)/g)) names.add(r[1]);
      // a map: from wo:newMap, or with libmap from map operations ("B" * map, map:sub …)
      if (/wo:newMap/.test(d[1]) || (libmap && /\bmap\b|\*|\.\.|:sub\b|:paste\b|:replace\b/i.test(d[1]))) plainTi = false;
    }
  }
  if ([...names].some((n) => !RESOLVERS.has(n))) return false;
  if (names.size || !plainTi) return true;
  // plain tiles: every key the call draws needs a ti entry (else "Murmel kennt die Kachel nicht")
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return call.keys.every((k) => new RegExp(`\\[\\s*"${esc(k)}"\\s*\\]\\s*=(?!=)`).test(code));
}

/**
 * The keys of all maps a level makes with wo:newMap(ignore, rows), when each one's rows are a literal
 * table (inline or in a variable defined once); null when one is built otherwise.
 */
export function newMapKeys(code) {
  const keys = new Set();
  let seen = 0;
  for (const m of code.matchAll(/wo:newMap\(\s*"([^"]*)"\s*,\s*([A-Za-z_]\w*|\{[^}]*\})\s*\)/g)) {
    seen++;
    let rows = m[2];
    if (!rows.startsWith('{')) {
      const defs = [...code.matchAll(new RegExp(`(?:^|[^.\\w])${m[2]}\\s*=(?!=)\\s*(\\{[^}]*\\})`, 'g'))];
      if (defs.length !== 1) return null;
      rows = defs[0][1];
    }
    if (/[^\s,{}]/.test(rows.replace(/"[^"]*"/g, ''))) return null; // not only strings
    const len = m[1].length || 1;
    for (const r of rows.matchAll(/"([^"]*)"/g)) for (let i = 0; i + len <= r[1].length; i += len) keys.add(r[1].slice(i, i + len));
  }
  return seen === (code.match(/wo:newMap\s*\(/g) ?? []).length ? keys : null;
}

/** Kinds (st_/fl_/it_/ac_) that callbacks may create: literals in the bodies and in ti entries they use. */
export function runtimeKinds(code, api1 = false, entries = undefined, libmap = false) {
  const body = bodies(code, api1 ? entries : undefined);
  const kinds = new Set([...body.matchAll(/"((?:st|fl|it|ac)_\w+)"/g)].map((m) => m[1]));
  if (api1) {
    // old names ("st-wood"), also kept in globals the reached functions use (mainstone = "st-rock1")
    const old = new Set([...body.matchAll(/"((?:st|fl|it|ac)-[\w-]+)"/g)].map((m) => m[1]));
    const ids = new Set([...body.matchAll(/\b[A-Za-z_]\w*\b/g)].map((m) => m[0]));
    for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*"((?:st|fl|it|ac)-[\w-]+)"/gm)) if (ids.has(m[1])) old.add(m[2]);
    // helpers of api1.lua with their own kinds (abyss(x, y), oxyd(x, y) …)
    for (const id of ids) for (const k of API1_HELPER_KINDS.get(id) ?? []) old.add(k);
    for (const o of old) kinds.add(api1Kind(o) ?? o);
  }
  // fire messages to floors: burning items
  if (/:\s*(setfire|forcefire|ignite|heat)\s*\(/.test(body)) kinds.add('it_burnable_ignited');
  // drawMap/drawRect/drawBorder during play: the tiles of the keys in their string arguments (map lines, keys)
  const keys = new Set();
  for (const m of body.matchAll(/:\s*draw(?:Map|Rect|Border)\s*\(/g)) {
    // the arguments up to the matching parenthesis
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < body.length && depth > 0) {
      if (body[i] === '"') i = body.indexOf('"', i + 1);
      else if (body[i] === '(' || body[i] === '{') depth++;
      else if (body[i] === ')' || body[i] === '}') depth--;
      if (i < 0) break;
      i++;
    }
    const args = body.slice(start, i - 1);
    for (const str of args.matchAll(/"([^"]*)"/g)) for (const ch of str[1]) keys.add(ch);
    // tiles kept in variables (SynapseOn = {"fl_redslab"})
    for (const id of args.replace(/"[^"]*"/g, '').matchAll(/\b([A-Za-z_]\w*)\b/g)) {
      for (const d of code.matchAll(new RegExp(`\\b${id[1]}\\s*=\\s*([^\\n]*)`, 'g'))) for (const k of d[1].matchAll(/"((?:st|fl|it)_\w+)"/g)) kinds.add(k[1]);
    }
  }
  // keys longer than one character (drawMap(ti, p, "  ", {"u y "}): "u ", "y ")
  for (const d of drawCalls(body)) for (const k of d.keys) keys.add(k);
  // res.random during play: the tiles of every key its call names (hits, superkeys, replacements)
  if (/:\s*draw(?:Map|Rect|Border)\s*\(/.test(body) && /\bres\.random\s*\(/.test(code)) {
    for (const m of code.matchAll(/\bres\.random\s*\(/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < code.length && depth > 0) {
        if (code[i] === '"') i = code.indexOf('"', i + 1);
        else if (code[i] === '(') depth++;
        else if (code[i] === ')') depth--;
        if (i < 0) break;
        i++;
      }
      for (const s of code.slice(start, i < 0 ? code.length : i).matchAll(/"([^"]*)"/g)) keys.add(s[1]);
    }
  }
  // maps from wo:newMap kept in variables (parts[kind] ^ rotation): the keys of their rows when every
  // map is made from literal rows (wo:newMap(" ", part1), local part1 = {"  A ", …}), else any ti entry
  if (/:\s*drawMap\s*\(/.test(body) && /wo:newMap/.test(code)) {
    // with libmap, operations that make new keys ("r" * map, map:replace/paste, map[pos] = key): any
    // ti entry; joining, cutting and turning (map .. map, map:sub, map ^ t) keep the rows' keys
    const newKeys = /"[^"\n]*"\s*\*\s*[A-Za-z_(]|[\w)\]]\s*\*\s*"|:(replace|replace_outside|paste|set_default_key|extend)\s*\(|\blib\.map\.(fuse|paste|replace|replace_outside|set|set_default_key|extend)\b/.test(code);
    const mapKeys = libmap && newKeys ? null : newMapKeys(code);
    for (const d of code.matchAll(/ti\[\s*"([^"]*)"\s*\]\s*=([^\n]*)/g)) {
      if (mapKeys && !mapKeys.has(d[1])) continue;
      for (const k of d[2].matchAll(/"((?:st|fl|it)_\w+)"/g)) kinds.add(k[1]);
    }
  }
  // a key's tile, also through the ti entries it builds on (ti["hG"] = ti["h1"] .. {"it_trap"})
  const seen = new Set();
  const live = code.replace(/^\s*--[^\n]*/gm, ''); // not commented-out entries
  const addKey = (ch) => {
    if (seen.has(ch)) return;
    seen.add(ch);
    const key = ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const d of live.matchAll(new RegExp(`ti\\[\\s*"${key}"\\s*\\]\\s*=([^\\n]*)`, 'g'))) {
      for (const k of d[1].matchAll(/"((?:st|fl|it)_\w+)"/g)) kinds.add(k[1]);
      for (const r of d[1].matchAll(/ti\[\s*"([^"]*)"\s*\]/g)) addKey(r[1]);
    }
  };
  for (const ch of keys) addKey(ch);
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
export async function luaInit(code, w, libs = [], api1 = false) {
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
  const lua = await LuaLevel.create(code, host, SHIM, await import('fengari'), libs.map((l) => libCode(l.name)), api1 ? API1_SHIM : undefined);
  // wo["FallenPuzzle"] = "=key": the kinds of tile ti[key]
  let fallenTile = null;
  if (typeof world.FallenPuzzle === 'string' && world.FallenPuzzle.startsWith('=')) {
    const before = adds.length;
    lua.describeTile(world.FallenPuzzle.slice(1));
    fallenTile = adds.splice(before).filter((a) => a.kind.startsWith('tile:')).map((a) => a.kind.slice(5));
  }
  const error = lua.lastError;
  // callback targets that name a Lua function after the init ("pento.next" in a library's table)
  return { world, adds, fallenTile, error, isFunction: (name) => !error && lua.isFunction(name) };
}
