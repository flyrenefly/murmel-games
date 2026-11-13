import { describe, expect, it } from 'vitest';
import { displayScale } from './classic';

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
