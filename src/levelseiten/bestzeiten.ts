// Bestzeiten auf den Levelseiten (docs/SPEC-levelseiten.md): lädt die öffentliche Rangliste eines
// Levels (GET /api/bestenliste/level) und zeigt Bestzeit und Top 3. Ohne Cookie (credentials: omit),
// ohne Importe: tools/levelseiten/bauen.mjs entfernt nur die Typen und schreibt level/bestzeiten.js.
// Ohne JS oder ohne API bleibt die Seite vollständig, nur ohne Zeiten.

/** Sekunden je Physikschritt (src/game/physics.ts PHYSICS_DT; ein Test hält beide gleich). */
export const STEP_SECONDS = 0.0025;

export interface RankRow {
  platz: number;
  name: string | null;
  zeit: number;
}

/** m:ss,t aus Physikschritten, wie im Spiel und auf der Ranglistenseite. */
export function zeit(steps: number): string {
  const t = Math.round(steps * STEP_SECONDS * 10);
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${t % 10}`;
}

/** Die ersten drei gültigen Einträge der Antwort (unbekannte Form → leer). */
export function top3(data: unknown): RankRow[] {
  const list = (data as { eintraege?: unknown } | null)?.eintraege;
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is RankRow => !!e && Number.isInteger(e.platz) && Number.isFinite(e.zeit) && (e.name === null || typeof e.name === 'string'))
    .slice(0, 3);
}

function el(tag: string, cls: string, text: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.textContent = text;
  return e;
}

async function zeigen(box: HTMLElement): Promise<void> {
  const id = box.dataset.level;
  if (!id) return;
  let rows: RankRow[];
  try {
    const res = await fetch(`/api/bestenliste/level?${new URLSearchParams({ id })}`, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return;
    rows = top3(await res.json());
  } catch {
    return; // offline oder API nicht da: Seite ohne Zeiten
  }
  if (!rows.length) {
    box.replaceChildren(el('p', '', 'Noch keine Zeiten. Löse das Level angemeldet, um den ersten Platz zu belegen.'));
    return;
  }
  const ol = document.createElement('ol');
  ol.setAttribute('aria-label', 'Die besten drei');
  for (const r of rows) {
    const li = document.createElement('li');
    li.append(el('span', 'platz', `${r.platz}.`), r.name ? el('span', 'name', r.name) : el('span', 'noname', 'ohne Namen'), el('span', 'zeit', zeit(r.zeit)));
    ol.append(li);
  }
  box.replaceChildren(el('p', '', `Bestzeit: ${zeit(rows[0].zeit)}`), ol);
}

if (typeof document !== 'undefined') {
  const box = document.getElementById('bestzeiten');
  if (box) void zeigen(box);
}
