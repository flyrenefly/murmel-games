// Strukturierte Daten der Startseite (de/en): gültiges JSON-LD, Spiel mit Pflichtfeldern, Bilder vorhanden.
// Die Levelseiten prüfen src/levelseiten/seiten.test.ts und tools/levelseiten/pruefen.mjs.
import { describe, expect, it } from 'vitest';
import index from '../../index.html?raw';
import presse from '../../presse.html?raw';
import EN_INDEX from './en/seite-index';
import EN_PRESSE from './en/seite-presse';
import { englischeSeite } from './seiten-en';

const bilder = Object.keys(import.meta.glob('/public/presse/*.webp', { query: '?url', eager: true })).map((p) => p.replace(/^\/public/, 'https://murmel.games'));

function bloecke(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

type Knoten = Record<string, unknown>;
function spiel(html: string): Knoten {
  const nodes = bloecke(html).flatMap((b) => ((b as Knoten)['@graph'] as Knoten[] | undefined) ?? [b as Knoten]);
  const games = nodes.filter((n) => [n['@type']].flat().includes('VideoGame'));
  expect(games).toHaveLength(1);
  return games[0];
}

describe('JSON-LD der Startseite', () => {
  for (const [lang, html] of [['de', index], ['en', englischeSeite(index, EN_INDEX, '')]] as const) {
    it(`${lang}: VideoGame/WebApplication mit Pflichtfeldern`, () => {
      expect(bloecke(html).every((b) => (b as Knoten)['@context'] === 'https://schema.org')).toBe(true);
      const g = spiel(html);
      expect(g['@type']).toEqual(['VideoGame', 'WebApplication']);
      expect(g['@id']).toBe('https://murmel.games/#game');
      for (const k of ['name', 'url', 'description', 'image', 'applicationCategory', 'operatingSystem', 'genre', 'gamePlatform', 'license']) expect(g[k], k).toBeTruthy();
      expect(g.applicationCategory).toBe('GameApplication');
      expect(g.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'EUR' });
      expect(g.isAccessibleForFree).toBe(true);
      expect(g.playMode).toEqual(['SinglePlayer', 'MultiPlayer']);
      expect(g.inLanguage).toBe(lang);
      // keine doppelte Spielbeschreibung: genau ein VideoGame (spiel() prüft das)
    });
  }

  it('Screenshots im JSON-LD gibt es als Dateien (public/presse/)', () => {
    const shots = spiel(index).screenshot as string[];
    expect(shots.length).toBe(5);
    expect(bilder.sort()).toEqual([...shots].sort());
  });

  it('die Pressemappe zeigt dieselben Screenshots', () => {
    const imgs = [...presse.matchAll(/<img[^>]*src="(presse\/[^"]+)"/g)].map((m) => `https://murmel.games/${m[1]}`);
    expect(imgs.sort()).toEqual(bilder.sort());
  });
});

describe('englische Pressemappe', () => {
  const out = englischeSeite(presse, EN_PRESSE, 'presse.html');
  it('Sprache, Canonical, Links auf englische Seiten', () => {
    expect(out).toMatch(/<html lang="en"/);
    expect(out).toContain('<link rel="canonical" href="https://murmel.games/en/presse.html"');
    expect(out).toContain('<title>Press kit – Murmel, the free browser marble game</title>');
    expect(out).toContain('href="en/level/"');
    expect(out).toContain('href="en/ueber.html"');
    expect(out).toContain('href="presse.html" hreflang="de" lang="de">Deutsch</a>');
    expect(out).not.toMatch(/oxyd\s+online/i);
  });
});
