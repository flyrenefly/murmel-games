import './style.css';
import { Sfx } from './audio';
import { Input } from './input';
import { cellAt, isDeadly, parseLevel, type Level } from './game/level';
import { bagContents, isBag, ITEM_NAMES, ObjectWorld, type ObjectEvent } from './game/objects';
import { PairBoard, type PairEvent } from './game/pairs';
import { DEFAULT_MOUSE_SPEED, JUMP_SECONDS, PHYSICS_DT, PhysicsWorld, SINK_DEPTH, type Contact } from './game/physics';
import type { LevelFile } from './game/level';
import { applyWorld, makeLuaHost } from './game/luahost';
import { LEVELS } from './levels';
import type { LuaLevel } from './lua/runtime';
import { listPacks, packLevels, packTitle } from './packs';
import { type ActorSprite, CLASSIC_FALL_SECONDS, ClassicView } from './render/classic';
import { classicSet, STYLE_ORDER, type StyleId } from './render/styles';
import type { ThemeId } from './render/themes';
import { View } from './render/view';

const AXIS_FORCE = 10; // force at full key press / tilt (times floor adhesion)
const FALL_SECONDS = CLASSIC_FALL_SECONDS;

// ---------- persistence (tolerant: private mode may block storage) ----------
const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(`murmel.${key}`);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`murmel.${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

// ---------- DOM ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas3d = $<HTMLCanvasElement>('game');
const canvas2d = $<HTMLCanvasElement>('classic');
const hudTitle = $('hud-title');
const hudPairs = $('hud-pairs');
const hudFalls = $('hud-falls');
const btnTheme = $<HTMLButtonElement>('btn-theme');
const btnRestart = $<HTMLButtonElement>('btn-restart');
const btnLevels = $<HTMLButtonElement>('btn-levels');
const btnSwap = $<HTMLButtonElement>('btn-swap');
const btnDrop = $<HTMLButtonElement>('btn-drop');
const btnRotate = $<HTMLButtonElement>('btn-rotate');
const hudItems = $('hud-items');
const overlay = $('overlay');
const ovTitle = $('ov-title');
const ovText = $('ov-text');
const ovButtons = $('ov-buttons');
const levelList = $('level-list');
const toast = $('toast');

const sfx = new Sfx();
const view = new View(canvas3d);
const classic = new ClassicView(canvas2d);
const input = new Input(document.body, (locked) => {
  if (!locked && mode === 'play' && !input.tiltEnabled) showPause();
});

let style: StyleId = store.get<StyleId>('style', 'klassisch');
if (!STYLE_ORDER.includes(style)) style = 'klassisch';
let mouseSpeed = Math.min(15, Math.max(1, store.get('mouseSpeed', DEFAULT_MOUSE_SPEED)));
const solved = new Set<string>(store.get<string[]>('solved', []));

type Mode = 'menu' | 'play' | 'won';
let mode: Mode = 'menu';
let packId = store.get('pack', 'murmel');
let levelIndex = Math.max(0, store.get('level', 0));
let packList: LevelFile[] = LEVELS;
let packName = 'Murmel';
let level: Level;
let board: PairBoard;
let physics: PhysicsWorld | null = null;
/** Extra lives carried into the next level after a win (player::PrepareLevel keeps them). */
let carryLives: number | null = null;
/** After the death animation: restart the level, as a new game or keeping the lives. */
let pendingRestart: 'new' | 'keep' | null = null;
/** Enigma's life rule applies to imported Enigma levels; Murmel's own levels stay unlimited. */
const enigmaRules = (): boolean => level.id.startsWith('enigma:');
const livesLeft = (): number => objects.inventories[0].filter((k) => k === 'it_extralife').length;
/** BasicBall invisibility (it_cherry): seconds left per marble. */
let invis: number[] = [];
/** BasicBall drunk time (it_bottle): seconds left per marble. */
let drunk: number[] = [];
/** BasicBall shield (it_umbrella): seconds of protection left per marble. */
let shield: number[] = [];
/** Marbles a vortex has swallowed: since when (ms of play), -1 = not. */
let inVortex: number[] = [];
/** Marbles that stay dead (player 2 without lives, not essential). */
let deadForever: boolean[] = [];
/** Owner of a marble: the white marble belongs to player 2 (YANG), pearls to player 1. */
const ownerOf = (i: number): number => (physics?.marbles[i] && physics.marbles[i].color === 1 && !physics.marbles[i].pearl ? 1 : 0);
/** Lua callbacks of the current level (null = none). */
let lua: LuaLevel | null = null;
/** wo["GlobalForce"] of the current level. */
let globalForce = { x: 0, y: 0 };
let objects: ObjectWorld = new ObjectWorld([], 1);
let acc = 0;
let falls = 0;
/** Per marble: seconds into the fall animation, -1 = not falling. */
let falling: number[] = [-1];
/** Per marble: how it died (sinking leaves nothing to see). */
let deathKind: ('fall' | 'shatter' | 'sink')[] = [];
/** Per marble: where it respawns. */
let startPos: { x: number; y: number }[] = [];
let startTime = 0;
let playSeconds = 0;

const isClassic = () => classicSet(style) !== null;

function buildRenderer(): void {
  const set = classicSet(style);
  canvas2d.hidden = set === null;
  canvas3d.hidden = set !== null;
  document.body.dataset.style = style;
  if (set) {
    document.body.dataset.theme = 'klassisch';
    void classic.build(level, set, board.states, objects);
  } else view.build(level, style as ThemeId, board.states);
}

async function loadLevel(pack: string, i: number): Promise<void> {
  try {
    packList = await packLevels(pack);
    packName = await packTitle(pack);
  } catch {
    pack = 'murmel';
    packList = LEVELS;
    packName = 'Murmel';
  }
  i = Math.min(Math.max(0, i), packList.length - 1);
  packId = pack;
  levelIndex = i;
  store.set('pack', pack);
  store.set('level', i);
  level = parseLevel(packList[i]);
  board = new PairBoard(level.signals.map((s) => s.symbol));
  physics?.dispose();
  const lv = level;
  objects = new ObjectWorld(lv.objects, lv.width, lv.texts, {
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
    setStaticStone: (c, r, kind) => {
      const cell = cellAt(lv, c, r);
      if (!cell) return;
      cell.stone = kind;
      physics?.setSolid(c, r, kind !== null);
      classic.floorChanged();
    },
  }, Math.random, lv.compat);
  if (lv.world.FallenPuzzle) objects.fallenPuzzle = lv.world.FallenPuzzle;
  physics = new PhysicsWorld(level, objects);
  // wo["GlobalForce"] (server::ConstantForce) acts on every actor, like the item forces.
  const force = (globalForce = { x: 0, y: 0 });
  const world = { ...lv.world };
  applyWorld(physics, world, force);
  physics.setForceField((x, y, flying) => {
    const [fx, fy] = objects.fieldForce(x, y, flying);
    return [fx + force.x, fy + force.y];
  });
  // player::NewGame: two extra lives (ProvideExtralifes), kept from the last level after a win;
  // with two marbles the yin-yang is an inventory item in front (player::AddYinYang).
  pendingRestart = null;
  // Each player has an inventory (player.cc); player 2 owns the white marble.
  objects.ownerOf = ownerOf;
  objects.isPearl = (i) => physics?.marbles[i]?.pearl === true;
  if (enigmaRules()) {
    const lives = carryLives ?? (lv.world.ProvideExtralifes === 'false' ? 0 : 2);
    for (let k = 0; k < lives; k++) objects.inventories[0].push('it_extralife');
    if (physics.marbles.some((_, k) => ownerOf(k) === 1)) {
      for (let k = 0; k < (lv.world.ProvideExtralifes === 'false' ? 0 : 2); k++) objects.inventories[1].push('it_extralife');
    }
  }
  carryLives = null;
  deadForever = physics.marbles.map(() => false);
  inVortex = physics.marbles.map(() => 0);
  shield = physics.marbles.map(() => 0);
  invis = physics.marbles.map(() => 0);
  drunk = physics.marbles.map(() => 0);
  if (physics.steerable > 1) for (const inv of objects.inventories) inv.unshift('it_yinyang');
  lua = null;
  if (lv.lua) {
    const ph = physics;
    const ow = objects;
    const { startLua } = await import('./lua');
    const host = makeLuaHost({ level: lv, objects: ow, physics: ph, redraw: () => classic.floorChanged(), random: Math.random }, world, force);
    const l = await startLua(lv.lua.code, host);
    if (level !== lv) return; // another level was loaded meanwhile
    lua = l;
    ow.onCallback = (fn, value, sender) => l.callback(fn, value, `o:${sender.id}`);
  }
  updateItems();
  acc = 0;
  falls = 0;
  falling = physics.marbles.map(() => -1);
  deathKind = physics.marbles.map(() => 'fall' as const);
  startPos = physics.marbles.map((m) => ({ ...m.pos }));
  btnSwap.hidden = physics.steerable < 2;
  startTime = 0;
  playSeconds = 0;
  buildRenderer();
  updateHud();
}

function styleLabel(): string {
  return isClassic() ? classic.label : view.themeLabel;
}

function updateHud(): void {
  hudTitle.textContent = `${levelIndex + 1}. ${level.title}`;
  hudPairs.textContent = pairsText();
  hudFalls.textContent = falls ? `Abstürze ${falls}` : '';
  btnTheme.textContent = `Stil: ${styleLabel()}`;
}

function cycleStyle(): void {
  style = STYLE_ORDER[(STYLE_ORDER.indexOf(style) + 1) % STYLE_ORDER.length];
  store.set('style', style);
  buildRenderer();
  updateHud();
}

let toastTimer = 0;
function showToast(text: string, ms = 1400): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), ms);
}

function changeMouseSpeed(delta: number): void {
  mouseSpeed = Math.min(15, Math.max(1, mouseSpeed + delta));
  store.set('mouseSpeed', mouseSpeed);
  showToast(`Mausgeschwindigkeit ${mouseSpeed}`);
}

// ---------- overlay ----------
function showOverlay(title: string, text: string, buttons: [string, () => void][]): void {
  ovTitle.textContent = title;
  ovText.innerHTML = text;
  ovButtons.replaceChildren(
    ...buttons.map(([label, fn], i) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (i === 0) b.className = 'primary';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        sfx.unlock();
        sfx.menu();
        fn();
      });
      return b;
    }),
  );
  levelList.hidden = true;
  overlay.hidden = false;
}

const isTouch = matchMedia('(pointer: coarse)').matches;

function startPlaying(): void {
  sfx.unlock();
  overlay.hidden = true;
  mode = 'play';
  if (startTime === 0) startTime = performance.now();
  input.requestLock();
}

async function startTouch(): Promise<void> {
  sfx.unlock();
  if (!input.tiltEnabled && !(await input.enableTilt())) {
    showOverlay('Neigen nicht möglich', 'Dieses Gerät oder dieser Browser liefert keine Lagedaten.', [['OK', showStart]]);
    return;
  }
  startPlaying();
}

const twoMarbles = () => (physics?.steerable ?? 1) > 1;

function controlsHelp(): string {
  return isTouch
    ? `Neige dein Gerät, um die Murmel zu rollen.<br>Öffne die Oxyd-Steine paarweise.${twoMarbles() ? '<br>Zwei Murmeln: „Murmel wechseln“ steuert die andere.' : ''}${hasSeeds() ? '<br>Samen einsammeln, mit „Ablegen“ wächst daraus eine Holzkiste.' : ''}${hasWand() ? '<br>Zauberstab einsammeln: Ist er vorn im Inventar („Drehen“), dreht ein Stoß Felsbrocken und Einbahnsteine um.' : ''}${hasSpring() ? '<br>Feder einsammeln: „Ablegen“ lässt die Murmel springen – über Abgründe und Wasser.' : ''}`
    : `Bewege die Maus, um die Murmel zu beschleunigen (oder Pfeiltasten).<br>Öffne die Oxyd-Steine paarweise.${twoMarbles() ? '<br>Zwei Murmeln: Klick oder Leertaste wechselt zwischen schwarzer und weißer Murmel.' : ''}${hasSeeds() ? '<br>Samen einsammeln, Klick oder Leertaste legt ihn ab – daraus wächst eine Holzkiste.' : ''}${hasWand() ? '<br>Zauberstab einsammeln: Ist er vorn im Inventar (Rechtsklick oder Tab dreht es), dreht ein Stoß Felsbrocken und Einbahnsteine um.' : ''}${hasSpring() ? '<br>Feder einsammeln: Klick oder Leertaste lässt die Murmel springen – über Abgründe und Wasser.' : ''}<br><span class="keys">Esc/P Pause · T Stil · R Neustart · +/− Mausgeschwindigkeit</span>`;
}

function showStart(): void {
  mode = 'menu';
  const credit = `<span class="credit">${escapeHtml(packName)} · Level ${levelIndex + 1} von ${packList.length}${level.author ? ` · von ${escapeHtml(level.author)}` : ''}</span><br>`;
  showOverlay(`${levelIndex + 1}. ${level.title}`, credit + controlsHelp(), [
    [isTouch ? 'Los (Neigen)' : 'Spielen', () => (isTouch ? void startTouch() : startPlaying())],
    ['Levels', showLevels],
  ]);
}

function showPause(): void {
  mode = 'menu';
  showOverlay('Pause', controlsHelp(), [
    ['Weiterspielen', startPlaying],
    ['Neustart', restart],
    ['Levels', showLevels],
  ]);
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function listButton(html: string, current: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'level' + (current ? ' current' : '');
  b.innerHTML = html;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    sfx.menu();
    onClick();
  });
  return b;
}

/** First level: the packs (own levels + imported Enigma packs). */
async function showLevels(): Promise<void> {
  mode = 'menu';
  input.releaseLock();
  showOverlay('Levelpakete', '', [['Zurück', showStart]]);
  const packs = await listPacks();
  levelList.replaceChildren(
    ...packs.map((p) => {
      const done = solvedCount(p.id);
      const info = p.source === 'enigma' ? `aus Enigma · ${p.count}${p.of && p.of > p.count ? ` von ${p.of}` : ''} Levels` : `${p.count} Levels`;
      return listButton(
        `<span>${done ? '✓' : '›'}</span><b>${escapeHtml(p.title)}</b><small>${info}${done ? ` · ${done} gelöst` : ''}</small>`,
        p.id === packId,
        () => void showPack(p.id),
      );
    }),
  );
  levelList.hidden = false;
  (levelList.querySelector('.current') as HTMLElement | null)?.scrollIntoView({ block: 'center' });
}

const solvedInPack = new Map<string, Set<string>>();
function solvedCount(pack: string): number {
  return solvedInPack.get(pack)?.size ?? 0;
}

/** Second level: the levels of one pack. */
async function showPack(id: string): Promise<void> {
  const levels = await packLevels(id).catch(() => null);
  if (!levels) return;
  showOverlay(await packTitle(id), '', [['Zurück', () => void showLevels()]]);
  levelList.replaceChildren(
    ...levels.map((l, i) =>
      listButton(
        `<span>${i + 1}</span>${escapeHtml(l.title)}${solved.has(l.id) ? ' <em>✓</em>' : ''}`,
        id === packId && i === levelIndex,
        async () => {
          await loadLevel(id, i);
          showStart();
        },
      ),
    ),
  );
  levelList.hidden = false;
  (levelList.querySelector('.current') as HTMLElement | null)?.scrollIntoView({ block: 'center' });
}

async function restart(): Promise<void> {
  await loadLevel(packId, levelIndex);
  startPlaying();
}

function formatTime(secs: number): string {
  const s = Math.floor(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Status: Oxyd pairs, or for meditation levels without Oxyd stones the engaged hollows. */
function pairsText(): string {
  if (board.totalPairs > 0) return `Paare ${board.solvedPairs}/${board.totalPairs}`;
  const pearls = physics?.marbles.filter((m) => m.pearl).length ?? 0;
  return `Perlen ${objects.meditationCount().engaged}/${pearls}`;
}

function onWin(): void {
  mode = 'won';
  solved.add(level.id);
  store.set('solved', [...solved]);
  noteSolved(packId, level.id);
  sfx.win();
  input.releaseLock();
  const last = levelIndex === packList.length - 1;
  setTimeout(() => {
    showOverlay(
      'Geschafft!',
      `Zeit ${formatTime(playSeconds)} · Abstürze ${falls}${last ? `<br>Das war das letzte Level in „${escapeHtml(packName)}“.` : ''}`,
      last
        ? [['Levels', showLevels], ['Nochmal', restart]]
        : [
            ['Nächstes Level', async () => { carryLives = enigmaRules() ? livesLeft() : null; await loadLevel(packId, levelIndex + 1); startPlaying(); }],
            ['Nochmal', restart],
          ],
    );
  }, 900);
}

// ---------- game events ----------
function setStone(index: number): void {
  view.setStoneState(index, board.states[index]);
  classic.setStoneState(index, board.states[index]);
}

function handlePairEvents(events: PairEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'opened':
        setStone(ev.index);
        sfx.open();
        break;
      case 'solved':
        setStone(ev.a);
        setStone(ev.b);
        sfx.solved();
        break;
      case 'closed':
        for (const i of ev.indices) setStone(i);
        sfx.close();
        break;
      case 'complete':
        onWin();
        break;
    }
  }
  updateHud();
}

function onContact(c: Contact): void {
  if (c.kind === 'actor') {
    // Rotor::on_collision, Top::on_collision, Killer::on_collision: the marble shatters.
    marbleDies(c.marble, true);
    return;
  }
  if (c.kind === 'sunk') {
    marbleDies(c.marble, 'sink');
    return;
  }
  if (c.kind === 'object') {
    if (c.by >= 0) objects.touch(c.col, c.row, c.by); // other actors only hit
    if (c.by >= 0 && c.vn < 0 && physics) {
      // ActorImpulseStone::actor_hit: away from the bumper's centre
      const m = physics.marbles[c.by];
      const f = objects.bump(c.col, c.row, m.pos.x, m.pos.y);
      if (f) physics.kick(c.by, f[0], f[1]);
    }
    if (!c.hit) return;
    // Switches sound metallic (Switch::collision_sound), doors like stone.
    if (objects.objects.some((o) => (o.cls === 'switch' || o.cls === 'laserswitch' || o.cls === 'coinslot' || o.cls === 'keyswitch') && o.col === c.col && o.row === c.row)) sfx.metal(c.speed);
    else sfx.stone(c.speed);
    objects.hit(c.col, c.row, c.color, c.nx, c.ny, c.vn, c.vx, c.vy, c.by);
    return;
  }
  sfx.stone(c.speed); // Enigma: every stone hit makes the stone sound
  if (c.kind === 'signal') handlePairEvents(board.hit(c.index));
}

/** Marble i dies: fall animation, then respawn at its start. */
function marbleDies(i: number, how: boolean | 'sink'): void {
  if (!physics || !(falling[i] < 0)) return;
  if ((shield[i] ?? 0) > 0) return; // BasicBall::change_state_noshield
  const shatter = how === true;
  invis[i] = 0; // BasicBall: dead marbles are visible again
  drunk[i] = 0;
  deathKind[i] = how === 'sink' ? 'sink' : shatter ? 'shatter' : 'fall';
  falling[i] = 0;
  physics.setActive(false, i);
  objects.marbleGone(i);
  falls++;
  // player::CheckDeadActors / resurrect_actor: every death costs an extra life.
  if (enigmaRules() && level.world.InfiniteReincarnation !== 'true') {
    const m = physics.marbles[i];
    const owner = ownerOf(i);
    const inv = objects.inventories[owner];
    const idx = inv.indexOf('it_extralife');
    if (idx >= 0) inv.splice(idx, 1);
    updateItems();
    if (idx >= 0) {
      // ConserveLevel false: the level restarts (costing the life)
      if (level.world.ConserveLevel === 'false') pendingRestart = 'keep';
    } else if (owner === 0 || m.essential) {
      pendingRestart = 'new'; // out of lives: a new game
    } else {
      // player 2 without lives: the white marble stays dead; control goes back to player 1
      deadForever[i] = true;
      if (physics.current === i) swapMarble();
    }
  }
  if (how === 'sink') sfx.swamped();
  else if (shatter) sfx.shatter();
  else sfx.fall(FALL_SECONDS);
  updateHud();
}

function handleObjectEvents(events: ObjectEvent[]): void {
  for (const e of events.splice(0)) {
    if (e.type === 'shatter') marbleDies(e.marble, true);
    else if (e.type === 'items') updateItems();
    else if (e.type === 'fall') {
      const m = physics?.marbles[e.marble];
      if (m && m.active && m.jump <= 0) marbleDies(e.marble, false);
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
      physics?.marbles.forEach((m, i) => {
        if (!m.active || falling[i] >= 0) return;
        const dx = Math.floor(m.pos.x) - e.col;
        const dy = Math.floor(m.pos.y) - e.row;
        if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || Math.hypot(m.pos.x - cx, m.pos.y - cy) > 1.58114 + m.radius) return;
        const src = TO_INDEX[dx + 1][dy + 1];
        if (src < 0) return;
        const dst = ROT[(e.cw ? 1 : 0) + (e.red ? 2 : 0)][src];
        let warp = false;
        if (e.red) {
          warp = i === e.sender;
          if (!warp && e.seen[src]) marbleDies(i, true); // hit by an arm
        } else warp = e.seen[src];
        if (!warp) return;
        const tc = e.col + TO_X[dst];
        const tr = e.row + TO_Y[dst];
        if (!cellAt(level, tc, tr)) {
          marbleDies(i, true);
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
        physics!.respawn(tc + 0.5 + (e.cw ? -oy : oy), tr + 0.5 + (e.cw ? ox : -ox), i);
      });
    } else if (e.type === 'pullWarp') {
      // PullStone::on_impulse: WarpActor into the old cell (clamped into it), without velocity
      physics?.marbles.forEach((m, i) => {
        if (!m.active || Math.floor(m.pos.x) !== e.fromCol || Math.floor(m.pos.y) !== e.fromRow) return;
        const x = Math.min(e.toCol + 0.99, Math.max(e.toCol + 0.01, m.pos.x));
        const y = Math.min(e.toRow + 0.99, Math.max(e.toRow + 0.01, m.pos.y));
        physics!.respawn(x, y, i);
      });
    } else if (e.type === 'scissors') {
      if (physics?.cutRubbers(e.marble)) objects.scissorsCut(e.col, e.row);
    } else if (e.type === 'rubberband') {
      // RubberbandStone::actor_hit: unless already connected to this stone
      const ph = physics;
      if (ph && !ph.hasRubberTo(e.marble, e.col + 0.5, e.row + 0.5)) {
        if (e.scissor) ph.cutRubbers(e.marble);
        ph.addRubber(e.marble, e.col + 0.5, e.row + 0.5, { strength: e.strength, length: e.length, threshold: e.threshold, max: e.max });
      }
    } else if (e.type === 'charge') {
      const m = physics?.marbles[e.marble];
      if (m) m.charge = e.charge;
    } else if (e.type === 'flash') {
      // FlashStone: FindOtherMarble – the marble of the other colour gets the force
      const ph = physics;
      const m = ph?.marbles[e.marble];
      const other = m ? ph!.marbles.findIndex((o, k) => k !== e.marble && !o.pearl && o.color === 1 - m.color && o.active) : -1;
      if (other >= 0) ph!.kick(other, e.fx, e.fy);
    } else if (e.type === 'laserhit') {
      // BasicBall "_laserhit": shatters (not while jumping, falling or in a vortex)
      const m = physics?.marbles[e.marble];
      if (m && m.active && m.jump <= 0 && falling[e.marble] < 0) marbleDies(e.marble, true);
    }
    else if (e.type === 'text') showToast(e.text, Math.min(12000, 2500 + e.text.length * 60));
    else if (e.type === 'floor') classic.floorChanged();
    else if (e.type === 'jump') marbleJumps(e.marble); // Springboard: "_jump"
    else if (e.type === 'vortexGrab') {
      // BasicBall FALLING_VORTEX: grabbed, shown falling into the vortex
      inVortex[e.marble] = performance.now();
      physics?.setActive(false, e.marble);
      objects.marbleGone(e.marble);
    } else if (e.type === 'vortexWarp') {
      inVortex[e.marble] = 0;
      physics?.respawn(e.x, e.y, e.marble);
      if (e.cut) physics?.cutRubbers(e.marble);
      // BasicBall RISING_VORTEX → JUMP_VORTEX → JUMPING: out of a vortex it jumps (no re-grab)
      if (e.rise) physics?.jump(e.marble);
    } else if (e.type === 'oxydMsg') {
      // StateObject::message → OxydStone::setState / message
      const s = level.signals.find((x) => x.col === e.col && x.row === e.row);
      if (!s) continue;
      const st = board.states[s.index];
      const open = e.msg === 'open' || e.msg === 'on' || (e.msg === 'signal' && e.value) || (e.msg === 'toggle' && st === 'closed');
      const close = e.msg === 'close' || e.msg === 'off' || (e.msg === 'signal' && !e.value) || (e.msg === 'toggle' && st === 'open');
      if (open) handlePairEvents(board.hit(s.index));
      else if (close) handlePairEvents(board.close(s.index));
      else if (e.msg === 'closeall') handlePairEvents(board.closeAll());
      else if (e.msg === 'shuffle') {
        board.shuffle();
        level.signals.forEach((x) => (x.symbol = board.symbolOf(x.index)));
      }
    } else if (e.type === 'oxyd') {
      // a boulder rolled against an Oxyd stone: it opens like on a marble hit
      const s = level.signals.find((x) => x.col === e.col && x.row === e.row);
      if (s) handlePairEvents(board.hit(s.index));
    }
    else if (e.type === 'quake') {
      sfx.quake();
      handlePairEvents(board.closeAll());
    }
    else if (e.name === 'switch') sfx.switchOn();
    else if (e.name === 'triggerdown') sfx.trigger(true);
    else if (e.name === 'triggerup') sfx.trigger(false);
    else if (e.name === 'pickup') {
      sfx.pickup();
      updateItems();
    }
    else if (e.name === 'move') sfx.move();
    else if (e.name === 'explode') sfx.explode();
    else if (e.name === 'fakeoxyd') sfx.fakeOxyd();
    else if (e.name === 'landmine') sfx.landmine();
    else if (e.name === 'mirror') sfx.mirror();
    else if (e.name === 'laser') sfx.laser();
    else if (e.name === 'glass') sfx.shatter();
    else if (e.name === 'bomb') sfx.bomb();
  }
}

// ---------- main loop ----------
let last = performance.now();
let slowFrames = 0;
let fastFrames = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // CSS hides the mouse pointer over the playing field while playing.
  if (document.body.dataset.mode !== mode) document.body.dataset.mode = mode;

  if (physics && mode !== 'menu') {
    const [mdx, mdy] = mode === 'play' ? input.takeMouse() : [0, 0];
    if (mode === 'play') {
      playSeconds += dt;
      shield = shield.map((s) => Math.max(0, s - dt));
      invis = invis.map((s) => Math.max(0, s - dt));
      drunk = drunk.map((s) => Math.max(0, s - dt));
      physics?.marbles.forEach((m, i) => {
        m.shielded = (shield[i] ?? 0) > 0;
        m.invisible = (invis[i] ?? 0) > 0;
        m.drunk = (drunk[i] ?? 0) > 0;
        m.spikes = (objects.inventories[ownerOf(i)] ?? objects.inventory).includes('it_pin'); // Actor "_update_pin"
      });
    }
    if (falling[physics.current] < 0 && mode === 'play') {
      physics.addMouseForce(mdx * mouseSpeed, mdy * mouseSpeed);
      const [ax, ay] = input.axis();
      physics.setAxisForce(ax * AXIS_FORCE, ay * AXIS_FORCE);
    } else physics.setAxisForce(0, 0);
    acc += dt;
    const ph = physics;
    while (acc >= PHYSICS_DT) {
      ph.step(onContact);
      ph.marbles.forEach((m, i) => {
        if (falling[i] >= 0) return;
        const to = objects.warpTarget(m.pos.x, m.pos.y);
        // WarpActor without keeping the velocity.
        if (to) {
          ph.respawn(to.x, to.y, i);
          if (to.cut) ph.cutRubbers(i);
        }
        if (inVortex[i]) return; // swallowed: nothing else happens to it
        // A jumping marble touches no items and presses no triggers (is_flying).
        if (m.jump > 0) return;
        objects.marbleAt(Math.floor(m.pos.x), Math.floor(m.pos.y), i);
        objects.actorStep(m.pos.x, m.pos.y, i, m.radius);
      });
      for (const e of ph.enemies) objects.actorStep(e.pos.x, e.pos.y, -1);
      objects.update(PHYSICS_DT * 1000);
      handleObjectEvents(objects.events);
      // ChangeMeditation → server::FinishLevel: all pearls rest in hollows
      if (mode === 'play' && objects.meditationDone(ph.marbles.filter((m) => m.pearl).length)) onWin();
      ph.marbles.forEach((m, i) => {
        const under = cellAt(level, Math.floor(m.pos.x), Math.floor(m.pos.y));
        if (falling[i] < 0 && m.jump <= 0 && !inVortex[i] && under && isDeadly(under.floor) && !objects.coversFloor(m.pos.x, m.pos.y, Math.hypot(m.vel.x, m.vel.y))) marbleDies(i, false);
      });
      acc -= PHYSICS_DT;
    }
  } else {
    input.takeMouse();
  }

  const fallen = falling.map((f, i) => {
    if (f < 0 || !physics) return -1;
    falling[i] = f + dt;
    if (falling[i] < FALL_SECONDS + 0.25) return Math.min(falling[i] / FALL_SECONDS, 1);
    // a marble without lives that is not essential stays fallen: still 'falling', never drawn
    if (deadForever[i]) return 1;
    falling[i] = -1;
    if (pendingRestart) {
      const how = pendingRestart;
      pendingRestart = null;
      if (how === 'keep') carryLives = livesLeft();
      else showToast('Keine Extraleben mehr – das Level beginnt neu.', 2500);
      void (async () => {
        await loadLevel(packId, levelIndex);
        startPlaying();
      })();
      return -1;
    }
    const at = respawnPos(i);
    physics.respawn(at.x, at.y, i);
    return -1;
  });

  // Interpolate between the last two physics states: smooth on any refresh rate.
  const a = acc / PHYSICS_DT;
  const ci = physics?.current ?? 0;
  const marbles = (physics?.marbles ?? []).map((m, i) => ({
    kind: 'marble' as const,
    color: m.color,
    // Sunk: invisible until the respawn (ac_marble-sunk).
    fall: inVortex[i] ? Math.min(1, (performance.now() - inVortex[i]) / 400) : deathKind[i] === 'sink' && falling[i] >= 0 ? -1 : (fallen[i] ?? -1),
    sink: deathKind[i] === 'sink' && falling[i] >= 0 ? SINK_DEPTH : m.sink,
    jump: m.jump > 0 ? 1 - m.jump / JUMP_SECONDS : -1,
    pearl: m.pearl,
    x: m.prev.x + (m.pos.x - m.prev.x) * a,
    y: m.prev.y + (m.pos.y - m.prev.y) * a,
  }));
  const me = marbles[ci] ?? { kind: 'marble' as const, color: 0, fall: -1, sink: 0, jump: -1, x: 0, y: 0 };
  const { x, y } = me;
  const fall = me.fall;
  const actors: ActorSprite[] = (physics?.enemies ?? []).map((e) => ({
    kind: e.kind,
    color: e.color,
    x: e.prev.x + (e.pos.x - e.prev.x) * a,
    y: e.prev.y + (e.pos.y - e.prev.y) * a,
  }));
  actors.push(...marbles.filter((_, i) => i !== ci && !deadForever[i] && !((invis[i] ?? 0) > 0)));
  // Rubber bands: flat list x1, y1, x2, y2 (interpolated like the actors).
  const lerp = (b: { pos: { x: number; y: number }; prev: { x: number; y: number } }) => [b.prev.x + (b.pos.x - b.prev.x) * a, b.prev.y + (b.pos.y - b.prev.y) * a];
  const bands: number[] = [];
  for (const r of physics?.rubbers ?? []) bands.push(...lerp(r.a1), ...(r.a2 ? lerp(r.a2) : [r.end.x, r.end.y]));
  if (isClassic()) {
    classic.status.left = formatTime(playSeconds);
    classic.status.right = `${pairsText()}${falls ? ` · Abstürze ${falls}` : ''}`;
    classic.updateMarble(x, y, fall, me.color, me.sink, me.jump, 'pearl' in me && me.pearl);
    classic.updateActors(actors);
    classic.hideMarble = (invis[ci] ?? 0) > 0; // BasicBall::update_model hides an invisible marble
    classic.setGlasses(objects.glassesBits());
    classic.updateRubbers(bands);
    classic.updateHalos(marbles.flatMap((m, i) => ((shield[i] ?? 0) > 0 && !deadForever[i] ? [{ x: m.x, y: m.y, rest: shield[i], small: !!m.pearl }] : [])));
    classic.render(dt);
  } else {
    const v = physics?.velocity ?? { x: 0, y: 0 };
    // 3D: sinking looks like a slow fall.
    const f3 = fall >= 0 ? fall : me.sink > 0 ? Math.min(1, me.sink / SINK_DEPTH) : -1;
    view.updateMarble(x, y, f3 >= 0 ? 0 : v.x, f3 >= 0 ? 0 : v.y, dt, f3);
    view.updateActors(actors);
    view.updateRubbers(bands);
    view.render(dt);
    // Adaptive resolution: drop pixel ratio when frames are slow, raise it again when fast.
    if (dt > 1 / 45) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (dt < 1 / 70) fastFrames++;
    else fastFrames = 0;
    const pr = view.currentPixelRatio;
    if (slowFrames > 90 && pr > 0.75) {
      view.setPixelRatio(Math.max(0.75, pr - 0.25));
      slowFrames = 0;
    } else if (fastFrames > 600 && pr < Math.min(window.devicePixelRatio || 1, 2)) {
      view.setPixelRatio(pr + 0.25);
      fastFrames = 0;
    }
  }

  requestAnimationFrame(frame);
}

// ---------- wiring ----------
btnTheme.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleStyle();
});
btnRestart.addEventListener('click', (e) => {
  e.stopPropagation();
  restart();
});
/** Yin-yang (it_yinyang): steer the other marble. */
function swapMarble(): void {
  if (mode !== 'play' || !physics?.swap()) return;
  objects.player = ownerOf(physics.current);
  updateItems();
  sfx.menu();
  showToast(physics.marbles[physics.current].color === 1 ? 'Weiße Murmel' : 'Schwarze Murmel', 900);
}
btnSwap.addEventListener('click', (e) => {
  e.stopPropagation();
  swapMarble();
});
/**
 * Actor::respawn: at the dropped flag of the marble's colour (centre of its cell, also for
 * the spoon's inplaceRespawn), else at the start.
 */
function respawnPos(i: number): { x: number; y: number } {
  const m = physics!.marbles[i];
  return (!m.pearl && (m.color === 0 || m.color === 1) ? objects.flagRespawn[m.color] : undefined) ?? startPos[i];
}
/** player::ActivateFirstItem: drop the first item (a seed) where the current marble is. */
function dropItem(): boolean {
  const ph = physics;
  if (mode !== 'play' || !ph || objects.inventory.length === 0) return false;
  const i = ph.current;
  const m = ph.marbles[i];
  if (!m.active || falling[i] >= 0) return true; // BasicBall::can_drop_items
  const first = objects.inventory[0];
  // it_yinyang: switch to the other marble, the item stays
  if (first === 'it_yinyang') {
    swapMarble();
    return true;
  }
  // Spring::activate: it_spring(_keep) makes the marble jump and stays; it_spring_drop is
  // dropped (only where no item lies) and makes it jump.
  if (first === 'it_spring' || first === 'it_spring_keep') {
    marbleJumps(i);
    return true;
  }
  if (first === 'it_spring_drop') {
    if (objects.canDropAt(m.pos.x, m.pos.y) && m.jump <= 0) {
      objects.dropItem(m.pos.x, m.pos.y);
      marbleJumps(i);
      updateItems();
    }
    return true;
  }
  // Bottle::activate: "_booze" – drunk for 5 s more, then the bottle is dropped (ITEM_DROP)
  if (first === 'it_bottle_idle' || first === 'it_bottle') {
    drunk[i] = (drunk[i] ?? 0) + 5;
    if (objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
    updateItems();
    return true;
  }
  // Cherry::activate: "_invisibility" – 8 s more; the cherry is used up (ITEM_KILL)
  if (first === 'it_cherry') {
    objects.inventory.shift();
    updateItems();
    invis[i] = (invis[i] ?? 0) + 8;
    return true;
  }
  // Brush::activate: "_brush" to the item here, then dropped (ITEM_DROP)
  if (first === 'it_brush') {
    objects.brushAt(m.pos.x, m.pos.y);
    if (objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
    updateItems();
    return true;
  }
  // Spade::activate: "shovel" to the item here (ITEM_KEEP); without an item it is dropped
  if (first === 'it_spade') {
    if (!objects.spadeAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
    updateItems();
    return true;
  }
  // Extinguisher::activate: foam around the marble (ITEM_KEEP); empty, it is dropped (ITEM_DROP)
  if (first.startsWith('it_extinguisher')) {
    if (!objects.useExtinguisher(m.pos.x, m.pos.y) && objects.canDropAt(m.pos.x, m.pos.y)) objects.dropItem(m.pos.x, m.pos.y);
    updateItems();
    return true;
  }
  // Umbrella::activate: "_shield" for every marble of the owner, 10 s more each; the item is used up
  if (first === 'it_umbrella') {
    objects.inventory.shift();
    updateItems();
    ph.marbles.forEach((_, j) => {
      if (ownerOf(j) === ownerOf(i)) shield[j] = (shield[j] ?? 0) + 10;
    });
    return true;
  }
  // Ring::activate: swap places with the other marble, else back to the start (RespawnActor);
  // Spoon::activate: "_suicide" (shatter, respawn in place). Both are then dropped (ITEM_DROP).
  if (first === 'it_ring' || first === 'it_spoon') {
    const { x, y } = m.pos;
    if (objects.canDropAt(x, y)) objects.dropItem(x, y);
    updateItems();
    if (first === 'it_spoon') {
      if (m.jump <= 0) marbleDies(i, true);
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
        sfx.menu();
      } else {
        const at = respawnPos(i);
        ph.respawn(at.x, at.y, i);
      }
      objects.marbleGone(i);
    }
    return true;
  }
  objects.dropItem(m.pos.x, m.pos.y);
  updateItems();
  return true;
}
/** BasicBall "_jump": JUMPING for the jump animation; triggers under it are released. */
function marbleJumps(i: number): void {
  if (!physics?.jump(i)) return;
  sfx.jump();
  objects.marbleGone(i);
}
/** The level has a spring to pick up. */
function hasSpring(): boolean {
  return objects.objects.some((o) => o.cls === 'spring');
}
/** The level has a magic wand to pick up. */
function hasWand(): boolean {
  return objects.objects.some((o) => o.cls === 'wand');
}
/** The level has seeds to pick up. */
function hasSeeds(): boolean {
  return objects.objects.some((o) => o.cls === 'seed');
}
/** Inventory display: the first item is the one in hand (Enigma's inventory, left to right). */
function updateItems(): void {
  const inv = objects.inventory;
  const n = inv.length;
  hudItems.hidden = n === 0;
  btnDrop.hidden = n === 0;
  btnRotate.hidden = n < 2;
  const names = inv.map((k) => (isBag(k) ? `Sack (${bagContents(k).length})` : (ITEM_NAMES[k] ?? k)));
  const rest = new Map<string, number>();
  for (const s of names.slice(1)) rest.set(s, (rest.get(s) ?? 0) + 1);
  hudItems.textContent = n ? [`Hand: ${names[0]}`, ...[...rest].map(([s, c]) => (c > 1 ? `${s} ${c}` : s))].join(' · ') : '';
}
/** Right click / Tab: rotate the inventory (player::RotateInventory). */
function rotateItems(): void {
  if (mode !== 'play' || objects.inventory.length < 2) return;
  objects.rotateInventory();
  sfx.menu();
  updateItems();
}
btnRotate.addEventListener('click', (e) => {
  e.stopPropagation();
  rotateItems();
});
window.addEventListener('contextmenu', (e) => {
  if (mode === 'play') e.preventDefault();
});
/** Left click / Space: use the first inventory item; without items the yin-yang swaps marbles. */
function useItem(): void {
  if (!dropItem()) swapMarble();
}
btnDrop.addEventListener('click', (e) => {
  e.stopPropagation();
  dropItem();
});
// client.cc: player::InhibitPickup while the left or right mouse button is held (here also the
// drop key and the drop button), so a dropped item is not picked up again at once.
btnDrop.addEventListener('pointerdown', () => (objects.inhibitPickup = true));
for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) btnDrop.addEventListener(ev, () => (objects.inhibitPickup = false));
window.addEventListener('mouseup', () => (objects.inhibitPickup = false));
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') objects.inhibitPickup = false;
});
window.addEventListener('blur', () => (objects.inhibitPickup = false));
window.addEventListener('mousedown', (e) => {
  if (e.button === 0 || e.button === 2) objects.inhibitPickup = true;
  // Enigma: a left click uses the first inventory item (seeds, then the yin-yang).
  if (e.button === 0 && mode === 'play' && input.locked) useItem();
  else if (e.button === 2 && mode === 'play') rotateItems();
});
btnLevels.addEventListener('click', (e) => {
  e.stopPropagation();
  showLevels();
});
window.addEventListener('click', () => {
  if (mode === 'play' && !input.locked && !isTouch) input.requestLock();
});
window.addEventListener('keydown', (e) => {
  // Esc/P pause even when the browser gave no pointer lock (then Esc does not
  // unlock anything). P also resumes; Esc does not, because a locked browser
  // may deliver the same Esc that already opened the pause via pointerlockchange.
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (mode === 'play') {
      input.releaseLock();
      if (!input.locked) showPause();
    } else if (mode === 'menu' && overlay.hidden === false && ovTitle.textContent === 'Pause' && e.code === 'KeyP') startPlaying();
    return;
  }
  if (e.code === 'Tab' && mode === 'play') {
    e.preventDefault();
    rotateItems();
    return;
  }
  if (e.code === 'Space' && mode === 'play') {
    e.preventDefault();
    objects.inhibitPickup = true;
    useItem();
    return;
  }
  if (e.code === 'KeyT') cycleStyle();
  else if (e.code === 'KeyR' && mode !== 'menu') restart();
  else if (e.key === '+' || e.code === 'NumpadAdd') changeMouseSpeed(1);
  else if (e.key === '-' || e.code === 'NumpadSubtract') changeMouseSpeed(-1);
  else if (mode === 'menu' && overlay.hidden === false && levelList.hidden && ['Enter', 'Space'].includes(e.code)) {
    (ovButtons.querySelector('button.primary') as HTMLButtonElement | null)?.click();
  }
});
window.addEventListener('resize', () => {
  view.resize();
  classic.resize();
});

// Solved levels per pack (for the pack list); level ids of imported packs start with "enigma:".
function noteSolved(pack: string, id: string): void {
  const set = solvedInPack.get(pack) ?? new Set<string>();
  set.add(id);
  solvedInPack.set(pack, set);
  store.set('solvedPacks', Object.fromEntries([...solvedInPack].map(([k, v]) => [k, [...v]])));
}
for (const [k, v] of Object.entries(store.get<Record<string, string[]>>('solvedPacks', {}))) solvedInPack.set(k, new Set(v));
for (const l of LEVELS) if (solved.has(l.id)) noteSolved('murmel', l.id);

await loadLevel(packId, levelIndex);
showStart();
$('loading').remove();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});

// Expose a tiny hook for automated browser tests.
(window as unknown as { murmel: unknown }).murmel = {
  state: () => ({ mode, level: level.id, rubbers: physics?.rubbers.length ?? 0, pairs: board.solvedPairs, total: board.totalPairs, states: [...board.states], falls, pos: { ...(physics?.position ?? { x: 0, y: 0 }) }, style, current: physics?.current ?? 0, marbles: (physics?.marbles ?? []).map((m, i) => ({ ...m.pos, active: m.active, jump: m.jump, falling: falling[i] >= 0 })) }),
  swap: swapMarble,
  drop: dropItem,
  /** Test helper: hold or release the drop button (player::InhibitPickup). */
  hold: (on: boolean) => (objects.inhibitPickup = on),
  luaError: () => lua?.lastError ?? null,
  /** Test helper: call a Lua function of the level like a callback. */
  luaCall: (fn: string, sender = '') => lua?.callback(fn, true, sender),
  globalForce: () => ({ ...globalForce }),
  friction: () => physics?.frictionFactor ?? 1,
  inventory: () => [...objects.inventory],
  push: (x: number, y: number) => {
    if (!physics) return;
    const v = physics.velocity;
    physics.setVelocity(v.x + x, v.y + y);
  },
  mouse: (dx: number, dy: number) => physics?.addMouseForce(dx * mouseSpeed, dy * mouseSpeed),
  enemies: () => (physics?.enemies ?? []).map((e) => ({ kind: e.kind, x: e.pos.x, y: e.pos.y })),
  objects: () => objects.objects.map((o) => ({ k: o.kind, x: o.col, y: o.row, state: o.state, moving: !!o.moving, gone: o.gone, name: o.name })),
  cell: (x: number, y: number) => ({ ...cellAt(level, x, y) }),
  /** Test helper: put the marble at x/y (tile units). */
  teleport: (x: number, y: number, i?: number) => physics?.respawn(x, y, i),
};
