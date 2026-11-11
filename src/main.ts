import './style.css';
import { Sfx } from './audio';
import { Input } from './input';
import { cellAt, parseLevel, type Level } from './game/level';
import { PairBoard, type PairEvent } from './game/pairs';
import { DEFAULT_MOUSE_SPEED, PHYSICS_DT, PhysicsWorld, type Contact } from './game/physics';
import { LEVELS } from './levels';
import { CLASSIC_FALL_SECONDS, ClassicView } from './render/classic';
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
let levelIndex = Math.min(store.get('level', 0), LEVELS.length - 1);
let level: Level;
let board: PairBoard;
let physics: PhysicsWorld | null = null;
let acc = 0;
let falls = 0;
let falling = -1; // seconds into the fall animation, -1 = not falling
let startTime = 0;
let playSeconds = 0;
const prev = { x: 0, y: 0 };
const cur = { x: 0, y: 0 };

const isClassic = () => classicSet(style) !== null;

function buildRenderer(): void {
  const set = classicSet(style);
  canvas2d.hidden = set === null;
  canvas3d.hidden = set !== null;
  document.body.dataset.style = style;
  if (set) {
    document.body.dataset.theme = 'klassisch';
    void classic.build(level, set, board.states);
  } else view.build(level, style as ThemeId, board.states);
}

function loadLevel(i: number): void {
  levelIndex = i;
  store.set('level', i);
  level = parseLevel(LEVELS[i]);
  board = new PairBoard(level.signals.map((s) => s.symbol));
  physics?.dispose();
  physics = new PhysicsWorld(level);
  acc = 0;
  falls = 0;
  falling = -1;
  startTime = 0;
  playSeconds = 0;
  const p = physics.position;
  prev.x = cur.x = p.x;
  prev.y = cur.y = p.y;
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
function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 1400);
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

function controlsHelp(): string {
  return isTouch
    ? 'Neige dein Gerät, um die Murmel zu rollen.<br>Öffne die Oxyd-Steine paarweise.'
    : 'Bewege die Maus, um die Murmel zu beschleunigen (oder Pfeiltasten).<br>Öffne die Oxyd-Steine paarweise.<br><span class="keys">Esc Pause · T Stil · R Neustart · +/− Mausgeschwindigkeit</span>';
}

function showStart(): void {
  mode = 'menu';
  showOverlay(`${levelIndex + 1}. ${level.title}`, controlsHelp(), [
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

function showLevels(): void {
  mode = 'menu';
  input.releaseLock();
  showOverlay('Levels', '', [['Zurück', showStart]]);
  levelList.replaceChildren(
    ...LEVELS.map((l, i) => {
      const b = document.createElement('button');
      b.className = 'level' + (i === levelIndex ? ' current' : '');
      b.innerHTML = `<span>${i + 1}</span>${l.title}${solved.has(l.id) ? ' <em>✓</em>' : ''}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        loadLevel(i);
        showStart();
      });
      return b;
    }),
  );
  levelList.hidden = false;
}

function restart(): void {
  loadLevel(levelIndex);
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
  sfx.win();
  input.releaseLock();
  const last = levelIndex === LEVELS.length - 1;
  setTimeout(() => {
    showOverlay(
      'Geschafft!',
      `Zeit ${formatTime(playSeconds)} · Abstürze ${falls}${last ? '<br>Das war das letzte Level – weitere folgen.' : ''}`,
      last
        ? [['Levels', showLevels], ['Nochmal', restart]]
        : [
            ['Nächstes Level', () => { loadLevel(levelIndex + 1); startPlaying(); }],
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
  sfx.stone(c.speed); // Enigma: every stone hit makes the stone sound
  if (c.kind === 'signal') handlePairEvents(board.hit(c.index));
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
    if (falling < 0 && mode === 'play') {
      physics.addMouseForce(mdx * mouseSpeed, mdy * mouseSpeed);
      const [ax, ay] = input.axis();
      physics.setAxisForce(ax * AXIS_FORCE, ay * AXIS_FORCE);
    } else physics.setAxisForce(0, 0);
    acc += dt;
    while (acc >= PHYSICS_DT) {
      prev.x = cur.x;
      prev.y = cur.y;
      physics.step(onContact);
      const p = physics.position;
      cur.x = p.x;
      cur.y = p.y;
      if (falling < 0 && cellAt(level, Math.floor(p.x), Math.floor(p.y))?.floor === 'abyss') {
        falling = 0;
        physics.setActive(false);
        falls++;
        sfx.fall(FALL_SECONDS);
        updateHud();
      }
      acc -= PHYSICS_DT;
    }
  } else {
    input.takeMouse();
  }

  let fall = -1;
  if (falling >= 0 && physics) {
    falling += dt;
    fall = Math.min(falling / FALL_SECONDS, 1);
    if (falling >= FALL_SECONDS + 0.25) {
      falling = -1;
      fall = -1;
      physics.respawn(level.start.col, level.start.row);
      prev.x = cur.x = level.start.col + 0.5;
      prev.y = cur.y = level.start.row + 0.5;
    }
  }

  // Interpolate between the last two physics states: smooth on any refresh rate.
  const a = acc / PHYSICS_DT;
  const x = prev.x + (cur.x - prev.x) * a;
  const y = prev.y + (cur.y - prev.y) * a;
  if (isClassic()) {
    classic.status.left = formatTime(playSeconds);
    classic.status.right = `Paare ${board.solvedPairs}/${board.totalPairs}${falls ? ` · Abstürze ${falls}` : ''}`;
    classic.updateMarble(x, y, fall);
    classic.render(dt);
  } else {
    const v = physics?.velocity ?? { x: 0, y: 0 };
    view.updateMarble(x, y, fall >= 0 ? 0 : v.x, fall >= 0 ? 0 : v.y, dt, fall);
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
btnLevels.addEventListener('click', (e) => {
  e.stopPropagation();
  showLevels();
});
window.addEventListener('click', () => {
  if (mode === 'play' && !input.locked && !isTouch) input.requestLock();
});
window.addEventListener('keydown', (e) => {
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

loadLevel(levelIndex);
showStart();
$('loading').remove();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});

// Expose a tiny hook for automated browser tests.
(window as unknown as { murmel: unknown }).murmel = {
  state: () => ({ mode, level: level.id, pairs: board.solvedPairs, total: board.totalPairs, states: [...board.states], falls, pos: { ...cur }, style }),
  push: (x: number, y: number) => {
    if (!physics) return;
    const v = physics.velocity;
    physics.setVelocity(v.x + x, v.y + y);
  },
  mouse: (dx: number, dy: number) => physics?.addMouseForce(dx * mouseSpeed, dy * mouseSpeed),
};
