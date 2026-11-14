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
import { listPacks, packLevels, packTitle, setPlayerPack } from './packs';
import { randomSeed } from './game/rng';
import { emptyProgress, mergeProgress, parseProgress, type Progress, recordAttempt, recordPlay, recordWin, serializeProgress, summarize } from './game/progress';
import { type ActorSprite, ClassicView } from './render/classic';
import { classicSet, STYLE_ORDER, type StyleId } from './render/styles';
import type { ThemeId } from './render/themes';
import { View } from './render/view';
import { anbieterRueckkehrPruefen, beiKontoWechsel, darfEinreichen, istAdmin, kontoLabel, kontoLaden, kontoOeffnen, type KontoHost, mailLinkPruefen } from './konto-ui';
import { Abgleich, statusText, type SyncStatus } from './sync';
import { loesungSpeichern } from './loesung';
import { abwarten, einreichen, ergebnisText, lohntSich, type Meine, meineLaden, ranglistenUrl } from './bestenliste';
import { reportEvent } from './stats';
import { fehlerLink } from './forum-text';
import { zuZweit } from './mehrspieler';
import { Geist, vergleich } from './game/geist';
import { type Aufgabe, aufgabenLaden, einreichenAufgabe, ergebnisZeile, listenZeile, titelZeile } from './tageslevel';
import { tippsUI } from './tipps-ui';
import { auswahl, eigenenLaufSpeichern, eigenerLauf, geistLaden, geisterListe, type Option } from './geister';
import { editorButton, LINK_PACK, noteLinkWin, openLinkFromHash } from './editor/game-link';
import { encodeLevel, LINK_PREFIX } from './editor/link';
import { LICENSE_LABEL, listUrl, loadPlayerLevel, PLAYER_PACK } from './spielerlevels';
import { indexOfLevel, startFromHash } from './startlink';
import { loadSteering, saveSteering, type Steering } from './steuerung';
import { steeringControl } from './steuerung-ui';
import { lockRotation, rotationHint, unlockRotation } from './drehsperre';
import { AUS, IOS_HINWEIS, type Moeglich, moeglich, schluesselLaden, standText, umgebung, VERWEIGERT_HINWEIS, type Wahl, wahlAnwenden } from './webpush';

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

/** `carry`: extra lives to start with (Wettkampf spectators replaying a restart); default: the carried ones. */
async function loadLevel(pack: string, i: number, seed?: number, carry?: number | null): Promise<void> {
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
  if (pack !== LINK_PACK && pack !== PLAYER_PACK) {
    store.set('pack', pack);
    store.set('level', i);
  }
  // one random sequence per run (docs/SPEC-aufzeichnung.md): every random choice of the level uses it
  const token = ++loadToken;
  noteRunEnded(session);
  physics?.dispose();
  const { startLua } = await import('./lua');
  let s: GameSession | null = null;
  const created = await GameSession.create(packList[i], { seed: seed ?? zz.seed(pack, i) ?? aufgabenSeed(pack, packList[i]) ?? randomSeed(), carryLives: carry !== undefined ? carry : carryLives, ui: sessionUI(() => s), startLua });
  const ghost = await geistFuer(packList[i], startLua);
  if (token !== loadToken) return; // another level was loaded meanwhile
  geist = ghost;
  geistImZiel = false;
  s = created;
  session = s;
  // levels from links (docs/SPEC-editor.md) count in no progress, statistics or best times
  if (pack === LINK_PACK) runStarted.add(s), runCounted.add(s);
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
  tipps.levelGeladen(s, packList[i], startLua);
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

// ---------- touch steering: tilt from a rest pose or swipe (src/steuerung.ts), rotation lock ----------
let steering: Steering = loadSteering(store);
function chooseSteering(s: Steering): void {
  steering = s;
  saveSteering(store, s);
}
/** The current attitude becomes the rest pose; with feedback when the player asked for it. */
function setRest(feedback: boolean): void {
  input.setRest();
  if (feedback) showToast('Ruhelage gesetzt');
}
input.onDoubleTap = () => {
  if (mode === 'play' && input.tiltEnabled) setRest(true);
};
$('btn-rest').addEventListener('click', (e) => {
  e.stopPropagation();
  setRest(true);
});
/** Touch dialogs: the segmented control "Neigen / Wischen"; a change shows the dialog again. */
function addSteeringChoice(redraw: () => void): void {
  if (!isTouch) return;
  ovForm.replaceChildren(steeringControl(steering, (s) => (chooseSteering(s), redraw())));
  ovForm.hidden = false;
}
async function lockRotationOrHint(): Promise<void> {
  if ((await lockRotation()) || store.get('drehsperreHinweis', false)) return;
  store.set('drehsperreHinweis', true); // once, not on every start
  showToast(rotationHint(), 5000);
}

function startPlaying(): void {
  sfx.unlock();
  overlay.hidden = true;
  mode = 'play';
  if (startTime === 0) {
    startTime = performance.now();
    reportEvent('start', level.id); // anonymous statistics: once per run
  }
  setRest(false); // level start and resume: the current attitude is the rest pose
  input.requestLock();
}

async function startTouch(): Promise<void> {
  sfx.unlock();
  if (steering === 'tilt' && !input.tiltEnabled && !(await input.enableTilt())) {
    showOverlay('Neigen nicht möglich', 'Dieses Gerät oder dieser Browser liefert keine Lagedaten. Mit Wischen geht es trotzdem.', [
      ['Mit Wischen spielen', () => (chooseSteering('swipe'), void startTouch())],
      ['Zurück', showStart],
    ]);
    return;
  }
  input.setSteering(steering);
  document.body.dataset.steer = steering;
  startPlaying();
  void lockRotationOrHint();
}

const twoMarbles = () => (physics?.steerable ?? 1) > 1;

function controlsHelp(): string {
  return isTouch
    ? `${steering === 'swipe' ? 'Wische über das Spielfeld, um die Murmel anzuschieben.' : 'Neige dein Gerät, um die Murmel zu rollen. Doppelt tippen macht die jetzige Haltung zur Ruhelage.'}<br>Öffne die Oxyd-Steine paarweise.${twoMarbles() ? '<br>Zwei Murmeln: „Murmel wechseln“ steuert die andere.' : ''}${hasSeeds() ? '<br>Samen einsammeln, mit „Ablegen“ wächst daraus eine Holzkiste.' : ''}${hasWand() ? '<br>Zauberstab einsammeln: Ist er vorn im Inventar („Drehen“), dreht ein Stoß Felsbrocken und Einbahnsteine um.' : ''}${hasSpring() ? '<br>Feder einsammeln: „Ablegen“ lässt die Murmel springen – über Abgründe und Wasser.' : ''}`
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

// Fortschritt auf allen Geräten (docs/SPEC-sync.md): only when signed in, never a dialog.
const abgleich = new Abgleich(
  () => progress,
  (p) => {
    progress = p;
    for (const id of progress.solved) solved.add(id);
    store.set('solved', [...solved]);
    saveProgress();
  },
);
beiKontoWechsel((angemeldet) => (angemeldet ? void abgleich.jetzt() : abgleich.abgemeldet()));
window.addEventListener('online', () => abgleich.online());

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

/** The statistics table of the progress page (rebuilt after a sync while the page is open). */
function progressTable(): string {
  const sum = summarize(progress);
  const last = sum.lastPlayed ? new Date(sum.lastPlayed).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }) : '–';
  const rows: [string, string][] = [
    ['Gelöste Levels', String(sum.solved)],
    ['Gespielte Levels', String(sum.played)],
    ['Spielzeit', formatTime(sum.playSteps * PHYSICS_DT)],
    ['Abstürze', String(sum.falls)],
    ['Zuletzt gespielt', last],
  ];
  return `<dl class="stats" id="fortschritt-zahlen">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

/** Statistics, the sync status, and saving or loading the progress as a file. */
function showProgress(message = ''): void {
  mode = 'menu';
  input.releaseLock();
  const note = message ? `<span class="note" role="status">${escapeHtml(message)}</span>` : '';
  const mitKonto = abgleich.status.art !== 'abgemeldet';
  const sync = `<p id="sync-status" class="sync-status" role="status" aria-live="polite" data-art="${abgleich.status.art}">${escapeHtml(statusText(abgleich.status))}</p>`;
  const hinweis = mitKonto
    ? 'Dein Konto hält den Fortschritt auf allen Geräten gleich. Mit „Sichern“ zusätzlich als Datei mitnehmen.'
    : 'Bleibt in diesem Browser. Mit „Sichern“ als Datei mitnehmen, mit „Laden“ auf einem anderen Gerät einlesen.';
  showOverlay('Fortschritt', `${progressTable()}${note}${sync}<span class="credit">${hinweis}</span>`, [
    ['Zurück', () => void showLevels()],
    ['Sichern', saveProgressFile],
    ['Laden', loadProgressFile],
  ]);
  if (mitKonto && abgleich.status.art !== 'laeuft') abgleich.bald(0);
}
// While the progress page is open: the status line, and the numbers after a sync brought something.
abgleich.beobachten((s: SyncStatus) => {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.textContent = statusText(s);
  el.dataset.art = s.art;
  if (s.art === 'ok') document.getElementById('fortschritt-zahlen')?.replaceWith(document.createRange().createContextualFragment(progressTable()));
});

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
  const where = packId === PLAYER_PACK ? escapeHtml(packName) : `${escapeHtml(packName)} · Level ${levelIndex + 1} von ${packList.length}`;
  const credit = `<span class="credit">${where}${level.author ? ` · von ${escapeHtml(level.author)}` : ''}${packId === PLAYER_PACK ? ` · ${LICENSE_LABEL}` : ''}</span><br>`;
  const ghostNote = (aufgabe ? `<span class="credit">${escapeHtml(titelZeile(aufgabe))}</span><br>` : '') + (geist && geistWahl ? `<span class="credit">Geist: ${escapeHtml(geistWahl.titel)}</span><br>` : '');
  const ghostButton: [string, () => void][] = packId === LINK_PACK || zz.laeuft() ? [] : [[geist ? 'Geist ändern' : 'Mit Geist', () => void showGeister()]];
  showOverlay(`${levelIndex + 1}. ${level.title}`, credit + ghostNote + controlsHelp(), [
    ['Spielen', () => (isTouch ? void startTouch() : startPlaying())],
    ...ghostButton,
    ['Levels', showLevels],
    ['Zu zweit', zz.menue],
    ...linkButtons(),
    ...adminButtons(),
    [kontoLabel(), openKonto],
  ]);
  addSteeringChoice(showStart);
}

// ---------- Tageslevel und Wochenaufgabe (docs/SPEC-tageslevel.md, src/tageslevel.ts) ----------
/** The task being played: its start value holds for every restart until another level is loaded. */
let aufgabe: Aufgabe | null = null;

/** Start value of the level being loaded if it is the active task's; otherwise the task ends. */
function aufgabenSeed(pack: string, file: LevelFile): number | null {
  if (aufgabe && aufgabe.pack === pack && aufgabe.level === file.id) return aufgabe.seed;
  aufgabe = null;
  return null;
}

async function aufgabeSpielen(a: Aufgabe): Promise<void> {
  aufgabe = a;
  await loadLevel(a.pack, a.index);
  if (level.id !== a.level) {
    aufgabe = null;
    showToast('Dieses Level fehlt in deiner Spielversion – bitte die Seite neu laden.', 3000);
  }
  showStart();
}

/** Today's and this week's task above the packs; they appear when the answer is there (not offline). */
function aufgabenZeigen(packs: { id: string; title: string }[]): void {
  void Promise.all([aufgabenLaden(), erinnerungMoeglich()]).then(([tasks, push]) => {
    if (!tasks || levelList.hidden || ovTitle.textContent !== 'Levelpakete') return;
    const rows = (['tag', 'woche'] as const).flatMap((art) => {
      const a = tasks[art];
      if (!a) return [];
      const z = listenZeile(a, packs.find((p) => p.id === a.pack)?.title ?? a.pack, formatBest);
      const current = aufgabe?.art === art && aufgabe.zeitraum === a.zeitraum;
      return [listButton(`<span>${solved.has(a.level) ? '✓' : '›'}</span><b>${escapeHtml(z.titel)}</b><small>${escapeHtml(z.info)}</small>`, current, () => void aufgabeSpielen(a))];
    });
    if (rows.length && push.m !== 'nein') {
      const info = push.m === 'ios-browser' ? 'auf dem Home-Bildschirm' : standText(erinnerungWahl);
      rows.push(listButton(`<span>›</span><b>Erinnerung</b><small>${escapeHtml(info)}</small>`, false, () => showErinnerung(push)));
    }
    levelList.prepend(...rows);
  });
}

// ---------- Erinnerung per Web Push (docs/SPEC-webpush.md, src/webpush.ts) ----------
let erinnerungWahl: Wahl = store.get<Wahl>('erinnerung', AUS);
let pushSchluessel: Promise<string | null> | null = null;

/** Can this browser get reminders, and does the server send them? Asks the server once per page. */
async function erinnerungMoeglich(): Promise<{ m: Moeglich; schluessel: string | null }> {
  const m = moeglich(umgebung());
  if (m === 'nein') return { m, schluessel: null };
  pushSchluessel ??= schluesselLaden();
  const schluessel = await pushSchluessel;
  if (!schluessel) pushSchluessel = null; // offline now: ask again next time
  return { m: schluessel ? m : 'nein', schluessel };
}

const pushTeile = (erlaubnis: () => Promise<NotificationPermission>) => ({ erlaubnis, registrierung: () => navigator.serviceWorker.getRegistration() });

/** The card with two switches; the browser asks for the permission only after one is switched on. */
function showErinnerung(push: { m: Moeglich; schluessel: string | null }): void {
  mode = 'menu';
  if (push.m === 'ios-browser' || !push.schluessel) return showOverlay('Erinnerung', escapeHtml(IOS_HINWEIS), [['Zurück', () => void showLevels()]]);
  const schluessel = push.schluessel;
  showOverlay('Erinnerung', 'Murmel schickt dir eine Mitteilung, sobald um Mitternacht ein neues Level bereitsteht. Ein Konto brauchst du dafür nicht.', [['Fertig', () => void showLevels()]]);
  const meldung = document.createElement('p');
  meldung.className = 'note';
  meldung.setAttribute('role', 'status');
  if (Notification.permission === 'denied') meldung.textContent = VERWEIGERT_HINWEIS;
  const boxes: HTMLInputElement[] = [];
  const schalter = (art: keyof Wahl, titel: string, wann: string) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = 'erinnerung-' + art;
    box.setAttribute('role', 'switch');
    box.checked = erinnerungWahl[art];
    box.addEventListener('change', () => {
      const neu = { ...erinnerungWahl, [art]: box.checked };
      for (const b of boxes) b.disabled = true;
      meldung.textContent = '';
      // straight from the click: Safari shows the permission prompt only then
      void wahlAnwenden(neu, schluessel, pushTeile(() => Notification.requestPermission())).then((r) => {
        if (r === 'ok') {
          erinnerungWahl = neu;
          store.set('erinnerung', neu);
          meldung.textContent = neu.tag || neu.woche ? 'Erinnerung ist an.' : 'Erinnerung ist aus.';
        } else {
          box.checked = !box.checked;
          meldung.textContent = r === 'verweigert' ? VERWEIGERT_HINWEIS : 'Das hat nicht geklappt. Bitte versuch es später noch einmal.';
        }
        for (const b of boxes) b.disabled = false;
      });
    });
    boxes.push(box);
    const text = document.createElement('span');
    text.append(titel, document.createElement('br'), Object.assign(document.createElement('small'), { textContent: wann }));
    const label = document.createElement('label');
    label.className = 'konto-schalter';
    label.htmlFor = box.id;
    // like the overlay buttons: the click belongs to the card, not to the game
    label.addEventListener('click', (e) => e.stopPropagation());
    label.append(box, text);
    return label;
  };
  ovForm.replaceChildren(schalter('tag', 'Neues Tageslevel', 'jeden Tag um Mitternacht'), schalter('woche', 'Neue Wochenaufgabe', 'montags um Mitternacht'), meldung);
  ovForm.hidden = false;
}

/** On load: the browser may have changed the subscription; tell the server quietly (no prompt). */
async function erinnerungAbgleichen(): Promise<void> {
  if (!erinnerungWahl.tag && !erinnerungWahl.woche) return;
  const { m, schluessel } = await erinnerungMoeglich();
  if (m !== 'bereit' || !schluessel) return;
  if (Notification.permission !== 'granted') {
    // permission taken back in the browser settings: the reminder is off
    erinnerungWahl = AUS;
    store.set('erinnerung', AUS);
    return;
  }
  await wahlAnwenden(erinnerungWahl, schluessel, pushTeile(async () => Notification.permission));
}

/** "#tageslevel" (a reminder was clicked): start today's level. */
async function tageslevelOeffnen(): Promise<void> {
  history.replaceState(null, '', location.pathname + location.search);
  const tasks = await aufgabenLaden();
  if (tasks?.tag) await aufgabeSpielen(tasks.tag);
  else {
    showStart();
    showToast('Das Tageslevel ist gerade nicht erreichbar.', 2400);
  }
}

/** The task line of the win message: signed in, the run goes to the task's ranking. */
function aufgabenLine(rec: ReturnType<GameSession['recording']>, a: Aufgabe): () => string {
  const id = `aufgabe-${++leaderboardSeq}`;
  let text = ergebnisZeile({ status: 'wartet' }, a.art, formatBest);
  const show = (t: string) => {
    text = t;
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  };
  void (async () => {
    const sent = await einreichenAufgabe(rec, a, __MURMEL_VERSION__);
    if ('fehler' in sent) return show(ergebnisZeile({ status: 'abgelehnt', grund: sent.fehler }, a.art, formatBest));
    show(ergebnisZeile(await abwarten(sent.id), a.art, formatBest));
  })();
  return () => `<br><span class="note" id="${id}" role="status" aria-live="polite">${escapeHtml(text)}</span>`;
}

// ---------- Geister (docs/SPEC-geister.md, src/game/geist.ts) ----------
/** The chosen run: plays along in this level (also after restarts) until another level is loaded. */
let geistWahl: { level: string; titel: string; daten: { steps: number } } | null = null;
let geist: Geist | null = null;
let geistImZiel = false;

/** The ghost for a level that is being loaded; null without a choice, zu zweit or when the run does not fit. */
async function geistFuer(file: LevelFile, startLua: Parameters<typeof Geist.create>[2]): Promise<Geist | null> {
  if (geistWahl && geistWahl.level !== file.id) geistWahl = null;
  if (!geistWahl || zz.laeuft()) return null;
  try {
    return await Geist.create(file, geistWahl.daten, startLua);
  } catch {
    geistWahl = null;
    showToast('Dieser Lauf passt nicht mehr zum Level – es geht ohne Geist weiter.', 2800);
    return null;
  }
}

/** The choice: own best run, other players' shared runs, none. */
async function showGeister(): Promise<void> {
  mode = 'menu';
  const lv = level.id;
  const token = loadToken;
  showOverlay('Mit Geist spielen', 'Einen Moment …', [['Zurück', showStart]]);
  const [lokal, server] = await Promise.all([eigenerLauf(lv), geisterListe(lv)]);
  // the player went elsewhere meanwhile
  if (token !== loadToken || mode !== 'menu' || ovTitle.textContent !== 'Mit Geist spielen') return;
  const opts = auswahl(lokal, server, formatBest);
  const text = opts.length
    ? 'Ein gespeicherter Lauf fährt als durchscheinende Murmel mit. So siehst du, ob du vorn liegst.'
    : 'Für dieses Level gibt es noch keinen Lauf. Gewinne es einmal, dann kannst du gegen dich selbst spielen.';
  const none: [string, () => void][] = geistWahl ? [['Ohne Geist', () => ((geistWahl = null), (geist = null), showStart())]] : [];
  showOverlay('Mit Geist spielen', text, [...opts.map((o): [string, () => void] => [o.titel, () => void geistWaehlen(o, lokal)]), ...none, ['Zurück', showStart]]);
}

async function geistWaehlen(o: Option, lokal: { steps: number } | null): Promise<void> {
  const daten = o.quelle === 'lokal' ? lokal : await geistLaden(o.quelle);
  if (!daten || typeof (daten as { steps?: unknown }).steps !== 'number') return void showToast('Dieser Lauf ist gerade nicht erreichbar.', 2400);
  geistWahl = { level: level.id, titel: o.titel, daten: daten as { steps: number } };
  await loadLevel(packId, levelIndex); // the ghost starts with the level
  if (!geist) return showStart();
  if (isTouch) void startTouch();
  else startPlaying();
}

/** "Zurück zum Editor" / "Im Editor öffnen" for a level from a link; list and editor for player levels. */
function linkButtons(): [string, () => void][] {
  if (packId === PLAYER_PACK) return playerButtons();
  const b = packId === LINK_PACK ? editorButton() : null;
  return b ? [b] : [];
}

// ---------- Spieler-Levels (src/spielerlevels.ts, docs/SPEC-spielerlevels.md) ----------
/** Back to the list, and the level in the editor (CC BY-SA allows changing it). */
function playerButtons(): [string, () => void][] {
  const file = packList[levelIndex];
  return [
    ['Spieler-Levels', () => location.assign(listUrl(level.id))],
    ['Im Editor öffnen', () => void encodeLevel(file).then((data) => location.assign(`./editor.html${LINK_PREFIX}${data}`))],
  ];
}

/** Opens a '#spieler=<n>' hash; false if the hash is no player level. */
async function openPlayerFromHash(hash: string): Promise<boolean> {
  const r = await loadPlayerLevel(hash);
  if (!r) return false;
  if (!r.ok) {
    showToast(r.error, 4000);
    return false;
  }
  setPlayerPack(r.file);
  await loadLevel(PLAYER_PACK, 0);
  if (r.offline) showToast('Offline: gespeicherte Fassung des Levels.', 2600);
  return true;
}

/**
 * Opens a '#start=<pack>/<level-id>' hash from the level pages (docs/SPEC-levelseiten.md) and removes
 * it from the address; false if the hash is no start link or the level is unknown (with a toast).
 */
async function openStartFromHash(hash: string): Promise<boolean> {
  const link = startFromHash(hash);
  if (!link) return false;
  history.replaceState(null, '', location.pathname + location.search);
  let i = -1;
  if (link.pack !== LINK_PACK && link.pack !== PLAYER_PACK) {
    try {
      i = indexOfLevel(await packLevels(link.pack), link.id);
    } catch {
      i = -1;
    }
  }
  if (i < 0) {
    showToast('Dieses Level gibt es hier nicht (mehr).', 4000);
    return false;
  }
  await loadLevel(link.pack, i);
  return true;
}

function showPause(): void {
  mode = 'menu';
  showOverlay('Pause', controlsHelp(), [
    ['Weiterspielen', () => (isTouch ? void startTouch() : startPlaying())],
    ['Neustart', restart],
    ['Levels', showLevels],
    ...tipps.menuePunkt(),
    ['Zu zweit', zz.menue],
    ...linkButtons(),
    ...adminButtons(),
    [kontoLabel(), openKonto],
    ['Fehler melden', reportBug],
  ]);
  addSteeringChoice(showPause);
}

/** Admins only: the statistics page (statistik.html; the server checks the role again). */
function adminButtons(): [string, () => void][] {
  return istAdmin() ? [['Statistik', () => location.assign('./statistik.html')]] : [];
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
  unlockRotation();
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
  unlockRotation();
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
    listButton('<span>›</span><b>Spieler-Levels</b><small>von Spielern gebaut · CC BY-SA 4.0</small>', packId === PLAYER_PACK, () => location.assign(listUrl())),
  );
  levelList.hidden = false;
  (levelList.querySelector('.current') as HTMLElement | null)?.scrollIntoView({ block: 'center' });
  aufgabenZeigen(packs);
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
      const server = meine.get(l.id);
      // the better of the local and the checked time, and the own place in the leaderboard
      const steps = Math.min(best?.steps ?? Infinity, server?.zeit ?? Infinity);
      const right = Number.isFinite(steps) ? `<small>${formatBest(steps)}${server ? ` · Platz ${server.platz}` : ''}</small>` : '';
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

// ---------- leaderboard (optional, src/bestenliste.ts) ----------
/** Own checked times and places per level; filled after sign-in. */
let meine: Meine = new Map();
let leaderboardSeq = 0;

/**
 * The leaderboard line of the win message. Signed in, the run goes to the server for its replay and the
 * line shows the place when the answer comes; otherwise a hint to sign in.
 */
function leaderboardLine(rec: ReturnType<GameSession['recording']>, steps: number, levelId: string): () => string {
  if (!darfEinreichen()) return () => '<br><span class="note">Anmelden, um in die Bestenliste zu kommen.</span>';
  const server = meine.get(levelId);
  if (server && !lohntSich(steps, server)) return () => `<br><span class="note">Bestenliste: Platz ${server.platz} (deine Bestzeit ${formatBest(server.zeit)})</span>`;
  const id = `bestenliste-${++leaderboardSeq}`;
  let text = 'Bestenliste: wird geprüft …';
  // the overlay appears a moment after the win (sound first); it shows whatever is known by then
  const show = (t: string) => {
    text = t;
    const el = document.getElementById(id);
    if (el) el.textContent = t;
  };
  void (async () => {
    const sent = await einreichen(rec, __MURMEL_VERSION__);
    if ('fehler' in sent) return show(`Bestenliste: ${sent.fehler}`);
    const result = await abwarten(sent.id);
    if (result.status === 'angenommen' && result.platz) meine.set(levelId, { zeit: result.zeit, platz: result.platz });
    show(ergebnisText(result, formatBest));
  })();
  return () => `<br><span class="note" id="${id}" role="status" aria-live="polite">${escapeHtml(text)}</span>`;
}

function onWin(): void {
  if (!session) return;
  if (packId === LINK_PACK) return linkWin(session);
  const s = session;
  mode = 'won';
  if (zz.gewonnen(s)) return input.releaseLock(); // zu zweit: no single-player progress, own result
  solved.add(level.id);
  reportEvent('solve', level.id);
  store.set('solved', [...solved]);
  const prevBest = progress.levels[level.id]?.best;
  progress = recordWin(progress, level.id, { steps: s.steps, falls: s.falls, seed: s.seed }, nowIso());
  noteRunEnded(s); // saves the progress
  abgleich.bald();
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
  void eigenenLaufSpeichern(recording); // kept only if it is the best of this level
  const ghostLine = geistWahl ? `<br>${escapeHtml(vergleich(s.steps, geistWahl.daten.steps, formatBest))}` : '';
  const raceIt: [string, () => void][] = [['Gegen diesen Lauf', () => {
    geistWahl = { level: level.id, titel: `Dein Lauf ${formatBest(s.steps)}`, daten: recording };
    void restart();
  }]];
  // a run with a shown way goes to no ranking (docs/SPEC-tipps.md)
  const ohneRangliste = tipps.wegGezeigt();
  const board = ohneRangliste ? () => '' : leaderboardLine(recording, s.steps, level.id);
  const task = !ohneRangliste && aufgabe && aufgabe.level === level.id && recording.seed === aufgabe.seed && darfEinreichen() ? aufgabenLine(recording, aufgabe) : () => '';
  const ranking: [string, () => void][] = [['Rangliste', () => void window.open(ranglistenUrl(level.id, level.title), '_blank', 'noopener')]];
  const rate: [string, () => void][] = packId === PLAYER_PACK ? [['Bewerten', () => location.assign(listUrl(level.id))]] : [];
  const asSolution: [string, () => void][] = istAdmin() ? [['Als Lösung speichern', () => void loesungSpeichern(recording).then((msg) => showToast(msg, 2600))]] : [];
  setTimeout(() => {
    showOverlay(
      'Geschafft!',
      `Zeit ${formatBest(s.steps)} · Abstürze ${s.falls}${bestLine}${ghostLine}${tipps.siegZeile()}${board()}${task()}${last ? `<br>Das war das letzte Level in „${escapeHtml(packName)}“.` : ''}`,
      last
        ? [['Levels', showLevels], ['Nochmal', restart], ...raceIt, ...ranking, ...rate, ...asSolution]
        : [
            ['Nächstes Level', async () => { carryLives = s.enigmaRules ? s.livesLeft() : null; await loadLevel(packId, levelIndex + 1); startPlaying(); }],
            ['Nochmal', restart],
            ...raceIt,
            ...ranking,
            ...asSolution,
          ],
    );
  }, 900);
}

/** Won a level from a link: no progress, statistics or best time (docs/SPEC-editor.md). */
function linkWin(s: GameSession): void {
  mode = 'won';
  noteLinkWin(s.recording());
  sfx.win();
  input.releaseLock();
  setTimeout(() => showOverlay('Geschafft!', `Zeit ${formatBest(s.steps)} · Abstürze ${s.falls}`, [...linkButtons(), ['Nochmal', restart], ['Levels', showLevels]]), 900);
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

// Tipps (docs/SPEC-tipps.md, src/tipps-ui.ts)
const tipps = tippsUI(
  {
    showOverlay,
    showToast,
    menue: () => ((mode = 'menu'), input.releaseLock()),
    spielen: () => (isTouch ? void startTouch() : startPlaying()),
    aus: () => zz.laeuft() || mode === 'won',
  },
  $<HTMLButtonElement>('btn-tipp'),
);

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
    if (geist) {
      geist.folgen(s.steps);
      if (geist.imZiel && !geistImZiel) {
        geistImZiel = true;
        if (!s.won) showToast(`Geist im Ziel: ${formatBest(geist.zeit ?? 0)}`, 2000);
      }
    }
    tipps.rechnen(s);
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
  const ghostSprite = geist?.sprite(a);
  if (ghostSprite) actors.push(ghostSprite);
  const tippSprite = tipps.sprite(a);
  if (tippSprite) actors.push(tippSprite);
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
  else if (e.code === 'KeyH' && mode === 'play') void tipps.oeffnen();
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

// a shared level in the link (#level=…, src/editor/game-link.ts) starts instead of the last level
const linkStart = await openLinkFromHash(location.hash);
if (linkStart?.ok) await loadLevel(LINK_PACK, 0);
else if (!(await openPlayerFromHash(location.hash)) && !(await openStartFromHash(location.hash))) await loadLevel(packId, levelIndex);
// Accounts are optional: the status call runs in the background; a mail link opens its dialog.
void kontoLaden().then(async () => {
  if (darfEinreichen()) meine = await meineLaden();
  const buttons = [...ovButtons.querySelectorAll('button')];
  for (const b of buttons) if (b.textContent === 'Anmelden') b.textContent = kontoLabel();
  // the menu was drawn before the account was known: add the admin button next to „Konto“
  const konto = buttons.find((b) => b.textContent === kontoLabel());
  if (istAdmin() && konto && !buttons.some((b) => b.textContent === 'Statistik')) {
    const stat = konto.cloneNode() as HTMLButtonElement;
    stat.textContent = 'Statistik';
    stat.addEventListener('click', () => location.assign('./statistik.html'));
    konto.before(stat);
  }
});
if (mailLinkPruefen(kontoHost) || anbieterRueckkehrPruefen(kontoHost)) {
  /* a mail link or the way back from Google, Apple, GitHub opened its dialog */
} else if (location.hash === '#tageslevel') {
  void tageslevelOeffnen();
} else if (location.hash === '#konto') {
  // from the forum: "Anmelden" opens the account dialog
  history.replaceState(null, '', location.pathname + location.search);
  openKonto();
} else showStart();
if (linkStart && !linkStart.ok) showToast(linkStart.error, 4000);
void erinnerungAbgleichen();
// A reminder clicked while the game is open (service worker) or a link with #tageslevel
navigator.serviceWorker?.addEventListener('message', (e) => {
  if ((e.data as { murmel?: unknown } | null)?.murmel === 'tageslevel') void tageslevelOeffnen();
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#tageslevel') void tageslevelOeffnen();
});
// A mail link opened in a tab that already plays
window.addEventListener('hashchange', () => void mailLinkPruefen(kontoHost));
window.addEventListener('hashchange', async () => {
  const r = await openLinkFromHash(location.hash);
  if (r && !r.ok) showToast(r.error, 4000);
  if (r?.ok) {
    await loadLevel(LINK_PACK, 0);
    showStart();
  } else if (!r && ((await openPlayerFromHash(location.hash)) || (await openStartFromHash(location.hash)))) showStart();
});
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
  /** Test helper: the start menu of the current level. */
  start: () => showStart(),
  /** Geister: the ghost of this run (docs/SPEC-geister.md). */
  ghost: () => (geist ? { steps: geist.schritte, done: geist.imZiel, sprite: geist.sprite(1) } : null),
  /** Tipps: the tip button, the shown way and the counts of this run (docs/SPEC-tipps.md). */
  tipp: () => tipps.zustand(),
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
