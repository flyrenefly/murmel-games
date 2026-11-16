import { afterEach, describe, expect, it } from 'vitest';
import { browserSprache, einsetzen, ermittleSprache, gebietsschema, platzhalter, setzeSpracheFuerTest, woerterbuch } from './i18n';
import { entitaeten, htmlSchluessel, htmlText, uebersetzeHtml } from './i18n/html';

afterEach(() => setzeSpracheFuerTest(null));

describe('Sprachwahl', () => {
  it('Browser: de* → Deutsch, sonst Englisch, ohne Angabe Deutsch', () => {
    expect(browserSprache(['de-AT', 'en'])).toBe('de');
    expect(browserSprache(['DE'])).toBe('de');
    expect(browserSprache(['en-US', 'de'])).toBe('en');
    expect(browserSprache(['fr-FR'])).toBe('en');
    expect(browserSprache(['dexx'])).toBe('en');
    expect(browserSprache([])).toBe('de');
    expect(browserSprache(undefined)).toBe('de');
  });
  it('gespeicherte Wahl vor Adresse vor Browser', () => {
    expect(ermittleSprache('de', '/en/', ['en'])).toBe('de');
    expect(ermittleSprache(null, '/en/', ['de'])).toBe('en');
    expect(ermittleSprache(null, '/en/level/enigma-i/welcome/', ['de'])).toBe('en');
    expect(ermittleSprache(null, '/level/enigma-i/', ['de'])).toBe('de');
    expect(ermittleSprache(null, '/forum.html', ['en-GB'])).toBe('en');
    expect(ermittleSprache('en', '/', ['de'])).toBe('en');
  });
  it('Gebietsschema', () => {
    expect(gebietsschema('de')).toBe('de-DE');
    expect(gebietsschema('en')).toBe('en-GB');
  });
});

describe('Übersetzen', () => {
  const EN = { Neustart: 'Restart', '{n} von {m} Paaren': '{n} of {m} pairs' } as const;
  it('Deutsch liefert den Schlüssel, Englisch die Übersetzung, mit Platzhaltern', () => {
    const t = woerterbuch(EN);
    setzeSpracheFuerTest('de');
    expect(t('Neustart')).toBe('Neustart');
    expect(t('{n} von {m} Paaren', { n: 2, m: 5 })).toBe('2 von 5 Paaren');
    setzeSpracheFuerTest('en');
    expect(t('Neustart')).toBe('Restart');
    expect(t('{n} von {m} Paaren', { n: 2, m: 5 })).toBe('2 of 5 pairs');
  });
  it('einsetzen und platzhalter', () => {
    expect(einsetzen('{a} und {b}', { a: 1 })).toBe('1 und {b}');
    expect(platzhalter('{b} {a} x')).toEqual(['a', 'b']);
  });
});

describe('statisches HTML', () => {
  const EN = { Neustart: 'Restart', 'Siehe Forum.': 'See the <a href="forum.html">forum</a>.', 'Die Murmel & du': 'The marble & you', 'Grafikstil wechseln (T)': 'Change graphics style (T)' };
  const html = `<p>x</p><button data-i18n data-i18n-attr="title" title="Grafikstil wechseln (T)">
      Neustart
    </button><p data-i18n-html>Siehe <a href="forum.html">Forum</a>.</p><b data-i18n>Die Murmel &amp; du</b><i data-i18n>fehlt</i>`;
  it('findet alle Schlüssel', () => {
    expect(htmlSchluessel(html).map((f) => f.schluessel)).toEqual(['Neustart', 'Siehe Forum.', 'Die Murmel & du', 'fehlt', 'Grafikstil wechseln (T)']);
  });
  it('übersetzt Text, Markup und Attribute, maskiert Text', () => {
    const out = uebersetzeHtml(html, EN);
    expect(out).toContain('title="Change graphics style (T)">Restart</button>');
    expect(out).toContain('<p data-i18n-html>See the <a href="forum.html">forum</a>.</p>');
    expect(out).toContain('<b data-i18n>The marble &amp; you</b>');
    expect(out).toContain('<i data-i18n>fehlt</i>');
  });
  it('Entitäten und Text', () => {
    expect(entitaeten('a&nbsp;&#8211;&#x2013;&amp;&unbekannt;')).toBe('a ––&&unbekannt;');
    expect(htmlText('<b>A</b> <!-- x --> &lt;B&gt;')).toBe('A  <B>');
  });
});

describe('Leveltitel', () => {
  it('titleEn nur in Englisch, sonst title', async () => {
    const { levelTitel } = await import('./game/level');
    const { displayTitle } = await import('./levelseiten/seiten');
    const { LEVELS } = await import('./levels');
    expect(levelTitel({ title: 'Brücken', titleEn: 'Bridges' }, 'en')).toBe('Bridges');
    expect(levelTitel({ title: 'Brücken', titleEn: 'Bridges' }, 'de')).toBe('Brücken');
    expect(levelTitel({ title: 'Welcome' }, 'en')).toBe('Welcome');
    // the editor stores „Ohne Titel“ for a level without title; only the display changes
    expect(levelTitel({ title: 'Ohne Titel' }, 'en')).toBe('Untitled');
    expect(levelTitel({ title: 'Ohne Titel' }, 'de')).toBe('Ohne Titel');
    expect(displayTitle(LEVELS[0], 'en')).toBe('First Steps');
    expect(displayTitle(LEVELS[0])).toBe('Erste Schritte');
    expect(LEVELS.every((l) => !!l.titleEn)).toBe(true);
  });
});
