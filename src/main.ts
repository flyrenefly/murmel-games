import './style.css';
import { Sfx } from './audio';
import { Input } from './input';
import { cellAt, isDeadly, parseLevel, type Level } from './game/level';
import { ObjectWorld, type ObjectEvent } from './game/objects';
import { PairBoard, type PairEvent } from './game/pairs';
import { DEFAULT_MOUSE_SPEED, PHYSICS_DT, PhysicsWorld, type Contact } from './game/physics';
import type { LevelFile } from './game/level';
import { LEVELS } from './levels';
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
let objects: ObjectWorld = new ObjectWorld([], 1);
let acc = 0;
let falls = 0;
/** Per marble: seconds into the fall animation, -1 = not falling. */
let falling: number[] = [-1];
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
      if (cell) cell.floor = kind;
    },
  }, Math.random, lv.compat);
  physics = new PhysicsWorld(level, objects);
  physics.setForceField((x, y) => objects.fieldForce(x, y));
  acc = 0;
  falls = 0;
  falling = physics.marbles.map(() => -1);
  startPos = physics.marbles.map((m) => ({ ...m.pos }));
  btnSwap.hidden = physics.marbles.length < 2;
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
  hudPairs.textContent = `Paare ${board.solvedPairs}/${board.totalPairs}`;
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

const twoMarbles = () => (physics?.marbles.length ?? 1) > 1;

function controlsHelp(): string {
  return isTouch
    ? `Neige dein Gerät, um die Murmel zu rollen.<br>Öffne die Oxyd-Steine paarweise.${twoMarbles() ? '<br>Zwei Murmeln: „Murmel wechseln“ steuert die andere.' : ''}`
    : `Bewege die Maus, um die Murmel zu beschleunigen (oder Pfeiltasten).<br>Öffne die Oxyd-Steine paarweise.${twoMarbles() ? '<br>Zwei Murmeln: Klick oder Leertaste wechselt zwischen schwarzer und weißer Murmel.' : ''}<br><span class="keys">Esc/P Pause · T Stil · R Neustart · +/− Mausgeschwindigkeit</span>`;
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
            ['Nächstes Level', async () => { await loadLevel(packId, levelIndex + 1); startPlaying(); }],
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
  if (c.kind === 'object') {
    if (c.by >= 0) objects.touch(c.col, c.row, c.by); // other actors only hit
    if (!c.hit) return;
    // Switches sound metallic (Switch::collision_sound), doors like stone.
    if (objects.objects.some((o) => o.cls === 'switch' && o.col === c.col && o.row === c.row)) sfx.metal(c.speed);
    else sfx.stone(c.speed);
    objects.hit(c.col, c.row, c.color, c.nx, c.ny, c.vn);
    return;
  }
  sfx.stone(c.speed); // Enigma: every stone hit makes the stone sound
  if (c.kind === 'signal') handlePairEvents(board.hit(c.index));
}

/** Marble i dies: fall animation, then respawn at its start. */
function marbleDies(i: number, shatter: boolean): void {
  if (!physics || !(falling[i] < 0)) return;
  falling[i] = 0;
  physics.setActive(false, i);
  objects.marbleGone(i);
  falls++;
  if (shatter) sfx.shatter();
  else sfx.fall(FALL_SECONDS);
  updateHud();
}

function handleObjectEvents(events: ObjectEvent[]): void {
  for (const e of events.splice(0)) {
    if (e.type === 'shatter') marbleDies(e.marble, true);
    else if (e.type === 'text') showToast(e.text, Math.min(12000, 2500 + e.text.length * 60));
    else if (e.type === 'floor') classic.floorChanged();
    else if (e.type === 'quake') {
      sfx.quake();
      handlePairEvents(board.closeAll());
    }
    else if (e.name === 'switch') sfx.switchOn();
    else if (e.name === 'triggerdown') sfx.trigger(true);
    else if (e.name === 'triggerup') sfx.trigger(false);
    else if (e.name === 'pickup') sfx.pickup();
    else if (e.name === 'move') sfx.move();
    else if (e.name === 'explode') sfx.explode();
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
    if (mode === 'play') playSeconds += dt;
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
        if (to) ph.respawn(to.x, to.y, i);
        objects.marbleAt(Math.floor(m.pos.x), Math.floor(m.pos.y), i);
      });
      objects.update(PHYSICS_DT * 1000);
      handleObjectEvents(objects.events);
      ph.marbles.forEach((m, i) => {
        const under = cellAt(level, Math.floor(m.pos.x), Math.floor(m.pos.y));
        if (falling[i] < 0 && under && isDeadly(under.floor)) marbleDies(i, false);
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
    falling[i] = -1;
    physics.respawn(startPos[i].x, startPos[i].y, i);
    return -1;
  });

  // Interpolate between the last two physics states: smooth on any refresh rate.
  const a = acc / PHYSICS_DT;
  const ci = physics?.current ?? 0;
  const marbles = (physics?.marbles ?? []).map((m, i) => ({
    kind: 'marble' as const,
    color: m.color,
    fall: fallen[i] ?? -1,
    x: m.prev.x + (m.pos.x - m.prev.x) * a,
    y: m.prev.y + (m.pos.y - m.prev.y) * a,
  }));
  const me = marbles[ci] ?? { kind: 'marble' as const, color: 0, fall: -1, x: 0, y: 0 };
  const { x, y } = me;
  const fall = me.fall;
  const actors: ActorSprite[] = (physics?.enemies ?? []).map((e) => ({
    kind: e.kind,
    color: e.color,
    x: e.prev.x + (e.pos.x - e.prev.x) * a,
    y: e.prev.y + (e.pos.y - e.prev.y) * a,
  }));
  actors.push(...marbles.filter((_, i) => i !== ci));
  if (isClassic()) {
    classic.status.left = formatTime(playSeconds);
    classic.status.right = `Paare ${board.solvedPairs}/${board.totalPairs}${falls ? ` · Abstürze ${falls}` : ''}`;
    classic.updateMarble(x, y, fall, me.color);
    classic.updateActors(actors);
    classic.render(dt);
  } else {
    const v = physics?.velocity ?? { x: 0, y: 0 };
    view.updateMarble(x, y, fall >= 0 ? 0 : v.x, fall >= 0 ? 0 : v.y, dt, fall);
    view.updateActors(actors);
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
  sfx.menu();
  showToast(physics.marbles[physics.current].color === 1 ? 'Weiße Murmel' : 'Schwarze Murmel', 900);
}
btnSwap.addEventListener('click', (e) => {
  e.stopPropagation();
  swapMarble();
});
window.addEventListener('mousedown', (e) => {
  // Enigma: a left click uses the first inventory item, here the yin-yang.
  if (e.button === 0 && mode === 'play' && input.locked && twoMarbles()) swapMarble();
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
  if (e.code === 'Space' && mode === 'play') {
    e.preventDefault();
    swapMarble();
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
  state: () => ({ mode, level: level.id, pairs: board.solvedPairs, total: board.totalPairs, states: [...board.states], falls, pos: { ...(physics?.position ?? { x: 0, y: 0 }) }, style, current: physics?.current ?? 0, marbles: (physics?.marbles ?? []).map((m) => ({ ...m.pos, active: m.active })) }),
  swap: swapMarble,
  push: (x: number, y: number) => {
    if (!physics) return;
    const v = physics.velocity;
    physics.setVelocity(v.x + x, v.y + y);
  },
  mouse: (dx: number, dy: number) => physics?.addMouseForce(dx * mouseSpeed, dy * mouseSpeed),
  enemies: () => (physics?.enemies ?? []).map((e) => ({ kind: e.kind, x: e.pos.x, y: e.pos.y })),
  objects: () => objects.objects.map((o) => ({ k: o.kind, x: o.col, y: o.row, state: o.state, moving: !!o.moving, gone: o.gone })),
  /** Test helper: put the marble at x/y (tile units). */
  teleport: (x: number, y: number) => physics?.respawn(x, y),
};
