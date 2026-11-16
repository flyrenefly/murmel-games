// Teilen nach dem Lösen: ein Satz mit Level, Zeit und Link. Web Share API, wo es sie gibt, sonst die
// Zwischenablage. Nur Text und Link, keine Netzwerk-Knöpfe, keine Fremd-Skripte, nichts an den Server.
import { type Sprache, sprache, woerterbuch } from './i18n';
import EN from './i18n/en/spiel';
import type { LevelFile } from './game/level';
import { buildPages, displayTitle, langPath, SITE } from './levelseiten/seiten';

const t = woerterbuch(EN);

/** Was geteilt wird: das Level eines Pakets (Levelseite) oder ein Spieler-Level (Spiel-Link). */
export type TeilenZiel =
  | { art: 'paket'; pack: string; levels: readonly LevelFile[]; index: number }
  | { art: 'spieler'; id: string; titel: string };

/** Absolute Adresse zum Teilen: Levelseite (/level/…, englisch /en/level/…) bzw. /#spieler=<n>. */
export function teilenLink(ziel: TeilenZiel, lang: Sprache = sprache()): string | null {
  const home = `${SITE}/${lang === 'en' ? 'en/' : ''}`;
  if (ziel.art === 'spieler') {
    const n = /^spieler:(\d+)$/.exec(ziel.id)?.[1];
    return n ? `${home}#spieler=${n}` : null;
  }
  // dieselben Adressen wie der Generator (tools/levelseiten/bauen.mjs): Slugs hängen nur vom Paket ab
  const seite = buildPages([{ id: ziel.pack, title: ziel.pack, levels: [...ziel.levels] }])[0]?.levels[ziel.index];
  return seite ? `${SITE}/${langPath(seite.path, lang)}` : null;
}

/** Titel wie auf der Levelseite (ohne Zierstriche, englisch mit titleEn). */
export function teilenTitel(ziel: TeilenZiel, lang: Sprache = sprache()): string {
  if (ziel.art === 'spieler') return ziel.titel;
  const f = ziel.levels[ziel.index];
  return f ? displayTitle(f, lang) : '';
}

/** „Level „X“ in 1:23,4 gelöst – https://…“ */
export function teilenText(titel: string, zeit: string, link: string): string {
  return t('Level „{titel}“ in {zeit} gelöst – {link}', { titel, zeit, link });
}

export type TeilenErgebnis = 'geteilt' | 'kopiert' | 'abgebrochen' | 'fehler';

interface Teiler {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

/**
 * Teilt Text und Link: zuerst über das Teilen-Menü des Geräts, sonst in die Zwischenablage.
 * Bricht der Spieler das Menü ab, wird nichts kopiert.
 */
export async function teilen(titel: string, text: string, nav: Teiler = navigator): Promise<TeilenErgebnis> {
  // text enthält den Link schon: url nicht doppelt mitgeben (manche Ziele hängen ihn sonst zweimal an)
  const data: ShareData = { title: titel, text };
  if (nav.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'geteilt';
    } catch (e) {
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'abgebrochen';
      // NotAllowedError u. a.: weiter mit der Zwischenablage
    }
  }
  try {
    if (!nav.clipboard) return 'fehler';
    await nav.clipboard.writeText(text);
    return 'kopiert';
  } catch {
    return 'fehler';
  }
}

/** Rückmeldung für den Toast (null: nichts zeigen). */
export function teilenMeldung(r: TeilenErgebnis, link: string): string | null {
  if (r === 'kopiert') return t('Text und Link kopiert.');
  if (r === 'fehler') return t('Kopieren ging nicht. Link: {link}', { link });
  return null;
}

export const TEILEN_KNOPF = (): string => t('Teilen');
