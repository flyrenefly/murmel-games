// The level editor page (editor.html, docs/SPEC-editor.md): palette, painting with mouse and touch,
// connections, checks, playtest, sharing by link and own levels in the browser.

import './editor.css';
import { drawEntry, drawLevel, ED_STYLES, type EdStyle, loadImages, symbolColor } from './draw';
import { History } from './history';
import { decodeLevel, encodeLevel, LINK_PREFIX, linkData, linkLength, LinkError, sanitizeLevel } from './link';
import { cellOf, clone, LICENSE_NOTE, type EditorLevel, erase, fromLevelFile, MAX_H, MAX_W, MIN_H, MIN_W, newLevel, paint, resize, sourceAt, sources, targets, toLevelFile } from './model';
import { ACTIONS, BY_KIND, GROUPS, OXYD_COLORS, OXYD_FLAVORS, type PaletteEntry, searchPalette } from './palette';
import { canShare, check, loadError, type Problem } from './rules';
import { currentId, deleteLevel, listLevels, loadHistory, loadStored, newId, saveHistory, saveLevel, setCurrentId } from './storage';

type Tool = 'paint' | 'rect' | 'erase' | 'select';
type Cell = { x: number; y: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('ed-board');
const ctx = canvas.getContext('2d')!;
const stage = $('ed-stage');
const titleIn = $<HTMLInputElement>('ed-title');
const authorIn = $<HTMLInputElement>('ed-author');
const groupsEl = $('ed-groups');
const currentEl = $('ed-current');
const selectionEl = $('ed-selection');
const statusEl = $('ed-status');
const dialog = $<HTMLDialogElement>('ed-dialog');
const toastEl = $('ed-toast');

// ---------- state ----------
let id = '';
let level: EditorLevel;
let history = new History<EditorLevel>();
let entry: PaletteEntry = BY_KIND.get('st_granite')!;
let tool: Tool = 'paint';
let oxydColor = 'auto';
let oxydFlavor = 'b';
let style = readStyle();
let tile = 32;
let selected: Cell | null = null;
let picking = false;
let marked: Cell[] = [];
let hover: Cell | null = null;
let problems: Problem[] = [];
let drag: { before: EditorLevel; changed: boolean; last: Cell; rect: { x0: number; y0: number; x1: number; y1: number } | null; pointer: number } | null = null;

function readStyle(): EdStyle {
  for (const key of ['murmel.editor.style', 'murmel.style']) {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (ED_STYLES.some(([s]) => s === v)) return v as EdStyle;
    } catch {
      /* ignore */
    }
  }
  return 'klassisch';
}

// ---------- toast ----------
let toastTimer = 0;
function toast(text: string, ms = 2600): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), ms);
}

// ---------- persistence ----------
let warnedStorage = false;
function persist(): void {
  if (!saveLevel(id, level) && !warnedStorage) {
    warnedStorage = true;
    toast('Speichern im Browser ist nicht möglich (privater Modus?). Exportiere das Level als Datei.', 5000);
  }
  saveHistory(id, history.toJSON());
}

function open(newLevelId: string, l: EditorLevel, h: History<EditorLevel> = new History()): void {
  id = newLevelId;
  level = l;
  history = h;
  selected = null;
  picking = false;
  marked = [];
  setCurrentId(id);
  persist();
  titleIn.value = level.title;
  authorIn.value = level.author;
  layout();
  refresh();
}

/** A change: the state before goes into the history. */
function commit(before: EditorLevel): void {
  history.record(before);
  persist();
  refresh();
}

function undo(): void {
  const prev = history.undo(clone(level));
  if (prev) restore(prev);
}

function redo(): void {
  const next = history.redo(clone(level));
  if (next) restore(next);
}

function restore(l: EditorLevel): void {
  const sizeChanged = l.width !== level.width || l.height !== level.height;
  level = l;
  titleIn.value = level.title;
  authorIn.value = level.author;
  if (selected && !cellOf(level, selected.x, selected.y)) selected = null;
  persist();
  if (sizeChanged) layout();
  refresh();
}

// ---------- drawing ----------
function layout(): void {
  const r = stage.getBoundingClientRect();
  const pad = 16;
  const t = Math.floor(Math.min((r.width - pad) / level.width, (r.height - pad) / level.height));
  tile = Math.max(8, Math.min(48, t >= 32 ? 32 + Math.floor((t - 32) / 16) * 16 : t));
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${level.width * tile}px`;
  canvas.style.height = `${level.height * tile}px`;
  canvas.width = Math.round(level.width * tile * dpr);
  canvas.height = Math.round(level.height * tile * dpr);
  draw();
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, level.width * tile, level.height * tile);
  const names = new Map(targets(level).map((t) => [t.name, t]));
  const links = sources(level).flatMap((s) => {
    const t = names.get(s.target);
    return t ? [{ from: s, to: t, active: !!selected && ((selected.x === s.x && selected.y === s.y) || (selected.x === t.x && selected.y === t.y)) }] : [];
  });
  drawLevel(style, ctx, level, tile, { hover, selected, marked, links, rect: drag?.rect ?? null, grid: true });
}

/** After every change: drawing, panels, checks, buttons. */
function refresh(): void {
  problems = check(level);
  draw();
  renderCurrent();
  renderSelection();
  renderStatus();
  $<HTMLButtonElement>('ed-undo').disabled = !history.canUndo;
  $<HTMLButtonElement>('ed-redo').disabled = !history.canRedo;
  canvas.setAttribute('aria-label', `Spielfeld ${level.width} × ${level.height}${level.title ? `: ${level.title}` : ''}`);
}

// ---------- palette ----------
function tileCanvas(e: PaletteEntry, size = 32): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  c.width = c.height = Math.round(size * dpr);
  c.style.width = c.style.height = `${size}px`;
  const g = c.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  drawEntry(style, g, e, 0, 0, size, oxydColor === 'auto' ? 'A' : oxydColor, oxydFlavor);
  return c;
}

function renderPalette(): void {
  const q = $<HTMLInputElement>('ed-search').value;
  const list = searchPalette(q);
  const parts: HTMLElement[] = [];
  for (const g of GROUPS) {
    const items = list.filter((e) => e.group === g);
    if (!items.length) continue;
    const sec = document.createElement('section');
    const h = document.createElement('h3');
    h.textContent = g;
    const grid = document.createElement('div');
    grid.className = 'ed-tiles';
    grid.setAttribute('role', 'listbox');
    grid.setAttribute('aria-label', g);
    for (const e of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ed-tile';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(e === entry));
      b.title = `${e.label} (${e.kind})`;
      b.append(tileCanvas(e));
      const label = document.createElement('span');
      label.textContent = e.label;
      b.append(label);
      b.addEventListener('click', () => choose(e));
      grid.append(b);
    }
    sec.append(h, grid);
    parts.push(sec);
  }
  if (!parts.length) {
    const p = document.createElement('p');
    p.className = 'ed-empty';
    p.textContent = `Nichts gefunden für „${q}“.`;
    parts.push(p);
  }
  groupsEl.replaceChildren(...parts);
}

function choose(e: PaletteEntry): void {
  entry = e;
  if (tool === 'erase' || tool === 'select') setTool('paint');
  picking = false;
  for (const b of groupsEl.querySelectorAll<HTMLButtonElement>('.ed-tile')) b.setAttribute('aria-selected', String(b.title === `${e.label} (${e.kind})`));
  renderCurrent();
}

function setTool(t: Tool): void {
  tool = t;
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name=tool]')) r.checked = r.value === t;
  canvas.dataset.tool = t;
  if (t !== 'select') picking = false;
  renderCurrent();
}

/** "Malen mit": the current entry, and the Oxyd colour/look. */
function renderCurrent(): void {
  const head = document.createElement('div');
  head.className = 'ed-current-head';
  const label = document.createElement('div');
  if (tool === 'erase') label.innerHTML = '<strong>Radierer</strong><small>Entfernt Stein, Gegenstand und Gegner. Der Boden bleibt.</small>';
  else if (tool === 'select') label.innerHTML = '<strong>Auswahl</strong><small>Feld antippen, um Schalter mit Türen zu verbinden.</small>';
  else {
    head.append(tileCanvas(entry, 40));
    const s = document.createElement('strong');
    s.textContent = entry.label;
    const sm = document.createElement('small');
    sm.textContent = tool === 'rect' ? 'Rechteck ziehen zum Füllen' : 'Tippen oder ziehen · Umschalt+Ziehen = Rechteck';
    label.append(s, sm);
  }
  head.append(label);
  const parts: HTMLElement[] = [head];
  if (entry.layer === 'oxyd' && tool !== 'erase' && tool !== 'select') {
    parts.push(colorChooser('Farbe', oxydColor, true, (c) => ((oxydColor = c), renderPalette(), renderCurrent())));
    parts.push(flavorChooser(oxydFlavor, (f) => ((oxydFlavor = f), renderPalette(), renderCurrent())));
  }
  currentEl.replaceChildren(...parts);
}

function colorChooser(title: string, value: string, withAuto: boolean, onPick: (c: string) => void): HTMLElement {
  const box = document.createElement('fieldset');
  box.className = 'ed-colors';
  const lg = document.createElement('legend');
  lg.textContent = title;
  box.append(lg);
  const opts = [...(withAuto ? ['auto'] : []), ...OXYD_COLORS, '?'];
  for (const c of opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-color';
    b.setAttribute('aria-pressed', String(c === value));
    b.textContent = c === 'auto' ? 'Auto' : c === '?' ? 'Zufall' : c;
    b.setAttribute('aria-label', c === 'auto' ? 'Automatisch paarweise' : c === '?' ? 'Zufällige Farbe beim Start' : `Farbe ${c}`);
    if (c !== 'auto') b.style.setProperty('--sym', symbolColor(c));
    b.addEventListener('click', () => onPick(c));
    box.append(b);
  }
  return box;
}

function flavorChooser(value: string, onPick: (f: string) => void): HTMLElement {
  const lab = document.createElement('label');
  lab.className = 'ed-field';
  lab.textContent = 'Aussehen ';
  const sel = document.createElement('select');
  for (const f of OXYD_FLAVORS) sel.append(new Option(`Sorte ${f.toUpperCase()}`, f, false, f === value));
  sel.addEventListener('change', () => onPick(sel.value));
  lab.append(sel);
  return lab;
}

// ---------- selection: properties and connections ----------
function renderSelection(): void {
  const c = selected && cellOf(level, selected.x, selected.y);
  if (!selected || !c) {
    selectionEl.hidden = true;
    return;
  }
  const { x, y } = selected;
  const h = document.createElement('h3');
  h.textContent = `Feld ${x + 1}, ${y + 1}`;
  const parts: HTMLElement[] = [h];
  const rows: [string, string][] = [['Boden', BY_KIND.get(c.f)?.label ?? c.f]];
  if (c.s) rows.push(['Stein', c.s === 'st_oxyd' ? `Oxyd ${c.sa?.symbol === '?' ? 'Zufall' : c.sa?.symbol}` : (BY_KIND.get(c.s)?.label ?? c.s)]);
  if (c.i) rows.push(['Gegenstand', BY_KIND.get(c.i)?.label ?? c.i]);
  const actor = level.actors.find((a) => Math.floor(a.x) === x && Math.floor(a.y) === y);
  if (actor) rows.push(['Gegner', BY_KIND.get(actor.k)?.label ?? actor.k]);
  if (level.start?.x === x && level.start.y === y) rows.push(['Start', 'Murmel']);
  const dl = document.createElement('dl');
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  parts.push(dl);

  if (c.s === 'st_oxyd') {
    parts.push(colorChooser('Farbe', c.sa?.symbol ?? '?', false, (sym) => change(() => (c.sa = { ...(c.sa ?? {}), symbol: sym }))));
    parts.push(flavorChooser(c.sa?.flavor ?? 'b', (f) => change(() => (c.sa = { ...(c.sa ?? {}), flavor: f }))));
  }

  const src = sourceAt(level, x, y);
  if (src) {
    const tg = targets(level);
    const sel = document.createElement('select');
    sel.append(new Option('— kein Ziel —', '', false, !src.attrs.target));
    for (const t of tg) sel.append(new Option(`${t.name} (${t.x + 1}, ${t.y + 1})`, t.name, false, t.name === src.attrs.target));
    if (src.attrs.target && !tg.some((t) => t.name === src.attrs.target)) sel.append(new Option(`fehlt: ${src.attrs.target}`, src.attrs.target, false, true));
    sel.addEventListener('change', () => change(() => (sourceAt(level, x, y)!.attrs.target = sel.value)));
    parts.push(field('Ziel', sel));
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = picking ? 'Tippe auf eine Tür … (Esc bricht ab)' : 'Ziel auf der Karte wählen';
    pick.setAttribute('aria-pressed', String(picking));
    pick.disabled = tg.length === 0;
    pick.addEventListener('click', () => {
      picking = !picking;
      renderSelection();
    });
    parts.push(pick);
    if (!tg.length) parts.push(note('Setze zuerst eine Tür (Schalter und Türen).'));
    const act = document.createElement('select');
    for (const [v, label] of ACTIONS) act.append(new Option(label, v, false, (src.attrs.action ?? '') === v));
    act.addEventListener('change', () => change(() => (sourceAt(level, x, y)!.attrs.action = act.value)));
    parts.push(field('Aktion', act));
    if (src.entry.kind === 'st_timer') {
      const iv = document.createElement('select');
      for (const s of ['0.5', '1', '2', '3', '5', '10']) iv.append(new Option(`${s.replace('.', ',')} s`, s, false, (src.attrs.interval ?? '1') === s));
      iv.addEventListener('change', () => change(() => (sourceAt(level, x, y)!.attrs.interval = iv.value)));
      parts.push(field('Takt', iv));
    }
  }
  const tgt = targets(level).find((t) => t.x === x && t.y === y);
  if (tgt) {
    const from = sources(level).filter((s) => s.target === tgt.name);
    parts.push(note(from.length ? `Gesteuert von: ${from.map((s) => `${s.entry.label} (${s.x + 1}, ${s.y + 1})`).join(', ')}` : `Name ${tgt.name}. Noch kein Schalter verbunden.`));
  }
  selectionEl.replaceChildren(...parts);
  selectionEl.hidden = false;
}

function field(label: string, control: HTMLElement): HTMLElement {
  const l = document.createElement('label');
  l.className = 'ed-field';
  l.append(document.createTextNode(label + ' '), control);
  return l;
}

function note(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'ed-note';
  p.textContent = text;
  return p;
}

/** A change from the panels, with undo. */
function change(fn: () => void): void {
  const before = clone(level);
  fn();
  commit(before);
}

// ---------- checks ----------
function renderStatus(): void {
  const errors = problems.filter((p) => p.level === 'fehler');
  const h = document.createElement('h3');
  h.textContent = errors.length ? `${errors.length} ${errors.length === 1 ? 'Problem' : 'Probleme'} vor dem Teilen` : 'Bereit zum Teilen';
  h.className = errors.length ? 'bad' : 'good';
  const ul = document.createElement('ul');
  for (const p of problems) {
    const li = document.createElement('li');
    li.className = p.level;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ed-problem';
    b.textContent = `${p.level === 'fehler' ? 'Fehler' : 'Hinweis'}: ${p.text}`;
    b.disabled = !p.cells?.length;
    b.addEventListener('click', () => {
      marked = p.cells ?? [];
      draw();
    });
    li.append(b);
    ul.append(li);
  }
  statusEl.replaceChildren(h, ul);
}

// ---------- pointer ----------
function cellFrom(e: PointerEvent | MouseEvent): Cell | null {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / tile);
  const y = Math.floor((e.clientY - r.top) / tile);
  return cellOf(level, x, y) ? { x, y } : null;
}

function applyAt(c: Cell): boolean {
  if (tool === 'erase') return erase(level, c.x, c.y);
  return paint(level, c.x, c.y, entry, { oxydColor, oxydFlavor });
}

/** The cells on a straight line (fast drags skip no cell). */
function line(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 1; i <= n; i++) out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / n), y: Math.round(a.y + ((b.y - a.y) * i) / n) });
  return out;
}

/** Right click / Alt+click: take what lies in the cell as the palette entry. */
function pipette(c: Cell): void {
  const cell = cellOf(level, c.x, c.y)!;
  const actor = level.actors.find((a) => Math.floor(a.x) === c.x && Math.floor(a.y) === c.y);
  const kind = level.start?.x === c.x && level.start.y === c.y ? 'start' : (actor?.k ?? cell.s ?? cell.i ?? cell.f);
  const e = BY_KIND.get(kind);
  if (!e) return;
  if (e.layer === 'oxyd') {
    oxydColor = cell.sa?.symbol ?? 'auto';
    oxydFlavor = cell.sa?.flavor ?? 'b';
  }
  choose(e);
  toast(`Pipette: ${e.label}`, 1200);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const c = cellFrom(e);
  if (!c) return;
  e.preventDefault();
  if (e.button === 2 || e.altKey) return pipette(c);
  if (e.button !== 0) return;
  if (picking && selected) {
    const t = targets(level).find((t) => t.x === c.x && t.y === c.y);
    if (t) {
      const s = selected;
      change(() => (sourceAt(level, s.x, s.y)!.attrs.target = t.name));
      picking = false;
      renderSelection();
      toast(`Verbunden mit ${t.name}`, 1500);
    } else toast('Das ist keine Tür. Tippe auf eine Tür oder drücke Esc.', 2000);
    return;
  }
  if (tool === 'select') {
    selected = c;
    picking = false;
    marked = [];
    refresh();
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  const rect = tool === 'rect' || e.shiftKey ? { x0: c.x, y0: c.y, x1: c.x, y1: c.y } : null;
  drag = { before: clone(level), changed: false, last: c, rect, pointer: e.pointerId };
  if (!rect) drag.changed = applyAt(c);
  marked = [];
  draw();
});

canvas.addEventListener('pointermove', (e) => {
  const c = cellFrom(e);
  if (!drag) {
    if (c?.x !== hover?.x || c?.y !== hover?.y) {
      hover = e.pointerType === 'mouse' ? c : null;
      draw();
    }
    return;
  }
  if (!c || e.pointerId !== drag.pointer) return;
  if (drag.rect) {
    drag.rect.x1 = c.x;
    drag.rect.y1 = c.y;
  } else if (c.x !== drag.last.x || c.y !== drag.last.y) {
    // the marble and actors go to one cell: dragging moves them instead of painting a trail
    for (const p of entry.layer === 'start' && tool === 'paint' ? [c] : line(drag.last, c)) drag.changed = applyAt(p) || drag.changed;
  }
  drag.last = c;
  hover = c;
  draw();
});

function endDrag(e: PointerEvent): void {
  if (!drag || e.pointerId !== drag.pointer) return;
  const d = drag;
  drag = null;
  if (d.rect) {
    const { x0, y0, x1, y1 } = d.rect;
    if (entry.layer === 'start' && tool !== 'erase') d.changed = applyAt({ x: x1, y: y1 });
    else for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) d.changed = applyAt({ x, y }) || d.changed;
  }
  if (!d.changed) return draw();
  // a single connection source: select it, so the target can be chosen right away
  const placed = d.last;
  if (tool === 'paint' && !d.rect && entry.role === 'source' && sourceAt(level, placed.x, placed.y)) selected = placed;
  commit(d.before);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => {
  if (!drag && hover) {
    hover = null;
    draw();
  }
});

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !typing && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && !typing && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (e.key === 'Escape' && picking) {
    picking = false;
    renderSelection();
  } else if (!typing && !mod && !dialog.open) {
    const t = ({ b: 'paint', r: 'rect', e: 'erase', v: 'select' } as Record<string, Tool>)[e.key.toLowerCase()];
    if (t) setTool(t);
  }
});

// ---------- header ----------
function metaInput(input: HTMLInputElement, key: 'title' | 'author'): void {
  let before: EditorLevel | null = null;
  input.addEventListener('focus', () => (before = clone(level)));
  input.addEventListener('input', () => {
    level[key] = input.value;
    saveLevel(id, level);
    problems = check(level);
    renderStatus();
  });
  input.addEventListener('change', () => {
    if (before && before[key] !== level[key]) commit(before);
    before = clone(level);
  });
}
metaInput(titleIn, 'title');
metaInput(authorIn, 'author');

$('ed-undo').addEventListener('click', undo);
$('ed-redo').addEventListener('click', redo);
for (const r of document.querySelectorAll<HTMLInputElement>('input[name=tool]')) r.addEventListener('change', () => setTool(r.value as Tool));
$<HTMLInputElement>('ed-search').addEventListener('input', renderPalette);

// ---------- dialogs ----------
function showDialog(title: string, body: (HTMLElement | string)[], buttons: [string, () => void, string?][]): void {
  $('ed-dialog-title').textContent = title;
  $('ed-dialog-body').replaceChildren(...body.map((b) => (typeof b === 'string' ? note(b) : b)));
  $('ed-dialog-buttons').replaceChildren(
    ...buttons.map(([label, fn, cls]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      return b;
    }),
  );
  if (!dialog.open) dialog.showModal();
}
const close = () => dialog.close();
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) close(); // click on the backdrop
});

function button(label: string, fn: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', fn);
  return b;
}

function showLevelMenu(): void {
  const size = document.createElement('div');
  size.className = 'ed-size';
  const w = Object.assign(document.createElement('input'), { type: 'number', min: String(MIN_W), max: String(MAX_W), value: String(level.width), inputMode: 'numeric' });
  const h = Object.assign(document.createElement('input'), { type: 'number', min: String(MIN_H), max: String(MAX_H), value: String(level.height), inputMode: 'numeric' });
  size.append(
    field('Breite', w),
    field('Höhe', h),
    button('Größe ändern', () => {
      const before = clone(level);
      level = resize(level, Number(w.value), Number(h.value));
      if (selected && !cellOf(level, selected.x, selected.y)) selected = null;
      commit(before);
      layout();
      close();
    }),
  );
  const styleSel = document.createElement('select');
  for (const [s, label] of ED_STYLES) styleSel.append(new Option(label, s, false, s === style));
  styleSel.addEventListener('change', async () => {
    style = styleSel.value as EdStyle;
    try {
      localStorage.setItem('murmel.editor.style', JSON.stringify(style));
    } catch {
      /* ignore */
    }
    await loadImages(style);
    renderPalette();
    refresh();
  });
  showDialog(
    'Level',
    [
      size,
      note(`Inhalt bleibt oben links. ${MIN_W}–${MAX_W} × ${MIN_H}–${MAX_H} Felder.`),
      field('Stil der Vorschau', styleSel),
      note('Alles wird automatisch in diesem Browser gespeichert.'),
      note(LICENSE_NOTE),
    ],
    [
      ['Neues Level', () => (close(), open(newId(), newLevel()))],
      ['Meine Levels', showMyLevels],
      ['Exportieren', exportFile],
      ['Importieren', importFile],
      ['Fertig', close, 'primary'],
    ],
  );
}

function showMyLevels(): void {
  const list = listLevels();
  const ul = document.createElement('ul');
  ul.className = 'ed-levels';
  for (const s of list) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${s.file.title || 'Ohne Titel'}${s.id === id ? ' (geöffnet)' : ''}`;
    const when = document.createElement('small');
    when.textContent = new Date(s.updated).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
    const info = document.createElement('div');
    info.append(name, when);
    const openB = button('Öffnen', () => {
      const l = loadStored(s.id);
      if (!l) return toast('Dieses Level lässt sich nicht öffnen.');
      close();
      const h = loadHistory(s.id);
      open(s.id, l, History.from(h));
    });
    let armed = false;
    const del = button('Löschen', () => {
      if (!armed) {
        armed = true;
        del.textContent = 'Wirklich löschen?';
        del.classList.add('danger');
        return;
      }
      deleteLevel(s.id);
      if (s.id === id) open(newId(), newLevel());
      showMyLevels();
    });
    li.append(info, openB, del);
    ul.append(li);
  }
  showDialog('Meine Levels', list.length ? [ul] : ['Noch keine eigenen Levels.'], [
    ['Neues Level', () => (close(), open(newId(), newLevel()))],
    ['Fertig', close, 'primary'],
  ]);
}

const slug = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'level';

function exportFile(): void {
  const blob = new Blob([JSON.stringify(toLevelFile(level, id), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(level.title)}.murmel.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Gespeichert als ${a.download} (Lizenz CC BY-SA 4.0)`);
}

function importFile(): void {
  const pick = document.createElement('input');
  pick.type = 'file';
  pick.accept = '.json,application/json';
  pick.addEventListener('change', async () => {
    const f = pick.files?.[0];
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new LinkError('Die Datei ist zu groß.');
      let raw: unknown;
      try {
        raw = JSON.parse(await f.text());
      } catch {
        throw new LinkError('Das ist keine Level-Datei (kein JSON).');
      }
      const nid = newId();
      const { level: l, dropped } = fromLevelFile(sanitizeLevel(raw, nid));
      close();
      open(nid, l);
      toast(dropped.length ? `Importiert, ohne: ${dropped.join(', ')}` : `„${l.title || 'Level'}“ importiert.`);
    } catch (e) {
      toast(e instanceof LinkError ? e.message : 'Die Datei lässt sich nicht lesen.', 4000);
    }
  });
  pick.click();
}

// ---------- playtest and share ----------
const gameUrl = () => new URL('./', location.href);

async function playtest(): Promise<void> {
  const err = loadError(level);
  if (err) {
    showDialog('Noch nicht spielbar', [`Das Spiel kann das Level so nicht laden: ${err}`], [['OK', close, 'primary']]);
    return;
  }
  persist();
  const data = await encodeLevel(toLevelFile(level, id));
  location.assign(`${gameUrl().pathname}${LINK_PREFIX}${data}&edit`);
}

async function share(): Promise<void> {
  problems = check(level);
  if (!canShare(problems)) {
    const errors = problems.filter((p) => p.level === 'fehler');
    const ul = document.createElement('ul');
    for (const p of errors) {
      const li = document.createElement('li');
      li.textContent = p.text;
      ul.append(li);
    }
    marked = errors.flatMap((p) => p.cells ?? []);
    draw();
    showDialog('Vor dem Teilen beheben', [ul], [['OK', close, 'primary']]);
    return;
  }
  const data = await encodeLevel(toLevelFile(level, id));
  const kind = linkLength(data);
  if (kind === 'zu-lang') {
    showDialog('Level zu groß für einen Link', ['Exportiere es als Datei und teile die Datei.'], [['Exportieren', () => (exportFile(), close()), 'primary'], ['Abbrechen', close]]);
    return;
  }
  const url = `${gameUrl().href}${LINK_PREFIX}${data}`;
  const out = document.createElement('input');
  out.type = 'text';
  out.readOnly = true;
  out.value = url;
  out.className = 'ed-link';
  out.setAttribute('aria-label', 'Link zum Level');
  out.addEventListener('focus', () => out.select());
  const body: (HTMLElement | string)[] = [out, `${url.length} Zeichen.${kind === 'lang' ? ' Langer Link: manche Messenger kürzen ihn – im Zweifel als Datei teilen.' : ''}`, `${LICENSE_NOTE} Wer den Link hat, kann das Level spielen und im Editor öffnen.`];
  const buttons: [string, () => void, string?][] = [
    [
      'Link kopieren',
      async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast('Link kopiert.');
        } catch {
          out.focus();
          toast('Kopieren nicht erlaubt – Link ist markiert.');
        }
      },
      'primary',
    ],
  ];
  if (navigator.share) buttons.push(['Teilen …', () => void navigator.share({ title: `Murmel: ${level.title}`, url }).catch(() => {})]);
  buttons.push(['Ausprobieren', () => window.open(url, '_blank', 'noopener')], ['Schließen', close]);
  showDialog('Level teilen', body, buttons);
}

$('ed-menu').addEventListener('click', showLevelMenu);
$('ed-test').addEventListener('click', () => void playtest());
$('ed-share').addEventListener('click', () => void share());

// ---------- start ----------
new ResizeObserver(() => layout()).observe(stage);

async function start(): Promise<void> {
  await loadImages(style);
  renderPalette();
  setTool('paint');
  const data = linkData(location.hash);
  if (data !== null) {
    window.history.replaceState(null, '', location.pathname + location.search);
    try {
      const nid = newId();
      const { level: l, dropped } = fromLevelFile(await decodeLevel(data));
      open(nid, l);
      toast(`Geteiltes Level geöffnet und unter „Meine Levels“ gespeichert.${dropped.length ? ` Ohne: ${dropped.join(', ')}` : ''}`, 4000);
      return;
    } catch (e) {
      toast(e instanceof LinkError ? e.message : 'Der Level-Link ist beschädigt.', 4000);
    }
  }
  const cid = currentId();
  const stored = cid ? loadStored(cid) : null;
  if (cid && stored) open(cid, stored, History.from(loadHistory(cid)));
  else open(newId(), newLevel());
}
void start();
