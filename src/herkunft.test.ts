import { describe, expect, it } from 'vitest';
import { fremdeDomain, herkunftMelden, type HerkunftEnv, kampagne } from './herkunft';

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

describe('kampagne', () => {
  it('liest von= (Kleinbuchstaben, Muster) und liefert die Adresse ohne den Zusatz', () => {
    expect(kampagne('https://murmel.games/?von=google')).toEqual({ von: 'google', ohneVon: '/' });
    expect(kampagne('https://murmel.games/en/?von=Reddit')).toEqual({ von: 'reddit', ohneVon: '/en/' });
    // other parameters and the hash stay
    expect(kampagne('https://murmel.games/?level=murmel%2F01&von=hn#x')).toEqual({ von: 'hn', ohneVon: '/?level=murmel%2F01#x' });
  });

  it('ungültige Werte werden nicht gezählt, aber trotzdem aus der Adresse entfernt', () => {
    for (const v of ['', 'mit%20leerzeichen', 'a.b', 'x_y', 'a'.repeat(33), '%3Cb%3E']) {
      expect(kampagne(`https://murmel.games/?von=${v}`), v).toEqual({ von: null, ohneVon: '/' });
    }
    expect(kampagne('https://murmel.games/?level=x')).toEqual({ von: null, ohneVon: null });
    expect(kampagne('kaputt')).toEqual({ von: null, ohneVon: null });
  });
});

function env(over: Partial<HerkunftEnv> & { referrer?: string } = {}) {
  const sent: { url: string; body: string }[] = [];
  const ersetzt: string[] = [];
  let marked = false;
  const e: HerkunftEnv = {
    referrer: 'https://news.ycombinator.com/item?id=1',
    hostname: 'murmel.games',
    adresse: 'https://murmel.games/',
    adresseErsetzen: (url) => void ersetzt.push(url),
    erlaubt: () => true,
    gemeldet: () => marked,
    merken: () => (marked = true),
    senden: (url, body) => (sent.push({ url, body }), true),
    ...over,
  };
  return { e, sent, ersetzt };
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

  it('Kampagne: mit Referrer im selben Beacon, ohne Referrer trotzdem; Zusatz aus der Adresse entfernt', () => {
    const a = env({ referrer: 'https://www.google.com/', adresse: 'https://murmel.games/?von=google' });
    herkunftMelden(a.e);
    expect(a.sent).toEqual([{ url: '/api/herkunft', body: '{"domain":"www.google.com","von":"google"}' }]);
    expect(a.ersetzt).toEqual(['/']);

    const b = env({ referrer: '', adresse: 'https://murmel.games/en/?von=reddit' });
    herkunftMelden(b.e);
    expect(b.sent).toEqual([{ url: '/api/herkunft', body: '{"von":"reddit"}' }]);
    expect(b.ersetzt).toEqual(['/en/']);
  });

  it('Kampagne bei späterem Aufruf der Sitzung oder abgeschalteter Statistik: nicht zählen, aber entfernen', () => {
    const a = env({ gemeldet: () => true, adresse: 'https://murmel.games/?von=google' });
    herkunftMelden(a.e);
    expect(a.sent).toEqual([]);
    expect(a.ersetzt).toEqual(['/']);
    const b = env({ erlaubt: () => false, adresse: 'https://murmel.games/?von=google' });
    herkunftMelden(b.e);
    expect(b.sent).toEqual([]);
    expect(b.ersetzt).toEqual(['/']);
  });

  it('ohne Kampagne bleibt die Adresse unberührt', () => {
    const { e, ersetzt } = env();
    herkunftMelden(e);
    expect(ersetzt).toEqual([]);
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
