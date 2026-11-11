import type { ClassicSet } from './classic';
import type { ThemeId } from './themes';

// All selectable looks. "Klassisch" uses the 2D renderer with Enigma graphics,
// the others the Three.js renderer.

export type StyleId = 'klassisch' | 'klassisch-retro' | ThemeId;

export const STYLE_ORDER: StyleId[] = ['klassisch', 'klassisch-retro', 'glas', 'neon', 'retro16'];

export function classicSet(style: StyleId): ClassicSet | null {
  if (style === 'klassisch') return 'gfx32';
  if (style === 'klassisch-retro') return 'gfx32-retro';
  return null;
}
