import * as THREE from 'three';

// All textures are drawn on small canvases at runtime: no image downloads,
// so the game loads fast.

const SHAPES = ['circle', 'triangle', 'square', 'diamond', 'star', 'cross', 'ring', 'hexagon'] as const;
const COLORS = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff', '#ff9f1c', '#f15bb5', '#e0e0e0'];

export function symbolStyle(symbol: string): { shape: (typeof SHAPES)[number]; color: string } {
  const n = symbol.charCodeAt(0) - 65;
  return { shape: SHAPES[n % SHAPES.length], color: COLORS[(n + Math.floor(n / SHAPES.length) * 3) % COLORS.length] };
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function drawShape(g: CanvasRenderingContext2D, shape: string, cx: number, cy: number, r: number): void {
  g.beginPath();
  switch (shape) {
    case 'circle':
      g.arc(cx, cy, r, 0, Math.PI * 2);
      break;
    case 'ring':
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.arc(cx, cy, r * 0.55, 0, Math.PI * 2, true);
      break;
    case 'square':
      g.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'diamond':
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r, cy);
      g.lineTo(cx, cy + r);
      g.lineTo(cx - r, cy);
      break;
    case 'triangle':
      g.moveTo(cx, cy - r);
      g.lineTo(cx + r * 0.95, cy + r * 0.75);
      g.lineTo(cx - r * 0.95, cy + r * 0.75);
      break;
    case 'cross': {
      const w = r * 0.38;
      g.rect(cx - w, cy - r, w * 2, r * 2);
      g.rect(cx - r, cy - w, r * 2, w * 2);
      break;
    }
    case 'hexagon':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        g[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 ? r * 0.45 : r;
        g[i ? 'lineTo' : 'moveTo'](cx + rr * Math.cos(a), cy + rr * Math.sin(a));
      }
      break;
  }
  g.closePath();
  g.fill('evenodd');
}

export type StoneFace = 'closed' | 'open' | 'solved';

export interface FaceStyle {
  background: string;
  border: string;
  closedMark: string;
  glow: boolean;
}

const faceCache = new Map<string, THREE.CanvasTexture>();

/** Top face of a signal stone for a given symbol and state. */
export function stoneFace(symbol: string, state: StoneFace, style: FaceStyle, key: string): THREE.CanvasTexture {
  const id = `${key}|${symbol}|${state}`;
  const hit = faceCache.get(id);
  if (hit) return hit;
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = style.background;
  g.fillRect(0, 0, S, S);
  g.lineWidth = 6;
  g.strokeStyle = state === 'solved' ? symbolStyle(symbol).color : style.border;
  g.strokeRect(5, 5, S - 10, S - 10);
  if (state === 'closed') {
    g.fillStyle = style.closedMark;
    drawShape(g, 'circle', S / 2, S / 2, 12);
  } else {
    const { shape, color } = symbolStyle(symbol);
    if (style.glow) {
      g.shadowColor = color;
      g.shadowBlur = 18;
    }
    g.fillStyle = color;
    drawShape(g, shape, S / 2, S / 2, state === 'solved' ? 34 : 38);
  }
  const t = toTexture(c);
  faceCache.set(id, t);
  return t;
}

/** Subtle stone grain for the glass theme floor. */
export function stoneGrain(): THREE.CanvasTexture {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#ebe6dc';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = 200 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgba(${v},${v - 6},${v - 14},0.35)`;
    g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(160,150,135,0.25)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    let x = Math.random() * S;
    let y = 0;
    g.moveTo(x, y);
    while (y < S) {
      x += (Math.random() - 0.5) * 30;
      y += 20;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.strokeStyle = 'rgba(120,110,100,0.35)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, S, S);
  return toTexture(c);
}

/** Glowing tile border for the neon floor (used as emissive map). */
export function neonTile(color: string): THREE.CanvasTexture {
  const S = 128;
  const [c, g] = canvas(S);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.shadowColor = color;
  g.shadowBlur = 8;
  g.strokeRect(3, 3, S - 6, S - 6);
  return toTexture(c);
}

/** Classic marble swirl so the rolling is visible. */
export function marbleSwirl(base: string, swirl: string): THREE.CanvasTexture {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = swirl;
  g.lineWidth = 14;
  g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const y = H / 2 + Math.sin((x / W) * Math.PI * 4 + k * Math.PI) * H * 0.28;
      g[x ? 'lineTo' : 'moveTo'](x, y);
    }
    g.stroke();
  }
  return toTexture(c);
}

/** Soft round shadow under the marble (much cheaper than shadow maps). */
export function blobShadow(): THREE.CanvasTexture {
  const S = 64;
  const [c, g] = canvas(S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  return toTexture(c, false);
}
