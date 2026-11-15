// Checks before sharing (docs/SPEC-editor.md §5). Errors block sharing, hints do not.

import { isDeadly, parseLevel } from '../game/level';
import { cellOf, type EditorLevel, oxydCounts, sources, targets, toLevelFile } from './model';
import { MAX_DOCS } from './link';
import { BY_KIND, paletteText } from './palette';
import { woerterbuch } from '../i18n';
import EN from '../i18n/en/editor';

const t = woerterbuch(EN);

export interface Problem {
  level: 'fehler' | 'hinweis';
  text: string;
  /** Cells to highlight. */
  cells?: { x: number; y: number }[];
}

/** Meditation items a pearl rests in (negative states in Meditation.cc). */
const DENTS = new Set(['it_meditation_hollow', 'it_meditation_dent', 'it_meditation_caldera']);

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

  if (!l.title.trim()) err(t('Das Level braucht einen Titel.'));

  // the marble
  if (!l.start) err(t('Die Murmel fehlt: setze genau eine Murmel oder Start-Perle (Spezial).'));
  else {
    const c = cellOf(l, l.start.x, l.start.y)!;
    if (c.s) err(t('Die Murmel steht auf einem Stein.'), [l.start]);
    if (isDeadly(c.f)) err(t('Die Murmel startet auf Abgrund oder Wasser.'), [l.start]);
  }

  // Oxyd stones
  const oxyds: { x: number; y: number; symbol: string }[] = [];
  l.cells.forEach((c, i) => {
    if (c.s === 'st_oxyd') oxyds.push({ x: i % l.width, y: Math.floor(i / l.width), symbol: c.sa?.symbol ?? '?' });
  });
  // Meditation (Meditation.cc): the level is also won when every pearl rests in a hollow
  const pearls = (l.mainPearl ? 1 : 0) + l.actors.filter((a) => /^ac_pearl_/.test(a.k)).length;
  const hollows = l.cells.filter((c) => c.i && DENTS.has(c.i)).length;
  const meditation = pearls > 0 && hollows >= pearls;
  if (pearls > 0 && hollows > 0 && hollows < pearls) err(t('Für jede Perle braucht es eine Mulde, Delle oder einen Krater ({perlen} Perlen, {mulden} Mulden).', { perlen: pearls, mulden: hollows }));
  if (oxyds.length < 2 && !meditation)
    err(pearls > 0 && hollows === 0 ? t('Es braucht mindestens zwei Oxyd-Steine oder für jede Perle eine Mulde (Meditation).') : t('Es braucht mindestens zwei Oxyd-Steine.'), oxyds);
  for (const [symbol, n] of oxydCounts(l)) {
    if (n % 2 === 0) continue;
    const cells = oxyds.filter((o) => o.symbol === symbol);
    err(symbol === '?' ? t('Die Zahl der Zufallsfarben-Steine ist ungerade ({n}).', { n }) : t('Oxyd-Farbe {farbe} hat keinen Partner ({n}×).', { farbe: symbol, n }), cells);
  }

  // reachability (only certain cases are errors)
  if (l.start) {
    const any = reachable(l, false);
    const safe = reachable(l, true);
    const lost = oxyds.filter((o) => !touched(l, any, o.x, o.y));
    if (lost.length) err(lost.length === 1 ? t('Ein Oxyd-Stein ist von der Murmel aus nicht erreichbar.') : t('{n} Oxyd-Steine sind von der Murmel aus nicht erreichbar.', { n: lost.length }), lost);
    const risky = oxyds.filter((o) => touched(l, any, o.x, o.y) && !touched(l, safe, o.x, o.y));
    if (risky.length) hint(t('Manche Oxyd-Steine sind nur über Abgrund oder Wasser erreichbar.'), risky);
    const unreachableSources = sources(l).filter((s) => !any.has(s.y * l.width + s.x) && !touched(l, any, s.x, s.y));
    if (unreachableSources.length) hint(t('Manche Schalter sind nicht erreichbar.'), unreachableSources);
  }

  // documents (user decision 15.11.2026: plain text, at most MAX_DOCS per level)
  const docs: { x: number; y: number; text: string }[] = [];
  l.cells.forEach((c, i) => {
    if (c.i === 'it_document') docs.push({ x: i % l.width, y: Math.floor(i / l.width), text: c.ia?.text ?? '' });
  });
  if (docs.length > MAX_DOCS) err(t('Höchstens {max} Dokumente je Level (jetzt {n}).', { max: MAX_DOCS, n: docs.length }), docs);
  const empty = docs.filter((d) => !d.text.trim());
  if (empty.length) hint(empty.length === 1 ? t('Ein Dokument hat noch keinen Text.') : t('{n} Dokumente haben noch keinen Text.', { n: empty.length }), empty);

  // connections
  const names = new Set(targets(l).map((t) => t.name));
  for (const s of sources(l)) {
    const name = paletteText(s.entry.label);
    if (!s.target) hint(t('{name} ohne Ziel.', { name }), [s]);
    else if (!names.has(s.target)) err(t('{name} zeigt auf „{ziel}“, das es nicht gibt.', { name, ziel: s.target }), [s]);
  }

  // open border: the marble could roll out
  const open: { x: number; y: number }[] = [];
  for (let x = 0; x < l.width; x++)
    for (const y of [0, l.height - 1]) if (!cellOf(l, x, y)!.s && !isDeadly(cellOf(l, x, y)!.f)) open.push({ x, y });
  for (let y = 1; y < l.height - 1; y++)
    for (const x of [0, l.width - 1]) if (!cellOf(l, x, y)!.s && !isDeadly(cellOf(l, x, y)!.f)) open.push({ x, y });
  if (open.length) hint(t('Der Rand ist offen: die Murmel kann aus dem Level rollen.'), open);

  // whatever else the game would refuse
  if (!out.some((p) => p.level === 'fehler')) {
    const msg = loadError(l);
    if (msg) err(t('Das Spiel kann das Level nicht laden: {grund}', { grund: msg }));
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
