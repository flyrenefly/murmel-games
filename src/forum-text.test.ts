import { describe, expect, test } from 'vitest';
import { fehlerLink, route, textTeile, wann } from './forum-text';

describe('textTeile', () => {
  test('reiner Text bleibt ein Stück, auch mit HTML darin', () => {
    expect(textTeile('<img src=x onerror=alert(1)>')).toEqual([{ text: '<img src=x onerror=alert(1)>' }]);
  });
  test('Links werden erkannt, Satzzeichen am Ende bleiben Text', () => {
    expect(textTeile('Siehe https://murmel.games/ueber.html. Danke!')).toEqual([
      { text: 'Siehe ' },
      { link: 'https://murmel.games/ueber.html' },
      { text: '. Danke!' },
    ]);
  });
  test('Klammern einer Adresse bleiben dran, umschließende nicht', () => {
    expect(textTeile('(https://de.wikipedia.org/wiki/Oxyd_(Spiel))')).toEqual([{ text: '(' }, { link: 'https://de.wikipedia.org/wiki/Oxyd_(Spiel)' }, { text: ')' }]);
  });
  test('javascript: und andere Schemata werden nie zum Link', () => {
    for (const t of ['javascript:alert(1)', 'data:text/html,x', 'Hallo javascript://%0aalert(1)']) {
      expect(textTeile(t).some((p) => 'link' in p)).toBe(false);
    }
  });
  test('Anführungszeichen beenden die Adresse', () => {
    expect(textTeile('"https://a.de/x"onmouseover=1')).toEqual([{ text: '"' }, { link: 'https://a.de/x' }, { text: '"onmouseover=1' }]);
  });
});

describe('fehlerLink und route', () => {
  test('der Knopf im Spiel füllt Kategorie, Level und Version vor', () => {
    const link = fehlerLink('enigma:Oxyd #1', 'abc1234');
    expect(link.startsWith('forum.html#neu?')).toBe(true);
    expect(route(link.slice(link.indexOf('#')))).toEqual({ seite: 'neu', kategorie: 'fehler', level: 'enigma:Oxyd #1', version: 'abc1234' });
  });
  test('Themen, Meldungen, Liste; Unsinn landet in der Liste', () => {
    expect(route('#thema/42')).toEqual({ seite: 'thema', id: 42 });
    expect(route('#meldungen')).toEqual({ seite: 'meldungen' });
    expect(route('')).toEqual({ seite: 'liste' });
    expect(route('#thema/abc')).toEqual({ seite: 'liste' });
    expect(route('#neu?kategorie=quatsch')).toEqual({ seite: 'neu', kategorie: 'fehler', level: '', version: '' });
    expect(route('#neu?kategorie=frage')).toMatchObject({ kategorie: 'frage' });
  });
});

test('wann: relativ für die letzten Tage, sonst Datum', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  expect(wann('2026-11-13T11:59:30Z', now)).toBe('gerade eben');
  expect(wann('2026-11-13T11:30:00Z', now)).toBe('vor 30 Min.');
  expect(wann('2026-11-13T09:00:00Z', now)).toBe('vor 3 Std.');
  expect(wann('2026-11-12T10:00:00Z', now)).toBe('gestern');
  expect(wann('2026-11-09T12:00:00Z', now)).toBe('vor 4 Tagen');
  expect(wann('2026-10-03T12:00:00Z', now)).toBe('3. Okt.');
});
