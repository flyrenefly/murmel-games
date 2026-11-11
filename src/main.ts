import './style.css';
import { Sfx } from './audio';
import { Input } from './input';
import { cellAt, parseLevel, type Level } from './game/level';
import { PairBoard, type PairEvent } from './game/pairs';
import { PHYSICS_DT, PhysicsWorld, type Contact } from './game/physics';
import { LEVELS } from './levels';
import { THEME_ORDER, type ThemeId } from './render/themes';
import { View } from './render/view';

const MOUSE_DV = 0.022; // tiles/s of speed per pixel of mouse movement
const AXIS_ACCEL = 11; // tiles/s² at full key press / tilt
const FALL_SECONDS = 0.6;

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
const canvas = $<HTMLCanvasElement>('game');
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

const sfx = new Sfx();
const view = new View(canvas);
const input = new Input(canvas, (locked) => {
  if (!locked && mode === 'play' && !input.tiltEnabled) showPause();
});

let theme: ThemeId = store.get<ThemeId>('theme', 'glas');
if (!THEME_ORDER.includes(theme)) theme = 'glas';
const solved = new Set<string>(store.get<string[]>('solved', []));

type Mode = 'menu' | 'play' | 'won';
let mode: Mode = 'menu';
let levelIndex = Math.min(store.get('level', 0), LEVELS.length - 1);
let level: Level;
let board: PairBoard;
let physics: PhysicsWorld | null = null;
let simTime = 0;
let acc = 0;
let falls = 0;
let falling = -1; // seconds into the fall animation, -1 = not falling
let startTime = 0;
const prev = { x: 0, y: 0 };
const cur = { x: 0, y: 0 };

function loadLevel(i: number): void {
  levelIndex = i;
  store.set('level', i);
  level = parseLevel(LEVELS[i]);
  board = new PairBoard(level.signals.map((s) => s.symbol));
  physics?.dispose();
  physics = new PhysicsWorld(level);
  simTime = 0;
  acc = 0;
  falls = 0;
  falling = -1;
  startTime = 0;
  const p = physics.position;
  prev.x = cur.x = p.x;
  prev.y = cur.y = p.y;
  view.build(level, theme, board.states);
  updateHud();
}

function updateHud(): void {
  hudTitle.textContent = `${levelIndex + 1}. ${level.title}`;
  hudPairs.textContent = `Paare ${board.solvedPairs}/${board.totalPairs}`;
  hudFalls.textContent = falls ? `Abstürze ${falls}` : '';
  btnTheme.textContent = `Stil: ${view.themeLabel}`;
}

function setTheme(next: ThemeId): void {
  theme = next;
  store.set('theme', theme);
  view.build(level, theme, board.states);
  updateHud();
}

function cycleTheme(): void {
  setTheme(THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]);
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
    ? 'Neige dein Gerät, um die Murmel zu rollen.<br>Decke die Signalsteine paarweise auf.'
    : 'Bewege die Maus, um die Murmel anzustoßen (oder Pfeiltasten).<br>Decke die Signalsteine paarweise auf.<br><span class="keys">Esc Pause · T Stil · R Neustart</span>';
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

function onWin(): void {
  mode = 'won';
  solved.add(level.id);
  store.set('solved', [...solved]);
  sfx.win();
  input.releaseLock();
  const secs = Math.round((performance.now() - startTime) / 1000);
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const last = levelIndex === LEVELS.length - 1;
  setTimeout(() => {
    showOverlay(
      'Geschafft!',
      `Zeit ${time} · Abstürze ${falls}${last ? '<br>Das war das letzte Level – weitere folgen.' : ''}`,
      last
        ? [['Levels', showLevels], ['Nochmal', restart]]
        : [
            ['Nächstes Level', () => { loadLevel(levelIndex + 1); startPlaying(); }],
            ['Nochmal', restart],
          ],
    );
  }, 700);
}

// ---------- game events ----------
function handlePairEvents(events: PairEvent[]): void {
  for (const ev of events) {
    switch (ev.type) {
      case 'opened':
        view.setStoneState(ev.index, board.states[ev.index]);
        sfx.open(level.signals[ev.index].symbol);
        break;
      case 'solved':
        view.setStoneState(ev.a, 'solved');
        view.setStoneState(ev.b, 'solved');
        sfx.solved();
        break;
      case 'mismatch':
        sfx.mismatch();
        break;
      case 'closed':
        for (const i of ev.indices) view.setStoneState(i, 'closed', false);
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
  if (c.kind === 'signal') handlePairEvents(board.hit(c.index, simTime));
  else sfx.wall(c.speed);
}

// ---------- main loop ----------
let last = performance.now();
let slowFrames = 0;
let fastFrames = 0;

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (physics && mode !== 'menu') {
    const [mdx, mdy] = mode === 'play' ? input.takeMouse() : [0, 0];
    if (falling < 0) physics.applyImpulse(mdx * MOUSE_DV * physics.mass, mdy * MOUSE_DV * physics.mass);
    acc += dt;
    while (acc >= PHYSICS_DT) {
      prev.x = cur.x;
      prev.y = cur.y;
      if (falling < 0 && mode === 'play') {
        const [ax, ay] = input.axis();
        const k = AXIS_ACCEL * PHYSICS_DT * physics.mass;
        physics.applyImpulse(ax * k, ay * k);
      }
      physics.step(onContact);
      simTime += PHYSICS_DT;
      const p = physics.position;
      cur.x = p.x;
      cur.y = p.y;
      if (falling < 0 && cellAt(level, Math.floor(p.x), Math.floor(p.y))?.floor === 'abyss') {
        falling = 0;
        physics.setActive(false);
        falls++;
        sfx.fall();
        updateHud();
      }
      acc -= PHYSICS_DT;
    }
    handlePairEvents(board.update(simTime));
  } else {
    input.takeMouse();
  }

  let lift = 0;
  let scale = 1;
  if (falling >= 0 && physics) {
    falling += dt;
    const k = Math.min(falling / FALL_SECONDS, 1);
    lift = -k * k * 1.6;
    scale = 1 - k * 0.6;
    if (k >= 1) {
      falling = -1;
      physics.respawn(level.start.col, level.start.row);
      prev.x = cur.x = level.start.col + 0.5;
      prev.y = cur.y = level.start.row + 0.5;
    }
  }

  // Interpolate between the last two physics states: smooth on any refresh rate.
  const a = acc / PHYSICS_DT;
  const v = physics?.velocity ?? { x: 0, y: 0 };
  view.updateMarble(prev.x + (cur.x - prev.x) * a, prev.y + (cur.y - prev.y) * a, falling >= 0 ? 0 : v.x, falling >= 0 ? 0 : v.y, dt, lift, scale);
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

  requestAnimationFrame(frame);
}

// ---------- wiring ----------
btnTheme.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleTheme();
});
btnRestart.addEventListener('click', (e) => {
  e.stopPropagation();
  restart();
});
btnLevels.addEventListener('click', (e) => {
  e.stopPropagation();
  showLevels();
});
canvas.addEventListener('click', () => {
  if (mode === 'play' && !input.locked && !isTouch) input.requestLock();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyT') cycleTheme();
  else if (e.code === 'KeyR' && mode !== 'menu') restart();
  else if (mode === 'menu' && overlay.hidden === false && levelList.hidden && ['Enter', 'Space'].includes(e.code)) {
    (ovButtons.querySelector('button.primary') as HTMLButtonElement | null)?.click();
  }
});
window.addEventListener('resize', () => view.resize());

loadLevel(levelIndex);
showStart();
$('loading').remove();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});

// Expose a tiny hook for automated browser tests.
(window as unknown as { murmel: unknown }).murmel = {
  state: () => ({ mode, level: level.id, pairs: board.solvedPairs, total: board.totalPairs, falls, pos: { ...cur }, theme }),
  push: (x: number, y: number) => physics?.applyImpulse(x * physics.mass, y * physics.mass),
};
