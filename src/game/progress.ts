/**
 * Player progress kept in the browser (docs/SPEC-lokal.md): best run per level, counters, solved
 * levels; saved to and loaded from a file, merged without losing anything. Pure functions – the
 * old state is never changed.
 */

export interface BestRun {
  /** Physics steps until the win (the time on every device: steps × PHYSICS_DT). */
  steps: number;
  falls: number;
  seed: number;
  date: string;
}

export interface LevelProgress {
  best?: BestRun;
  solves: number;
  attempts: number;
  lastPlayed?: string;
}

export interface Progress {
  levels: Record<string, LevelProgress>;
  solved: string[];
}

export function emptyProgress(): Progress {
  return { levels: {}, solved: [] };
}

/** Is a better than b? Fewer steps, then fewer falls; date and seed only make the order total. */
function better(a: BestRun, b: BestRun): boolean {
  if (a.steps !== b.steps) return a.steps < b.steps;
  if (a.falls !== b.falls) return a.falls < b.falls;
  if (a.date !== b.date) return a.date < b.date;
  return a.seed < b.seed;
}

const best = (a?: BestRun, b?: BestRun): BestRun | undefined => (!a ? b : !b ? a : better(a, b) ? a : b);
const later = (a?: string, b?: string): string | undefined => (!a ? b : !b ? a : a > b ? a : b);
const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])].sort();

function entry(p: Progress, id: string): LevelProgress {
  return p.levels[id] ?? { solves: 0, attempts: 0 };
}

/** A level was started. */
export function recordAttempt(p: Progress, id: string, date: string): Progress {
  const e = entry(p, id);
  return { ...p, levels: { ...p.levels, [id]: { ...e, attempts: e.attempts + 1, lastPlayed: date } } };
}

/** A level was won: count it, keep the better run. */
export function recordWin(p: Progress, id: string, run: Omit<BestRun, 'date'>, date: string): Progress {
  const e = entry(p, id);
  const next: LevelProgress = { ...e, solves: e.solves + 1, best: best(e.best, { ...run, date }), lastPlayed: later(e.lastPlayed, date) };
  return { levels: { ...p.levels, [id]: next }, solved: union(p.solved, [id]) };
}

/** Both states together: better runs, highest counters, every solved level (order does not matter). */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const levels: Record<string, LevelProgress> = {};
  for (const id of union(Object.keys(a.levels), Object.keys(b.levels))) {
    const x = entry(a, id);
    const y = entry(b, id);
    const m: LevelProgress = { solves: Math.max(x.solves, y.solves), attempts: Math.max(x.attempts, y.attempts) };
    const bst = best(x.best, y.best);
    if (bst) m.best = bst;
    const lp = later(x.lastPlayed, y.lastPlayed);
    if (lp) m.lastPlayed = lp;
    levels[id] = m;
  }
  return { levels, solved: union(a.solved, b.solved) };
}

// ---------- file format (version 1) ----------

export function serializeProgress(p: Progress, saved: string): string {
  return JSON.stringify({ v: 1, app: 'murmel', saved, levels: p.levels, solved: p.solved }, null, 1);
}

const MAX_ID = 200;
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 1e9;
const isDate = (v: unknown): v is string => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));

function checkBest(v: unknown): BestRun | null {
  const b = v as Partial<BestRun>;
  if (!b || typeof b !== 'object') return null;
  if (!isCount(b.steps) || b.steps === 0 || !isCount(b.falls) || !Number.isInteger(b.seed) || b.seed! < 0 || b.seed! >= 2 ** 32 || !isDate(b.date)) return null;
  return { steps: b.steps, falls: b.falls, seed: b.seed!, date: b.date };
}

function checkLevel(v: unknown): LevelProgress | null {
  const l = v as Partial<LevelProgress>;
  if (!l || typeof l !== 'object' || !isCount(l.solves) || !isCount(l.attempts)) return null;
  const out: LevelProgress = { solves: l.solves, attempts: l.attempts };
  if (l.best !== undefined) {
    const b = checkBest(l.best);
    if (!b) return null;
    out.best = b;
  }
  if (l.lastPlayed !== undefined) {
    if (!isDate(l.lastPlayed)) return null;
    out.lastPlayed = l.lastPlayed;
  }
  return out;
}

/** Reads a progress file (untrusted): throws for foreign files, skips and counts broken entries. */
export function parseProgress(text: string): { progress: Progress; skipped: number } {
  const d = JSON.parse(text) as { v?: unknown; app?: unknown; levels?: unknown; solved?: unknown };
  if (!d || d.v !== 1 || d.app !== 'murmel' || typeof d.levels !== 'object' || d.levels === null || !Array.isArray(d.solved)) {
    throw new Error('Keine Murmel-Fortschrittsdatei');
  }
  let skipped = 0;
  const levels: Record<string, LevelProgress> = {};
  for (const [id, v] of Object.entries(d.levels as Record<string, unknown>)) {
    const l = isId(id) ? checkLevel(v) : null;
    if (l) levels[id] = l;
    else skipped++;
  }
  const solved: string[] = [];
  for (const s of d.solved) {
    if (isId(s)) solved.push(s);
    else skipped++;
  }
  return { progress: { levels, solved: [...new Set(solved)].sort() }, skipped };
}
