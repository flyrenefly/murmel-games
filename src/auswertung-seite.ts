/**
 * Auswertung on statistik.html (docs/SPEC-auswertung.md): the hardest levels and the abandon rate per
 * pack, computed from the sums of GET /api/statistik/auswertung. Pure functions; the page renders them.
 */
export interface LevelCounts {
  pack: string;
  level: string;
  gestartet: number;
  geloest: number;
  neustart: number;
  abbruch: number;
  abstuerze: number;
  zeitGeloest: number[];
  zeitAbbruch: number[];
}

export const ZEITKLASSEN = ['unter 1 min', '1–3 min', '3–10 min', '10–30 min', 'ab 30 min'];

/** Ended runs: solved, restarted or abandoned. */
export const beendet = (l: LevelCounts) => l.geloest + l.neustart + l.abbruch;

export interface SchweresLevel {
  pack: string;
  level: string;
  laeufe: number;
  /** solved ÷ ended runs, 0–1 */
  geloest: number;
  neustartsJeLauf: number;
  abbrueche: number;
  abstuerzeJeLauf: number;
  /** Most frequent time class of solved runs, or null when none was solved. */
  typischeZeit: string | null;
}

/** Levels with at least `min` ended runs, lowest solve rate first (ties: more runs first), at most `n`. */
export function schwersteLevels(levels: LevelCounts[], min = 5, n = 20): SchweresLevel[] {
  return levels
    .filter((l) => beendet(l) >= min)
    .map((l) => {
      const laeufe = beendet(l);
      const top = Math.max(...l.zeitGeloest);
      return {
        pack: l.pack,
        level: l.level,
        laeufe,
        geloest: l.geloest / laeufe,
        neustartsJeLauf: l.neustart / laeufe,
        abbrueche: l.abbruch,
        abstuerzeJeLauf: l.abstuerze / laeufe,
        typischeZeit: top > 0 ? ZEITKLASSEN[l.zeitGeloest.indexOf(top)] : null,
      };
    })
    .sort((a, b) => a.geloest - b.geloest || b.laeufe - a.laeufe || (a.level < b.level ? -1 : 1))
    .slice(0, n);
}

export interface PaketQuote {
  pack: string;
  laeufe: number;
  geloest: number;
  abbruch: number;
}

/** Per pack: ended runs, solve rate and abandon rate (0–1), highest abandon rate first. */
export function paketQuoten(levels: LevelCounts[]): PaketQuote[] {
  const sums = new Map<string, { laeufe: number; geloest: number; abbruch: number }>();
  for (const l of levels) {
    const s = sums.get(l.pack) ?? { laeufe: 0, geloest: 0, abbruch: 0 };
    s.laeufe += beendet(l);
    s.geloest += l.geloest;
    s.abbruch += l.abbruch;
    sums.set(l.pack, s);
  }
  return [...sums]
    .filter(([, s]) => s.laeufe > 0)
    .map(([pack, s]) => ({ pack, laeufe: s.laeufe, geloest: s.geloest / s.laeufe, abbruch: s.abbruch / s.laeufe }))
    .sort((a, b) => b.abbruch - a.abbruch || b.laeufe - a.laeufe || (a.pack < b.pack ? -1 : 1));
}
