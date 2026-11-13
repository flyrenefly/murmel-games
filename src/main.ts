import './style.css';
import { Sfx } from './audio';
import { Input } from './input';
import { cellAt, type Level } from './game/level';
import { bagContents, isBag, ITEM_NAMES, ObjectWorld } from './game/objects';
import type { PairBoard } from './game/pairs';
import { DEFAULT_MOUSE_SPEED, JUMP_SECONDS, PHYSICS_DT, type PhysicsWorld, SINK_DEPTH } from './game/physics';
import type { LevelFile } from './game/level';
import { FALL_SECONDS, GameSession, type SessionUI, type SoundName } from './game/session';
import { LEVELS } from './levels';
import { listPacks, packLevels, packTitle } from './packs';
import { randomSeed } from './game/rng';
import { emptyProgress, mergeProgress, parseProgress, type Progress, recordAttempt, recordPlay, recordWin, serializeProgress, summarize } from './game/progress';
import { type ActorSprite, ClassicView } from './render/classic';
import { classicSet, STYLE_ORDER, type StyleId } from './render/styles';
import type { ThemeId } from './render/themes';
import { View } from './render/view';
import { istAdmin, kontoLabel, kontoLaden, kontoOeffnen, type KontoHost, mailLinkPruefen } from './konto-ui';
import { loesungSpeichern } from './loesung';
import { reportEvent } from './stats';
import { fehlerLink } from './forum-text';
import { zuZweit } from './mehrspieler';

const AXIS_FORCE = 10; // force at full key press / tilt (times floor adhesion)

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
const ovForm = $('ov-form');

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
/** The current run (simulation in src/game/session.ts); main.ts draws, plays sounds and handles menus. */
let session: GameSession | null = null;
// Short names for the parts of the run that drawing, menus and test hooks read.
let level: Level;
let board: PairBoard;
let physics: PhysicsWorld | null = null;
let objects: ObjectWorld = new ObjectWorld([], 1);
/** Extra lives carried into the next level after a win (player::PrepareLevel keeps them). */
let carryLives: number | null = null;
/** Physics time not yet stepped, and mouse movement waiting for the next step. */
let acc = 0;
let pendingMouse = { x: 0, y: 0 };
let startTime = 0;

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

async function loadLevel(pack: string, i: number, seed?: number): Promise<void> {
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
  // one random sequence per run (docs/SPEC-aufzeichnung.md): every random choice of the level uses it
  const token = ++loadToken;
  noteRunEnded(session);
  physics?.dispose();
  const { startLua } = await import('./lua');
  let s: GameSession | null = null;
  const created = await GameSession.create(packList[i], { seed: seed ?? zz.seed(pack, i) ?? randomSeed(), carryLives, ui: sessionUI(() => s), startLua });
  if (token !== loadToken) return; // another level was loaded meanwhile
  s = created;
  session = s;
  level = s.level;
  board = s.board;
  physics = s.physics;
  objects = s.objects;
  carryLives = null;
  updateItems();
  acc = 0;
  pendingMouse = { x: 0, y: 0 };
  restartNow = null;
  btnSwap.hidden = physics.steerable < 2;
  startTime = 0;
  buildRenderer();
  updateHud();
  zz.levelGeladen(s);
}

function styleLabel(): string {
  return isClassic() ? classic.label : view.themeLabel;
}

function updateHud(): void {
  hudTitle.textContent = `${levelIndex + 1}. ${level.title}`;
  hudPairs.textContent = pairsText();
  const falls = session?.falls ?? 0;
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
  ovForm.hidden = true;
  ovForm.replaceChildren();
  overlay.hidden = false;
}

const isTouch = matchMedia('(pointer: coarse)').matches;

function startPlaying(): void {
  sfx.unlock();
  overlay.hidden = true;
  mode = 'play';
  if (startTime === 0) {
    startTime = performance.now();
    reportEvent('start', level.id); // anonymous statistics: once per run
  }
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

// ---------- progress: best times, statistics, save and load (docs/SPEC-lokal.md) ----------
/** Best runs, counters and solved levels; only in this browser (and in files the player saves). */
let progress: Progress = (() => {
  const raw = store.get<unknown>('progress', null);
  try {
    if (raw) return parseProgress(JSON.stringify(raw)).progress;
  } catch {
    /* a broken entry: start fresh, the solved list below keeps what was solved */
  }
  return emptyProgress();
})();
// levels solved before best times existed (keys 'solved' and 'solvedPacks')
progress = mergeProgress(progress, {
  levels: {},
  solved: [...solved, ...Object.values(store.get<Record<string, string[]>>('solvedPacks', {})).flat()],
});
const nowIso = () => new Date().toISOString();
function saveProgress(): void {
  store.set('progress', JSON.parse(serializeProgress(progress, nowIso())));
}
saveProgress();
/** Runs already counted: started (attempt) and finished (play time, falls). */
const runStarted = new WeakSet<GameSession>();
const runCounted = new WeakSet<GameSession>();

/** A run played its first step: one attempt. */
function noteRunStarted(s: GameSession): void {
  if (runStarted.has(s) || s.steps === 0) return;
  runStarted.add(s);
  progress = recordAttempt(progress, s.level.id, nowIso());
  saveProgress();
}

/** A run ends (won, left, restarted): its play time and falls count. */
function noteRunEnded(s: GameSession | null): void {
  if (!s || runCounted.has(s)) return;
  runCounted.add(s);
  if (s.steps === 0 && s.falls === 0) return;
  progress = recordPlay(progress, s.level.id, s.steps, s.falls);
  saveProgress();
}

/** Time of a best run: m:ss,t from physics steps (the same on every device). */
function formatBest(steps: number): string {
  const t = Math.round(steps * PHYSICS_DT * 10);
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${t % 10}`;
}

/** Statistics, and saving or loading the progress as a file. */
function showProgress(message = ''): void {
  mode = 'menu';
  input.releaseLock();
  const sum = summarize(progress);
  const last = sum.lastPlayed ? new Date(sum.lastPlayed).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '–';
  const rows: [string, string][] = [
    ['Gelöste Levels', String(sum.solved)],
    ['Gespielte Levels', String(sum.played)],
    ['Spielzeit', formatTime(sum.playSteps * PHYSICS_DT)],
    ['Abstürze', String(sum.falls)],
    ['Zuletzt gespielt', last],
  ];
  const table = `<dl class="stats">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
  const note = message ? `<span class="note" role="status">${escapeHtml(message)}</span>` : '';
  showOverlay('Fortschritt', `${table}${note}<span class="credit">Bleibt in diesem Browser. Mit „Sichern“ als Datei mitnehmen, mit „Laden“ auf einem anderen Gerät einlesen.</span>`, [
    ['Zurück', () => void showLevels()],
    ['Sichern', saveProgressFile],
    ['Laden', loadProgressFile],
  ]);
}

function saveProgressFile(): void {
  const blob = new Blob([serializeProgress(progress, nowIso())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `murmel-fortschritt-${nowIso().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showProgress('Datei gespeichert.');
}

function loadProgressFile(): void {
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = 'application/json,.json';
  pick.addEventListener('change', async () => {
    const file = pick.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('zu groß');
      const { progress: loaded, skipped } = parseProgress(await file.text());
      const before = summarize(progress).solved;
      progress = mergeProgress(progress, loaded);
      for (const id of progress.solved) solved.add(id);
      store.set('solved', [...solved]);
      saveProgress();
      const added = summarize(progress).solved - before;
      showProgress(`Geladen: ${added} Levels neu gelöst${skipped ? `, ${skipped} unlesbare Einträge übersprungen` : ''}.`);
    } catch {
      showProgress('Das ist keine Murmel-Fortschrittsdatei.');
    }
  });
  pick.click();
}

function showStart(): void {
  mode = 'menu';
  const credit = `<span class="credit">${escapeHtml(packName)} · Level ${levelIndex + 1} von ${packList.length}${level.author ? ` · von ${escapeHtml(level.author)}` : ''}</span><br>`;
  showOverlay(`${levelIndex + 1}. ${level.title}`, credit + controlsHelp(), [
    [isTouch ? 'Los (Neigen)' : 'Spielen', () => (isTouch ? void startTouch() : startPlaying())],
    ['Levels', showLevels],
    ['Zu zweit', zz.menue],
    [kontoLabel(), openKonto],
  ]);
}

function showPause(): void {
  mode = 'menu';
  showOverlay('Pause', controlsHelp(), [
    ['Weiterspielen', startPlaying],
    ['Neustart', restart],
    ['Levels', showLevels],
    ['Zu zweit', zz.menue],
    [kontoLabel(), openKonto],
    ['Fehler melden', reportBug],
  ]);
}

/** Opens the forum in a new tab with a bug topic for this level and game version (src/forum-text.ts). */
function reportBug(): void {
  window.open(fehlerLink(level.id, __MURMEL_VERSION__), '_blank', 'noopener');
}

// ---------- account (optional, src/konto-ui.ts) ----------
const kontoHost: KontoHost = { showOverlay, form: ovForm, back: showStart };
function openKonto(): void {
  mode = 'menu';
  input.releaseLock();
  void kontoOeffnen(kontoHost);
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
  showOverlay('Levelpakete', '', [['Zurück', showStart], ['Fortschritt', () => showProgress()]]);
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

/** Which levels the pack list shows (remembered). */
type LevelFilter = 'alle' | 'offen' | 'geloest';
let levelFilter: LevelFilter = (['alle', 'offen', 'geloest'] as const).find((f) => f === store.get('levelFilter', 'alle')) ?? 'alle';

/** Alle · Offen · Gelöst: a segmented control above the level list. */
function filterBar(onChange: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'filter';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Levels anzeigen');
  for (const [f, label] of [['alle', 'Alle'], ['offen', 'Offen'], ['geloest', 'Gelöst']] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-pressed', String(f === levelFilter));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sfx.menu();
      levelFilter = f;
      store.set('levelFilter', f);
      onChange();
    });
    bar.append(b);
  }
  return bar;
}

/** Second level: the levels of one pack, with best times and the filter. */
async function showPack(id: string): Promise<void> {
  const levels = await packLevels(id).catch(() => null);
  if (!levels) return;
  showOverlay(await packTitle(id), '', [['Zurück', () => void showLevels()]]);
  const render = () => {
    const rows = levels.flatMap((l, i) => {
      const done = solved.has(l.id);
      if ((levelFilter === 'offen' && done) || (levelFilter === 'geloest' && !done)) return [];
      const best = progress.levels[l.id]?.best;
      const right = best ? `<small>${formatBest(best.steps)}</small>` : '';
      return [
        listButton(`<span>${i + 1}</span>${escapeHtml(l.title)}${right}${done ? ' <em aria-label="gelöst">✓</em>' : ''}`, id === packId && i === levelIndex, async () => {
          await loadLevel(id, i);
          showStart();
        }),
      ];
    });
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = levelFilter === 'offen' ? 'Alle Levels dieses Pakets sind gelöst.' : 'Noch kein Level dieses Pakets gelöst.';
    levelList.replaceChildren(filterBar(render), ...(rows.length ? rows : [empty]));
  };
  render();
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
  if (pearls === 0) return ''; // Oxyd stones still to come (made by Lua)
  return `Perlen ${objects.meditationCount().engaged}/${pearls}`;
}

function onWin(): void {
  if (!session) return;
  const s = session;
  mode = 'won';
  if (zz.gewonnen(s)) return input.releaseLock(); // zu zweit: no single-player progress, own result
  solved.add(level.id);
  reportEvent('solve', level.id);
  store.set('solved', [...solved]);
  const prevBest = progress.levels[level.id]?.best;
  progress = recordWin(progress, level.id, { steps: s.steps, falls: s.falls, seed: s.seed }, nowIso());
  noteRunEnded(s); // saves the progress
  const newBest = progress.levels[level.id]?.best;
  const bestLine = !prevBest
    ? ''
    : newBest && newBest !== prevBest
      ? `<br><strong class="best">Neue Bestzeit!</strong> Vorher ${formatBest(prevBest.steps)}`
      : `<br>Bestzeit ${formatBest(prevBest.steps)}`;
  noteSolved(packId, level.id);
  sfx.win();
  input.releaseLock();
  const last = levelIndex === packList.length - 1;
  // Admins: the won run as a solution for the nightly check (docs/SPEC-loesbarkeit.md)
  const recording = s.recording();
  const asSolution: [string, () => void][] = istAdmin() ? [['Als Lösung speichern', () => void loesungSpeichern(recording).then((msg) => showToast(msg, 2600))]] : [];
  setTimeout(() => {
    showOverlay(
      'Geschafft!',
      `Zeit ${formatBest(s.steps)} · Abstürze ${s.falls}${bestLine}${last ? `<br>Das war das letzte Level in „${escapeHtml(packName)}“.` : ''}`,
      last
        ? [['Levels', showLevels], ['Nochmal', restart], ...asSolution]
        : [
            ['Nächstes Level', async () => { carryLives = s.enigmaRules ? s.livesLeft() : null; await loadLevel(packId, levelIndex + 1); startPlaying(); }],
            ['Nochmal', restart],
            ...asSolution,
          ],
    );
  }, 900);
}

// ---------- game events (the simulation is in src/game/session.ts) ----------
function setStone(index: number): void {
  view.setStoneState(index, board.states[index]);
  classic.setStoneState(index, board.states[index]);
}

function playSound(name: SoundName, value = 0): void {
  switch (name) {
    case 'open': return sfx.open();
    case 'solved': return sfx.solved();
    case 'close': return sfx.close();
    case 'metal': return sfx.metal(value);
    case 'stone': return sfx.stone(value);
    case 'swamped': return sfx.swamped();
    case 'shatter': return sfx.shatter();
    case 'fall': return sfx.fall(value);
    case 'switchOn': return sfx.switchOn();
    case 'triggerDown': return sfx.trigger(true);
    case 'triggerUp': return sfx.trigger(false);
    case 'pickup': return sfx.pickup();
    case 'move': return sfx.move();
    case 'explode': return sfx.explode();
    case 'fakeOxyd': return sfx.fakeOxyd();
    case 'landmine': return sfx.landmine();
    case 'mirror': return sfx.mirror();
    case 'laser': return sfx.laser();
    case 'bomb': return sfx.bomb();
    case 'quake': return sfx.quake();
    case 'menu': return sfx.menu();
    case 'jump': return sfx.jump();
  }
}

/** The browser side of a run; calls from a run that is no longer the current one are ignored. */
function sessionUI(of: () => GameSession | null): SessionUI {
  const live = () => of() !== null && of() === session;
  return {
    sound: (name, value) => live() && playSound(name, value),
    toast: (text, ms) => live() && showToast(text, ms),
    stoneState: (index) => live() && setStone(index),
    items: () => live() && updateItems(),
    hud: () => live() && updateHud(),
    floorChanged: () => live() && classic.floorChanged(),
    peepAll: (indices) => live() && classic.peepAll(indices),
    signalsAdded: () => {
      if (!live()) return;
      if (isClassic()) classic.signalsAdded();
      else buildRenderer();
      updateHud();
    },
    won: () => live() && onWin(),
    restart: (how) => {
      if (live()) restartNow = how;
    },
  };
}

// ---------- main loop ----------
let last = performance.now();
let slowFrames = 0;
let fastFrames = 0;
/** Counts level loads: only the newest one may take over. */
let loadToken = 0;

/** Set by the run when the level starts over; frame() reloads it. */
let restartNow: 'new' | 'keep' | null = null;

// Zu zweit spielen (docs/SPEC-mehrspieler.md): everything else lives in src/mehrspieler/
const zz = zuZweit({
  session: () => session,
  packId: () => packId,
  levelIndex: () => levelIndex,
  loadLevel,
  spielen: () => (isTouch ? void startTouch() : startPlaying()),
  neustart: () => void restart(),
  showOverlay,
  showStart,
  showToast,
  formatTime: formatBest,
});

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  // CSS hides the mouse pointer over the playing field while playing.
  if (document.body.dataset.mode !== mode) document.body.dataset.mode = mode;

  const s = session;
  if (s && (mode !== 'menu' || zz.laeuft())) {
    // Mouse movement goes to the next physics step (also when this frame has none); keys and tilt act on every step.
    const [mdx, mdy] = mode === 'play' ? input.takeMouse() : [0, 0];
    pendingMouse.x += mdx * mouseSpeed;
    pendingMouse.y += mdy * mouseSpeed;
    const [ax, ay] = mode === 'play' ? input.axis() : [0, 0];
    acc += dt;
    // zu zweit, gemeinsam: src/mehrspieler plays the steps of both players
    const net = zz.rechnen(s, acc, { fx: pendingMouse.x, fy: pendingMouse.y, ax: ax * AXIS_FORCE, ay: ay * AXIS_FORCE });
    if (net !== null) {
      acc = net;
      pendingMouse = { x: 0, y: 0 };
    }
    while (net === null && acc >= PHYSICS_DT) {
      s.step({ fx: pendingMouse.x, fy: pendingMouse.y, ax: ax * AXIS_FORCE, ay: ay * AXIS_FORCE });
      pendingMouse = { x: 0, y: 0 };
      acc -= PHYSICS_DT;
    }
    if (mode === 'play') noteRunStarted(s);
  } else {
    input.takeMouse();
    pendingMouse = { x: 0, y: 0 };
  }

  // the level starts over after the last life (decided by the run, the reload is asynchronous)
  if (restartNow && s && !zz.folgt()) {
    const how = restartNow;
    restartNow = null;
    if (how === 'keep') carryLives = s.livesLeft();
    else showToast('Keine Extraleben mehr – das Level beginnt neu.', 2500);
    void (async () => {
      await loadLevel(packId, levelIndex);
      startPlaying();
    })();
  }
  const falling = s?.falling ?? [];
  const deadForever = s?.deadForever ?? [];
  const deathKind = s?.deathKind ?? [];
  const invis = s?.invis ?? [];
  const rotorTime = s?.rotorTime ?? [];
  const shield = s?.shield ?? [];
  // fall animation only: the run advances falling[] in its physics steps
  const fallen = falling.map((f, i) => (f < 0 || !physics ? -1 : deadForever[i] && f >= FALL_SECONDS + 0.25 ? 1 : Math.min(f / FALL_SECONDS, 1)));

  // Interpolate between the last two physics states: smooth on any refresh rate.
  const a = acc / PHYSICS_DT;
  const ci = (s && zz.kamera(s)) ?? physics?.current ?? 0;
  const marbles = (physics?.marbles ?? []).map((m, i) => ({
    kind: 'marble' as const,
    color: m.color,
    // Sunk: invisible until the respawn (ac_marble-sunk).
    fall: s && s.inVortex[i] ? s.vortexFall(i) : deathKind[i] === 'sink' && falling[i] >= 0 ? -1 : (fallen[i] ?? -1),
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
  actors.push(...marbles.filter((_, i) => i !== ci && !deadForever[i] && !((invis[i] ?? 0) > 0) && !((rotorTime[i] ?? 0) > 0)));
  actors.push(...zz.geister(dt));
  // marbles turned into rotors (it_drop) are drawn as rotors
  marbles.forEach((mm, i) => {
    if ((rotorTime[i] ?? 0) > 0 && !deadForever[i]) actors.push({ kind: 'rotor', color: 0, x: mm.x, y: mm.y });
  });
  // Rubber bands: flat list x1, y1, x2, y2 (interpolated like the actors).
  const lerp = (b: { pos: { x: number; y: number }; prev: { x: number; y: number } }) => [b.prev.x + (b.pos.x - b.prev.x) * a, b.prev.y + (b.pos.y - b.prev.y) * a];
  const bands: number[] = [];
  for (const r of physics?.rubbers ?? []) bands.push(...lerp(r.a1), ...(r.a2 ? lerp(r.a2) : [r.end.x, r.end.y]));
  if (isClassic()) {
    classic.status.left = formatTime(s?.playSeconds ?? 0);
    classic.status.right = `${pairsText()}${s?.falls ? ` · Abstürze ${s.falls}` : ''}`;
    classic.updateMarble(x, y, fall, me.color, me.sink, me.jump, 'pearl' in me && me.pearl);
    classic.updateActors(actors);
    classic.hideMarble = (invis[ci] ?? 0) > 0 || (rotorTime[ci] ?? 0) > 0; // invisible (it_cherry) or a rotor (it_drop)
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
  if (mode === 'play') zz.aktion('swap') ?? session?.act('swap');
}
btnSwap.addEventListener('click', (e) => {
  e.stopPropagation();
  swapMarble();
});
/** player::ActivateFirstItem: use or drop the first item; false = no item. */
function dropItem(): boolean {
  return mode === 'play' && !!(zz.aktion('drop') ?? session?.act('drop'));
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
  const inv = zz.inventar(objects) ?? objects.inventory;
  const n = inv.length;
  hudItems.hidden = n === 0;
  btnDrop.hidden = n === 0;
  btnRotate.hidden = n < 2;
  const names = inv.map((k) => (isBag(k) ? `Sack (${bagContents(k).length})` : (ITEM_NAMES[k.replace(/#\d+$/, '')] ?? k)));
  const rest = new Map<string, number>();
  for (const s of names.slice(1)) rest.set(s, (rest.get(s) ?? 0) + 1);
  hudItems.textContent = n ? [`Hand: ${names[0]}`, ...[...rest].map(([s, c]) => (c > 1 ? `${s} ${c}` : s))].join(' · ') : '';
}
/** Right click / Tab: rotate the inventory (player::RotateInventory). */
function rotateItems(): void {
  if (mode === 'play') zz.aktion('rotate') ?? session?.act('rotate');
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
  if (mode === 'play') zz.aktion('use') ?? session?.act('use');
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
  // Typing in a form field (account dialog) is no game shortcut.
  if (e.target instanceof HTMLInputElement) return;
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
// Accounts are optional: the status call runs in the background; a mail link opens its dialog.
void kontoLaden().then(() => {
  for (const b of ovButtons.querySelectorAll('button')) if (b.textContent === 'Anmelden') b.textContent = kontoLabel();
});
if (mailLinkPruefen(kontoHost)) {
  /* the mail link opened its dialog */
} else if (location.hash === '#konto') {
  // from the forum: "Anmelden" opens the account dialog
  history.replaceState(null, '', location.pathname + location.search);
  openKonto();
} else showStart();
// A mail link opened in a tab that already plays
window.addEventListener('hashchange', () => void mailLinkPruefen(kontoHost));
$('loading').remove();
requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});

// Expose a tiny hook for automated browser tests.
(window as unknown as { murmel: unknown }).murmel = {
  state: () => ({ mode, level: level.id, seed: session?.seed ?? 0, rubbers: physics?.rubbers.length ?? 0, pairs: board.solvedPairs, total: board.totalPairs, states: [...board.states], falls: session?.falls ?? 0, steps: session?.steps ?? 0, pos: { ...(physics?.position ?? { x: 0, y: 0 }) }, style, current: physics?.current ?? 0, marbles: (physics?.marbles ?? []).map((m, i) => ({ ...m.pos, active: m.active, jump: m.jump, falling: (session?.falling[i] ?? -1) >= 0 })) }),
  swap: swapMarble,
  drop: dropItem,
  /** Test helper: hold or release the drop button (player::InhibitPickup). */
  hold: (on: boolean) => (objects.inhibitPickup = on),
  luaError: () => session?.lua?.lastError ?? null,
  /** Test helper: start a level; with a seed the run uses that random sequence. */
  load: async (pack: string, i: number, seed?: number) => {
    await loadLevel(pack, i, seed);
    startPlaying();
  },
  /** Test helper: call a Lua function of the level like a callback. */
  luaCall: (fn: string, sender = '') => session?.lua?.callback(fn, true, sender),
  /** Test helper: set a tile like Lua's wo[pos] = {kind, …} (Lua levels only). */
  tile: (x: number, y: number, kind: string, attrs: Record<string, string> = {}) => session?.luaHost?.setTile(x, y, kind, attrs),
  /** Test helper: wo:shuffleOxyd() like Lua (Lua levels only). */
  shuffleOxyd: () => session?.luaHost?.shuffleOxyd?.(),
  globalForce: () => ({ ...(session?.globalForce ?? { x: 0, y: 0 }) }),
  friction: () => physics?.frictionFactor ?? 1,
  inventory: () => [...objects.inventory],
  /** Test helper (not recorded: it changes the run directly). */
  push: (x: number, y: number) => {
    if (!physics) return;
    const v = physics.velocity;
    physics.setVelocity(v.x + x, v.y + y);
  },
  /** Test helper: mouse movement like the real mouse (goes into the recording). */
  mouse: (dx: number, dy: number) => {
    pendingMouse.x += dx * mouseSpeed;
    pendingMouse.y += dy * mouseSpeed;
  },
  /** The recording of the current run (docs/SPEC-aufzeichnung.md). */
  recording: () => session?.recording() ?? null,
  enemies: () => (physics?.enemies ?? []).map((e) => ({ kind: e.kind, x: e.pos.x, y: e.pos.y })),
  objects: () => objects.objects.map((o) => ({ k: o.kind, x: o.col, y: o.row, state: o.state, moving: !!o.moving, gone: o.gone, name: o.name })),
  cell: (x: number, y: number) => ({ ...cellAt(level, x, y) }),
  /** Test helper: positions of the Oxyd stones. */
  signals: () => level.signals.map((g) => ({ x: g.col, y: g.row })),
  /** Test helper: put the marble at x/y (tile units; not recorded). */
  teleport: (x: number, y: number, i?: number) => physics?.respawn(x, y, i),
};

// Offline play: the service worker (dist/sw.js, built by the offline plugin in vite.config.ts)
// keeps the game, its graphics and every opened level pack in the browser cache.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const register = () => void navigator.serviceWorker.register('./sw.js').catch(() => {});
  // main.ts waits for level data first, so the load event may already be over
  if (document.readyState === 'complete') register();
  else addEventListener('load', register);
}
