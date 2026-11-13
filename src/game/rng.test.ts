import { describe, expect, it } from 'vitest';
import { createRng, randomSeed } from './rng';

describe('createRng', () => {
  it('liefert bei gleichem Startwert dieselbe Folge', () => {
    const a = createRng(123456789);
    const b = createRng(123456789);
    const fa = Array.from({ length: 50 }, () => a());
    const fb = Array.from({ length: 50 }, () => b());
    expect(fa).toEqual(fb);
  });

  it('liefert bei anderem Startwert eine andere Folge', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 5 }, () => a())).not.toEqual(Array.from({ length: 5 }, () => b()));
  });

  it('liefert Werte in [0, 1) wie Math.random', () => {
    const r = createRng(42);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('verteilt grob gleichmäßig auf zehn Fächer', () => {
    const r = createRng(7);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) bins[Math.floor(r() * 10)]++;
    for (const n of bins) expect(Math.abs(n - 10000)).toBeLessThan(500);
  });

  it('ist für den Startwert 0 nicht entartet', () => {
    const r = createRng(0);
    const vals = new Set(Array.from({ length: 20 }, () => r()));
    expect(vals.size).toBe(20);
  });

  it('ist über Plattformen stabil: feste Erwartungswerte für Startwert 1', () => {
    const r = createRng(1);
    expect([r(), r(), r()].map((v) => Math.round(v * 1e9))).toEqual(FIXED_SEED1);
  });
});

describe('randomSeed', () => {
  it('liefert eine 32-bit-Ganzzahl ohne Vorzeichen', () => {
    const s = randomSeed();
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
  });
});

// Referenzwerte von mulberry32 (Startwert 1); ändern sich nur, wenn der Generator wechselt –
// dann werden alle gespeicherten Aufzeichnungen ungültig.
const FIXED_SEED1 = [627073941, 2735721, 527447040];
