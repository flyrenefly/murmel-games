// Levelzahl für Werbetexte (Pressemappe, App-Manifest). Eine Quelle: der Build zählt die Levels
// (vite.config.ts, levelAnzahl in tools/lib/levels.mjs) und setzt sie für den Platzhalter ein.
// Gemeint sind die verschiedenen spielbaren Levels inklusive Murmels eigener – dieselbe Zahl wie
// „Alle Levels“ der Levelübersicht (Querverweise in Tutorials zählen nicht doppelt). In Texten steht
// sie auf Hunderter abgerundet: „über 1.200“ / „more than 1,200“.
import type { Woerterbuch } from './i18n';

/** Platzhalter in Seiten, Wörterbüchern und public/manifest.webmanifest. */
export const LEVELZAHL = '{levelzahl}';

/**
 * Die volle Hunderterzahl unter der Anzahl, in der Schreibweise der Sprache: 1203 → „1.200“ / „1,200“.
 * Echt kleiner, damit „über …“ stimmt: 1200 → „1.100“.
 */
export function levelzahlText(anzahl: number, lang: 'de' | 'en'): string {
  if (!Number.isInteger(anzahl) || anzahl <= 100) throw new Error(`Levelzahl unplausibel: ${anzahl}`);
  return String(Math.floor((anzahl - 1) / 100) * 100).replace(/\B(?=(\d{3})+$)/g, lang === 'de' ? '.' : ',');
}

/** Platzhalter in einem Text ersetzen. */
export function setzeLevelzahl(text: string, anzahl: number, lang: 'de' | 'en'): string {
  return text.split(LEVELZAHL).join(levelzahlText(anzahl, lang));
}

/** Wörterbuch mit eingesetzter Zahl: Schlüssel deutsch (wie in der gebauten Seite), Werte englisch. */
export function woerterbuchMitLevelzahl(en: Woerterbuch, anzahl: number): Woerterbuch {
  return Object.fromEntries(Object.entries(en).map(([k, v]) => [setzeLevelzahl(k, anzahl, 'de'), setzeLevelzahl(v, anzahl, 'en')]));
}
