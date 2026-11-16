// Bestzeiten auf den Levelseiten (docs/SPEC-levelseiten.md): lädt die öffentliche Rangliste eines
// Levels (GET /api/bestenliste/level) und zeigt Bestzeit und Top 3. Ohne Cookie (credentials: omit),
// ohne Importe: tools/levelseiten/bauen.mjs entfernt nur die Typen und schreibt level/bestzeiten.js.
// Ohne JS oder ohne API bleibt die Seite vollständig, nur ohne Zeiten. Sprache aus <html lang> (de/en).

/** Sekunden je Physikschritt (src/game/physics.ts PHYSICS_DT; ein Test hält beide gleich). */
export const STEP_SECONDS = 0.0025;

export interface RankRow {
  platz: number;
  name: string | null;
  zeit: number;
}

export type Lang = 'de' | 'en';

/** Texte der Anzeige je Sprache. */
export const TEXTE = {
  de: { leer: 'Noch keine Zeiten. Löse das Level angemeldet, um den ersten Platz zu belegen.', top: 'Die besten drei', ohneName: 'ohne Namen', bestzeit: 'Bestzeit' },
  en: { leer: 'No times yet. Solve the level while signed in to take first place.', top: 'The best three', ohneName: 'no name', bestzeit: 'Best time' },
};

/** Sprache der Seite: Englisch bei <html lang="en…">, sonst Deutsch. */
export function sprache(lang: string | null | undefined): Lang {
  return /^en(-|$)/i.test(lang ?? '') ? 'en' : 'de';
}

/** m:ss,t aus Physikschritten, wie im Spiel und auf der Ranglistenseite (Englisch: m:ss.t). */
export function zeit(steps: number, lang: Lang = 'de'): string {
  const t = Math.round(steps * STEP_SECONDS * 10);
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${lang === 'en' ? '.' : ','}${t % 10}`;
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
  const lang = sprache(document.documentElement.lang);
  const tx = TEXTE[lang];
  let rows: RankRow[];
  try {
    const res = await fetch(`/api/bestenliste/level?${new URLSearchParams({ id })}`, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return;
    rows = top3(await res.json());
  } catch {
    return; // offline oder API nicht da: Seite ohne Zeiten
  }
  if (!rows.length) {
    box.replaceChildren(el('p', '', tx.leer));
    return;
  }
  const ol = document.createElement('ol');
  ol.setAttribute('aria-label', tx.top);
  for (const r of rows) {
    const li = document.createElement('li');
    li.append(el('span', 'platz', `${r.platz}.`), r.name ? el('span', 'name', r.name) : el('span', 'noname', tx.ohneName), el('span', 'zeit', zeit(r.zeit, lang)));
    ol.append(li);
  }
  box.replaceChildren(el('p', '', `${tx.bestzeit}: ${zeit(rows[0].zeit, lang)}`), ol);
}

if (typeof document !== 'undefined') {
  const box = document.getElementById('bestzeiten');
  if (box) void zeigen(box);
}
