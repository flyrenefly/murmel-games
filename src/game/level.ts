// Level format: a character map plus a legend. Every cell has up to three
// layers (floor, stone, item), like Enigma, so imported levels fit later.

export type FloorKind = 'stone' | 'abyss';
export type StoneKind = 'wall' | 'signal';

export interface CellDef {
  floor?: FloorKind;
  stone?: StoneKind;
  /** Symbol of a signal stone; every symbol must occur exactly twice. */
  symbol?: string;
  /** Start position of the marble. */
  start?: boolean;
}

export interface LevelFile {
  id: string;
  title: string;
  author: string;
  license: string;
  map: string[];
  legend?: Record<string, CellDef>;
}

export interface Cell {
  floor: FloorKind;
  stone: StoneKind | null;
  symbol: string | null;
}

export interface SignalStone {
  index: number;
  col: number;
  row: number;
  symbol: string;
}

export interface Level {
  id: string;
  title: string;
  author: string;
  license: string;
  width: number;
  height: number;
  cells: Cell[];
  start: { col: number; row: number };
  signals: SignalStone[];
}

export const DEFAULT_LEGEND: Record<string, CellDef> = {
  '#': { floor: 'stone', stone: 'wall' },
  '.': { floor: 'stone' },
  o: { floor: 'abyss' },
  '@': { floor: 'stone', start: true },
};

export class LevelError extends Error {}

/** Letters A–Z are signal stones with that letter as symbol. */
function resolve(ch: string, legend: Record<string, CellDef>): CellDef | undefined {
  if (legend[ch]) return legend[ch];
  if (/^[A-Z]$/.test(ch)) return { floor: 'stone', stone: 'signal', symbol: ch };
  return undefined;
}

export function parseLevel(file: LevelFile): Level {
  const legend = { ...DEFAULT_LEGEND, ...(file.legend ?? {}) };
  const height = file.map.length;
  const width = Math.max(0, ...file.map.map((r) => r.length));
  if (height === 0 || width === 0) throw new LevelError(`${file.id}: leere Karte`);

  const cells: Cell[] = [];
  const signals: SignalStone[] = [];
  let start: { col: number; row: number } | null = null;

  for (let row = 0; row < height; row++) {
    const line = file.map[row].padEnd(width, '#');
    for (let col = 0; col < width; col++) {
      const ch = line[col];
      const def = resolve(ch, legend);
      if (!def) throw new LevelError(`${file.id}: unbekanntes Zeichen '${ch}' in Zeile ${row + 1}`);
      const cell: Cell = { floor: def.floor ?? 'stone', stone: def.stone ?? null, symbol: null };
      if (def.stone === 'signal') {
        if (!def.symbol) throw new LevelError(`${file.id}: Signalstein ohne Symbol`);
        cell.symbol = def.symbol;
        signals.push({ index: signals.length, col, row, symbol: def.symbol });
      }
      if (def.start) {
        if (start) throw new LevelError(`${file.id}: mehr als ein Startpunkt`);
        start = { col, row };
      }
      cells.push(cell);
    }
  }

  if (!start) throw new LevelError(`${file.id}: kein Startpunkt '@'`);

  const counts = new Map<string, number>();
  for (const s of signals) counts.set(s.symbol, (counts.get(s.symbol) ?? 0) + 1);
  for (const [symbol, n] of counts) {
    if (n !== 2) throw new LevelError(`${file.id}: Symbol ${symbol} kommt ${n}× vor, erwartet 2×`);
  }
  if (signals.length === 0) throw new LevelError(`${file.id}: keine Signalsteine`);

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
  };
}

export function cellAt(level: Level, col: number, row: number): Cell | null {
  if (col < 0 || row < 0 || col >= level.width || row >= level.height) return null;
  return level.cells[row * level.width + col];
}
