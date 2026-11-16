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
  ...[...API1_SHIM.matchAll(/^\s+(\w+) = "([\w<>^-]+)",?\r?$/gm)].map((m) => [m[2], m[1]]),
  ...[...API1_SHIM.matchAll(/^\s+\["([\w<>^-]+)"\] = \{"(\w+)"/gm)].map((m) => [m[1], m[2]]),
]);
/** Old kind names the helper functions of api1.lua set (abyss → "fl-abyss"). */
const API1_HELPER_KINDS = new Map(
  API1_SHIM.split(/^(?=function\s)/m)
    .map((chunk) => [/^function\s+(\w+)/.exec(chunk)?.[1], [...chunk.matchAll(/"((?:st|fl|it|ac)-[\w<>^-]+)"/g)].map((m) => m[1])])
    .filter(([n, kinds]) => n && kinds.length),
);
// and their aliases (document = Document: Khun Phan's hints)
for (const [, alias, f] of API1_SHIM.matchAll(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*$/gm)) if (API1_HELPER_KINDS.has(f) && !API1_HELPER_KINDS.has(alias)) API1_HELPER_KINDS.set(alias, API1_HELPER_KINDS.get(f));
/** Slope shapes of API 1 fl-gradient types (api1.lua SLOPES). */
const API1_SLOPES = [...(/^local SLOPES = \{([^}]*)\}/m.exec(API1_SHIM)?.[1] ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1]);
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
const RESOLVERS = new Set(['autotile', 'composer', 'pento', 'random']);

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
 * Top-level functions by name → [start, end) in the code. Old levels do not indent: a function
 * ends at its matching "end" (blocks counted, strings and comments skipped).
 */
function functionRanges(code) {
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
    byName.set(h[1], [h.index, end]);
  }
  return byName;
}

/**
 * API 1 levels draw rows with a function of their own that goes through a pattern character by
 * character (renderLine(line, pattern): local c = strsub(pattern, i, i); if c == "#" then … elseif …).
 * When every call the callbacks (entries) make passes a literal pattern, the branches of characters
 * none of them draws can never run during play: they are blanked out of the returned code (for the
 * kind analysis only – Encased: the marble's "z" is drawn in the init alone).
 */
export function pruneCharBranches(code, entries) {
  const ranges = functionRanges(code);
  const reachedNames = new Set();
  const todo = [...entries];
  while (todo.length) {
    const n = todo.pop();
    if (reachedNames.has(n) || !ranges.has(n)) continue;
    reachedNames.add(n);
    const [s, e] = ranges.get(n);
    for (const m of code.slice(s, e).matchAll(/[A-Za-z_][\w.]*/g)) if (ranges.has(m[0])) todo.push(m[0]);
  }
  let out = code;
  for (const [name, [s, e]] of ranges) {
    if (!reachedNames.has(name)) continue;
    const body = code.slice(s, e);
    const params = /^function\s+[\w.]+\s*\(([^)]*)\)/.exec(body)?.[1].split(',').map((p) => p.trim()) ?? [];
    const pick = new RegExp(String.raw`local\s+(\w+)\s*=\s*(?:strsub|string\.sub)\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*\3\s*\)`).exec(body);
    const arg = pick ? params.indexOf(pick[2]) : -1;
    if (arg < 0) continue;
    // the characters the callbacks draw with it (outside its own body); unknown → keep everything
    const used = new Set();
    let known = true;
    for (const caller of reachedNames) {
      if (caller === name) continue;
      const [cs, ce] = ranges.get(caller);
      for (const call of code.slice(cs, ce).matchAll(new RegExp(String.raw`(?<![\w.:])${name.replace(/\./g, '\\.')}\s*\(([^()\n]*)\)`, 'g'))) {
        const a = call[1].split(',')[arg]?.trim() ?? '';
        if (/^"[^"\\]*"$/.test(a)) for (const ch of a.slice(1, -1)) used.add(ch);
        else known = false;
      }
    }
    if (!known) continue;
    // blank each branch "if/elseif c == "x" then … " whose character is never drawn
    const branch = new RegExp(String.raw`\b(?:if|elseif)\s+${pick[1]}\s*==\s*"(.)"\s*then\b([\s\S]*?)(?=\belseif\b|\belse\b|\bend\b)`, 'g');
    const pruned = body.replace(branch, (all, ch, inner) => (used.has(ch) ? all : all.slice(0, all.length - inner.length) + inner.replace(/[^\n]/g, ' ')));
    out = out.slice(0, s) + pruned + out.slice(e);
  }
  return out;
}

/**
 * Bodies of the top-level functions (header line up to an "end" as far indented as the header:
 * 4 - 8 - 4 indents all its functions by one space). With entries
 * (API 1: the callbacks the level's objects name) only the functions they reach: old levels
 * build their world with functions that run in the init only.
 */
export function bodies(code, entries) {
  const all = [...code.matchAll(/^([ \t]*)function\b[\s\S]*?^\1end\b/gm)].map((m) => m[0]);
  if (!entries) return all.join('\n');
  const byName = new Map([...functionRanges(code)].map(([n, [s, e]]) => [n, code.slice(s, e)]));
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

// (newMap: the shim's wo:newMap, or libmap's when loaded, also works during play – Enigris)
const METHODS = new Set(['newMap', 'shuffleOxyd', 'sound', 'open', 'close', 'toggle', 'on', 'off', 'flip', 'turn', 'signal', 'grow', 'explode', 'shovel', 'turnback', 'orientate', 'closeall', 'peepall', 'setfire', 'forcefire', 'stopfire', 'heat', 'ignite','set', 'fl', 'st', 'it', 'message', 'exists', 'kill', 'xy', 'sub', 'sort', 'shuffle', 'nearest', 'is', 'kind', 'grid',
  // string methods
  'len', 'upper', 'lower', 'find', 'match', 'gsub', 'gmatch', 'rep', 'format', 'byte', 'reverse']);
const FUNCS = new Set(['po', 'grp', 'st', 'it', 'fl', 'ti', 'cond', 'etype', 'ipairs', 'pairs', 'type', 'tostring', 'tonumber', 'unpack', 'select', 'next',
  'error', 'assert', 'print', 'rawget', 'rawset', 'setmetatable', 'getmetatable', 'random']);
const KEYWORDS = new Set(['if', 'while', 'for', 'function', 'return', 'and', 'or', 'not', 'elseif', 'until', 'local', 'then', 'do', 'end', 'in', 'else', 'repeat']);
/** World attributes the game applies (also when set during play). */
/** wo:add(YIN, {obj["_attr"]}): an item kind the level keeps in an own attribute (Puzzle Shift: switches' _type). */
const DYNAMIC_ADD = /wo:add\(\s*(YIN|YANG|[01])\s*,\s*\{\s*[A-Za-z_]\w*\s*\[\s*"(_\w+)"\s*\]\s*\}\s*\)/g;
/** The kinds every assignment of that attribute names, if all are item literals (else null). */
function dynamicItems(code, attr) {
  const values = [...code.matchAll(new RegExp(String.raw`\b${attr}\s*=\s*([^,}\n]*)`, 'g'))].map((m) => m[1].trim());
  if (values.length === 0 || !values.every((v) => /^"it_\w+"$/.test(v))) return null;
  return values.map((v) => v.slice(1, -1));
}

export const RUNTIME_WORLD = new Set(['GlobalForce', 'FrictionStrength', 'ElectricStrength', 'SlopeStrength']);
const API1 = /\b(set_stone|set_floor|set_item|set_actor|set_attrib|get_attrib|fill_floor|fill_stones|draw_\w+|create_world|SendMessage|enigma\.\w+)\s*\(/;

/**
 * What the callbacks use that the shim does not know (empty = fine).
 * api1: the level uses API 1 (api1.lua); entries: its callbacks (only what they reach counts).
 */
export function luaProblems(code, fns, api1 = false, entries = undefined) {
  const problems = new Set();
  // (not the level's own functions – Sunrise Sunset: function draw_line() – nor enigma.random, which
  // API 2 also has: Panic Room)
  const api1Calls = [...code.matchAll(new RegExp(API1.source, 'g'))].filter((m) => !fns.has(m[1]) && m[1] !== 'enigma.random' && !/\bfunction\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index)));
  if (!api1 && api1Calls.length) problems.add('API 1');
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
  // wo:add during play: only items into an inventory (YIN/YANG), rubber bands, wires, timers and counters
  const raw = reached.replace(/--[^\n]*/g, '');
  const adds = [...body.matchAll(/:\s*add\s*\(/g)].length;
  const ok = [...raw.matchAll(/wo:add\(\s*(YIN|YANG|[01])\s*,\s*\{\s*"it_\w+"\s*(,\s*(connections|text)\s*=[^}]*)?\}\s*\)/g)].length + [...raw.matchAll(/wo:add\(\s*\{\s*"ot_(rubberband|timer|counter|wire)"/g)].length
    + [...raw.matchAll(DYNAMIC_ADD)].filter((m) => dynamicItems(code, m[2]) !== null).length;
  if (adds > ok) problems.add(':add');
  // the rubber bands and wires of an object as Lua objects (sender["rubbers"]:kill(), Tinker, Tailor): not built
  for (const m of raw.matchAll(/\[\s*"(rubbers|fellows)"\s*\]|\.(rubbers|fellows)\b/g)) problems.add(`obj.${m[1] ?? m[2]}`);
  // function parameters may hold functions (local f in "function scan(f)")
  for (const m of body.matchAll(/\bfunction\b[\w\s.:]*\(([^)]*)\)/g)) for (const p of m[1].split(',')) locals.add(p.trim());
  for (const m of body.matchAll(/(^|[^.:\w])([A-Za-z_]\w*)\s*\(/g)) {
    const n = m[2];
    if (/:\s*$/.test(body.slice(0, m.index + m[1].length))) continue; // obj: close() is a method call
    if (!FUNCS.has(n) && !KEYWORDS.has(n) && !fns.has(n) && !locals.has(n) && !(api1 && (API1_GLOBALS.has(n) || assigned.has(n)))) problems.add(`${n}()`);
  }
  // lib.math.permutation is provided (enigma.lua), functions of loaded libraries too; other libraries and resolvers are not
  // the resolvers the shim builds (res.autotile, res.random, res.pento) work; draw calls are checked above
  for (const m of body.matchAll(/\b(res|lib)\.(\w+)(?:\.(\w+))?/g)) if (!(m[2] === 'math' && m[3] === 'permutation') && !(m[1] === 'lib' && fns.has(`lib.${m[2]}.${m[3]}`)) && !(m[1] === 'res' && RESOLVERS.has(m[2]))) problems.add(`${m[1]}.${m[2]}`);
  // world attributes changed during play: only those the game applies
  for (const m of reached.matchAll(/wo\[\s*"(\w+)"\s*\]\s*=(?!=)/g)) if (!RUNTIME_WORLD.has(m[1]) && m[1] !== 'ConserveLevel') problems.add(`wo["${m[1]}"]`);
  return [...problems];
}

/** Whether the level's functions may change the world (wo[…] = …, wo(…), wo:drawMap/drawRect/drawBorder/add). */
export function callbacksBuild(code) {
  return /\bwo\s*(\[|\(|:\s*(draw\w+|add)\s*\()/.test(bodies(code));
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

/**
 * API 1 callbacks that set a stone or item of a kind held in a variable (The Turtle:
 * set_stone(tab.face, x, y) with the faces in a table built at the top): every stone or item kind
 * the code names may come. The importer allows the supported ones (like API 1 floors) and skips
 * the others, so this never rejects a level.
 */
export function api1VariableKinds(code, entries) {
  const body = bodies(code, entries);
  const out = new Set();
  for (const [fn, layer] of [['set_stone', 'st'], ['set_item', 'it']]) {
    if (!new RegExp(String.raw`\b${fn}\s*\(\s*[A-Za-z_]`).test(body)) continue;
    for (const m of code.matchAll(new RegExp(String.raw`"(${layer}-[\w<>^-]+)"`, 'g'))) out.add(api1Kind(m[1]) ?? m[1].replace(/-/g, '_'));
  }
  return [...out];
}

/**
 * cond(wo["CreatingPreview"], preview, play) → play: Murmel never makes previews, so during play
 * the world attribute is unset (Sunrise Sunset: ti["A"] is the marble only in the preview).
 */
export function playBranch(code) {
  const head = /\bcond\(\s*wo\[\s*"CreatingPreview"\s*\]\s*,/g;
  let out = '';
  let from = 0;
  for (let m = head.exec(code); m; m = head.exec(code)) {
    // the two arguments up to the matching parenthesis (strings skipped)
    const args = [];
    let depth = 0;
    let start = m.index + m[0].length;
    let i = start;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === '"') i = code.indexOf('"', i + 1);
      else if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' && depth === 0) break;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 0) {
        args.push(code.slice(start, i));
        start = i + 1;
      }
      if (i < 0) return code;
    }
    args.push(code.slice(start, i));
    if (args.length !== 2) continue;
    out += code.slice(from, m.index) + args[1].trim();
    from = i + 1;
    head.lastIndex = from;
  }
  return out + code.slice(from);
}

/** Kinds (st_/fl_/it_/ac_) that callbacks may create: literals in the bodies and in ti entries they use. */
export function runtimeKinds(code, api1 = false, entries = undefined, libmap = false) {
  code = playBranch(code);
  const body = bodies(code, api1 ? entries : undefined);
  // (actors also as "#ac_…": placed at the cell centre)
  const kinds = new Set([...body.matchAll(/"#?((?:st|fl|it|ac)_\w+)"/g)].map((m) => m[1]));
  // wo:add(YIN, {sender["_type"]}): the items the level keeps in that attribute
  for (const m of body.matchAll(DYNAMIC_ADD)) for (const k of dynamicItems(code, m[2]) ?? []) kinds.add(k);
  if (api1) {
    // old names ("st-wood"), also kept in globals the reached functions use (mainstone = "st-rock1")
    // (mirrors keep their direction in the name: "st-mirror-3>", "st-mirror-3<t")
    const old = new Set([...body.matchAll(/"((?:st|fl|it|ac)-[\w<>^-]+)"/g)].map((m) => m[1]));
    const ids = new Set([...body.matchAll(/\b[A-Za-z_]\w*\b/g)].map((m) => m[0]));
    for (const m of code.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*"((?:st|fl|it|ac)-[\w<>^-]+)"/gm)) if (ids.has(m[1])) old.add(m[2]);
    // helpers of api1.lua with their own kinds (abyss(x, y), oxyd(x, y) …)
    for (const id of ids) for (const k of API1_HELPER_KINDS.get(id) ?? []) old.add(k);
    for (const o of old) kinds.add(api1Kind(o) ?? o);
    // fl-gradient with a type (Tilt Board: {type = gdir}): any shape (api1.lua SLOPES)
    if (old.has('fl-gradient') && /\btype\s*=/.test(body)) for (const s of API1_SLOPES) kinds.add(`fl_slope_${s}`);
  }
  // fire messages to floors: burning items
  if (/:\s*(setfire|forcefire|ignite|heat)\s*\(/.test(body)) kinds.add('it_burnable_ignited');
  // drawMap/drawRect/drawBorder during play: the tiles of the keys in their string arguments (map lines, keys)
  const keys = new Set();
  const ignored = new Set();
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
    // drawMap never sets its ignore key (Sunrise Sunset: "@", the marble's key in the init map)
    let flat = args;
    while (/[[(][^[\]()]*[\])]/.test(flat)) flat = flat.replace(/[[(][^[\]()]*[\])]/g, '');
    const ignore = /draw\s*Map|drawMap/.test(m[0]) ? (/"([^"]*)"/.exec(flat.replace(/\{[^{}]*\}/g, ''))?.[1] ?? null) : null;
    // (a kind such as {"it_cross"} is a tile, not keys "i", "t" … – it counts above as a literal)
    for (const str of args.matchAll(/"([^"]*)"/g)) if (!/^(st|fl|it|ac)_\w+$/.test(str[1])) for (const ch of str[1]) (ch === ignore ? ignored : keys).add(ch);
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
      for (const k of d[1].matchAll(/"#?((?:st|fl|it|ac)_\w+)"/g)) kinds.add(k[1]);
      for (const r of d[1].matchAll(/ti\[\s*"([^"]*)"\s*\]/g)) addKey(r[1]);
    }
  };
  // res.composer: a key without a tile of its own is built from its characters, each in a key of spaces
  // (only where a callback composes: levels that compose in their init keep their kinds and level hashes)
  if (/\bres\.composer\s*\(/.test(body)) {
    for (const k of [...keys]) {
      if (k.length < 2) continue;
      for (let i = 0; i < k.length; i++) if (k[i] !== ' ') keys.add(' '.repeat(i) + k[i] + ' '.repeat(k.length - i - 1));
    }
  }
  for (const ch of keys) addKey(ch);
  // drawMap's ignore key is never set; its floors, stones and items have always counted (harmless,
  // and leaving them out would change many level files), its actors not (Sunrise Sunset: the marble)
  const before = new Set(kinds);
  for (const ch of ignored) if (!keys.has(ch)) addKey(ch);
  for (const k of kinds) if (!before.has(k) && k.startsWith('ac_')) kinds.delete(k);
  for (const m of body.matchAll(/ti\[\s*"([^"]+)"\s*\]/g)) {
    const key = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const d of code.matchAll(new RegExp(`ti\\[\\s*"${key}"\\s*\\]\\s*=([^\\n]*)`, 'g'))) {
      for (const k of d[1].matchAll(/"#?((?:st|fl|it|ac)_\w+)"/g)) kinds.add(k[1]);
      // and the entries it builds on (Bizarro World: ti[";"] = {"st_invisible"} .. ti["l"] → fl_lawn)
      for (const r of d[1].matchAll(/ti\[\s*"([^"]*)"\s*\]/g)) addKey(r[1]);
    }
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
/**
 * initSteps: instruction budget of an init known to end in an endless loop (LuaHost.initSteps).
 * initNames: collect the names the world building gives that the export no longer has (the init
 * overwrote them itself); no[…] finds them during this init and the result lists them (LevelLua.initNames).
 */
export async function luaInit(code, w, libs = [], api1 = false, initSteps = undefined, initNames = false) {
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
  // names lost by the init: [{n, l, x, y}] (Enigma numbers "name#" tiles; any number fits name#*)
  const lost = [];
  const mapTile = (x, y, kind, name) => {
    const l = kind.replace(/^#/, '').slice(0, 2);
    if (!['fl', 'st', 'it'].includes(l) || x >= w.w || y >= w.h) return;
    const o = w.cells[y * w.w + x][layers.indexOf(l)];
    const base = name.replace(/#$/, '');
    const n = name.endsWith('#') ? `${name}${lost.length + 1}` : name;
    if (!o?.name || !(o.name === name || (name.endsWith('#') && o.name.startsWith(base + '#')))) lost.push({ n, l, x, y });
  };
  const host = {
    initSteps,
    ...(initNames ? { mapTile, initNames: lost } : {}),
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
  return { world, adds, fallenTile, error, ...(lost.length ? { initNames: lost } : {}), isFunction: (name) => !error && lua.isFunction(name) };
}
