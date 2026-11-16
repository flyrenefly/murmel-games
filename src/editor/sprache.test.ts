// The editor in English (docs/SPEC-englisch.md): every palette text has a translation, link errors keep
// a German message (the server's checker relies on it) and show English text, checks speak English.
import { afterEach, describe, expect, it } from 'vitest';
import { setzeSpracheFuerTest } from '../i18n';
import EN_PALETTE from '../i18n/en/editor-palette';
import { ED_STYLES } from './draw';
import { LinkError, sanitizeLevel } from './link';
import { newLevel } from './model';
import { ACTIONS, GROUPS, PALETTE, paletteText, searchPalette } from './palette';
import { check } from './rules';

afterEach(() => setzeSpracheFuerTest(null));

/** Labels built from a template that read the same in English (Laser ↑, Shogun S). */
const SAME = /^(Laser|Shogun) [↑→↓←SML]+$/;

describe('Palette auf Englisch', () => {
  it('jeder Name, jede Gruppe, Eigenschaft, Aktion und jeder Stil steht im Wörterbuch', () => {
    const texts = [
      ...GROUPS,
      ...PALETTE.flatMap((e) => [e.label, ...(e.props ?? []).flatMap((p) => [p.label, ...p.options.map(([, l]) => l)])]),
      ...ACTIONS.map(([, l]) => l),
      ...ED_STYLES.map(([, l]) => l),
    ];
    const fehlt = [...new Set(texts)].filter((t) => !(t in EN_PALETTE) && !SAME.test(t));
    expect(fehlt).toEqual([]);
  });

  it('zeigt englische Namen und findet in beiden Sprachen', () => {
    setzeSpracheFuerTest('en');
    expect(paletteText('Tür waagerecht')).toBe('Door, horizontal');
    expect(paletteText('Laser ↑')).toBe('Laser ↑');
    expect(searchPalette('door').map((e) => e.kind)).toContain('st_door_d');
    expect(searchPalette('tür').map((e) => e.kind)).toContain('st_door_d');
    expect(searchPalette('enemies').every((e) => e.layer === 'actor')).toBe(true);
  });
});

describe('Meldungen auf Englisch', () => {
  it('LinkError: deutsche message, englischer text', () => {
    setzeSpracheFuerTest('en');
    try {
      sanitizeLevel({ map: ['#'], objects: [{ x: 0, y: 0, k: 'it_wormhole' }] }, 'x');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LinkError);
      expect((e as LinkError).message).toBe('Das Objekt „it_wormhole“ ist im Editor nicht erlaubt.');
      expect((e as LinkError).text).toBe('The object “it_wormhole” is not allowed in the editor.');
    }
  });

  it('Prüfungen vor dem Teilen', () => {
    setzeSpracheFuerTest('en');
    const l = newLevel();
    expect(check(l).map((p) => p.text)).toContain('The level needs a title.');
  });
});
