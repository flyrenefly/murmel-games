import { describe, expect, it } from 'vitest';
import { displayScale, zoomCamera, zoomLayout } from './classic';

describe('displayScale (640×480 picture)', () => {
  it('fills a phone in portrait instead of rounding down to one device pixel', () => {
    // iPhone 390 × 844, dpr 3: 390 / 640 = 0.609; before: floor(1.83) / 3 → 213 px wide
    expect(640 * displayScale(390, 844, 3)).toBeCloseTo(390);
    expect(640 * displayScale(375, 812, 2)).toBeCloseTo(375);
  });

  it('fills a phone in landscape by its height', () => {
    expect(480 * displayScale(844, 390, 3)).toBeCloseTo(390);
  });

  it('keeps whole device pixels on ordinary screens', () => {
    expect(displayScale(1920, 1080, 1)).toBe(2); // 2.25 → 2
    expect(displayScale(1366, 768, 1)).toBe(1); // 1.6 → 1
    expect(displayScale(2560, 1440, 2)).toBe(3); // exactly 6 device pixels
  });

  it('shrinks without rounding when the window is smaller than the picture', () => {
    expect(displayScale(320, 480, 1)).toBe(0.5);
  });
});

describe('zoom for phones held upright', () => {
  it('uses 10 tiles across and fills the height above the buttons', () => {
    // 375 × 812: 32 px tile = 37.5 CSS px; (812 · 0.85 − 64 · 1.17) / 37.5 = 16.4 → 16 rows
    expect(zoomLayout(375, 812)).toEqual({ cols: 10, rows: 16 });
    // the zoomed picture is twice as large as the whole screen: 37.5 instead of 18.75 CSS px per tile
    expect(displayScale(375, 812, 2, 320, 16 * 32 + 64) * 32).toBeCloseTo(37.5);
  });

  it('stays off in landscape and on squarish windows', () => {
    expect(zoomLayout(844, 390)).toBeNull();
    expect(zoomLayout(800, 860)).toBeNull();
  });

  it('keeps the marble in the middle but never shows beyond the level edge', () => {
    // level 39 × 25 tiles, window 10 × 16 tiles
    const lw = 39 * 32;
    const lh = 25 * 32;
    expect(zoomCamera(20 * 32, 12 * 32, lw, lh, 320, 512)).toEqual({ x: 20 * 32 - 160, y: 12 * 32 - 256 });
    expect(zoomCamera(32, 32, lw, lh, 320, 512)).toEqual({ x: 0, y: 0 });
    expect(zoomCamera(38 * 32, 24 * 32, lw, lh, 320, 512)).toEqual({ x: lw - 320, y: lh - 512 });
  });

  it('centres a level that is smaller than the window', () => {
    expect(zoomCamera(100, 100, 8 * 32, 6 * 32, 320, 512)).toEqual({ x: -32, y: -160 });
  });
});

describe('zoom band', () => {
  it('fits the rows into the band between info box and footer', () => {
    // band 635 px (info box ends at 133, footer starts at 776): (635 − 75) / 37.5 = 14.9 → 14 rows
    expect(zoomLayout(375, 812, 635)).toEqual({ cols: 10, rows: 14 });
  });
});
