import { afterEach, describe, expect, it } from 'vitest';
import type { LevelFile } from './game/level';
import { setzeSpracheFuerTest } from './i18n';
import { buildPages } from './levelseiten/seiten';
import { teilen, teilenLink, teilenMeldung, teilenText, teilenTitel } from './teilen';

const lv = (id: string, title: string, titleEn?: string) => ({ id, title, ...(titleEn ? { titleEn } : {}) }) as unknown as LevelFile;
const LEVELS = [lv('enigma:a', 'Brücken', 'Bridges'), lv('enigma:b', '- meditation -'), lv('enigma:c', '- meditation -')];
const paket = (index: number) => ({ art: 'paket', pack: 'enigma_ii', levels: LEVELS, index }) as const;

afterEach(() => setzeSpracheFuerTest(null));

describe('Teilen: Links', () => {
  it('Levelseite wie der Generator, englisch unter /en/', () => {
    expect(teilenLink(paket(0), 'de')).toBe('https://murmel.games/level/enigma-ii/bruecken/');
    expect(teilenLink(paket(0), 'en')).toBe('https://murmel.games/en/level/enigma-ii/bruecken/');
    // gleicher Titel zweimal: ID-Slug angehängt, genau wie die gebauten Seiten
    const gebaut = buildPages([{ id: 'enigma_ii', title: 'Enigma II', levels: LEVELS }])[0].levels.map((p) => `https://murmel.games/${p.path}`);
    expect([0, 1, 2].map((i) => teilenLink(paket(i), 'de'))).toEqual(gebaut);
    expect(teilenLink(paket(2), 'de')).toBe('https://murmel.games/level/enigma-ii/meditation-c/');
  });

  it('Spieler-Level: Spiel-Link #spieler=<n>; unbekannt: kein Link', () => {
    expect(teilenLink({ art: 'spieler', id: 'spieler:42', titel: 'X' }, 'de')).toBe('https://murmel.games/#spieler=42');
    expect(teilenLink({ art: 'spieler', id: 'spieler:42', titel: 'X' }, 'en')).toBe('https://murmel.games/en/#spieler=42');
    expect(teilenLink({ art: 'spieler', id: 'link:abc', titel: 'X' }, 'de')).toBeNull();
    expect(teilenLink(paket(9), 'de')).toBeNull();
  });

  it('Titel ohne Zierstriche, englisch mit titleEn', () => {
    expect(teilenTitel(paket(1), 'de')).toBe('meditation');
    expect(teilenTitel(paket(0), 'en')).toBe('Bridges');
    expect(teilenTitel({ art: 'spieler', id: 'spieler:1', titel: 'Mein Level' })).toBe('Mein Level');
  });
});

describe('Teilen: Text und Weg', () => {
  it('Text deutsch und englisch', () => {
    setzeSpracheFuerTest('de');
    expect(teilenText('Brücken', '1:23,4', 'https://murmel.games/level/x/')).toBe('Level „Brücken“ in 1:23,4 gelöst – https://murmel.games/level/x/');
    setzeSpracheFuerTest('en');
    expect(teilenText('Bridges', '1:23,4', 'https://murmel.games/en/level/x/')).toBe('Solved level “Bridges” in 1:23,4 – https://murmel.games/en/level/x/');
  });

  it('Web Share, wo vorhanden; Abbruch kopiert nichts', async () => {
    const kopiert: string[] = [];
    const clipboard = { writeText: async (s: string) => void kopiert.push(s) };
    const geteilt: ShareData[] = [];
    expect(await teilen('T', 'Text', { share: async (d) => void geteilt.push(d), clipboard })).toBe('geteilt');
    expect(geteilt).toEqual([{ title: 'T', text: 'Text' }]);
    const abbruch = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(await teilen('T', 'Text', { share: async () => Promise.reject(abbruch), clipboard })).toBe('abgebrochen');
    expect(kopiert).toEqual([]);
  });

  it('ohne Web Share oder bei Fehler: Zwischenablage, sonst Fehler mit Link', async () => {
    const kopiert: string[] = [];
    const clipboard = { writeText: async (s: string) => void kopiert.push(s) };
    expect(await teilen('T', 'Text', { clipboard })).toBe('kopiert');
    expect(await teilen('T', 'Text', { share: async () => Promise.reject(new Error('NotAllowed')), clipboard })).toBe('kopiert');
    expect(await teilen('T', 'Text', { share: async () => {}, canShare: () => false, clipboard })).toBe('kopiert');
    expect(kopiert).toEqual(['Text', 'Text', 'Text']);
    expect(await teilen('T', 'Text', {})).toBe('fehler');
    expect(await teilen('T', 'Text', { clipboard: { writeText: async () => Promise.reject(new Error('nein')) } })).toBe('fehler');
    setzeSpracheFuerTest('de');
    expect(teilenMeldung('kopiert', 'L')).toBe('Text und Link kopiert.');
    expect(teilenMeldung('fehler', 'https://x')).toContain('https://x');
    expect(teilenMeldung('geteilt', 'L')).toBeNull();
  });
});
