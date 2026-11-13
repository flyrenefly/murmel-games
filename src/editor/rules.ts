// Checks before sharing (docs/SPEC-editor.md §5). Errors block sharing, hints do not.

import { isDeadly, parseLevel } from '../game/level';
import { cellOf, type EditorLevel, oxydCounts, sources, targets, toLevelFile } from './model';
import { BY_KIND } from './palette';

export interface Problem {
  level: 'fehler' | 'hinweis';
  text: string;
  /** Cells to highlight. */
  cells?: { x: number; y: number }[];
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Only fixed walls and Oxyd stones block; doors, boxes and other objects count as passable. */
function blocks(l: EditorLevel, x: number, y: number): boolean {
  const c = cellOf(l, x, y);
  if (!c?.s) return false;
  return c.s === 'st_oxyd' || !!BY_KIND.get(c.s)?.wall || !BY_KIND.get(c.s);
}

/** Cells reachable from the start (4-neighbours); optionally deadly floors block too. */
export function reachable(l: EditorLevel, avoidDeadly: boolean): Set<number> {
  const seen = new Set<number>();
  if (!l.start) return seen;
  const todo = [l.start];
  seen.add(l.start.y * l.width + l.start.x);
  while (todo.length) {
    const p = todo.pop()!;
    for (const [dx, dy] of DIRS) {
      const x = p.x + dx;
      const y = p.y + dy;
      const c = cellOf(l, x, y);
      const i = y * l.width + x;
      if (!c || seen.has(i) || blocks(l, x, y) || (avoidDeadly && isDeadly(c.f))) continue;
      seen.add(i);
      todo.push({ x, y });
    }
  }
  return seen;
}

/** An Oxyd stone (or a stone source) is hit from a neighbour cell. */
function touched(l: EditorLevel, set: Set<number>, x: number, y: number): boolean {
  return DIRS.some(([dx, dy]) => cellOf(l, x + dx, y + dy) !== null && set.has((y + dy) * l.width + x + dx));
}

export function check(l: EditorLevel): Problem[] {
  const out: Problem[] = [];
  const err = (text: string, cells?: { x: number; y: number }[]) => out.push({ level: 'fehler', text, cells });
  const hint = (text: string, cells?: { x: number; y: number }[]) => out.push({ level: 'hinweis', text, cells });

  if (!l.title.trim()) err('Das Level braucht einen Titel.');

  // the marble
  if (!l.start) err('Die Murmel fehlt: setze genau eine Murmel (Spezial → Murmel).');
  else {
    const c = cellOf(l, l.start.x, l.start.y)!;
    if (c.s) err('Die Murmel steht auf einem Stein.', [l.start]);
    if (isDeadly(c.f)) err('Die Murmel startet auf Abgrund oder Wasser.', [l.start]);
  }

  // Oxyd stones
  const oxyds: { x: number; y: number; symbol: string }[] = [];
  l.cells.forEach((c, i) => {
    if (c.s === 'st_oxyd') oxyds.push({ x: i % l.width, y: Math.floor(i / l.width), symbol: c.sa?.symbol ?? '?' });
  });
  if (oxyds.length < 2) err('Es braucht mindestens zwei Oxyd-Steine.', oxyds);
  for (const [symbol, n] of oxydCounts(l)) {
    if (n % 2 === 0) continue;
    const cells = oxyds.filter((o) => o.symbol === symbol);
    err(symbol === '?' ? `Die Zahl der Zufallsfarben-Steine ist ungerade (${n}).` : `Oxyd-Farbe ${symbol} hat keinen Partner (${n}×).`, cells);
  }

  // reachability (only certain cases are errors)
  if (l.start) {
    const any = reachable(l, false);
    const safe = reachable(l, true);
    const lost = oxyds.filter((o) => !touched(l, any, o.x, o.y));
    if (lost.length) err(`${lost.length === 1 ? 'Ein Oxyd-Stein ist' : `${lost.length} Oxyd-Steine sind`} von der Murmel aus nicht erreichbar.`, lost);
    const risky = oxyds.filter((o) => touched(l, any, o.x, o.y) && !touched(l, safe, o.x, o.y));
    if (risky.length) hint('Manche Oxyd-Steine sind nur über Abgrund oder Wasser erreichbar.', risky);
    const unreachableSources = sources(l).filter((s) => !any.has(s.y * l.width + s.x) && !touched(l, any, s.x, s.y));
    if (unreachableSources.length) hint('Manche Schalter sind nicht erreichbar.', unreachableSources);
  }

  // connections
  const names = new Set(targets(l).map((t) => t.name));
  for (const s of sources(l)) {
    if (!s.target) hint(`${s.entry.label} ohne Ziel.`, [s]);
    else if (!names.has(s.target)) err(`${s.entry.label} zeigt auf „${s.target}“, das es nicht gibt.`, [s]);
  }

  // open border: the marble could roll out
  const open: { x: number; y: number }[] = [];
  for (let x = 0; x < l.width; x++)
    for (const y of [0, l.height - 1]) if (!cellOf(l, x, y)!.s && !isDeadly(cellOf(l, x, y)!.f)) open.push({ x, y });
  for (let y = 1; y < l.height - 1; y++)
    for (const x of [0, l.width - 1]) if (!cellOf(l, x, y)!.s && !isDeadly(cellOf(l, x, y)!.f)) open.push({ x, y });
  if (open.length) hint('Der Rand ist offen: die Murmel kann aus dem Level rollen.', open);

  // whatever else the game would refuse
  if (!out.some((p) => p.level === 'fehler')) {
    const msg = loadError(l);
    if (msg) err(`Das Spiel kann das Level nicht laden: ${msg}`);
  }
  return out;
}

/** Message of parseLevel, or null if the game can load the level (enough for playtesting). */
export function loadError(l: EditorLevel): string | null {
  try {
    parseLevel(toLevelFile(l), () => 0.5);
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).replace(/^[^:]*: /, '');
  }
}

export const canShare = (problems: Problem[]): boolean => !problems.some((p) => p.level === 'fehler');
