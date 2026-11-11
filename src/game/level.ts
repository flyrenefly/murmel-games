// Level format: a character map plus a legend. Every cell has a floor and
// optionally a stone, named with Enigma kinds (fl_gray, st_granite, st_oxyd …),
// so own levels and levels imported from Enigma use the same model.

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
}

export interface Cell {
  floor: string;
  stone: string | null;
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

export const isDeadly = (floor: string): boolean => DEADLY_FLOORS.has(floor);

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
      cells.push({ floor, stone });
    }
  }

  if (startCells > 1) throw new LevelError(`${file.id}: mehr als ein Startpunkt`);
  if (!start) throw new LevelError(`${file.id}: kein Startpunkt '@'`);
  if (signals.length === 0) throw new LevelError(`${file.id}: keine Oxyd-Steine`);

  assignRandomSymbols(file.id, signals, random);

  const counts = new Map<string, number>();
  for (const s of signals) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
  for (const [symbol, n] of counts) {
    if (n % 2 !== 0) throw new LevelError(`${file.id}: Symbol ${symbol} kommt ${n}× vor, erwartet paarweise`);
  }

  return { id: file.id, title: file.title, author: file.author, license: file.license, width, height, cells, start, signals };
}

/** Gives '?' stones random colours in pairs, using colours not taken by fixed stones. */
function assignRandomSymbols(id: string, signals: SignalStone[], random: () => number): void {
  const auto = signals.filter((s) => s.symbol === '?');
  if (auto.length === 0) return;
  if (auto.length % 2 !== 0) throw new LevelError(`${id}: ungerade Zahl zufälliger Oxyd-Steine`);
  const taken = new Set(signals.filter((s) => s.symbol !== '?').map((s) => s.symbol));
  const free = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((c) => !taken.has(c));
  const pool: string[] = [];
  for (let i = 0; i < auto.length / 2; i++) {
    const sym = free[i % free.length];
    pool.push(sym, sym);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  auto.forEach((s, i) => (s.symbol = pool[i]));
}

export function cellAt(level: Level, col: number, row: number): Cell | null {
  if (col < 0 || row < 0 || col >= level.width || row >= level.height) return null;
  return level.cells[row * level.width + col];
}
