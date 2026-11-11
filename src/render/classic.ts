import type { Level } from '../game/level';
import type { StoneState } from '../game/pairs';

// "Klassisch": 2D top-down view with Enigma's GPL graphics (public/enigma/),
// composed the way Enigma's models-2d.lua does it:
// 640×416 play area (20×13 tiles of 32 px), flip-screen scrolling, 64 px status bar.

const T = 32; // tile size
const SPRITE = 40; // actor sprite size
const SCREEN_W = 20;
const SCREEN_H = 13;
const STEP_X = 19; // Enigma screens share their border row/column
const STEP_Y = 12;
const BAR_H = 64;
const VIEW_W = SCREEN_W * T;
const VIEW_H = SCREEN_H * T + BAR_H;

const IMAGES = [
  'fl_gray',
  'fl_abyss',
  'st_greenbrown',
  'sh_solid',
  'sh_round',
  'st_oxyda',
  'st_oxyda_open',
  'st_oxyda_opening',
  'st_oxyd_colordots',
  'st_oxyd_questmark',
  'st_oxyd_blink',
  'ac_marble_black',
  'sh_marble',
  'ac_marble_black_fall',
  'sh_marble_fall',
] as const;
type ImageName = (typeof IMAGES)[number];

export type ClassicSet = 'gfx32' | 'gfx32-retro';

const OPEN_FRAME_MS = 35; // st_oxyda_opening: 10 frames à 35 ms
const OPEN_FRAMES = 10;
const FALL_MS = [70, 65, 60, 55, 50, 50, 50, 50, 50, 50];
export const CLASSIC_FALL_SECONDS = FALL_MS.reduce((a, b) => a + b, 0) / 1000;

interface StoneAnim {
  state: StoneState;
  prev: StoneState;
  since: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Bild fehlt: ${src}`));
    img.src = src;
  });
}

const cache = new Map<ClassicSet, Promise<Record<ImageName, HTMLImageElement>>>();

function loadSet(set: ClassicSet): Promise<Record<ImageName, HTMLImageElement>> {
  let p = cache.get(set);
  if (!p) {
    const base = `${import.meta.env.BASE_URL}enigma/`;
    p = Promise.all(
      IMAGES.map((n) =>
        // The retro set has no colour dots; fall back to the normal set.
        loadImage(`${base}${set}/${n}.png`).catch(() => loadImage(`${base}gfx32/${n}.png`)),
      ),
    ).then((imgs) => Object.fromEntries(IMAGES.map((n, i) => [n, imgs[i]])) as Record<ImageName, HTMLImageElement>);
    cache.set(set, p);
  }
  return p;
}

export class ClassicView {
  private readonly ctx: CanvasRenderingContext2D;
  private img: Record<ImageName, HTMLImageElement> | null = null;
  private set: ClassicSet = 'gfx32';
  private level: Level | null = null;
  private staticLayer: HTMLCanvasElement | null = null;
  private stones: StoneAnim[] = [];
  private marble = { x: 0, y: 0, fall: -1 };
  private now = 0;
  private screen = { x: 0, y: 0 };
  private offset = { x: 0, y: 0 };
  status = { left: '', right: '' };

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.ctx.imageSmoothingEnabled = false;
  }

  get label(): string {
    return this.set === 'gfx32' ? 'Klassisch' : 'Klassisch (Retro)';
  }

  async build(level: Level, set: ClassicSet, states: readonly StoneState[]): Promise<void> {
    this.level = level;
    this.set = set;
    this.stones = states.map((s) => ({ state: s, prev: s, since: -1e9 }));
    this.img = null;
    const img = await loadSet(set);
    if (this.level !== level || this.set !== set) return; // superseded meanwhile
    this.img = img;
    this.staticLayer = this.renderStatic(level, img);
    // Small levels sit in the middle of the screen.
    this.offset.x = level.width < SCREEN_W ? Math.floor((SCREEN_W - level.width) / 2) : 0;
    this.offset.y = level.height < SCREEN_H ? Math.floor((SCREEN_H - level.height) / 2) : 0;
    this.resize();
  }

  setStoneState(index: number, state: StoneState): void {
    const s = this.stones[index];
    if (!s || s.state === state) return;
    s.prev = s.state;
    s.state = state;
    s.since = this.now;
  }

  /** Marble position in tile units; fall = progress 0..1 of the fall animation, -1 = not falling. */
  updateMarble(x: number, y: number, fall: number): void {
    this.marble.x = x;
    this.marble.y = y;
    this.marble.fall = fall;
  }

  render(dt: number): void {
    this.now += dt * 1000;
    const { ctx, img, level, staticLayer } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    if (!img || !level || !staticLayer) return;

    this.updateScreen(level);
    const ox = (this.offset.x - this.screen.x) * T;
    const oy = (this.offset.y - this.screen.y) * T;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, SCREEN_H * T);
    ctx.clip();
    ctx.drawImage(staticLayer, ox, oy);

    for (const s of level.signals) {
      const px = ox + s.col * T;
      const py = oy + s.row * T;
      if (px < -T || py < -T || px > VIEW_W || py > SCREEN_H * T) continue;
      this.drawOxyd(px, py, s.symbol, this.stones[s.index]);
    }

    this.drawMarble(ox, oy);
    ctx.restore();
    this.drawStatusBar();
  }

  private updateScreen(level: Level): void {
    const maxX = Math.max(0, Math.ceil((level.width - SCREEN_W) / STEP_X));
    const maxY = Math.max(0, Math.ceil((level.height - SCREEN_H) / STEP_Y));
    const sx = Math.min(maxX, Math.max(0, Math.floor((this.marble.x - 0.5) / STEP_X)));
    const sy = Math.min(maxY, Math.max(0, Math.floor((this.marble.y - 0.5) / STEP_Y)));
    // Flip screen like Oxyd/Enigma: jump, no scrolling.
    this.screen.x = Math.min(sx * STEP_X, Math.max(0, level.width - SCREEN_W));
    this.screen.y = Math.min(sy * STEP_Y, Math.max(0, level.height - SCREEN_H));
  }

  private renderStatic(level: Level, img: Record<ImageName, HTMLImageElement>): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = level.width * T + T; // room for shadows on the right/bottom edge
    c.height = level.height * T + T;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    const variants = img.fl_gray.height / T;
    level.cells.forEach((cell, i) => {
      const col = i % level.width;
      const row = Math.floor(i / level.width);
      if (cell.floor === 'abyss') g.drawImage(img.fl_abyss, col * T, row * T);
      else {
        const v = Math.floor(hash(col, row) * variants);
        g.drawImage(img.fl_gray, 0, v * T, T, T, col * T, row * T, T, T);
      }
    });
    // Shadows fall onto the floor before the stones are drawn.
    level.cells.forEach((cell, i) => {
      const col = i % level.width;
      const row = Math.floor(i / level.width);
      if (cell.stone === 'wall') g.drawImage(img.sh_solid, col * T, row * T);
      else if (cell.stone === 'signal') g.drawImage(img.sh_round, col * T, row * T);
    });
    level.cells.forEach((cell, i) => {
      if (cell.stone !== 'wall') return;
      const col = i % level.width;
      const row = Math.floor(i / level.width);
      g.drawImage(img.st_greenbrown, 0, 0, T, T, col * T, row * T, T, T);
    });
    return c;
  }

  private drawOxyd(px: number, py: number, symbol: string, s: StoneAnim): void {
    const { ctx } = this;
    const img = this.img!;
    const t = this.now - s.since;
    const color = (symbol.charCodeAt(0) - 65) % 12;
    const base = () => {
      ctx.drawImage(img.st_oxyda_open, px, py);
      ctx.drawImage(img.st_oxyd_colordots, (color % 4) * T, Math.floor(color / 4) * T, T, T, px, py, T, T);
    };
    const opening = OPEN_FRAME_MS * OPEN_FRAMES;

    if (s.state === 'closed') {
      if (s.prev !== 'closed' && t < opening) {
        // Closing: opening frames in reverse (open → closed) over the open stone.
        base();
        const f = OPEN_FRAMES - 1 - Math.min(OPEN_FRAMES - 1, Math.floor(t / OPEN_FRAME_MS));
        ctx.drawImage(img.st_oxyda_opening, 0, f * T, T, T, px, py, T, T);
      } else ctx.drawImage(img.st_oxyda, px, py);
      return;
    }

    base();
    if (t < opening && s.prev === 'closed') {
      // Opening: frame 0 = closed lid … frame 9 = almost open.
      const f = Math.min(OPEN_FRAMES - 1, Math.floor(t / OPEN_FRAME_MS));
      ctx.drawImage(img.st_oxyda_opening, 0, f * T, T, T, px, py, T, T);
      return;
    }
    if (s.state === 'open') {
      // Single open stone: question mark blinks (800 ms on, 1200 ms off).
      if (t % 2000 < 800) ctx.drawImage(img.st_oxyd_questmark, px, py);
    } else {
      // Pair open: blinking ovals, ping-pong over 5 frames à 100 ms.
      const seq = [0, 1, 2, 3, 4, 3, 2, 1];
      const f = seq[Math.floor(t / 100) % seq.length];
      ctx.drawImage(img.st_oxyd_blink, 0, f * T, T, T, px, py, T, T);
    }
  }

  private drawMarble(ox: number, oy: number): void {
    const { ctx } = this;
    const img = this.img!;
    const cx = Math.round(ox + this.marble.x * T);
    const cy = Math.round(oy + this.marble.y * T);
    if (this.marble.fall >= 0) {
      const ms = this.marble.fall * CLASSIC_FALL_SECONDS * 1000;
      let f = 0;
      for (let acc = FALL_MS[0]; f < FALL_MS.length - 1 && ms >= acc; ) acc += FALL_MS[++f];
      ctx.drawImage(img.sh_marble_fall, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE * 0.4, cy - SPRITE * 0.4, SPRITE, SPRITE);
      ctx.drawImage(img.ac_marble_black_fall, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
      return;
    }
    ctx.drawImage(img.sh_marble, cx - SPRITE * 0.4, cy - SPRITE * 0.4);
    ctx.drawImage(img.ac_marble_black, 0, 0, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
  }

  private drawStatusBar(): void {
    const { ctx } = this;
    const y = SCREEN_H * T;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, y, VIEW_W, BAR_H);
    ctx.fillStyle = '#3a3a3a';
    ctx.fillRect(0, y, VIEW_W, 2);
    ctx.font = 'bold 22px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d8d8d8';
    ctx.textAlign = 'left';
    ctx.fillText(this.status.left, 16, y + BAR_H / 2 + 1);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '16px ui-monospace, Consolas, monospace';
    ctx.fillText(this.status.right, VIEW_W - 16, y + BAR_H / 2 + 1);
  }

  /** Integer upscaling of the 640×480 picture, centred in the window. */
  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const fit = Math.min(w / VIEW_W, h / VIEW_H);
    const dpr = window.devicePixelRatio || 1;
    // Integer scale in device pixels keeps every pixel the same size.
    const deviceScale = fit * dpr >= 1 ? Math.floor(fit * dpr) : fit * dpr;
    const css = deviceScale / dpr;
    this.canvas.style.width = `${VIEW_W * css}px`;
    this.canvas.style.height = `${VIEW_H * css}px`;
  }
}

function hash(c: number, r: number): number {
  const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
