import { describe, expect, it } from 'vitest';
import { STYLE_ORDER } from './render/styles';
import { stilWahl } from './vorladen';
import { vorladeListen } from './vorladen-listen';

describe('vorladeListen', () => {
  const dateien = [
    'assets/main.js',
    'enigma/README.md',
    'enigma/gfx32/a.png',
    'enigma/gfx32/b.png',
    'enigma/gfx32/nur-normal.png',
    'enigma/gfx32-retro/a.png',
    'enigma/gfx32-retro/b.png',
    'enigma/gfx32-retro/nur-retro.png',
    'sounds/boing.wav',
  ];

  it('nimmt beide Grafiksätze aus dem Grundbestand', () => {
    expect(vorladeListen(dateien).grund).toEqual(['assets/main.js', 'enigma/README.md', 'sounds/boing.wav']);
  });

  it('listet den normalen Satz unverändert', () => {
    expect(vorladeListen(dateien).saetze.gfx32).toEqual(['enigma/gfx32/a.png', 'enigma/gfx32/b.png', 'enigma/gfx32/nur-normal.png']);
  });

  it('ergänzt im Retro-Satz die normalen Bilder, die ihm fehlen (Rückfall in classic.ts)', () => {
    expect(vorladeListen(dateien).saetze['gfx32-retro']).toEqual([
      'enigma/gfx32-retro/a.png',
      'enigma/gfx32-retro/b.png',
      'enigma/gfx32-retro/nur-retro.png',
      'enigma/gfx32/nur-normal.png',
    ]);
  });

  it('verliert keine Datei', () => {
    const { grund, saetze } = vorladeListen(dateien);
    expect(new Set([...grund, ...saetze.gfx32, ...saetze['gfx32-retro']])).toEqual(new Set(dateien));
  });
});

describe('stilWahl', () => {
  it('wechselt online zum nächsten Stil und lädt dessen fehlenden Satz nach', () => {
    expect(stilWahl(STYLE_ORDER, 'klassisch', { gfx32: true, 'gfx32-retro': false }, true)).toEqual({ stil: 'klassisch-retro', uebersprungen: [], nachladen: 'gfx32-retro' });
  });

  it('lädt nichts nach, wenn der Satz schon im Cache ist', () => {
    expect(stilWahl(STYLE_ORDER, 'klassisch', { gfx32: true, 'gfx32-retro': true }, true)).toEqual({ stil: 'klassisch-retro', uebersprungen: [], nachladen: null });
  });

  it('überspringt offline einen Stil ohne Satz', () => {
    expect(stilWahl(STYLE_ORDER, 'klassisch', { gfx32: true, 'gfx32-retro': false }, false)).toEqual({ stil: 'glas', uebersprungen: ['klassisch-retro'], nachladen: null });
  });

  it('überspringt offline vom letzten 3D-Stil aus auch „Klassisch“, wenn nur Retro da ist', () => {
    expect(stilWahl(STYLE_ORDER, 'retro16', { gfx32: false, 'gfx32-retro': true }, false)).toEqual({ stil: 'klassisch-retro', uebersprungen: ['klassisch'], nachladen: null });
  });

  it('wechselt bei unbekanntem Stand (kein Service Worker) wie bisher', () => {
    expect(stilWahl(STYLE_ORDER, 'klassisch', { gfx32: null, 'gfx32-retro': null }, false)).toEqual({ stil: 'klassisch-retro', uebersprungen: [], nachladen: null });
    expect(stilWahl(STYLE_ORDER, 'neon', {}, false).stil).toBe('retro16');
  });

  it('3D-Stile brauchen keinen Satz', () => {
    expect(stilWahl(STYLE_ORDER, 'klassisch-retro', { gfx32: false, 'gfx32-retro': false }, false)).toEqual({ stil: 'glas', uebersprungen: [], nachladen: null });
  });

  it('bleibt beim Stil, wenn nichts anderes geht', () => {
    expect(stilWahl(['klassisch', 'klassisch-retro'], 'klassisch', { gfx32: true, 'gfx32-retro': false }, false)).toEqual({ stil: 'klassisch', uebersprungen: ['klassisch-retro'], nachladen: null });
  });
});
