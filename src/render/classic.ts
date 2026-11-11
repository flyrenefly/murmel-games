import type { Level } from '../game/level';
import { doorFlavor, EAST, type GameObject, type ObjectWorld, WEST } from '../game/objects';
import type { StoneState } from '../game/pairs';
import type { EnemyKind } from '../game/actors';

/** Another actor to draw (interpolated position in tile units). */
export interface ActorSprite {
  kind: EnemyKind | 'marble';
  color: number;
  x: number;
  y: number;
  /** Marbles: fall progress 0..1, -1 = not falling. */
  fall?: number;
}

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

// Always needed; the floor and stone images of a level are loaded on top.
const BASE_IMAGES = [
  'fl_gray',
  'fl_abyss',
  'st_greenbrown',
  'sh_solid',
  'sh_round',
  'st_oxyd_colordots',
  'st_oxyd_questmark',
  'st_oxyd_blink',
  'ac_marble_black',
  'sh_marble',
  'ac_marble_black_fall',
  'sh_marble_fall',
];
type Images = Record<string, HTMLImageElement>;

export type ClassicSet = 'gfx32' | 'gfx32-retro';

/** Opening animation per Oxyd flavor (models-2d.lua): frames and ms per frame. */
const OXYD_ANIM: Record<string, { frames: number; ms: number; shadow: string }> = {
  a: { frames: 10, ms: 35, shadow: 'sh_round' },
  b: { frames: 14, ms: 25, shadow: 'sh_round' },
  c: { frames: 5, ms: 70, shadow: 'sh_solid' },
  d: { frames: 10, ms: 35, shadow: 'sh_solid' },
};
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

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Loads one image; the retro set falls back to the normal set, a missing image yields null. */
function loadOne(set: ClassicSet, name: string): Promise<HTMLImageElement | null> {
  const key = `${set}/${name}`;
  let p = cache.get(key);
  if (!p) {
    const base = `${import.meta.env.BASE_URL}enigma/`;
    p = loadImage(`${base}${set}/${name}.png`)
      .catch(() => loadImage(`${base}gfx32/${name}.png`))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function loadImages(set: ClassicSet, names: Iterable<string>): Promise<Images> {
  const list = [...new Set(names)];
  const imgs = await Promise.all(list.map((n) => loadOne(set, n)));
  const out: Images = {};
  list.forEach((n, i) => {
    if (imgs[i]) out[n] = imgs[i]!;
  });
  return out;
}

/** Image names a level needs besides the base images. */
function levelImages(level: Level): string[] {
  const names: string[] = [];
  for (const c of level.cells) {
    names.push(c.floor);
    if (c.stone && c.stone !== 'st_oxyd') names.push(c.stone);
  }
  for (const s of level.signals) names.push(`st_oxyd${s.flavor}`, `st_oxyd${s.flavor}_open`, `st_oxyd${s.flavor}_opening`);
  for (const o of level.objects) names.push(...objectImages(o.k));
  for (const a of level.actors) names.push(...actorImages(a.k, a.a?.color));
  return names;
}

/** Images of another actor (models-2d.lua: the killer looks like a pearl). */
export function actorImages(kind: string, color?: string): string[] {
  if (kind === 'ac_rotor') return ['ac_rotor', 'sh_rotor'];
  if (kind === 'ac_top') return ['ac_top', 'sh_top'];
  if (kind.startsWith('ac_killer')) return [color === '0' || (color === undefined && kind === 'ac_killer_black') ? 'ac_pearl_black' : 'ac_pearl_white', 'sh_pearl'];
  if (kind === 'ac_marble_white') return ['ac_marble_white', 'ac_marble_white_fall'];
  return [];
}

/** Images an interactive object needs (models-2d.lua). */
export function objectImages(kind: string): string[] {
  if (kind === 'it_trigger') return ['it_trigger'];
  if (kind === 'it_document') return ['it_document'];
  if (kind.startsWith('st_grate')) return ['st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed'];
  if (kind === 'st_timer') return ['st_timer', 'sh_round'];
  if (kind === 'st_quake') return ['st_quake', 'st_oxydb', 'sh_round'];
  if (kind.startsWith('st_death')) return ['st_death', 'sh_round'];
  if (kind.startsWith('st_oneway')) return ['st_oneway'];
  if (kind.startsWith('it_wormhole')) return ['it_wormhole'];
  if (kind.startsWith('st_stoneimpulse')) return ['st_stoneimpulse', 'st_stoneimpulse_hollow', 'sh_stoneimpulse_hollow', 'sh_round'];
  if (kind.startsWith('st_puzzle')) return ['st_puzzle_blue', 'st_puzzle_yellow', 'sh_solid', 'it_explosion'];
  if (kind.startsWith('st_box')) return ['st_box_wood', 'st_box_hay', 'st_box_rock', 'sh_round', 'fl_wood_framed', 'fl_hay', 'fl_rock'];
  const sw = /^st_switch(_black|_white)?/.exec(kind);
  if (sw) return [`st_switch${sw[1] ?? ''}`, 'sh_round'];
  if (kind.startsWith('st_door')) {
    return ['st_oxyda', 'st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed', 'st_flat', 'st_door_b', 'st_door_d_ns', 'st_door_d_ew', 'sh_doorh', 'sh_doorv'];
  }
  return [];
}

export class ClassicView {
  private readonly ctx: CanvasRenderingContext2D;
  private img: Images | null = null;
  private set: ClassicSet = 'gfx32';
  private level: Level | null = null;
  private objects: ObjectWorld | null = null;
  private staticLayer: HTMLCanvasElement | null = null;
  private stones: StoneAnim[] = [];
  private marble = { x: 0, y: 0, fall: -1, color: 0 };
  private actors: ActorSprite[] = [];
  private rubbers: number[] = [];
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

  async build(level: Level, set: ClassicSet, states: readonly StoneState[], objects: ObjectWorld | null = null): Promise<void> {
    this.level = level;
    this.objects = objects;
    this.set = set;
    this.stones = states.map((s) => ({ state: s, prev: s, since: -1e9 }));
    this.img = null;
    const img = await loadImages(set, [...BASE_IMAGES, ...levelImages(level)]);
    if (this.level !== level || this.set !== set) return; // superseded meanwhile
    this.img = img;
    this.staticLayer = this.renderStatic(level, img);
    // Small levels sit in the middle of the screen.
    this.offset.x = level.width < SCREEN_W ? Math.floor((SCREEN_W - level.width) / 2) : 0;
    this.offset.y = level.height < SCREEN_H ? Math.floor((SCREEN_H - level.height) / 2) : 0;
    this.resize();
  }

  /** A floor changed (box became a bridge): redraw the static layer. */
  floorChanged(): void {
    if (this.level && this.img) this.staticLayer = this.renderStatic(this.level, this.img);
  }

  setStoneState(index: number, state: StoneState): void {
    const s = this.stones[index];
    if (!s || s.state === state) return;
    s.prev = s.state;
    s.state = state;
    s.since = this.now;
  }

  /** Marble position in tile units; fall = progress 0..1 of the fall animation, -1 = not falling. */
  updateMarble(x: number, y: number, fall: number, color = 0): void {
    this.marble.x = x;
    this.marble.y = y;
    this.marble.fall = fall;
    this.marble.color = color;
  }

  updateActors(actors: ActorSprite[]): void {
    this.actors = actors;
  }

  /** Rubber bands as x1, y1, x2, y2 in tile units. */
  updateRubbers(lines: number[]): void {
    this.rubbers = lines;
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

    if (this.objects) this.drawObjects(this.objects, ox, oy);

    for (const s of level.signals) {
      const px = ox + s.col * T;
      const py = oy + s.row * T;
      if (px < -T || py < -T || px > VIEW_W || py > SCREEN_H * T) continue;
      this.drawOxyd(px, py, s.symbol, s.flavor, this.stones[s.index]);
    }

    this.drawActors(ox, oy);
    this.drawMarble(ox, oy, this.marble);
    // Rubber bands: thick orange lines (Rubberband::postAddition, DL_Lines).
    if (this.rubbers.length) {
      ctx.strokeStyle = 'rgb(240, 140, 20)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < this.rubbers.length; i += 4) {
        ctx.moveTo(Math.round(ox + this.rubbers[i] * T), Math.round(oy + this.rubbers[i + 1] * T));
        ctx.lineTo(Math.round(ox + this.rubbers[i + 2] * T), Math.round(oy + this.rubbers[i + 3] * T));
      }
      ctx.stroke();
    }
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

  private renderStatic(level: Level, img: Images): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = level.width * T + T; // room for shadows on the right/bottom edge
    c.height = level.height * T + T;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#000';
    g.fillRect(0, 0, c.width, c.height);
    level.cells.forEach((cell, i) => {
      const col = i % level.width;
      const row = Math.floor(i / level.width);
      // Floors with several images (stacked vertically) get a stable random variant.
      const [name, fixed] = floorImage(cell.floor, img);
      const im = img[name] ?? img.fl_gray;
      const variants = Math.max(1, Math.floor(im.height / T));
      const v = fixed ?? Math.floor(hash(col, row) * variants);
      g.drawImage(im, 0, v * T, T, T, col * T, row * T, T, T);
    });
    // Shadows fall onto the floor before the stones are drawn.
    for (const s of level.signals) g.drawImage(img[OXYD_ANIM[s.flavor]?.shadow ?? 'sh_round'], s.col * T, s.row * T);
    level.cells.forEach((cell, i) => {
      if (!cell.stone || cell.stone === 'st_oxyd' || cell.stone === 'st_invisible') return;
      g.drawImage(img.sh_solid, (i % level.width) * T, Math.floor(i / level.width) * T);
    });
    level.cells.forEach((cell, i) => {
      // st_invisible: a wall that is not drawn.
      if (!cell.stone || cell.stone === 'st_oxyd' || cell.stone === 'st_invisible') return;
      const im = img[cell.stone] ?? img.st_greenbrown;
      g.drawImage(im, 0, 0, T, T, (i % level.width) * T, Math.floor(i / level.width) * T, T, T);
    });
    return c;
  }


  private drawOxyd(px: number, py: number, symbol: string, flavor: string, s: StoneAnim): void {
    const { ctx } = this;
    const img = this.img!;
    const t = this.now - s.since;
    const color = (symbol.charCodeAt(0) - 65) % 12;
    const anim = OXYD_ANIM[flavor] ?? OXYD_ANIM.a;
    const closedImg = img[`st_oxyd${flavor}`] ?? img.st_oxyda;
    const openImg = img[`st_oxyd${flavor}_open`] ?? img.st_oxyda_open;
    const openingImg = img[`st_oxyd${flavor}_opening`] ?? img.st_oxyda_opening;
    const base = () => {
      if (openImg) ctx.drawImage(openImg, px, py);
      ctx.drawImage(img.st_oxyd_colordots, (color % 4) * T, Math.floor(color / 4) * T, T, T, px, py, T, T);
    };
    const opening = anim.ms * anim.frames;
    const frame = (f: number) => openingImg && ctx.drawImage(openingImg, 0, f * T, T, T, px, py, T, T);

    if (s.state === 'closed') {
      if (s.prev !== 'closed' && t < opening) {
        // Closing: opening frames in reverse (open → closed) over the open stone.
        base();
        frame(anim.frames - 1 - Math.min(anim.frames - 1, Math.floor(t / anim.ms)));
      } else if (closedImg) ctx.drawImage(closedImg, px, py);
      return;
    }

    base();
    if (t < opening && s.prev === 'closed') {
      // Opening: frame 0 = closed lid … last frame = almost open.
      frame(Math.min(anim.frames - 1, Math.floor(t / anim.ms)));
      return;
    }
    if (s.state === 'open') {
      // Single open stone: question mark blinks (800 ms on, 1200 ms off).
      if (t % 2000 < 800) ctx.drawImage(img.st_oxyd_questmark, px, py);
    } else {
      // Pair open: blinking ovals, ping-pong over 5 frames à 100 ms.
      const seq = [0, 1, 2, 3, 4, 3, 2, 1];
      ctx.drawImage(img.st_oxyd_blink, 0, seq[Math.floor(t / 100) % seq.length] * T, T, T, px, py, T, T);
    }
  }


  /** Items first, then shadows and stones of the interactive objects. */
  private drawObjects(world: ObjectWorld, ox: number, oy: number): void {
    const { ctx } = this;
    const img = this.img!;
    const visible = (o: GameObject) => {
      const px = ox + o.col * T;
      const py = oy + o.row * T;
      return px > -2 * T && py > -2 * T && px < VIEW_W + T && py < SCREEN_H * T + T;
    };
    for (const o of world.objects) {
      if (!visible(o)) continue;
      const px = ox + o.col * T;
      const py = oy + o.row * T;
      if (o.cls === 'trigger' && o.attrs.invisible !== 'true') this.frame('it_trigger', o.state ? 1 : 0, px, py);
      else if (o.cls === 'document' && !o.gone && img.it_document) ctx.drawImage(img.it_document, px, py);
      // it_wormhole: 2 frames à 100 ms while on, frame 1 when off.
      else if (o.cls === 'wormhole') this.frame('it_wormhole', o.state ? Math.floor(this.now / 100) % 2 : 0, px, py);
    }
    for (const pass of ['shadow', 'stone'] as const) {
      for (const o of world.objects) {
        if (!visible(o) || o.cls === 'trigger' || o.cls === 'document' || o.cls === 'wormhole') continue;
        this.drawObjectStone(world, o, ox + o.col * T, oy + o.row * T, pass);
      }
    }
  }

  /** Frame f of an image sheet (frames stacked vertically, or side by side). */
  private frame(name: string, f: number, px: number, py: number, vertical = true): void {
    const im = this.img![name];
    if (!im) return;
    if (vertical) this.ctx.drawImage(im, 0, f * T, T, T, px, py, T, T);
    else this.ctx.drawImage(im, f * T, 0, T, T, px, py, T, T);
  }

  private image(name: string, px: number, py: number): void {
    const im = this.img![name];
    if (im) this.ctx.drawImage(im, px, py);
  }

  private drawObjectStone(world: ObjectWorld, o: GameObject, px: number, py: number, pass: 'shadow' | 'stone'): void {
    const { ctx } = this;
    const img = this.img!;
    // Door shadows are sheets of 41 px frames.
    const shadowFrame = (name: string, f: number, vertical: boolean) => {
      const im = img[name];
      if (!im) return;
      const S = 41;
      if (vertical) ctx.drawImage(im, 0, f * S, im.width, S, px, py, im.width, S);
      else ctx.drawImage(im, f * S, 0, S, im.height, px, py, S, im.height);
    };
    const p = world.progress(o);
    const to = o.moving ? o.moving.to : o.state;
    if (o.cls === 'impulse') {
      // Frames 0..3: expanding forwards (55 ms each), shrinking backwards over 5 frames.
      let f = 0;
      if (o.impulse && o.moving) {
        const t = this.now - o.moving.since;
        f = o.impulse.phase === 'expanding' ? Math.min(3, Math.floor(t / 55)) : Math.max(0, 3 - Math.max(0, Math.floor(t / 55) - 1));
      }
      const hollow = o.kind === 'st_stoneimpulse_hollow';
      if (pass === 'shadow') {
        if (hollow) {
          const im = this.img!.sh_stoneimpulse_hollow;
          if (im) this.ctx.drawImage(im, 0, f * 41, 41, 41, px, py, 41, 41);
        } else this.image('sh_round', px, py);
      } else this.frame(hollow ? 'st_stoneimpulse_hollow' : 'st_stoneimpulse', f, px, py);
      return;
    }
    if (o.cls === 'puzzle') {
      if (o.gone) return;
      if (o.puzzle === 'exploding') {
        if (pass === 'stone') this.image('it_explosion', px, py);
        return;
      }
      if (pass === 'shadow') {
        this.image('sh_solid', px, py);
        return;
      }
      // st_puzzle_<colour>.png: 4×4 sheet, column-major by connection bits (models-2d.lua).
      const c = Number(o.attrs.$connections) || 0;
      const im = this.img![o.attrs.color === '3' ? 'st_puzzle_yellow' : 'st_puzzle_blue'];
      if (im) this.ctx.drawImage(im, Math.floor(c / 4) * 32, (c % 4) * 32, 32, 32, px, py, 32, 32);
      return;
    }
    if (o.cls === 'death') {
      if (o.kind === 'st_death_invisible' || o.attrs.invisible === 'true') return;
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_death', o.moving ? Math.min(2, Math.floor(p * 3)) : 0, px, py);
      return;
    }
    if (o.cls === 'oneway') {
      // st_oneway.png: columns plain/black/white, rows e n s w (models-2d.lua); floating, no shadow.
      if (pass === 'shadow') return;
      const col = o.attrs.color === '0' || o.kind.includes('_black') ? 1 : o.attrs.color === '1' || o.kind.includes('_white') ? 2 : 0;
      const row = [3, 2, 0, 1][o.state & 3]; // Enigma dir W S E N → row of e n s w
      const im = this.img!.st_oneway;
      if (im) this.ctx.drawImage(im, col * 32, row * 32, 32, 32, px, py, 32, 32);
      return;
    }
    if (o.cls === 'quake') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else if (o.moving) {
        // st_quaking: frames 0 1 2 3 3 2 1 0, twice, 50 ms each.
        const seq = [0, 1, 2, 3, 3, 2, 1, 0];
        this.frame('st_quake', seq[Math.min(15, Math.floor(p * 16)) % 8], px, py);
      } else this.frame('st_oxydb', 0, px, py); // looks like a closed Oxyd stone
      return;
    }
    if (o.cls === 'timer') {
      if (o.attrs.invisible === 'true') return;
      // models-2d.lua timer_anim: frames 3 2 1 2 3 4 5 4 à 120 ms; stopped: frame 3.
      const seq = [2, 1, 0, 1, 2, 3, 4, 3];
      const f = o.state ? seq[Math.floor(this.now / 120) % seq.length] : 2;
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_timer', f, px, py);
      return;
    }
    if (o.cls === 'box') {
      if (o.gone) return;
      if (pass === 'shadow') this.image('sh_round', px, py);
      else if (o.kind.startsWith('st_box_wood')) this.frame('st_box_wood', o.kind.endsWith('_v') ? 1 : 0, px, py);
      else this.image(o.kind, px, py);
      return;
    }
    if (o.cls === 'grate') {
      const v = o.kind.includes('framed') || o.attrs.flavor === 'framed' ? 'framed' : 'cross';
      this.image(pass === 'shadow' ? `sh_grate_${v}` : `st_grate_${v}`, px, py);
      return;
    }
    if (o.cls === 'switch') {
      const color = o.attrs.color === '0' ? '_black' : o.attrs.color === '1' ? '_white' : '';
      // Frames 0 off … 2 on; turning on runs forwards, turning off backwards.
      const step = Math.min(2, Math.floor(p * 3));
      const f = o.moving ? (to === 1 ? step : 2 - step) : o.state ? 2 : 0;
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame(`st_switch${color}`, f, px, py);
      return;
    }
    // Doors: open fraction 0 (closed) … 1 (open).
    const open = o.moving ? (to === 1 ? p : 1 - p) : o.state;
    const flavor = doorFlavor(o);
    if (flavor === 'd') {
      const conn = Number(o.attrs.$connections || (o.kind.includes('_ew') ? 10 : 5));
      const ns = conn === (WEST | EAST);
      const f = Math.round((1 - open) * 6); // 7 frames: 0 = open … 6 = closed
      if (pass === 'shadow') shadowFrame(ns ? 'sh_doorh' : 'sh_doorv', f, ns);
      else this.frame(ns ? 'st_door_d_ns' : 'st_door_d_ew', f, px, py, ns);
      return;
    }
    if (flavor === 'b') {
      if (open >= 1) return; // an open door b is invisible
      if (o.moving) {
        if (pass === 'stone') this.frame('st_door_b', Math.min(7, Math.floor(open * 8)), px, py);
      } else if (pass === 'shadow') this.image('sh_solid', px, py);
      else this.frame('st_flat', 0, px, py);
      return;
    }
    // a: Oxyd-like lid ↔ cross grate, c: flat stone ↔ framed grate (2 frames).
    const isOpen = open >= 0.5;
    const grate = flavor === 'a' ? 'cross' : 'framed';
    if (pass === 'shadow') this.image(isOpen ? `sh_grate_${grate}` : flavor === 'a' ? 'sh_round' : 'sh_solid', px, py);
    else if (isOpen) this.image(`st_grate_${grate}`, px, py);
    else this.frame(flavor === 'a' ? 'st_oxyda' : 'st_flat', 0, px, py);
  }

  /** Rotors (9 frames à 30 ms), tops (9 à 25 ms) and killers (pearl image). */
  private drawActors(ox: number, oy: number): void {
    const { ctx } = this;
    const img = this.img!;
    for (const a of this.actors) {
      const cx = Math.round(ox + a.x * T);
      const cy = Math.round(oy + a.y * T);
      if (cx < -SPRITE || cy < -SPRITE || cx > VIEW_W + SPRITE || cy > SCREEN_H * T + SPRITE) continue;
      const s = 0.4 * SPRITE;
      if (a.kind === 'marble') {
        this.drawMarble(ox, oy, { x: a.x, y: a.y, fall: a.fall ?? -1, color: a.color });
        continue;
      }
      if (a.kind === 'killer') {
        if (img.sh_pearl) ctx.drawImage(img.sh_pearl, cx - s, cy - s);
        const im = img[a.color === 0 ? 'ac_pearl_black' : 'ac_pearl_white'];
        if (im) ctx.drawImage(im, 0, 0, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
        continue;
      }
      const f = Math.floor(this.now / (a.kind === 'rotor' ? 30 : 25)) % 9;
      const sh = img[a.kind === 'rotor' ? 'sh_rotor' : 'sh_top'];
      if (sh) ctx.drawImage(sh, 0, a.kind === 'rotor' ? f * SPRITE : 0, SPRITE, SPRITE, cx - s, cy - s, SPRITE, SPRITE);
      const im = img[a.kind === 'rotor' ? 'ac_rotor' : 'ac_top'];
      if (im) ctx.drawImage(im, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
    }
  }

  private drawMarble(ox: number, oy: number, m: { x: number; y: number; fall: number; color: number }): void {
    const { ctx } = this;
    const img = this.img!;
    const name = m.color === 1 && img.ac_marble_white ? 'ac_marble_white' : 'ac_marble_black';
    const cx = Math.round(ox + m.x * T);
    const cy = Math.round(oy + m.y * T);
    if (m.fall >= 0) {
      const ms = m.fall * CLASSIC_FALL_SECONDS * 1000;
      let f = 0;
      for (let acc = FALL_MS[0]; f < FALL_MS.length - 1 && ms >= acc; ) acc += FALL_MS[++f];
      ctx.drawImage(img.sh_marble_fall, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE * 0.4, cy - SPRITE * 0.4, SPRITE, SPRITE);
      ctx.drawImage(img[`${name}_fall`] ?? img.ac_marble_black_fall, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
      return;
    }
    ctx.drawImage(img.sh_marble, cx - SPRITE * 0.4, cy - SPRITE * 0.4);
    ctx.drawImage(img[name], 0, 0, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
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

/**
 * Image and fixed variant of a floor kind: bridges built from boxes use
 * fl_wood_framed (variant 0 horizontal, 1 vertical); hay/rock bridges the plain floor.
 */
function floorImage(kind: string, img: Images): [string, number | undefined] {
  if (kind === 'fl_wood_framed_h') return ['fl_wood_framed', 0];
  if (kind === 'fl_wood_framed_v') return ['fl_wood_framed', 1];
  if (img[kind]) return [kind, undefined];
  let k = kind;
  while (!img[k] && k.lastIndexOf('_') > 2) k = k.slice(0, k.lastIndexOf('_'));
  return [k, undefined];
}

function hash(c: number, r: number): number {
  const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
