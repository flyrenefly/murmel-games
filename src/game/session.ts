/**
 * One run of a level without the browser (docs/SPEC-aufzeichnung.md, stage A3): physics, objects,
 * Lua, deaths and respawns, pairs and the win – one physics step at a time. Everything seen or heard
 * goes through SessionUI; main.ts draws and plays sounds, a replay in Node passes NO_UI.
 * The code moved here from main.ts unchanged in behaviour.
 */
import { addSignal, cellAt, colorNewSignals, isDeadly, parseLevel, type Level, type LevelFile } from './level';
import { applyWorld, makeLuaHost } from './luahost';
import { ObjectWorld, type ObjectEvent } from './objects';
import { PairBoard, type PairEvent } from './pairs';
import { PHYSICS_DT, PhysicsWorld, type Contact } from './physics';
import { createRng } from './rng';
import type { LuaHost, LuaLevel } from '../lua/runtime';
import { CLASSIC_FALL_SECONDS } from '../render/classic';

/** Seconds of the fall animation; a fallen marble comes back 0.25 s after it. */
export const FALL_SECONDS = CLASSIC_FALL_SECONDS;
/** A vortex takes the marble in 0.4 s (drawing only). */
const VORTEX_SECONDS = 0.4;

export type SoundName =
  | 'open' | 'solved' | 'close' | 'metal' | 'stone' | 'swamped' | 'shatter' | 'fall' | 'switchOn' | 'triggerDown' | 'triggerUp'
  | 'pickup' | 'move' | 'explode' | 'fakeOxyd' | 'landmine' | 'mirror' | 'laser' | 'bomb' | 'quake' | 'menu' | 'jump';

/** What the browser does for a run: sounds, messages, drawing updates. */
export interface SessionUI {
  sound(name: SoundName, value?: number): void;
  toast(text: string, ms: number): void;
  /** An Oxyd stone changed (board.states[index]). */
  stoneState(index: number): void;
  /** The inventory changed. */
  items(): void;
  /** Pairs, falls or similar changed. */
  hud(): void;
  floorChanged(): void;
  peepAll(indices: number[]): void;
  /** Lua made new Oxyd stones. */
  signalsAdded(): void;
  /** The level is solved. */
  won(): void;
  /** The level starts over: a new game, or keeping the extra lives. */
  restart(how: 'new' | 'keep'): void;
}

const noop = (): void => {};
export const NO_UI: SessionUI = {
  sound: noop, toast: noop, stoneState: noop, items: noop, hud: noop, floorChanged: noop, peepAll: noop, signalsAdded: noop, won: noop, restart: noop,
};

export type StartLua = (code: string, host: LuaHost, libs: readonly string[], oldApi: boolean) => Promise<LuaLevel>;

export interface SessionOptions {
  seed: number;
  /** Extra lives kept from the last level (after a win). */
  carryLives?: number | null;
  ui?: SessionUI;
  /** Lua runtime (browser: src/lua, Node: fengari); without it Lua levels cannot start. */
  startLua?: StartLua;
}

/** Input of one physics step: a mouse impulse (already scaled) and the force of keys or tilt. */
export interface StepControl {
  fx: number;
  fy: number;
  ax: number;
  ay: number;
}

export const NO_CONTROL: StepControl = { fx: 0, fy: 0, ax: 0, ay: 0 };

export class GameSession {
  readonly level: Level;
  readonly board: PairBoard;
  readonly physics: PhysicsWorld;
  readonly objects: ObjectWorld;
  readonly seed: number;
  readonly rng: () => number;
  /** World attributes during play (Lua may change them: wo["ConserveLevel"] …). */
  readonly world: Record<string, string>;
  /** wo["GlobalForce"] of the level. */
  readonly globalForce = { x: 0, y: 0 };
  lua: LuaLevel | null = null;
  luaHost: LuaHost | null = null;
  ui: SessionUI;

  /** Still playing: false after the win (physics keeps running, input and timers stop). */
  playing = true;
  won = false;
  /** Physics steps played (the time of the run: steps × PHYSICS_DT). */
  steps = 0;
  falls = 0;
  /** Set when the level starts over (a replay ends there). */
  restartRequested: 'new' | 'keep' | null = null;
  /** After the death animation: restart the level, as a new game or keeping the lives. */
  private pendingRestart: 'new' | 'keep' | null = null;

  /** Per marble: seconds into the fall animation, -1 = not falling. */
  readonly falling: number[];
  /** Per marble: how it died (sinking leaves nothing to see). */
  readonly deathKind: ('fall' | 'shatter' | 'sink')[];
  /** Per marble: where it respawns. */
  readonly startPos: { x: number; y: number }[];
  /** BasicBall shield (it_umbrella): seconds of protection left per marble. */
  readonly shield: number[];
  /** BasicBall invisibility (it_cherry): seconds left per marble. */
  readonly invis: number[];
  /** BasicBall drunk time (it_bottle): seconds left per marble. */
  readonly drunk: number[];
  /** Drop::activate: seconds a marble stays a rotor (ROTOR_LIFETIME 5). */
  readonly rotorTime: number[];
  /** Marbles a vortex has swallowed: the step it happened + 1, 0 = not. */
  readonly inVortex: number[];
  /** Marbles that stay dead (player 2 without lives, not essential). */
  readonly deadForever: boolean[];

  private constructor(file: LevelFile, opts: SessionOptions) {
    this.ui = opts.ui ?? NO_UI;
    this.seed = opts.seed >>> 0;
    this.rng = createRng(this.seed);
    const lv = (this.level = parseLevel(file, this.rng));
    this.board = new PairBoard(lv.signals.map((s) => s.symbol));
    this.objects = new ObjectWorld(lv.objects, lv.width, lv.texts, {
      stoneAt: (c, r) => {
        const cell = cellAt(lv, c, r);
        return !cell || cell.stone !== null;
      },
      floorAt: (c, r) => cellAt(lv, c, r)?.floor ?? 'fl_abyss',
      setFloor: (c, r, kind) => {
        const cell = cellAt(lv, c, r);
        if (cell) {
          cell.floor = kind;
          delete cell.force;
          delete cell.fire;
        }
      },
      staticStone: (c, r) => cellAt(lv, c, r)?.stone ?? null,
      floorAttr: (c, r, key) => cellAt(lv, c, r)?.fire?.[key],
      floodSources: () => lv.cells.flatMap((cell, i) => (cell.fire?.flooding === 'true' ? [[i % lv.width, Math.floor(i / lv.width)] as [number, number]] : [])),
      // Stone::is_transparent: hollow stones and glass except dark glass and beads
      transparentAt: (c, r) => {
        const cell = cellAt(lv, c, r);
        return !!cell?.stone && (!!cell.hollow || /^st_(rawglass|lightglass|redfiber)/.test(cell.stone));
      },
      setStaticStone: (c, r, kind, hollow) => {
        const cell = cellAt(lv, c, r);
        if (!cell) return;
        cell.stone = kind;
        if (hollow) cell.hollow = true;
        else delete cell.hollow;
        this.physics?.setSolid(c, r, kind !== null && !hollow);
        this.ui.floorChanged();
      },
    }, this.rng, lv.compat);
    const objects = this.objects;
    if (lv.world.FallenPuzzle) objects.fallenPuzzle = lv.world.FallenPuzzle;
    const physics = (this.physics = new PhysicsWorld(lv, objects));
    physics.random = this.rng;
    // the player of the main ball (a single white marble belongs to player 2)
    objects.player = this.ownerOf(physics.current);
    // wo["GlobalForce"] (server::ConstantForce) acts on every actor, like the item forces.
    this.world = { ...lv.world };
    applyWorld(physics, this.world, this.globalForce);
    physics.setForceField((x, y, flying) => {
      const [fx, fy] = objects.fieldForce(x, y, flying);
      return [fx + this.globalForce.x, fy + this.globalForce.y];
    });
    // Each player has an inventory (player.cc); player 2 owns the white marble.
    objects.ownerOf = (i) => this.ownerOf(i);
    objects.isPearl = (i) => physics.marbles[i]?.pearl === true;
    // player::NewGame: two extra lives (ProvideExtralifes), kept from the last level after a win;
    // with two marbles the yin-yang is an inventory item in front (player::AddYinYang).
    if (this.enigmaRules) {
      const lives = opts.carryLives ?? (lv.world.ProvideExtralifes === 'false' ? 0 : 2);
      for (let k = 0; k < lives; k++) objects.inventories[0].push('it_extralife');
      if (physics.marbles.some((_, k) => this.ownerOf(k) === 1)) {
        for (let k = 0; k < (lv.world.ProvideExtralifes === 'false' ? 0 : 2); k++) objects.inventories[1].push('it_extralife');
      }
    }
    const each = <T>(v: T): T[] => physics.marbles.map(() => v);
    this.deadForever = each(false);
    this.inVortex = each(0);
    this.shield = each(0);
    this.invis = each(0);
    this.drunk = each(0);
    this.rotorTime = each(0);
    if (physics.steerable > 1) for (const inv of objects.inventories) inv.unshift('it_yinyang');
    this.falling = each(-1);
    this.deathKind = each<'fall' | 'shatter' | 'sink'>('fall');
    this.startPos = physics.marbles.map((m) => ({ ...m.pos }));
  }

  /** A run of a level; Lua levels start their script (needs opts.startLua). */
  static async create(file: LevelFile, opts: SessionOptions): Promise<GameSession> {
    const s = new GameSession(file, opts);
    await s.startScript(opts.startLua);
    return s;
  }

  private async startScript(startLua?: StartLua): Promise<void> {
    const lv = this.level;
    if (!lv.lua) return;
    if (!startLua) throw new Error('Lua-Level ohne Lua-Laufzeit');
    const ph = this.physics;
    const ow = this.objects;
    // Oxyd stones made by Lua (Pentomino): a new closed stone; the renderer learns of them once per batch
    let signalsPending = false;
    const addOxyd = (x: number, y: number, flavor: string): void => {
      const s = addSignal(lv, x, y, flavor);
      if (!s || s.index < this.board.states.length) return;
      this.board.add(s.symbol);
      ph.addSignal(x, y, s.index);
      if (signalsPending) return;
      signalsPending = true;
      queueMicrotask(() => {
        signalsPending = false;
        this.ui.signalsAdded();
      });
    };
    const shuffleOxyd = (): void => {
      this.colorSignals();
      this.board.shuffle(this.rng);
      lv.signals.forEach((x) => (x.symbol = this.board.symbolOf(x.index)));
    };
    const host = makeLuaHost({ level: lv, objects: ow, physics: ph, redraw: () => this.ui.floorChanged(), random: this.rng, addOxyd, shuffleOxyd }, this.world, this.globalForce);
    const l = await startLua(lv.lua.code, host, lv.lua.libs ?? [], lv.compat < 1.1);
    this.lua = l;
    this.luaHost = host;
    ow.onCallback = (fn, value, sender) => l.callback(fn, value, `o:${sender.id}`);
  }

  /** Enigma's life rule applies to imported Enigma levels; Murmel's own levels stay unlimited. */
  get enigmaRules(): boolean {
    return this.level.id.startsWith('enigma:');
  }

  /** Seconds of play (physics steps × PHYSICS_DT). */
  get playSeconds(): number {
    return this.steps * PHYSICS_DT;
  }

  livesLeft(): number {
    return this.objects.inventories[0].filter((k) => k === 'it_extralife').length;
  }

  /** Owner of a marble: the white marble belongs to player 2 (YANG), pearls to player 1. */
  ownerOf(i: number): number {
    const m = this.physics?.marbles[i];
    return m && m.color === 1 && !m.pearl ? 1 : 0;
  }

  /** Progress of the vortex animation of marble i (0..1), -1 = not in a vortex. */
  vortexFall(i: number): number {
    const v = this.inVortex[i];
    return v ? Math.min(1, ((this.steps + 1 - v) * PHYSICS_DT) / VORTEX_SECONDS) : -1;
  }

  // ---------- one physics step ----------

  step(control: StepControl): void {
    const ph = this.physics;
    const objects = this.objects;
    const steering = this.playing && this.falling[ph.current] < 0;
    if (steering && (control.fx !== 0 || control.fy !== 0)) ph.addMouseForce(control.fx, control.fy);
    if (steering) ph.setAxisForce(control.ax, control.ay);
    else ph.setAxisForce(0, 0);
    // Timers count physics steps, not frames: a run replays the same on any refresh rate.
    if (this.playing) this.timerStep(PHYSICS_DT);
    ph.step((c) => this.onContact(c));
    ph.marbles.forEach((m, i) => {
      if (this.falling[i] >= 0) return;
      const to = objects.warpTarget(m.pos.x, m.pos.y);
      // WarpActor without keeping the velocity.
      if (to) {
        ph.respawn(to.x, to.y, i);
        if (to.cut) ph.cutRubbers(i);
      }
      if (this.inVortex[i]) return; // swallowed: nothing else happens to it
      // A jumping marble touches no items and presses no triggers (is_flying).
      if (m.jump > 0) return;
      // a marble turned into a rotor flies too (Rotor: is_flying)
      if ((this.rotorTime[i] ?? 0) > 0) return;
      objects.marbleAt(Math.floor(m.pos.x), Math.floor(m.pos.y), i);
      objects.actorStep(m.pos.x, m.pos.y, i, m.radius);
    });
    for (const e of ph.enemies) objects.actorStep(e.pos.x, e.pos.y, -1);
    objects.update(PHYSICS_DT * 1000);
    this.handleObjectEvents(objects.events);
    // ChangeMeditation → server::FinishLevel: all pearls rest in hollows
    if (this.playing && objects.meditationDone(ph.marbles.filter((m) => m.pearl).length)) this.win();
    ph.marbles.forEach((m, i) => {
      const under = cellAt(this.level, Math.floor(m.pos.x), Math.floor(m.pos.y));
      if (this.falling[i] < 0 && m.jump <= 0 && !this.inVortex[i] && !((this.rotorTime[i] ?? 0) > 0) && under && isDeadly(under.floor) && !objects.coversFloor(m.pos.x, m.pos.y, Math.hypot(m.vel.x, m.vel.y))) this.marbleDies(i, false);
    });
    this.fallStep(PHYSICS_DT);
  }

  /** One physics step of the item timers (shield, invisibility, drunk, rotor) and the play time. */
  private timerStep(dt: number): void {
    this.steps++;
    const down = (a: number[]) => a.forEach((s, i) => (a[i] = Math.max(0, s - dt)));
    down(this.shield);
    down(this.invis);
    down(this.drunk);
    down(this.rotorTime);
    const objects = this.objects;
    this.physics.marbles.forEach((m, i) => {
      m.shielded = (this.shield[i] ?? 0) > 0;
      m.invisible = (this.invis[i] ?? 0) > 0;
      m.drunk = (this.drunk[i] ?? 0) > 0;
      // DropCallback::alarm: back to a marble after 5 s
      m.rotor = (this.rotorTime[i] ?? 0) > 0;
      m.radius = m.rotor ? 22 / 64 : m.pearl ? 13 / 64 : 19 / 64;
      // Actor "_update_mass": the inventory's weights (it_weight, mass 10) add to the marble
      const inv = objects.inventories[this.ownerOf(i)] ?? objects.inventory;
      m.mass = (m.pearl ? 0.7 : 1) + 10 * inv.filter((k) => k === 'it_weight').length;
      m.spikes = inv.includes('it_pin'); // Actor "_update_pin"
    });
  }

  /** One physics step of falling marbles: after the fall they come back (or the level starts over). */
  private fallStep(dt: number): void {
    this.falling.forEach((f, i) => {
      if (f < 0) return;
      this.falling[i] = f + dt;
      if (this.falling[i] < FALL_SECONDS + 0.25) return;
      // a marble without lives that is not essential stays fallen: still 'falling', never drawn
      if (this.deadForever[i]) return;
      this.falling[i] = -1;
      if (this.pendingRestart) {
        this.restartRequested = this.pendingRestart;
        this.pendingRestart = null;
        this.ui.restart(this.restartRequested);
        return;
      }
      const at = this.respawnPos(i);
      this.physics.respawn(at.x, at.y, i);
    });
  }

  private win(): void {
    if (this.won) return;
    this.won = true;
    this.playing = false;
    this.ui.won();
  }

  // ---------- events ----------

  private handlePairEvents(events: PairEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'opened':
          this.ui.stoneState(ev.index);
          this.ui.sound('open');
          break;
        case 'solved':
          this.ui.stoneState(ev.a);
          this.ui.stoneState(ev.b);
          this.ui.sound('solved');
          break;
        case 'closed':
          for (const i of ev.indices) this.ui.stoneState(i);
          this.ui.sound('close');
          break;
        case 'complete':
          this.win();
          break;
      }
    }
    this.ui.hud();
  }

  private onContact(c: Contact): void {
    const objects = this.objects;
    if (c.kind === 'actor') {
      // Rotor::on_collision, Top::on_collision, Killer::on_collision: the marble shatters (not as a rotor itself).
      if ((this.rotorTime[c.marble] ?? 0) <= 0) this.marbleDies(c.marble, true);
      return;
    }
    if (c.kind === 'sunk') {
      this.marbleDies(c.marble, 'sink');
      return;
    }
    if (c.kind === 'shatter') {
      this.marbleDies(c.marble, true);
      return;
    }
    if (c.kind === 'object') {
      if (c.by >= 0) objects.touch(c.col, c.row, c.by); // other actors only hit
      if (c.by >= 0 && c.vn < 0) {
        // ActorImpulseStone::actor_hit: away from the bumper's centre
        const m = this.physics.marbles[c.by];
        const f = objects.bump(c.col, c.row, m.pos.x, m.pos.y);
        if (f) this.physics.kick(c.by, f[0], f[1]);
      }
      if (!c.hit) return;
      // Switches sound metallic (Switch::collision_sound), doors like stone.
      if (objects.objects.some((o) => (o.cls === 'switch' || o.cls === 'laserswitch' || o.cls === 'coinslot' || o.cls === 'keyswitch') && o.col === c.col && o.row === c.row)) this.ui.sound('metal', c.speed);
      else this.ui.sound('stone', c.speed);
      objects.hit(c.col, c.row, c.color, c.nx, c.ny, c.vn, c.vx, c.vy, c.by);
      return;
    }
    this.ui.sound('stone', c.speed); // Enigma: every stone hit makes the stone sound
    if (c.kind === 'signal') this.hitSignal(c.index);
  }

  /** OxydStone::initColors: stones made by Lua get their colours with wo:shuffleOxyd or their first hit. */
  private colorSignals(): void {
    if (colorNewSignals(this.level, this.rng)) this.level.signals.forEach((s) => this.board.setSymbol(s.index, s.symbol));
  }

  private hitSignal(index: number): void {
    this.colorSignals();
    this.handlePairEvents(this.board.hit(index));
  }

  /** Marble i dies: fall animation, then respawn at its start. */
  marbleDies(i: number, how: boolean | 'sink'): void {
    const physics = this.physics;
    if (!(this.falling[i] < 0)) return;
    if ((this.shield[i] ?? 0) > 0) return; // BasicBall::change_state_noshield
    const shatter = how === true;
    this.invis[i] = 0; // BasicBall: dead marbles are visible again
    this.rotorTime[i] = 0;
    this.drunk[i] = 0;
    this.deathKind[i] = how === 'sink' ? 'sink' : shatter ? 'shatter' : 'fall';
    this.falling[i] = 0;
    physics.setActive(false, i);
    this.objects.marbleGone(i);
    this.falls++;
    // player::CheckDeadActors / resurrect_actor: every death costs an extra life.
    if (this.enigmaRules && this.level.world.InfiniteReincarnation !== 'true') {
      const m = physics.marbles[i];
      const owner = this.ownerOf(i);
      const inv = this.objects.inventories[owner];
      const idx = inv.indexOf('it_extralife');
      if (idx >= 0) inv.splice(idx, 1);
      this.ui.items();
      if (idx >= 0) {
        // ConserveLevel false: the level restarts (costing the life)
        if ((this.world.ConserveLevel ?? this.level.world.ConserveLevel) === 'false') this.pendingRestart = 'keep';
      } else if (owner === 0 || m.essential) {
        this.pendingRestart = 'new'; // out of lives: a new game
      } else {
        // player 2 without lives: the white marble stays dead; control goes back to player 1
        this.deadForever[i] = true;
        if (physics.current === i) this.swapMarble();
      }
    }
    if (how === 'sink') this.ui.sound('swamped');
    else if (shatter) this.ui.sound('shatter');
    else this.ui.sound('fall', FALL_SECONDS);
    this.ui.hud();
  }

  private handleObjectEvents(events: ObjectEvent[]): void {
    const physics = this.physics;
    const level = this.level;
    for (const e of events.splice(0)) {
      if (e.type === 'shatter') this.marbleDies(e.marble, true);
      else if (e.type === 'items') this.ui.items();
      else if (e.type === 'fall') {
        const m = physics.marbles[e.marble];
        if (m && m.active && m.jump <= 0) this.marbleDies(e.marble, false);
      }
      else if (e.type === 'turnstile') {
        // TurnstilePivot::handleActorsAndItems: marbles in the swept fields
        const TO_INDEX = [[0, 7, 6], [1, -1, 5], [2, 3, 4]];
        const TO_X = [-1, 0, 1, 1, 1, 0, -1, -1];
        const TO_Y = [-1, -1, -1, 0, 1, 1, 1, 0];
        const ROT = [
          [6, 0, 0, 2, 2, 4, 4, 6],
          [2, 2, 4, 4, 6, 6, 0, 0],
          [6, 6, 0, 0, 2, 2, 4, 4],
          [2, 4, 4, 6, 6, 0, 0, 2],
        ];
        const cx = e.col + 0.5;
        const cy = e.row + 0.5;
        physics.marbles.forEach((m, i) => {
          if (!m.active || this.falling[i] >= 0) return;
          const dx = Math.floor(m.pos.x) - e.col;
          const dy = Math.floor(m.pos.y) - e.row;
          if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || Math.hypot(m.pos.x - cx, m.pos.y - cy) > 1.58114 + m.radius) return;
          const src = TO_INDEX[dx + 1][dy + 1];
          if (src < 0) return;
          const dst = ROT[(e.cw ? 1 : 0) + (e.red ? 2 : 0)][src];
          let warp = false;
          if (e.red) {
            warp = i === e.sender;
            if (!warp && e.seen[src]) this.marbleDies(i, true); // hit by an arm
          } else warp = e.seen[src];
          if (!warp) return;
          const tc = e.col + TO_X[dst];
          const tr = e.row + TO_Y[dst];
          if (!cellAt(level, tc, tr)) {
            this.marbleDies(i, true);
            return;
          }
          let ox = m.pos.x - (Math.floor(m.pos.x) + 0.5);
          let oy = m.pos.y - (Math.floor(m.pos.y) + 0.5);
          const len = Math.hypot(ox, oy);
          const max = 0.5 - m.radius;
          if (len > max) {
            ox *= max / len;
            oy *= max / len;
          }
          physics.respawn(tc + 0.5 + (e.cw ? -oy : oy), tr + 0.5 + (e.cw ? ox : -ox), i);
        });
      } else if (e.type === 'pullWarp') {
        // PullStone::on_impulse: WarpActor into the old cell (clamped into it), without velocity
        physics.marbles.forEach((m, i) => {
          if (!m.active || Math.floor(m.pos.x) !== e.fromCol || Math.floor(m.pos.y) !== e.fromRow) return;
          const x = Math.min(e.toCol + 0.99, Math.max(e.toCol + 0.01, m.pos.x));
          const y = Math.min(e.toRow + 0.99, Math.max(e.toRow + 0.01, m.pos.y));
          physics.respawn(x, y, i);
        });
      } else if (e.type === 'scissors') {
        if (physics.cutRubbers(e.marble)) this.objects.scissorsCut(e.col, e.row);
      } else if (e.type === 'rubberband') {
        // RubberbandStone::actor_hit: unless already connected to this stone
        if (!physics.hasRubberTo(e.marble, e.col + 0.5, e.row + 0.5)) {
          if (e.scissor) physics.cutRubbers(e.marble);
          physics.addRubber(e.marble, e.col + 0.5, e.row + 0.5, { strength: e.strength, length: e.length, threshold: e.threshold, max: e.max });
        }
      } else if (e.type === 'charge') {
        const m = physics.marbles[e.marble];
        if (m) m.charge = e.charge;
      } else if (e.type === 'flash') {
        // FlashStone: FindOtherMarble – the marble of the other colour gets the force
        const m = physics.marbles[e.marble];
        const other = m ? physics.marbles.findIndex((o, k) => k !== e.marble && !o.pearl && o.color === 1 - m.color && o.active) : -1;
        if (other >= 0) physics.kick(other, e.fx, e.fy);
      } else if (e.type === 'swapPlayer') {
        this.swapMarble();
      } else if (e.type === 'laserhit') {
        // BasicBall "_laserhit": shatters (not while jumping, falling or in a vortex)
        const m = physics.marbles[e.marble];
        // the glass marble lets the laser through
        if (m && m.active && !m.glass && m.jump <= 0 && this.falling[e.marble] < 0) this.marbleDies(e.marble, true);
      }
      else if (e.type === 'text') this.ui.toast(e.text, Math.min(12000, 2500 + e.text.length * 60));
      else if (e.type === 'floor') this.ui.floorChanged();
      else if (e.type === 'jump') this.marbleJumps(e.marble); // Springboard: "_jump"
      else if (e.type === 'vortexGrab') {
        // BasicBall FALLING_VORTEX: grabbed, shown falling into the vortex
        this.inVortex[e.marble] = this.steps + 1;
        physics.setActive(false, e.marble);
        this.objects.marbleGone(e.marble);
      } else if (e.type === 'vortexWarp') {
        this.inVortex[e.marble] = 0;
        physics.respawn(e.x, e.y, e.marble);
        if (e.cut) physics.cutRubbers(e.marble);
        // BasicBall RISING_VORTEX → JUMP_VORTEX → JUMPING: out of a vortex it jumps (no re-grab)
        if (e.rise) physics.jump(e.marble);
      } else if (e.type === 'oxydMsg') {
        // StateObject::message → OxydStone::setState / message
        const s = level.signals.find((x) => x.col === e.col && x.row === e.row);
        if (!s) continue;
        const st = this.board.states[s.index];
        const open = e.msg === 'open' || e.msg === 'on' || (e.msg === 'signal' && e.value) || (e.msg === 'toggle' && st === 'closed');
        const close = e.msg === 'close' || e.msg === 'off' || (e.msg === 'signal' && !e.value) || (e.msg === 'toggle' && st === 'open');
        if (open) this.hitSignal(s.index);
        else if (close) this.handlePairEvents(this.board.close(s.index));
        else if (e.msg === 'closeall') this.handlePairEvents(this.board.closeAll());
        else if (e.msg === 'peepall') this.ui.peepAll(level.signals.filter((x) => x.symbol !== '-').map((x) => x.index));
        else if (e.msg === 'shuffle') {
          this.board.shuffle(this.rng);
          level.signals.forEach((x) => (x.symbol = this.board.symbolOf(x.index)));
        }
      } else if (e.type === 'oxyd') {
        // a boulder rolled against an Oxyd stone: it opens like on a marble hit
        const s = level.signals.find((x) => x.col === e.col && x.row === e.row);
        if (s) this.hitSignal(s.index);
      }
      else if (e.type === 'quake') {
        this.ui.sound('quake');
        this.handlePairEvents(this.board.closeAll());
      }
      else if (e.name === 'switch') this.ui.sound('switchOn');
      else if (e.name === 'triggerdown') this.ui.sound('triggerDown');
      else if (e.name === 'triggerup') this.ui.sound('triggerUp');
      else if (e.name === 'pickup') {
        this.ui.sound('pickup');
        this.ui.items();
      }
      else if (e.name === 'move') this.ui.sound('move');
      else if (e.name === 'explode') this.ui.sound('explode');
      else if (e.name === 'fakeoxyd') this.ui.sound('fakeOxyd');
      else if (e.name === 'landmine') this.ui.sound('landmine');
      else if (e.name === 'mirror') this.ui.sound('mirror');
      else if (e.name === 'laser') this.ui.sound('laser');
      else if (e.name === 'glass') this.ui.sound('shatter');
      else if (e.name === 'bomb') this.ui.sound('bomb');
    }
  }

  // ---------- player actions ----------

  /** Yin-yang (it_yinyang): steer the other marble. */
  swapMarble(): boolean {
    if (!this.playing || !this.physics.swap()) return false;
    this.objects.player = this.ownerOf(this.physics.current);
    this.ui.items();
    this.ui.sound('menu');
    this.ui.toast(this.physics.marbles[this.physics.current].color === 1 ? 'Weiße Murmel' : 'Schwarze Murmel', 900);
    return true;
  }

  /**
   * Actor::respawn: at the dropped flag of the marble's colour (centre of its cell, also for
   * the spoon's inplaceRespawn), else at the start.
   */
  respawnPos(i: number): { x: number; y: number } {
    const m = this.physics.marbles[i];
    return (!m.pearl && (m.color === 0 || m.color === 1) ? this.objects.flagRespawn[m.color] : undefined) ?? this.startPos[i];
  }

  /** player::ActivateFirstItem: use or drop the first item; false = no item (the yin-yang decides). */
  dropItem(): boolean {
    const ph = this.physics;
    const objects = this.objects;
    if (!this.playing || objects.inventory.length === 0) return false;
    const i = ph.current;
    const m = ph.marbles[i];
    if (!m.active || this.falling[i] >= 0) return true; // BasicBall::can_drop_items
    const first = objects.inventory[0];
    const items = () => this.ui.items();
    // it_yinyang: switch to the other marble, the item stays
    if (first === 'it_yinyang') {
      this.swapMarble();
      return true;
    }
    // Spring::activate: it_spring(_keep) makes the marble jump and stays; it_spring_drop is
    // dropped (only where no item lies) and makes it jump.
    if (first === 'it_spring' || first === 'it_spring_keep') {
      this.marbleJumps(i);
      return true;
    }
    if (first === 'it_spring_drop') {
      if (objects.canDropAt(m.pos.x, m.pos.y) && m.jump <= 0) {
        objects.dropItem(m.pos.x, m.pos.y);
        this.marbleJumps(i);
        items();
      }
      return true;
    }
    // Drop::activate: the marble becomes a rotor for 5 s (its rubber bands snap); the drop is used up
    if (first === 'it_drop') {
      if (!m.pearl) {
        ph.cutRubbers(i);
        this.rotorTime[i] = 5;
      }
      objects.useFirst();
      items();
      return true;
    }
    // RubberbandItem::activate: a band to anchor2 (an actor "a:n", a named object, "@@pattern" the nearest);
    // scissor cuts the others first. Without an anchor, or connected already, it is dropped.
    if (first.startsWith('it_rubberband')) {
      const a = objects.carriedAttrs(first);
      const num = (v: string | undefined) => (v === undefined || v === '' ? undefined : Number(v));
      const def = { strength: num(a.strength) ?? 10, length: num(a.length), threshold: num(a.threshold), min: num(a.min), max: num(a.max) };
      const scissor = a.scissor === 'true' || a.scissor === '1';
      let done = false;
      const am = /^a:(\d+)$/.exec(a.anchor2 ?? '');
      if (am) {
        const n = Number(am[1]);
        const j = n === 0 ? 0 : this.level.actors[n - 1]?.k === 'ac_marble_white' ? ph.marbles.findIndex((o, k) => k > 0 && !o.pearl && o.color === 1) : -1;
        if (j >= 0 && j !== i && !ph.rubbers.some((r) => (r.a1 === m && r.a2 === ph.marbles[j]) || (r.a2 === m && r.a1 === ph.marbles[j]))) {
          if (scissor) ph.cutRubbers(i);
          ph.addRubberBetween(i, j, def);
          done = true;
        }
      } else if (a.anchor2) {
        const t = objects.findAnchor(a.anchor2, m.pos.x, m.pos.y);
        if (t && !ph.hasRubberTo(i, t.x, t.y)) {
          if (scissor) ph.cutRubbers(i);
          ph.addRubber(i, t.x, t.y, def, () => objects.anchorAt(t.id));
          done = true;
        }
      }
      if (done) objects.useFirst();
      else if (objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
      items();
      return true;
    }
    // Pencil::activate: a cross under the marble (ITEM_KILL); flying it is dropped
    if (first === 'it_pencil') {
      if (m.jump > 0) objects.dropItem(m.pos.x, m.pos.y);
      else objects.pencilAt(m.pos.x, m.pos.y);
      items();
      return true;
    }
    // Weight::activate: ITEM_KEEP – it cannot be dropped
    if (first === 'it_weight') return true;
    // Bottle::activate: "_booze" – drunk for 5 s more, then the bottle is dropped (ITEM_DROP)
    if (first === 'it_bottle_idle' || first === 'it_bottle') {
      this.drunk[i] = (this.drunk[i] ?? 0) + 5;
      if (objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
      items();
      return true;
    }
    // Cherry::activate: "_invisibility" – 8 s more; the cherry is used up (ITEM_KILL)
    if (first === 'it_cherry') {
      objects.inventory.shift();
      items();
      this.invis[i] = (this.invis[i] ?? 0) + 8;
      return true;
    }
    // Brush::activate: "_brush" to the item here, then dropped (ITEM_DROP)
    if (first === 'it_brush') {
      objects.brushAt(m.pos.x, m.pos.y);
      if (objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
      items();
      return true;
    }
    // Spade::activate: "shovel" to the item here (ITEM_KEEP); without an item it is dropped
    if (first === 'it_spade') {
      if (!objects.spadeAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
      items();
      return true;
    }
    // Extinguisher::activate: foam around the marble (ITEM_KEEP); empty, it is dropped (ITEM_DROP)
    if (first.startsWith('it_extinguisher')) {
      if (!objects.useExtinguisher(m.pos.x, m.pos.y) && objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
      items();
      return true;
    }
    // Umbrella::activate: "_shield" for every marble of the owner, 10 s more each; the item is used up
    if (first === 'it_umbrella') {
      objects.inventory.shift();
      items();
      ph.marbles.forEach((_, j) => {
        if (this.ownerOf(j) === this.ownerOf(i)) this.shield[j] = (this.shield[j] ?? 0) + 10;
      });
      return true;
    }
    // Ring::activate: swap places with the other marble, else back to the start (RespawnActor);
    // Spoon::activate: "_suicide" (shatter, respawn in place). Both are then dropped (ITEM_DROP).
    if (first === 'it_ring' || first === 'it_spoon') {
      const { x, y } = m.pos;
      if (objects.canDropAt(x, y)) objects.dropItem(x, y);
      items();
      if (first === 'it_spoon') {
        if (m.jump <= 0) this.marbleDies(i, true);
      } else {
        const other = ph.marbles.findIndex((o, k) => k !== i && !o.pearl && o.color === 1 - m.color);
        if (other >= 0) {
          const p = { ...ph.marbles[other].pos };
          ph.marbles[other].pos.x = x;
          ph.marbles[other].pos.y = y;
          ph.marbles[other].prev.x = x;
          ph.marbles[other].prev.y = y;
          m.pos.x = m.prev.x = p.x;
          m.pos.y = m.prev.y = p.y;
          this.ui.sound('menu');
        } else {
          const at = this.respawnPos(i);
          ph.respawn(at.x, at.y, i);
        }
        objects.marbleGone(i);
      }
      return true;
    }
    objects.dropItem(m.pos.x, m.pos.y);
    items();
    return true;
  }

  /** BasicBall "_jump": JUMPING for the jump animation; triggers under it are released. */
  marbleJumps(i: number): void {
    if (!this.physics.jump(i)) return;
    this.ui.sound('jump');
    this.objects.marbleGone(i);
  }

  /** Right click / Tab: rotate the inventory (player::RotateInventory). */
  rotateItems(): boolean {
    if (!this.playing || this.objects.inventory.length < 2) return false;
    this.objects.rotateInventory();
    this.ui.sound('menu');
    this.ui.items();
    return true;
  }

  /** Left click / Space: use the first inventory item; without items the yin-yang swaps marbles. */
  useItem(): void {
    if (!this.dropItem()) this.swapMarble();
  }
}
