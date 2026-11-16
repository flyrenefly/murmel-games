// Vorladen (docs/LASTTEST.md, „Erstbesuch verkleinern“): which files the service worker puts into its
// cache on install. The two classic graphics sets are split off: only the set of the active style is
// precached, the other one when the player switches to it. Used by the offline plugin in vite.config.ts,
// so this file imports nothing.

/** The classic graphics sets below public/enigma/ (like ClassicSet in src/render/classic.ts). */
export const GRAFIKSAETZE = ['gfx32', 'gfx32-retro'] as const;
export type Grafiksatz = (typeof GRAFIKSAETZE)[number];

/** Precached when the page never chose a set: the set of the default style „Klassisch“. */
export const SATZ_STANDARD: Grafiksatz = 'gfx32';

export interface VorladeListen {
  /** Always precached: everything but the graphics sets. */
  grund: string[];
  /** Per set: its files, plus the gfx32 image for every name the retro set lacks (src/render/classic.ts falls back to it). */
  saetze: Record<Grafiksatz, string[]>;
}

/** Splits the precache list (paths relative to dist/) into the base and one list per graphics set. */
export function vorladeListen(dateien: string[]): VorladeListen {
  const saetze = { gfx32: [], 'gfx32-retro': [] } as Record<Grafiksatz, string[]>;
  const grund: string[] = [];
  for (const f of dateien) {
    const m = /^enigma\/(gfx32|gfx32-retro)\/(.+)$/.exec(f);
    if (m) saetze[m[1] as Grafiksatz].push(f);
    else grund.push(f);
  }
  const retro = new Set(saetze['gfx32-retro'].map((f) => f.slice('enigma/gfx32-retro/'.length)));
  const ersatz = saetze.gfx32.filter((f) => !retro.has(f.slice('enigma/gfx32/'.length)));
  saetze['gfx32-retro'].push(...ersatz);
  return { grund, saetze };
}
