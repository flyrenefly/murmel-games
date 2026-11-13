// Level format: a character map plus a legend. Every cell has a floor and
// optionally a stone, named with Enigma kinds (fl_gray, st_granite, st_oxyd …),
// so own levels and levels imported from Enigma use the same model.
// Interactive stones and items (doors, switches, triggers …) are listed in `objects`.

import type { ActorDef } from './actors';
import type { RubberDef } from './rubber';
import type { ObjectDef } from './objects';

/** Floors that kill the marble (it falls or drowns). */
export const DEADLY_FLOORS = new Set(['fl_abyss', 'fl_water']);

export interface CellDef {
  /** Enigma floor kind; legacy names: 'stone' = fl_gray, 'abyss' = fl_abyss. */
  floor?: string;
  /** Enigma stone kind; legacy names: 'wall' = st_greenbrown, 'signal' = st_oxyd. */
  stone?: string;
  /** Oxyd stone: symbol (letter) or '?' for a random pair assignment at level start. */
  symbol?: string;
  /** Oxyd stone flavor a–d (look only). */
  flavor?: string;
  /** Start position of the marble (centre of this cell). */
  start?: boolean;
  /** Constant floor force (Floor::add_force: force_x/force_y, or a slope's direction × strength). */
  force?: [number, number];
  /** Hollow stone (OBJBIT_HOLLOW): drawn like the stone, but actors pass (STONE_PASS). */
  hollow?: boolean;
  /** Fire attributes of the floor (burnable, secure, eternal, noash, fastfire, ignitable). */
  fire?: Record<string, string>;
}

export interface LevelFile {
  id: string;
  title: string;
  author: string;
  license: string;
  map: string[];
  legend?: Record<string, CellDef>;
  /** Exact start position in tile units (overrides a start cell). */
  start?: { x: number; y: number };
  /** Origin of an imported level. */
  source?: { pack: string; file: string };
  /** Interactive objects (doors, switches, triggers, documents, grates). */
  objects?: ObjectDef[];
  /** Texts of documents by key. */
  texts?: Record<string, string>;
  /** Enigma compatibility version of an imported level (message names of API 1 below 1.10). */
  compat?: number;
  /** Other actors (rotors, tops, killers), positions in tile units. */
  actors?: ActorDef[];
  /** Rubber bands between actors (0 = black marble, n = actors[n − 1]) or to a stone centre. */
  rubbers?: RubberDef[];
  /** World attributes the level script sets (GlobalForce "x,y", FrictionStrength). */
  world?: Record<string, string>;
  /** Lua callbacks of the level (src/lua). */
  lua?: LevelLua;
  /** No black marble: this pearl (at the start) is the main ball, actor index 0. */
  mainPearl?: { k: string; a?: Record<string, string> };
}

export interface LevelLua {
  /** The level script (el:luamain). */
  code: string;
  /** Kinds callbacks may set: floor/stone image name, 'object' or 'nil'. */
  kinds: Record<string, string>;
  /** Names and custom attributes of floors (l 'fl') and plain stones (l 'st'). */
  named: { l: string; x: number; y: number; a: Record<string, string> }[];
  /** Name and custom attributes of the black marble. */
  marble?: Record<string, string>;
  /** Enigma libraries the script needs (src/lua/lib, e.g. "libpento"), run before it. */
  libs?: string[];
}

export interface Cell {
  floor: string;
  stone: string | null;
  /** Floor force of this cell's floor (cleared when the floor changes). */
  force?: [number, number];
  /** The stone is hollow: actors pass through it. */
  hollow?: boolean;
  /** Fire attributes of the floor (cleared when the floor changes). */
  fire?: Record<string, string>;
}

export interface SignalStone {
  index: number;
  col: number;
  row: number;
  symbol: string;
  flavor: string;
}

export interface Level {
  id: string;
  title: string;
  author: string;
  license: string;
  width: number;
  height: number;
  cells: Cell[];
  /** Start position in tile units (marble centre). */
  start: { x: number; y: number };
  signals: SignalStone[];
  objects: ObjectDef[];
  texts: Record<string, string>;
  compat: number;
  actors: ActorDef[];
  rubbers: RubberDef[];
  world: Record<string, string>;
  lua: LevelLua | null;
  mainPearl: { k: string; a?: Record<string, string> } | null;
}

export const DEFAULT_LEGEND: Record<string, CellDef> = {
  '#': { floor: 'fl_gray', stone: 'st_greenbrown' },
  '.': { floor: 'fl_gray' },
  o: { floor: 'fl_abyss' },
  '@': { floor: 'fl_gray', start: true },
};

const LEGACY_FLOOR: Record<string, string> = { stone: 'fl_gray', abyss: 'fl_abyss' };
const LEGACY_STONE: Record<string, string> = { wall: 'st_greenbrown', signal: 'st_oxyd' };

export class LevelError extends Error {}

/** Letters A–Z are Oxyd stones with that letter as symbol. */
function resolve(ch: string, legend: Record<string, CellDef>): CellDef | undefined {
  if (legend[ch]) return legend[ch];
  if (/^[A-Z]$/.test(ch)) return { floor: 'fl_gray', stone: 'st_oxyd', symbol: ch };
  return undefined;
}

/** Deadly floors; an open bridge (fl_bridge_*_open) lets actors fall too (BridgeFloor::actor_contact). */
export const isDeadly = (floor: string): boolean => DEADLY_FLOORS.has(floor) || /^fl_bridge_\w+_open$/.test(floor);

/**
 * @param random random source for the colour assignment of '?' Oxyd stones
 *               (Enigma shuffles the colours at every level start).
 */
export function parseLevel(file: LevelFile, random: () => number = Math.random): Level {
  const legend = { ...DEFAULT_LEGEND, ...(file.legend ?? {}) };
  const height = file.map.length;
  const width = Math.max(0, ...file.map.map((r) => r.length));
  if (height === 0 || width === 0) throw new LevelError(`${file.id}: leere Karte`);

  const cells: Cell[] = [];
  const signals: SignalStone[] = [];
  let start: { x: number; y: number } | null = file.start ?? null;
  let startCells = 0;

  for (let row = 0; row < height; row++) {
    const line = file.map[row].padEnd(width, '#');
    for (let col = 0; col < width; col++) {
      const ch = line[col];
      const def = resolve(ch, legend);
      if (!def) throw new LevelError(`${file.id}: unbekanntes Zeichen '${ch}' in Zeile ${row + 1}`);
      const floor = LEGACY_FLOOR[def.floor ?? ''] ?? def.floor ?? 'fl_gray';
      const stone = def.stone ? (LEGACY_STONE[def.stone] ?? def.stone) : null;
      if (stone === 'st_oxyd') {
        if (!def.symbol) throw new LevelError(`${file.id}: Oxyd-Stein ohne Symbol`);
        signals.push({ index: signals.length, col, row, symbol: def.symbol, flavor: def.flavor ?? 'a' });
      }
      if (def.start) {
        startCells++;
        if (!file.start) start = { x: col + 0.5, y: row + 0.5 };
      }
      const cell: Cell = { floor, stone };
      if (def.force) cell.force = def.force;
      if (def.fire) cell.fire = { ...def.fire };
      if (def.hollow && stone) cell.hollow = true;
      cells.push(cell);
    }
  }

  if (startCells > 1) throw new LevelError(`${file.id}: mehr als ein Startpunkt`);
  if (!start) throw new LevelError(`${file.id}: kein Startpunkt '@'`);
  // Meditation levels (Enigma ChangeMeditation): pearls and hollows instead of Oxyd stones
  // Meditation levels: pearls (also the main pearl, which is not in actors) and meditation hollows
  const meditation = (!!file.mainPearl || (file.actors ?? []).some((a) => /^ac_pearl/.test(a.k))) && (file.objects ?? []).some((o) => o.k.startsWith('it_meditation'));
  // Lua may set Oxyd stones during play (Pentomino: wo[…] = {"st_oxyd"} once the puzzle is done)
  const luaOxyds = file.lua?.kinds.st_oxyd === 'oxyd';
  if (signals.length === 0 && !meditation && !luaOxyds) throw new LevelError(`${file.id}: keine Oxyd-Steine`);

  assignRandomSymbols(file.id, signals, random);

  const counts = new Map<string, number>();
  for (const s of signals) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
  for (const [symbol, n] of counts) {
    if (n % 2 !== 0 && symbol !== FAKE_OXYD) throw new LevelError(`${file.id}: Symbol ${symbol} kommt ${n}× vor, erwartet paarweise`);
  }

  // Other objects (ot_timer) have no cell.
  const objects = (file.objects ?? []).filter((o) => o.k.startsWith('ot_') || (o.x >= 0 && o.y >= 0 && o.x < width && o.y < height));
  return {
    id: file.id,
    title: file.title,
    author: file.author,
    license: file.license,
    width,
    height,
    cells,
    start,
    signals,
    objects,
    texts: file.texts ?? {},
    compat: file.compat ?? 1.1,
    actors: file.actors ?? [],
    rubbers: file.rubbers ?? [],
    mainPearl: file.mainPearl ?? null,
    world: file.world ?? {},
    lua: file.lua ?? null,
  };
}

/** Symbol of a fake Oxyd stone (OxydStone FAKE): never opens, closes a single open stone. */
export const FAKE_OXYD = '-';

/**
 * OxydStone::initColors: '?' stones first complete fixed colours that occur an odd number of
 * times, then get random colours in pairs (colours not taken by fixed stones); an odd one left
 * over becomes a fake Oxyd stone.
 */
export function assignRandomSymbols(id: string, signals: SignalStone[], random: () => number): void {
  const auto = signals.filter((s) => s.symbol === '?');
  const count = new Map<string, number>();
  for (const s of signals) if (s.symbol !== '?') count.set(s.symbol, (count.get(s.symbol) ?? 0) + 1);
  const pool: string[] = [];
  for (const [sym, n] of count) {
    if (n % 2 === 0) continue;
    if (pool.length >= auto.length) throw new LevelError(`${id}: Oxyd-Farbe ${sym} ohne Partner`);
    pool.push(sym);
  }
  if (auto.length === 0) return;
  const taken = new Set(count.keys());
  const free = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => !taken.has(c));
  const rest = auto.length - pool.length;
  for (let i = 0; i < Math.floor(rest / 2); i++) {
    const sym = free[i % free.length];
    pool.push(sym, sym);
  }
  if (rest % 2) pool.push(FAKE_OXYD);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  auto.forEach((s, i) => (s.symbol = pool[i]));
}

/**
 * wo[pos] = {"st_oxyd"} during play: a new closed Oxyd stone ('?' until wo:shuffleOxyd or its
 * first hit colours it, see colorNewSignals). Returns it, or null outside the level.
 */
export function addSignal(level: Level, col: number, row: number, flavor: string): SignalStone | null {
  const cell = cellAt(level, col, row);
  if (!cell) return null;
  const old = level.signals.find((s) => s.col === col && s.row === row);
  if (old) return old;
  cell.stone = 'st_oxyd';
  delete cell.hollow;
  const s: SignalStone = { index: level.signals.length, col, row, symbol: '?', flavor };
  level.signals.push(s);
  return s;
}

/** OxydStone::initColors for Oxyd stones made during play: their '?' becomes colours in pairs. */
export function colorNewSignals(level: Level, random: () => number): boolean {
  if (!level.signals.some((s) => s.symbol === '?')) return false;
  assignRandomSymbols(level.id, level.signals, random);
  return true;
}

export function cellAt(level: Level, col: number, row: number): Cell | null {
  if (col < 0 || row < 0 || col >= level.width || row >= level.height) return null;
  return level.cells[row * level.width + col];
}
