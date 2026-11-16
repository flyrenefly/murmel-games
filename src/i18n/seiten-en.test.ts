import { describe, expect, it } from 'vitest';
import EN_INDEX from './en/seite-index';
import EN_UEBER from './en/seite-ueber';
import { englischeSeite, uebersetzeJsonLd } from './seiten-en';
import index from '../../index.html?raw';
import ueber from '../../ueber.html?raw';

describe('englische Startseite und About-Seite', () => {
  for (const [name, html, en, pfad] of [['index', index, EN_INDEX, ''], ['ueber', ueber, EN_UEBER, 'ueber.html']] as const) {
    const out = englischeSeite(html, en, pfad);
    it(`${name}: Sprache, Basis, Canonical, hreflang, og:locale`, () => {
      expect(out).toMatch(/<html lang="en"/);
      expect(out).toMatch(/<head>\s*<base href="\.\.\/" \/>/);
      expect(out).toContain(`<link rel="canonical" href="https://murmel.games/en/${pfad}"`);
      expect(out).toContain(`<meta property="og:url" content="https://murmel.games/en/${pfad}"`);
      expect(out).toContain(`hreflang="de" href="https://murmel.games/${pfad}"`);
      expect(out).toContain(`hreflang="en" href="https://murmel.games/en/${pfad}"`);
      expect(out).toContain(`hreflang="x-default" href="https://murmel.games/${pfad}"`);
      expect(out).toContain('<meta property="og:locale" content="en_US" />');
      expect(out).toContain('<meta property="og:locale:alternate" content="de_DE" />');
      expect(out).not.toContain('<meta property="og:locale:alternate" content="en_US" />');
    });
    it(`${name}: Texte englisch, JSON-LD gültig, kein „Oxyd online“`, () => {
      const title = /<title>([^<]*)<\/title>/.exec(out)?.[1] ?? '';
      expect(title).toMatch(/style of Oxyd and Enigma/);
      expect(out).toMatch(/<meta\s+data-i18n-attr="content"\s+name="description"\s+content="[A-Z][^"]*(marble|Murmel)[^"]*"/);
      expect(out).not.toMatch(/oxyd\s+online/i);
      for (const m of out.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const ld = JSON.parse(m[1]);
        expect(JSON.stringify(ld)).not.toMatch(/"inLanguage":"de"/);
        expect(JSON.stringify(ld)).not.toMatch(/Murmelspiel|Kann man|kostenlos/);
      }
    });
  }
  it('Startseite: Fußzeile und Ladetext englisch, Links auf englische About-Seite', () => {
    const out = englischeSeite(index, EN_INDEX, '');
    expect(out).toContain('<div id="loading" data-i18n>Loading Murmel …</div>');
    expect(out).toContain('<a href="en/ueber.html">About the game</a>');
    expect(out).toContain('Privacy (German)');
  });
  it('About-Seite: Sprachlink zurück auf Deutsch, Spielen-Link auf /en/', () => {
    const out = englischeSeite(ueber, EN_UEBER, 'ueber.html');
    expect(out).toMatch(/<a class="lang"[^>]*href="ueber.html" hreflang="de" lang="de">Deutsch<\/a>/);
    expect(out).toMatch(/<a class="play"[^>]*href="en\/">Play now<\/a>/);
    expect(out).toContain('<a href="en/level/">Browse all levels</a>');
  });
  it('JSON-LD: Texte aus dem Wörterbuch, inLanguage en', () => {
    expect(JSON.parse(uebersetzeJsonLd('{"a":"Hallo","inLanguage":"de","b":["Hallo","x"]}', { Hallo: 'Hello' }))).toEqual({ a: 'Hello', inLanguage: 'en', b: ['Hello', 'x'] });
  });
});
