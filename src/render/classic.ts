import type { Level } from '../game/level';
import { chargeOf, doorFlavor, magicFlavor, mailDir, pipeBits, windowFaces, stripConnections, EAST, type GameObject, isHollow, meditationImage, passageLook, MOVABLE_STONE, movableLook, type ObjectWorld, SEED_GROW_FRAMES, WEST } from '../game/objects';
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
  /** Marbles: sink depth 0..7 (swamp). */
  sink?: number;
  /** Marbles: jump progress 0..1, -1 = on the floor. */
  jump?: number;
  /** A pearl (ac_pearl): smaller ball with its own images. */
  pearl?: boolean;
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
  'halo',
  'halo-blink',
  'halo-small',
  'halo-small-blink',
];
const MEDITATION_IMAGES = ['caldera', 'hollow', 'dent', 'bump', 'hill', 'volcano'].map((s) => `it_meditation_${s}`);
/** Swamp levels: sinking marbles (models-2d.lua, 7 frames). */
const SINK_IMAGES = ['ac_marble_black_sink', 'ac_marble_white_sink', 'sh_marble_sink'];
const PASSAGE_FLAVORS = ['square', 'slash', 'cross', 'frame', 'backslash'];
const PASSAGE_IMAGES = [
  ...PASSAGE_FLAVORS.flatMap((f) => [`st_passage_black_${f}`, `st_passage_white_${f}`]),
  'sh_round',
  ...PASSAGE_FLAVORS.slice(1).map((f) => `sh_passage_${f}`),
];
/** Jumping marbles (models-2d.lua: 4 frames, ping-pong à 70 ms). */
const JUMP_IMAGES = ['ac_marble_black_jump', 'ac_marble_white_jump', 'sh_marble_jump'];
type Images = Record<string, HTMLImageElement>;

export type ClassicSet = 'gfx32' | 'gfx32-retro';

/** Opening animation per Oxyd flavor (models-2d.lua): frames and ms per frame. */
const OXYD_ANIM: Record<string, { frames: number; ms: number; shadow: string }> = {
  a: { frames: 10, ms: 35, shadow: 'sh_round' },
  b: { frames: 14, ms: 25, shadow: 'sh_round' },
  c: { frames: 5, ms: 70, shadow: 'sh_solid' },
  d: { frames: 10, ms: 35, shadow: 'sh_solid' },
  // models-2d.lua: flavor e uses b's images and animations
  e: { frames: 14, ms: 25, shadow: 'sh_round' },
};
const FALL_MS = [70, 65, 60, 55, 50, 50, 50, 50, 50, 50];
export const CLASSIC_FALL_SECONDS = FALL_MS.reduce((a, b) => a + b, 0) / 1000;

interface StoneAnim {
  state: StoneState;
  prev: StoneState;
  since: number;
  /** Has been open once (flavor e then shows its colour through the peephole when closed). */
  opened?: boolean;
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
    names.push(c.floor.startsWith('fl_slope') ? 'fl_slope' : c.floor === 'fl_fake_abyss' ? 'fl_abyss' : c.floor);
    if (c.stone && c.stone !== 'st_oxyd') names.push(c.stone);
  }
  for (const s of level.signals) {
    const f = s.flavor === 'e' ? 'b' : s.flavor;
    names.push(`st_oxyd${f}`, `st_oxyd${f}_open`, `st_oxyd${f}_opening`);
    if (s.flavor === 'e') names.push('st_oxyde');
  }
  for (const o of level.objects) names.push(...objectImages(o.k));
  for (const a of level.actors) names.push(...actorImages(a.k, a.a?.color));
  if (level.mainPearl) names.push(...actorImages(level.mainPearl.k, level.mainPearl.a?.color));
  if (level.cells.some((c) => c.floor === 'fl_swamp')) names.push(...SINK_IMAGES);
  if (level.world.FallenPuzzle) names.push(level.world.FallenPuzzle);
  // Kinds Lua callbacks may place.
  for (const [k, v] of Object.entries(level.lua?.kinds ?? {})) {
    if (v === 'object') names.push(...objectImages(k));
    else if (v !== 'nil') names.push(v);
  }
  return names;
}

/** Images of another actor (models-2d.lua: the killer looks like a pearl). */
export function actorImages(kind: string, color?: string): string[] {
  if (kind === 'ac_rotor') return ['ac_rotor', 'sh_rotor'];
  if (kind === 'ac_top') return ['ac_top', 'sh_top'];
  if (kind === 'ac_bug') return ['ac_bug', 'sh_pearl'];
  if (kind === 'ac_horse') return ['ac_horse', 'sh_horse'];
  if (kind.startsWith('ac_killer')) return [color === '0' || (color === undefined && kind === 'ac_killer_black') ? 'ac_pearl_black' : 'ac_pearl_white', 'sh_pearl'];
  if (kind === 'ac_marble_white') return ['ac_marble_white', 'ac_marble_white_fall'];
  if (/^ac_pearl(_white|_black)?$/.test(kind)) {
    const c = kind === 'ac_pearl_black' || color === '0' ? 'black' : 'white';
    return [`ac_pearl_${c}`, `ac_pearl_${c}_fall`, 'sh_pearl', 'sh_pearl_fall'];
  }
  return [];
}

/** Images an interactive object needs (models-2d.lua). */
/** Volcano: seed, growing, quaking, breaking, finished (st_flat). */
const VOLCANO_IMAGES = ['it_seed', 'st_volcano_growing', 'st_quake', 'st_quake_break', 'st_flat', 'sh_round', 'sh_solid'];

/** Fire: the burnable items, the extinguisher, transformed floors and heating animations. */
const FIRE_IMAGES = ['it_burnable_oil', 'it_burnable_ignite', 'it_burnable_burning', 'it_burnable_ash', 'it_burnable_fireproof', 'it_extinguisher', 'fl_abyss', 'fl_dunes', 'fl_swamp', 'fl_water', 'fl_ice_heating', 'fl_water_heating', 'fl_swamp_heating', 'it_crack_abyss', 'it_crack_water'];

export function objectImages(kind: string): string[] {
  if (kind === 'it_trigger') return ['it_trigger'];
  if (kind === 'it_document') return ['it_document'];
  if (kind.startsWith('st_grate')) return ['st_grate_cross', 'sh_grate_cross', 'st_grate_framed', 'sh_grate_framed'];
  if (kind === 'st_timer') return ['st_timer', 'sh_round'];
  if (kind === 'st_quake' || kind === 'st_fake_quake') return ['st_quake', 'st_oxydb', 'sh_round'];
  if (kind.startsWith('st_death')) return ['st_death', 'sh_round'];
  if (kind.startsWith('st_oneway')) return ['st_oneway'];
  if (kind.startsWith('it_wormhole')) return ['it_wormhole'];
  if (kind === 'it_seed' || kind === 'it_seed_wood') return ['it_seed', 'st_box_wood', 'st_box_wood_growing', 'sh_round', 'fl_wood_framed'];
  if (kind === 'it_seed_hay') return ['it_seed', 'st_box_hay', 'sh_round', 'fl_hay'];
  if (kind === 'it_seed_greenbrown') return ['it_seed', 'st_greenbrown', 'sh_round'];
  if (kind === 'it_seed_volcano' || kind.startsWith('st_volcano')) return VOLCANO_IMAGES;
  if (kind.startsWith('it_meditation') || kind === 'it_landmine') return [...MEDITATION_IMAGES, 'it_landmine', 'it_explosion'];
  if (kind.startsWith('st_stoneimpulse')) return ['st_stoneimpulse', 'st_stoneimpulse_hollow', 'sh_stoneimpulse_hollow', 'sh_round'];
  if (kind.startsWith('st_puzzle')) return ['st_puzzle_blue', 'st_puzzle_yellow', 'st_puzzle_blue_hollow', 'st_puzzle_yellow_hollow', 'sh_solid', 'sh_puzzle_hollow', 'it_explosion'];
  if (kind === 'it_magicwand') return ['it_magicwand'];
  if (kind === 'it_extralife') return ['it_extralife'];
  if (kind === 'it_yinyang') return ['it_yinyang'];
  if (kind === 'it_ring' || kind === 'it_spoon' || kind === 'it_wrench' || kind === 'it_hammer' || kind === 'it_floppy' || kind === 'it_sword' || kind === 'it_umbrella') return [kind];
  if (kind === 'it_death') return ['it_death'];
  if (/^it_(coffee|coffee_drop)$/.test(kind)) return ['it_coffee'];
  if (/^it_(spade|brush|cherry|banana|cross|squashed|pin|weight)$/.test(kind)) return [kind, 'it_squashed'];
  if (/^it_glasses/.test(kind)) return ['it_glasses', 'it_glasses_broken', 'st_death'];
  if (kind === 'it_surprise') return ['it_surprise', 'it_umbrella', 'it_spring', 'it_dynamite', 'it_dynamite_burning', 'it_explosion', 'it_coffee', 'it_hammer'];
  if (/^it_bottle/.test(kind)) return ['it_bottle_idle', 'it_bottle_broken'];
  if (kind.startsWith('it_burnable') || kind.startsWith('it_extinguisher')) return FIRE_IMAGES;
  if (kind.startsWith('it_strip')) return ['it_strip'];
  if (kind.startsWith('it_puller')) return ['it_puller', 'it_explosion'];
  if (kind === 'st_knight') return ['st_knight', 'sh_round'];
  if (kind === 'st_floppy') return ['st_floppy_on', 'st_floppy_off', 'sh_round'];
  if (kind.startsWith('it_flag')) return ['it_flag_black', 'it_flag_white'];
  if (kind === 'it_springboard') return ['it_springboard', ...JUMP_IMAGES];
  if (kind.startsWith('it_magnet')) return ['it_magnet_on', 'it_magnet_off'];
  if (kind.startsWith('it_sensor')) return ['it_sensor', 'it_sensor_exit'];
  if (kind.startsWith('it_key')) return ['it_key'];
  if (kind === 'st_key') return ['st_key_on', 'st_key_off', 'sh_round'];
  if (kind.startsWith('st_laser')) return ['st_laser', 'sh_rounded', 'it_laser'];
  if (kind.startsWith('it_crack')) return ['it_crack_abyss', 'it_crack_water'];
  if (kind === 'fl_scales') return ['fl_scales'];
  if (kind === 'fl_bridge') return ['fl_bridge_gc', 'fl_bridge_gc_open', 'fl_bridge_gc_closed', 'fl_bridge_bw', 'fl_bridge_bs', 'fl_bridge_be', 'fl_bridge_bn', 'fl_bridge_bw_open', 'fl_bridge_bw_closed'];
  if (kind.startsWith('st_mirror')) return ['st_mirror_static', 'st_mirror_movable', 'sh_rounded', 'it_laser'];
  if (kind.startsWith('it_vortex')) return ['it_vortex'];
  if (kind.startsWith('it_spring')) return ['it_spring', ...JUMP_IMAGES];
  if (kind.startsWith('st_passage')) return PASSAGE_IMAGES;
  if (kind === 'st_swap') return ['st_swap', 'sh_round'];
  if (kind === 'st_pull') return ['st_pull', 'sh_rawglass', 'sh_pull'];
  if (kind.startsWith('st_rotator')) return ['st_rotator_cw', 'st_rotator_ccw', 'sh_round'];
  if (/^(st|it)_blocker/.test(kind)) return ['st_blocker', 'sh_round'];
  if (kind === 'st_laserswitch') return ['st_oxydb', 'st_quake', 'sh_round'];
  if (kind === 'st_polarswitch') return ['st_lightglass', 'st_darkglass', 'sh_rawglass'];
  if (kind === 'st_monoflop' || kind.startsWith('st_laserflop')) return ['st_monoflop', 'sh_round'];
  if (kind === 'st_scissors') return ['st_scissors', 'sh_round'];
  if (/^st_portal/.test(kind)) return ['st_portal_horse', 'sh_portal_horse'];
  if (/^st_mail/.test(kind)) return ['st_mail', 'sh_solid'];
  if (/^st_charge/.test(kind)) return ['st_charge_plus', 'st_charge_minus', 'st_charge_zero', 'sh_rounded'];
  if (kind === 'st_brake' || kind === 'it_brake') return ['st_brake', 'sh_brake', 'it_explosion'];
  if (/^it_pipe/.test(kind)) return ['it_pipe'];
  if (kind === 'st_rubberband') return ['st_rubberband', 'sh_round'];
  if (kind === 'st_flash') return ['st_flash', 'sh_solid'];
  if (/^st_magic/.test(kind)) return ['st_brick', 'st_oxyda', 'st_oxydc', 'sh_solid', 'st_rawglass', 'st_lightglass', 'sh_rawglass'];
  if (/^st_ghost/.test(kind)) return ['st_purplemarble', 'st_greenbrown', 'st_break_oxydc', 'st_flat_break', 'sh_solid', 'sh_round'];
  if (/^st_disco/.test(kind)) return ['st_disco'];
  if (kind === 'st_barrier') return ['st_barrier', 'sh_solid'];
  if (/^st_(flat_(breakable|breaking|cracked|burnable)|plaster_breakable)$/.test(kind)) return ['st_flat', 'st_flat_cracked', 'st_flat_fire', 'st_plaster', 'st_flat_break', 'sh_solid'];
  if (kind.startsWith('st_break')) return [kind === 'st_break' ? 'st_break_plain' : kind === 'st_break_laser' ? 'st_flat' : kind, 'st_flat_break', 'sh_solid', 'sh_round'];
  if (kind.startsWith('it_dynamite')) return ['it_dynamite', 'it_dynamite_burning', 'it_explosion', 'it_meditation_hollow', 'it_crack_water', 'it_crack_abyss'];
  if (kind.startsWith('st_shogun')) return ['st_shogun', 'sh_shogun_s', 'sh_shogun_m', 'sh_shogun_l'];
  if (kind.startsWith('it_shogun')) return ['it_shogun_s', 'it_shogun_m', 'it_shogun_l'];
  if (kind === 'st_ice') return ['st_ice', 'st_ice_break', 'sh_rawglass', 'fl_ice'];
  if (/^st_turnstile(_red|_green)?$/.test(kind)) return ['st_turnstile', 'st_turnstile_green', 'sh_solid'];
  if (kind.startsWith('st_turnstilearm')) return ['st_puzzle_blue', 'sh_solid'];
  if (kind.startsWith('st_lightpassenger')) return ['st_lightpassenger', 'st_lightpassenger_off', 'st_lightpassenger_break', 'sh_rawglass'];
  if (kind.startsWith('st_dispenser')) return [kind === 'st_dispenser' ? 'st_dispenser_bombblack' : kind, 'sh_round', 'it_bomb', 'it_dynamite', 'it_dynamite_burning', 'it_extralife', 'it_explosion', 'it_crack_abyss', 'it_crack_water', 'it_meditation_hollow'];
  if (kind === 'st_thief') return ['st_bluegray', 'thief_template', 'st_thief_capture', 'sh_round', 'it_bag'];
  if (kind.startsWith('it_coin')) return ['it_coin_s', 'it_coin_m', 'it_coin_l'];
  if (kind.startsWith('st_coinslot')) return ['st_coinslot', 'st_coinslot_insert', 'sh_solid'];
  if (kind.startsWith('it_bomb')) return ['it_bomb', 'it_explosion', 'it_crack_abyss', 'it_crack_water', 'it_meditation_hollow'];
  if (kind.startsWith('st_window')) return ['st_window_blue', 'st_window_green', 'sh_window'];
  if (kind === 'st_fourswitch') return ['st_fourswitch', 'sh_round'];
  if (kind.startsWith('st_actorimpulse')) return ['st_actorimpulse', 'sh_actorimpulse'];
  if (kind.startsWith('st_blur')) return ['st_blur_straight', 'st_blur_cross', 'sh_round', ...PASSAGE_IMAGES];
  if (kind.startsWith('st_chess')) return ['st_chess_black', 'st_chess_white', 'sh_round'];
  if (kind.startsWith('st_boulder')) return ['st_boulder', 'st_boulder_fall', 'sh_round'];
  if (MOVABLE_STONE.test(kind)) {
    const look = movableLook(kind);
    return look ? [look.image, look.shadow] : [];
  }
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
  private marble = { x: 0, y: 0, fall: -1, color: 0, sink: 0, jump: -1, pearl: false };
  /** The current marble is invisible (it_cherry). */
  hideMarble = false;
  /** Glasses::Spot bits of the current player's glasses (1 death, 2 hollow, 16 light passenger). */
  private glasses = 0;

  /** Glasses in the inventory changed: invisible death stones show, hollow stones vanish. */
  setGlasses(bits: number): void {
    if (bits === this.glasses) return;
    this.glasses = bits;
    this.floorChanged();
  }
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
    // OxydStone "peepall" (level init): flavor e shows the colours of all closed stones but fakes
    const peep = level.world?._PeepAll === 'true';
    this.stones = states.map((s, i) => ({ state: s, prev: s, since: -1e9, opened: peep && level.signals[i]?.symbol !== '-' }));
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
    if (state !== 'closed') s.opened = true;
  }

  private halos: { x: number; y: number; rest: number; small: boolean }[] = [];

  /** Shielded marbles (it_umbrella): halo, blinking in the last 3 s. */
  updateHalos(h: { x: number; y: number; rest: number; small: boolean }[]): void {
    this.halos = h;
  }

  /** Marble position in tile units; fall = progress 0..1 of the fall animation, -1 = not falling. */
  updateMarble(x: number, y: number, fall: number, color = 0, sink = 0, jump = -1, pearl = false): void {
    this.marble.pearl = pearl;
    this.marble.sink = sink;
    this.marble.jump = jump;
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
    // The current ball: a pearl when the level has no black marble (mainPearl)
    if (this.hideMarble) {
      // invisible: nothing drawn
    } else if (this.marble.pearl) this.drawPearl(Math.round(ox + this.marble.x * T), Math.round(oy + this.marble.y * T), this.marble.color, this.marble.fall);
    else this.drawMarble(ox, oy, this.marble);
    // BasicBall::update_halo: halo / halo-blink (2 frames à 30 ms), small ones for pearls
    for (const h of this.halos) {
      const im = this.img![`halo${h.small ? '-small' : ''}${h.rest <= 3 ? '-blink' : ''}`];
      if (!im) continue;
      const S = im.width;
      this.ctx.drawImage(im, 0, (Math.floor(this.now / 30) % 2) * S, S, S, Math.round(ox + h.x * T - S / 2), Math.round(oy + h.y * T - S / 2), S, S);
    }
    // Rubber bands: thick orange lines (Rubberband::postAddition, DL_Lines).
    // ot_wire: purple lines between wired stones (Wire::postAddition)
    const wires = this.objects?.wireLines() ?? [];
    if (wires.length) {
      ctx.strokeStyle = 'rgb(200, 50, 150)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < wires.length; i += 4) {
        ctx.moveTo(Math.round(ox + wires[i] * T), Math.round(oy + wires[i + 1] * T));
        ctx.lineTo(Math.round(ox + wires[i + 2] * T), Math.round(oy + wires[i + 3] * T));
      }
      ctx.stroke();
    }
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
      const [name, fixed, sheetCol = 0] = floorImage(cell.floor, img);
      const im = img[name] ?? img.fl_gray;
      const variants = Math.max(1, Math.floor(im.height / T));
      const v = fixed ?? Math.floor(hash(col, row) * variants);
      g.drawImage(im, sheetCol * T, v * T, T, T, col * T, row * T, T, T);
    });
    // Shadows fall onto the floor before the stones are drawn.
    for (const s of level.signals) g.drawImage(img[OXYD_ANIM[s.flavor]?.shadow ?? 'sh_round'], s.col * T, s.row * T);
    // Glass, greenbrown, plaster and flat stones that are hollow vanish behind glasses ("_glasses" HOLLOW)
    const seenThrough = (cell: { stone: string | null; hollow?: boolean }) => (this.glasses & 2) !== 0 && !!cell.hollow && /^st_(rawglass|lightglass|darkglass|greenbrown|plaster|flat)/.test(cell.stone ?? '');
    level.cells.forEach((cell, i) => {
      if (!cell.stone || cell.stone === 'st_oxyd' || cell.stone === 'st_invisible' || seenThrough(cell)) return;
      g.drawImage(img.sh_solid, (i % level.width) * T, Math.floor(i / level.width) * T);
    });
    level.cells.forEach((cell, i) => {
      // st_invisible: a wall that is not drawn.
      if (!cell.stone || cell.stone === 'st_oxyd' || cell.stone === 'st_invisible' || seenThrough(cell)) return;
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
    const peep = flavor === 'e'; // OxydStone::setClosedModel: st_oxyde<color> after the first opening
    if (peep) flavor = 'b';
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
      } else if (peep && s.opened) {
        base();
        if (img.st_oxyde) ctx.drawImage(img.st_oxyde, px, py);
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
    // it_laserbeam: it_laser_h, _v, _hv
    if (img.it_laser)
      for (const [k, b] of world.beams) {
        const col = k % world.width;
        const row = Math.floor(k / world.width);
        const bx = ox + col * T;
        const by = oy + row * T;
        if (bx < -T || by < -T || bx > VIEW_W || by > SCREEN_H * T) continue;
        const h = (b & 5) !== 0;
        const v = (b & 10) !== 0;
        this.frame('it_laser', h && v ? 2 : h ? 0 : 1, bx, by);
      }
    // Floor heating animation (fl_ice/water/swamp_heating)
    for (const h of world.heatingCells()) if (img[h.image]) this.frame(h.image, h.frame, ox + h.col * T, oy + h.row * T);
    // fl_thief: the thief overlay on its fl_bluegray floor while it emerges, retreats or is captured
    for (const o of world.objects) {
      if (o.cls !== 'flthief' || o.gone || !visible(o)) continue;
      const look = world.thiefLook(o);
      if (look.image) this.frame(look.image, look.frame, ox + o.col * T, oy + o.row * T);
    }
    // fl_scales: overlay on the base floor, released 0 / pressed 1 (models-2d.lua)
    for (const o of world.objects) if (o.cls === 'scales' && !o.gone && visible(o)) this.frame('fl_scales', o.state, ox + o.col * T, oy + o.row * T);
    // fl_bridge opening/closing animation over the floor
    for (const o of world.objects) {
      if (o.cls !== 'bridge' || o.gone || !visible(o)) continue;
      const look = world.bridgeLook(o);
      if (look) this.frame(look.image, look.frame, ox + o.col * T, oy + o.row * T);
    }
    for (const o of world.objects) {
      if (o.gone || o.col < 0 || o.cls === 'oxydref' || o.cls === 'scales' || o.cls === 'bridge' || !visible(o)) continue; // picked up, sunk, removed by Lua, or no cell (ot_timer)
      const px = ox + o.col * T;
      const py = oy + o.row * T;
      if (o.cls === 'trigger' && o.attrs.invisible !== 'true') this.frame('it_trigger', o.state ? 1 : 0, px, py);
      else if (o.cls === 'document' && !o.gone && img.it_document) ctx.drawImage(img.it_document, px, py);
      // it_wormhole: 2 frames à 100 ms while on, frame 1 when off.
      else if (o.cls === 'wormhole') this.frame('it_wormhole', o.state ? Math.floor(this.now / 100) % 2 : 0, px, py);
      else if (o.cls === 'meditation' && !o.gone) this.image(meditationImage(o.state), px, py);
      else if (o.cls === 'landmine' && !o.gone) this.image(o.exploding !== undefined ? 'it_explosion' : 'it_landmine', px, py);
      else if (o.cls === 'wand') this.image('it_magicwand', px, py);
      else if (o.cls === 'spring') this.image('it_spring', px, py);
      else if (o.cls === 'extralife') this.image('it_extralife', px, py);
      else if (o.cls === 'yinyang') this.frame('it_yinyang', 0, px, py); // DefTiles: it_yinyang, it_yangyin
      else if (o.cls === 'tool' && o.kind.startsWith('it_coffee')) this.frame('it_coffee', Math.floor(this.now / 150) % 4, px, py);
      else if (o.cls === 'cross') this.image('it_cross', px, py);
      else if (o.cls === 'surprise') this.image('it_surprise', px, py);
      else if (o.cls === 'pipe') {
        // it_pipe tiles: e s es sw ew w n ne nw ns (models-2d.lua, first row)
        const b = pipeBits(o);
        const idx = ({ 4: 0, 2: 1, 6: 2, 3: 3, 5: 4, 1: 5, 8: 6, 12: 7, 9: 8, 10: 9 } as Record<number, number>)[b] ?? 4;
        if (img.it_pipe) ctx.drawImage(img.it_pipe, idx * T, 0, T, T, px, py, T, T);
      }
      else if (o.cls === 'bottle') this.image(o.kind === 'it_bottle_broken' ? 'it_bottle_broken' : 'it_bottle_idle', px, py);
      else if (o.cls === 'squashed') this.image('it_squashed', px, py);
      else if (o.cls === 'tool' && o.kind.startsWith('it_extinguisher')) this.frame('it_extinguisher', o.kind === 'it_extinguisher_empty' ? 2 : o.kind === 'it_extinguisher_medium' ? 1 : 0, px, py);
      else if (o.cls === 'tool') this.image(o.kind, px, py);
      else if (o.cls === 'burnable') {
        const look = world.burnableLook(o);
        if (look && look.frame < 0) this.image(look.image, px, py);
        else if (look) this.frame(look.image, look.frame, px, py);
      }
      else if (o.cls === 'springboard') this.frame('it_springboard', world.springboardFrame(o), px, py);
      else if (o.cls === 'key') this.frame('it_key', 0, px, py); // Item model it_key (codes only in the inventory)
      else if (o.cls === 'coin') this.image(o.kind === 'it_coin' ? 'it_coin_s' : o.kind, px, py);
      else if (o.cls === 'bag') this.image('it_bag', px, py);
      else if (o.cls === 'strip') {
        const c = stripConnections(o);
        const im = img.it_strip;
        if (im) ctx.drawImage(im, Math.floor(c / 4) * T, (c % 4) * T, T, T, px, py, T, T);
      }
      else if (o.cls === 'puller') {
        // it_puller tiles n e s w; active: they cycle (100 ms)
        const d = 'nesw'.indexOf(/^it_puller_([nesw])$/.exec(o.kind)?.[1] ?? 'w');
        this.frame('it_puller', o.blast !== undefined ? world.dispenserFrameAt(o.blast) % 4 : d, px, py);
      }
      else if (o.cls === 'deathitem') this.frame('it_death', o.blast !== undefined && world.dispenserFrameAt(o.blast) < 4 ? world.dispenserFrameAt(o.blast) : 0, px, py);
      else if (o.cls === 'shogundot') this.frame(o.kind === 'it_shogun' ? 'it_shogun_s' : o.kind, [0, 1, 2, 1][Math.floor(this.now / 160) % 4], px, py);
      else if (o.cls === 'explosion' || o.cls === 'debris' || o.cls === 'dynamite' || o.cls === 'bomb') {
        const look = world.blastLook(o);
        const im = img[look.image];
        if (im) ctx.drawImage(im, look.col * T, look.row * T, T, T, px, py, T, T);
      }
      else if (o.cls === 'blocker' && !world.blockerLook(o).stone) this.frame('st_blocker', 3, px, py); // it_blocker
      else if (o.cls === 'crack') {
        const look = world.crackLook(o);
        if (look) this.frame(look.image, look.frame, px, py);
      }
      else if (o.cls === 'sensor') {
        const look = world.sensorLook(o);
        if (look) this.frame(look.image, look.frame, px, py);
      }
      else if (o.cls === 'magnet') {
        // it_magnet_on: 5 frames à 100 ms, looping
        if (o.state === 1) this.frame('it_magnet_on', Math.floor(this.now / 100) % 5, px, py);
        else this.image('it_magnet_off', px, py);
      }
      else if (o.cls === 'flag') this.image(o.kind === 'it_flag_white' ? 'it_flag_white' : 'it_flag_black', px, py);
      else if (o.cls === 'vortex') this.frame('it_vortex', world.vortexFrame(o), px, py);
      else if (o.cls === 'seed' && !o.gone) {
        const age = world.growAge(o);
        this.frame('it_seed', age < 0 ? 0 : SEED_GROW_FRAMES[Math.min(SEED_GROW_FRAMES.length - 1, Math.floor(age / 120))], px, py);
      }
    }
    for (const pass of ['shadow', 'stone'] as const) {
      for (const o of world.objects) {
        if (o.gone || o.col < 0 || o.cls === 'oxydref' || !visible(o) || o.cls === 'trigger' || o.cls === 'document' || o.cls === 'wormhole' || o.cls === 'meditation' || o.cls === 'landmine' || o.cls === 'seed' || o.cls === 'wand' || o.cls === 'spring' || o.cls === 'extralife' || o.cls === 'yinyang' || o.cls === 'vortex' || o.cls === 'tool' || o.cls === 'flag' || o.cls === 'springboard' || o.cls === 'magnet' || o.cls === 'sensor' || o.cls === 'key' || o.cls === 'crack' || o.cls === 'scales' || o.cls === 'bridge' || o.cls === 'explosion' || o.cls === 'debris' || o.cls === 'dynamite' || o.cls === 'bomb' || o.cls === 'coin' || o.cls === 'bag' || o.cls === 'shogundot' || o.cls === 'deathitem' || o.cls === 'puller' || o.cls === 'strip' || o.cls === 'burnable' || o.cls === 'cross' || o.cls === 'squashed' || o.cls === 'bottle' || o.cls === 'pipe' || o.cls === 'surprise') continue;
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
      const hollow = isHollow(o);
      if (pass === 'shadow') {
        this.image(hollow ? 'sh_puzzle_hollow' : 'sh_solid', px, py);
        return;
      }
      // st_puzzle_<colour>[_hollow].png: 4×4 sheet, column-major by connection bits (models-2d.lua).
      const c = Number(o.attrs.$connections) || 0;
      const im = this.img![`${o.attrs.color === '3' ? 'st_puzzle_yellow' : 'st_puzzle_blue'}${hollow ? '_hollow' : ''}`];
      if (im) this.ctx.drawImage(im, Math.floor(c / 4) * 32, (c % 4) * 32, 32, 32, px, py, 32, 32);
      return;
    }
    if (o.cls === 'death') {
      // DeathStone: invisible ones show through glasses (Spot DEATH)
      if ((o.kind === 'st_death_invisible' || o.attrs.invisible === 'true') && !(this.glasses & 1)) return;
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
    if (o.cls === 'laser' || o.cls === 'mirror') {
      if (pass === 'shadow') {
        this.image('sh_rounded', px, py);
        return;
      }
      const look = o.cls === 'laser' ? { image: 'st_laser', ...world.laserLook(o) } : world.mirrorLook(o);
      const im = this.img![look.image];
      if (im) this.ctx.drawImage(im, look.col * T, look.row * T, T, T, px, py, T, T);
      return;
    }
    if (o.cls === 'keyswitch') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else if (o.kind === 'st_floppy') this.image(o.state === 1 ? 'st_floppy_on' : 'st_floppy_off', px, py);
      else this.frame(o.state === 1 ? 'st_key_on' : 'st_key_off', world.keySwitchFrame(o), px, py);
      return;
    }
    if (o.cls === 'actorimpulse') {
      if (!world.actorimpulseVisible(o)) return;
      const f = world.actorimpulseFrame(o);
      if (pass === 'shadow') shadowFrame('sh_actorimpulse', f, true);
      else this.frame('st_actorimpulse', f, px, py);
      return;
    }
    if (o.cls === 'blur') {
      this.image(pass === 'shadow' ? 'sh_round' : o.state === 0 ? 'st_blur_straight' : 'st_blur_cross', px, py);
      return;
    }
    if (o.cls === 'chess') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame(o.state === 1 ? 'st_chess_white' : 'st_chess_black', world.chessFrame(o), px, py);
      return;
    }
    if (o.cls === 'fourswitch') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_fourswitch', world.fourswitchFrame(o), px, py);
      return;
    }
    if (o.cls === 'knight') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_knight', Math.min(4, o.state), px, py);
      return;
    }
    if (o.cls === 'shogun') {
      const look = world.shogunLook(o);
      if (pass === 'shadow') this.image(look.shadow, px, py);
      else this.frame('st_shogun', look.frame, px, py);
      return;
    }
    if (o.cls === 'ice') {
      if (pass === 'shadow') this.image('sh_rawglass', px, py);
      else if (o.breaking !== undefined) this.frame('st_ice_break', world.dispenserFrame(o) > 4 ? 4 : world.dispenserFrame(o), px, py);
      else this.image('st_ice', px, py);
      return;
    }
    if (o.cls === 'turnstile' || o.cls === 'turnstilearm') {
      if (pass === 'shadow') {
        this.image('sh_solid', px, py);
        return;
      }
      if (o.cls === 'turnstile') {
        const look = world.turnstileLook(o);
        this.frame(look.image, look.frame, px, py);
      } else {
        // arms: blue puzzle pieces connected towards the pivot (st_puzzle1/2/4/8)
        const conn = [4, 8, 1, 2][o.state];
        const im = this.img!.st_puzzle_blue;
        if (im) ctx.drawImage(im, Math.floor(conn / 4) * T, (conn % 4) * T, T, T, px, py, T, T);
      }
      return;
    }
    if (o.cls === 'lightpassenger') {
      const look = world.passengerLook(o);
      if (pass === 'shadow') this.image('sh_rawglass', px, py);
      else this.frame(look.image, look.frame, px, py);
      return;
    }
    if (o.cls === 'dispenser') {
      const name = o.kind === 'st_dispenser' ? 'st_dispenser_bombblack' : o.kind;
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame(name, world.dispenserFrame(o), px, py);
      return;
    }
    if (o.cls === 'thief') {
      const look = world.thiefLook(o);
      if (pass === 'shadow') {
        if (look.image !== 'st_thief_capture') this.image('sh_round', px, py);
      } else if (look.image === 'st_thief_capture') this.frame(look.image, look.frame, px, py);
      else {
        this.image('st_bluegray', px, py);
        if (look.overlay) this.frame('thief_template', look.frame, px, py);
      }
      return;
    }
    if (o.cls === 'coinslot') {
      if (pass === 'shadow') this.image('sh_solid', px, py);
      else {
        const look = world.coinslotLook(o);
        this.frame(look.image, look.frame, px, py);
      }
      return;
    }
    if (o.cls === 'charge') {
      // st_charge_plus/minus/zero: frame 0, hit: frame 1 for 140 ms; shadow sh_rounded
      const c = chargeOf(o);
      const age = o.pulse === undefined ? -1 : world.ageOf(o.pulse);
      if (pass === 'shadow') this.image('sh_rounded', px, py);
      else this.frame(c > 0 ? 'st_charge_plus' : c < 0 ? 'st_charge_minus' : 'st_charge_zero', age >= 0 && age < 140 ? 1 : 0, px, py);
      return;
    }
    if (o.cls === 'brake') {
      if (pass === 'shadow') this.image('sh_brake', px, py);
      else this.image('st_brake', px, py);
      return;
    }
    if (o.cls === 'volcano') {
      const look = world.volcanoLook(o);
      if (pass === 'shadow') {
        if (look.shadow) this.image(look.shadow, px, py);
      } else this.frame(look.image, look.frame, px, py);
      return;
    }
    if (o.cls === 'mail') {
      // st_mail: sheet n e w s, DefSolidStone (sh_solid)
      if (pass === 'shadow') this.image('sh_solid', px, py);
      else this.frame('st_mail', [2, 3, 1, 0][mailDir(o)], px, py);
      return;
    }
    if (o.cls === 'portal') {
      // st_portal_*: model st_portal_horse, shadow sh_portal_horse
      if (pass === 'shadow') this.image('sh_portal_horse', px, py);
      else this.image('st_portal_horse', px, py);
      return;
    }
    if (o.cls === 'scissors') {
      // st_scissors: frame 0; snip: frame 1 for 130 ms
      const age = o.pulse === undefined ? -1 : world.ageOf(o.pulse);
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_scissors', age >= 0 && age < 130 ? 1 : 0, px, py);
      return;
    }
    if (o.cls === 'rubberstone') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.image('st_rubberband', px, py);
      return;
    }
    if (o.cls === 'monoflop') {
      // st_monoflop: frame 0 off; on: st_monoflop_anim 2 × 180 ms
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_monoflop', o.state === 1 ? Math.floor(this.now / 180) % 2 : 0, px, py);
      return;
    }
    if (o.cls === 'flash') {
      // st_flash: frame 0; hit: st_flash_anim = frames 1..5 à 50 ms (models-2d.lua)
      const age = o.pulse === undefined ? -1 : world.ageOf(o.pulse);
      if (pass === 'shadow') this.image('sh_solid', px, py);
      else this.frame('st_flash', age >= 0 && age < 5 * 50 ? 1 + Math.floor(age / 50) : 0, px, py);
      return;
    }
    if (o.cls === 'magic') {
      // st_magic_brick = st_brick0, oxyda/oxydc look like closed Oxyd stones
      const f = magicFlavor(o);
      if (pass === 'shadow') this.image('sh_solid', px, py);
      else this.frame(f === 'oxyda' ? 'st_oxyda' : f === 'oxydc' ? 'st_oxydc' : 'st_brick', 0, px, py);
      return;
    }
    if (o.cls === 'ghost') return; // GhostStone: model "invisible"
    if (o.cls === 'disco') {
      // DiscoStone: tiles st_disco0..2, no shadow (floating)
      if (pass !== 'shadow') this.frame('st_disco', Math.max(0, Math.min(2, o.state)), px, py);
      return;
    }
    if (o.cls === 'polarswitch') {
      if (pass === 'shadow') this.image('sh_rawglass', px, py);
      else this.image(o.state === 1 ? 'st_lightglass' : 'st_darkglass', px, py);
      return;
    }
    if (o.cls === 'barrier') {
      // st_barrier_<item>: the barrier with its item drawn on top
      if (pass === 'shadow') this.image('sh_solid', px, py);
      else {
        this.image('st_barrier', px, py);
        const f = o.attrs.flavor || 'all';
        if (f !== 'all') {
          const name = objectImages(f)[0];
          if (name) this.frame(name, 0, px, py);
        }
      }
      return;
    }
    if (o.cls === 'breakstone') {
      const look = world.breakLook(o);
      if (pass === 'shadow') this.image(look.solid ? 'sh_solid' : 'sh_round', px, py);
      else this.frame(look.image, look.frame, px, py);
      return;
    }
    if (o.cls === 'window') {
      // st_window_blue/_green: sheet 4 × 4 by the face bits; sh_window1..4 per face
      const faces = windowFaces(o);
      const green = o.attrs.secure === 'true' || o.attrs.secure === '1';
      if (pass === 'shadow') {
        const sh = img.sh_window;
        if (sh) for (let d = 0; d < 4; d++) if (faces & (1 << d)) ctx.drawImage(sh, 0, d * 41, 41, 41, px, py, 41, 41);
      } else {
        const im = img[green ? 'st_window_green' : 'st_window_blue'];
        if (im) ctx.drawImage(im, Math.floor(faces / 4) * T, (faces % 4) * T, T, T, px, py, T, T);
      }
      return;
    }
    if (o.cls === 'laserswitch') {
      // st_laserswitch0 = st_oxydb; on: st_quake PingPong, 50 ms per frame
      if (pass === 'shadow') this.image('sh_round', px, py);
      else if (o.state === 1) this.frame('st_quake', [0, 1, 2, 3, 3, 2, 1, 0][Math.floor(this.now / 50) % 8], px, py);
      else this.image('st_oxydb', px, py);
      return;
    }
    if (o.cls === 'blocker') {
      const look = world.blockerLook(o);
      if (!look.stone) return; // drawn with the items
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_blocker', look.frame, px, py);
      return;
    }
    if (o.cls === 'rotator') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else {
        const look = world.rotatorLook(o);
        this.frame(look.image, look.frame, px, py);
      }
      return;
    }
    if (o.cls === 'pull') {
      // st_pull: sh_rawglass idle, sh_pull1..4 while moving n s e w
      const f = world.swapFrame(o);
      if (pass === 'shadow') {
        if (f === 0) this.image('sh_rawglass', px, py);
        else shadowFrame('sh_pull', f - 1, true);
      } else this.frame('st_pull', f, px, py);
      return;
    }
    if (o.cls === 'swap') {
      if (pass === 'shadow') this.image('sh_round', px, py);
      else this.frame('st_swap', world.swapFrame(o), px, py);
      return;
    }
    if (o.cls === 'passage') {
      const look = passageLook(o);
      this.image(pass === 'shadow' ? look.shadow : look.image, px, py);
      return;
    }
    if (o.cls === 'chameleon') {
      // ChameleonStone::init_model: the model of the floor below (it covers items there)
      if (pass === 'stone' && this.level) {
        const floor = this.level.cells[o.row * this.level.width + o.col]?.floor ?? 'fl_gray';
        const [name, fixed] = floorImage(floor, this.img!);
        const im = this.img![name] ?? this.img!.fl_gray;
        const variants = Math.max(1, Math.floor(im.height / T));
        const v = fixed ?? Math.floor(hash(o.col, o.row) * variants);
        this.ctx.drawImage(im, 0, v * T, T, T, px, py, T, T);
      }
      return;
    }
    if (o.cls === 'boulder') {
      // st_boulder.png / st_boulder_fall.png: columns n e s w, rows = 3 frames; falling has no shadow
      const { frame, falling } = world.boulderFrame(o);
      if (pass === 'shadow') {
        if (!falling) this.image('sh_round', px, py);
        return;
      }
      const col = [3, 2, 1, 0][o.state & 3]; // Enigma W0 S1 E2 N3 → column of n e s w
      const im = this.img![falling ? 'st_boulder_fall' : 'st_boulder'];
      if (im) this.ctx.drawImage(im, col * 32, frame * 32, 32, 32, px, py, 32, 32);
      return;
    }
    if (o.cls === 'box') {
      if (o.gone) return;
      if (MOVABLE_STONE.test(o.kind)) {
        const look = movableLook(o.kind);
        if (look) this.image(pass === 'shadow' ? look.shadow : look.image, px, py);
        return;
      }
      const age = world.growAge(o);
      if (pass === 'shadow') this.image('sh_round', px, py);
      else if (age >= 0) {
        // hay box and greenbrown: frames 4, 3, 2 of their sheet (ReverseFrames), 130 ms each
        const f = Math.min(2, Math.floor(age / 130));
        if (o.kind === 'st_box_hay' || o.kind === 'st_greenbrown') this.frame(o.kind, 3 - f, px, py);
        else this.frame('st_box_wood_growing', f, px, py);
      } else if (o.kind.startsWith('st_box_wood')) this.frame('st_box_wood', o.kind.endsWith('_v') ? 1 : 0, px, py);
      else if (o.kind === 'st_box_hay' || o.kind === 'st_greenbrown') this.frame(o.kind, 0, px, py);
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
      if (a.kind === 'marble' && a.pearl) {
        this.drawPearl(cx, cy, a.color, a.fall ?? -1);
        continue;
      }
      if (a.kind === 'marble') {
        this.drawMarble(ox, oy, { x: a.x, y: a.y, fall: a.fall ?? -1, color: a.color, sink: a.sink ?? 0, jump: a.jump ?? -1 });
        continue;
      }
      if (a.kind === 'horse') {
        // ac_horse: SpriteImage (0.5, 0.18), shadow sh_horse
        const sh = img.sh_horse;
        if (sh) ctx.drawImage(sh, cx - sh.width / 2 + 4, cy - sh.height * 0.18 + 4);
        const im = img.ac_horse;
        if (im) ctx.drawImage(im, cx - im.width / 2, cy - im.height * 0.18);
        continue;
      }
      if (a.kind === 'bug') {
        // ac_bug: SpriteImage centred, shadow sh_pearl
        if (img.sh_pearl) ctx.drawImage(img.sh_pearl, cx - s, cy - s);
        const im = img.ac_bug;
        if (im) ctx.drawImage(im, cx - im.width / 2, cy - im.height / 2);
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

  /** ac_pearl: sh_pearl offset 0.4; falling: 5 frames à 70 65 60 55 50 ms, then invisible. */
  private drawPearl(cx: number, cy: number, color: number, fall: number): void {
    const { ctx } = this;
    const img = this.img!;
    const name = color === 0 ? 'ac_pearl_black' : 'ac_pearl_white';
    const s = 0.4 * SPRITE;
    if (fall >= 0) {
      const ms = fall * CLASSIC_FALL_SECONDS * 1000;
      const steps = [70, 65, 60, 55, 50];
      let f = 0;
      for (let acc = steps[0]; f < steps.length && ms >= acc; ) acc += steps[++f] ?? 1e9;
      if (f >= steps.length) return;
      if (img.sh_pearl_fall) ctx.drawImage(img.sh_pearl_fall, 0, f * SPRITE, SPRITE, SPRITE, cx - s, cy - s, SPRITE, SPRITE);
      const im = img[`${name}_fall`];
      if (im) ctx.drawImage(im, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
      return;
    }
    if (img.sh_pearl) ctx.drawImage(img.sh_pearl, cx - s, cy - s);
    const im = img[name];
    if (im) ctx.drawImage(im, 0, 0, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
  }

  private drawMarble(ox: number, oy: number, m: { x: number; y: number; fall: number; color: number; sink: number; jump?: number }): void {
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
    if (m.sink >= 7) return; // sunk: invisible
    if ((m.jump ?? -1) >= 0 && img[`${name}_jump`] && img.sh_marble_jump) {
      // ac_marble-jump: frames 1 2 3 4 4 3 2 1 à 70 ms; the shadow sits further off (0.4).
      const k = Math.min(7, Math.floor((m.jump ?? 0) * 8));
      const f = k < 4 ? k : 7 - k;
      ctx.drawImage(img.sh_marble_jump, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE * 0.4, cy - SPRITE * 0.4, SPRITE, SPRITE);
      ctx.drawImage(img[`${name}_jump`], 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
      return;
    }
    if (m.sink > 0 && img[`${name}_sink`] && img.sh_marble_sink) {
      // BasicBall::set_sink_model: frame = depth rounded down.
      const f = Math.floor(m.sink);
      ctx.drawImage(img.sh_marble_sink, 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE * 0.4, cy - SPRITE * 0.4, SPRITE, SPRITE);
      ctx.drawImage(img[`${name}_sink`], 0, f * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
      return;
    }
    // set_shine_model: the highlight alternates with the pixel position.
    const shine = (Math.round(m.x * 32) + Math.round(m.y * 32)) % 2 !== 0 ? 1 : 0;
    ctx.drawImage(img.sh_marble, cx - SPRITE * 0.4, cy - SPRITE * 0.4);
    ctx.drawImage(img[name], 0, shine * SPRITE, SPRITE, SPRITE, cx - SPRITE / 2, cy - SPRITE / 2, SPRITE, SPRITE);
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
/** models-2d.lua: fl_slope is a 6 × 4 sheet (DefSubimages, column by column); shape → subimage. */
const SLOPE_SUB: Record<string, number> = {
  '': 21, pw: 4, ps: 1, pe: 3, pn: 2, inw: 12, isw: 11, ise: 9, ine: 10, onw: 8, osw: 6, ose: 5, one: 7,
  tw: 21, ts: 21, te: 21, tn: 21, twl: 2, tsl: 4, tel: 1, tnl: 3, twr: 1, tsr: 3, ter: 2, tnr: 4,
};

/** Floor image: name, row (variant) and column in its sheet. */
function floorImage(kind: string, img: Images): [string, number | undefined, number?] {
  const slope = /^fl_slope(?:_(\w+))?$/.exec(kind);
  if (slope) {
    const n = (SLOPE_SUB[slope[1] ?? ''] ?? 21) - 1;
    return ['fl_slope', n % 4, Math.floor(n / 4)];
  }
  if (kind === 'fl_wood_framed_h') return ['fl_wood_framed', 0];
  // fl_yinyang_yin/_yang: sheet of 2 – visible, invisible
  const yy = /^fl_yinyang(?:_(yin|yang))?(_invisible)?$/.exec(kind);
  if (yy) return [`fl_yinyang_${yy[1] ?? 'yin'}`, yy[2] ? 1 : 0];
  if (kind === 'fl_fake_abyss') return ['fl_abyss', undefined]; // FakeFloor
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
