import { describe, expect, it } from 'vitest';
import { fremdeDomain, herkunftMelden, type HerkunftEnv } from './herkunft';

describe('fremdeDomain', () => {
  it('nimmt nur den Rechnernamen, ohne Pfad, Query, Port und Zugangsdaten', () => {
    expect(fremdeDomain('https://news.ycombinator.com/item?id=123', 'murmel.games')).toBe('news.ycombinator.com');
    expect(fremdeDomain('https://user:pw@Blog.Example.org:8443/a/b#c', 'murmel.games')).toBe('blog.example.org');
    expect(fremdeDomain('http://www.reddit.com/', 'murmel.games')).toBe('www.reddit.com');
  });

  it('leer, eigene Domain, Unterdomains und Nicht-Web-Adressen zählen nicht', () => {
    for (const r of ['', 'kein link', 'https://murmel.games/forum.html', 'https://www.murmel.games/', 'https://beta.murmel.games/', 'http://localhost:5173/', 'android-app://com.google.android.gm/', 'file:///C:/x.html', 'about:blank']) {
      expect(fremdeDomain(r, 'murmel.games'), r).toBeNull();
    }
    // the own host also on another domain (e.g. a preview)
    expect(fremdeDomain('https://vorschau.example.net/x', 'vorschau.example.net')).toBeNull();
  });
});

function env(over: Partial<HerkunftEnv> & { referrer?: string } = {}) {
  const sent: { url: string; body: string }[] = [];
  let marked = false;
  const e: HerkunftEnv = {
    referrer: 'https://news.ycombinator.com/item?id=1',
    hostname: 'murmel.games',
    erlaubt: () => true,
    gemeldet: () => marked,
    merken: () => (marked = true),
    senden: (url, body) => (sent.push({ url, body }), true),
    ...over,
  };
  return { e, sent };
}

describe('herkunftMelden', () => {
  it('schickt beim ersten Aufruf der Sitzung nur die Domain, ohne Kennung', () => {
    const { e, sent } = env();
    herkunftMelden(e);
    expect(sent).toEqual([{ url: '/api/herkunft', body: '{"domain":"news.ycombinator.com"}' }]);
    // the next page view (or a reload) in the same tab sends nothing
    herkunftMelden(e);
    expect(sent).toHaveLength(1);
  });

  it('ohne fremde Herkunft nichts senden, aber die Sitzung merken', () => {
    const { e, sent } = env({ referrer: '' });
    herkunftMelden(e);
    expect(sent).toEqual([]);
    expect(e.gemeldet()).toBe(true);
  });

  it('Statistik aus (Schalter, Do Not Track, GPC, Entwicklung): nichts senden', () => {
    const { e, sent } = env({ erlaubt: () => false });
    herkunftMelden(e);
    expect(sent).toEqual([]);
  });

  it('ohne Sitzungsspeicher nichts senden (sonst zählte jedes Neuladen)', () => {
    const { e, sent } = env({ gemeldet: () => false, merken: () => false });
    herkunftMelden(e);
    expect(sent).toEqual([]);
  });

  it('Fehler beim Senden stören die Seite nicht', () => {
    const { e } = env({
      senden: () => {
        throw new Error('blockiert');
      },
    });
    expect(() => herkunftMelden(e)).not.toThrow();
  });
});
