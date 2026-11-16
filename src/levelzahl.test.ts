// Eine Levelzahl für alle Werbetexte (src/levelzahl.ts): gezählt beim Build, nirgends fest im Text.
import { describe, expect, it } from 'vitest';
import presse from '../presse.html?raw';
import ueber from '../ueber.html?raw';
import index from '../index.html?raw';
import manifest from '../public/manifest.webmanifest?raw';
import { levelAnzahl, loadLevels } from '../tools/lib/levels.mjs';
import EN_PRESSE from './i18n/en/seite-presse';
import { englischeSeite } from './i18n/seiten-en';
import { buildPages, type PackSource } from './levelseiten/seiten';
import { LEVELZAHL, levelzahlText, setzeLevelzahl, woerterbuchMitLevelzahl } from './levelzahl';

const woerterbuecher = import.meta.glob('./i18n/en/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('levelzahlText', () => {
  it('rundet auf die volle Hundert darunter, echt kleiner', () => {
    expect(levelzahlText(1203, 'de')).toBe('1.200');
    expect(levelzahlText(1203, 'en')).toBe('1,200');
    expect(levelzahlText(1299, 'de')).toBe('1.200');
    expect(levelzahlText(1200, 'de')).toBe('1.100');
    expect(levelzahlText(999, 'en')).toBe('900');
    expect(levelzahlText(12345, 'de')).toBe('12.300');
  });
  it('lehnt Unsinn ab (leere Leveldaten)', () => {
    expect(() => levelzahlText(0, 'de')).toThrow();
    expect(() => levelzahlText(Number.NaN, 'de')).toThrow();
  });
});

describe('gezählte Levels', () => {
  it('gleich „Alle Levels“ der Levelübersicht', () => {
    // wie tools/levelseiten/bauen.mjs: Pakete in Spielreihenfolge, Querverweise ohne eigene Seite
    const sources: PackSource[] = [];
    for (const { pack, file, ref } of loadLevels()) {
      if (ref) continue;
      let src = sources.at(-1);
      if (src?.id !== pack) sources.push((src = { id: pack, title: pack, levels: [] }));
      src.levels.push(file as unknown as PackSource['levels'][number]);
    }
    const uebersicht = buildPages(sources).reduce((n, p) => n + p.levels.length, 0);
    expect(levelAnzahl()).toBe(uebersicht);
    expect(levelAnzahl()).toBeGreaterThan(1000);
  });
});

describe('keine feste Levelzahl in Texten', () => {
  // „über 1.100 Levels“, „über 1000 Levels“, „more than 1,100 levels“, „over 1,000 levels“ …
  const fest = /\b(über|mehr als|more than|over)\s+\d[\d.,\s]*\s+levels\b/i;
  const quellen: Record<string, string> = { 'presse.html': presse, 'ueber.html': ueber, 'index.html': index, 'public/manifest.webmanifest': manifest, ...woerterbuecher };

  for (const [name, text] of Object.entries(quellen)) {
    it(name, () => expect(text.match(fest)?.[0]).toBeUndefined());
  }

  it('Pressemappe und Manifest nutzen den Platzhalter', () => {
    expect(presse.split(LEVELZAHL).length - 1).toBe(2);
    expect(manifest).toContain(LEVELZAHL);
    for (const [de, en] of Object.entries(EN_PRESSE)) expect(en.includes(LEVELZAHL), de).toBe(de.includes(LEVELZAHL));
  });
});

describe('gebaute Pressemappe', () => {
  const n = levelAnzahl();
  const de = setzeLevelzahl(presse, n, 'de');
  const en = englischeSeite(de, woerterbuchMitLevelzahl(EN_PRESSE, n), 'presse.html');
  it('deutsch und englisch mit derselben Zahl, kein Platzhalter übrig', () => {
    expect(de).toContain(`über ${levelzahlText(n, 'de')} Levels`);
    expect(en).toContain(`more than ${levelzahlText(n, 'en')} levels`);
    expect(en).toContain(`More than ${levelzahlText(n, 'en')} levels`);
    expect(de).not.toContain(LEVELZAHL);
    expect(en).not.toContain(LEVELZAHL);
    expect(en).not.toMatch(/Über \d/);
  });
  it('Manifest', () => {
    const m = JSON.parse(setzeLevelzahl(manifest, n, 'de')) as { description: string };
    expect(m.description).toContain(`über ${levelzahlText(n, 'de')} Levels`);
  });
});
