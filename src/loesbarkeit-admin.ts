// loesbarkeit.html (docs/SPEC-loesbarkeit.md): results of the nightly run for admins. Uses the session
// cookie of the game (same address); without an admin account the page says how to sign in.
import { gebietsschema, seiteUebersetzen, sprachKnopf, sprachKopf, woerterbuch } from './i18n';
import EN from './i18n/en/loesbarkeit';
import EN_SEITE from './i18n/en/seite-loesbarkeit';

seiteUebersetzen(EN_SEITE);
const t = woerterbuch(EN);
document.getElementById('sprache')?.replaceWith(sprachKnopf('sprache'));

interface Run {
  id: number;
  finishedAt: string;
  startedAt: string;
  version: string;
  levels: number;
  probeOk: number;
  probeLua: number;
  probeFailed: number;
  solutions: number;
  solved: number;
  unsolved: number;
  failed: number;
  solvedLevels: number;
  newFailures: number;
  error: string | null;
}
interface Result {
  level: string;
  kind: 'probe' | 'solution';
  ref: string;
  status: 'ok' | 'lua' | 'fehler' | 'geloest' | 'nicht-geloest';
  steps: number | null;
  recordedSteps: number | null;
  levelChanged: boolean;
  isNew: boolean;
  error: string | null;
}
interface Solution {
  id: number;
  level: string;
  levelHash: string | null;
  steps: number;
  createdAt: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $('status');
const fmt = new Intl.NumberFormat(gebietsschema());
const when = new Intl.DateTimeFormat(gebietsschema(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const day = new Intl.DateTimeFormat(gebietsschema(), { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
const STATUS: Record<Result['status'], string> = { ok: t('ok'), lua: t('Lua-Fehler'), fehler: t('Fehler'), geloest: t('gelöst'), 'nicht-geloest': t('nicht gelöst') };
const PHYSICS_DT = 0.0025;

let problems: Result[] = [];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  try {
    const res = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init, headers: { ...sprachKopf(), ...(init?.headers as Record<string, string> | undefined) } });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 };
  }
}

function showError(status: number): void {
  $('result').hidden = true;
  statusEl.replaceChildren();
  if (status === 401) {
    statusEl.append(`${t('Nur für angemeldete Admins. Im Spiel unter „Konto“ anmelden, dann hier neu laden.')} `);
    const a = el('a', t('Zum Spiel'));
    a.href = './';
    statusEl.append(a);
  } else if (status === 403) statusEl.textContent = t('Dieses Konto ist kein Admin. Admins stehen auf dem Server in ADMIN_EMAILS.');
  else statusEl.textContent = t('Der Server antwortet gerade nicht. Später noch einmal versuchen.');
}

const statusCell = (r: Result): HTMLTableCellElement => {
  const bad = r.status === 'fehler' || r.status === 'nicht-geloest';
  const td = el('td', STATUS[r.status], bad ? 's-bad' : r.status === 'geloest' || r.status === 'ok' ? 's-good' : '');
  if (r.isNew) td.append(el('span', t('neu'), 'tag'));
  return td;
};
const what = (r: Result) => {
  if (r.kind === 'probe') return t('Ladeprobe');
  const db = /^db:(.*)$/.exec(r.ref);
  if (db) return t('Lösung gespeichert #{id}', { id: db[1] });
  return t('Lösung {ref}', { ref: r.ref.replace(/^repo:/, 'Repo: ') });
};
const note = (r: Result) =>
  [r.levelChanged ? t('Level seit der Aufnahme geändert') : '', r.error ?? '', r.status === 'geloest' && r.recordedSteps !== null && r.steps !== r.recordedSteps ? t('{n} statt {m} Schritte', { n: r.steps ?? 0, m: r.recordedSteps }) : '']
    .filter(Boolean)
    .join(' · ');

function levelButton(level: string): HTMLButtonElement {
  const b = el('button', level, 'link');
  b.type = 'button';
  b.addEventListener('click', () => void showLevel(level));
  return b;
}

function renderSummary(run: Run | null, history: Run[], stored: number): void {
  if (!run) {
    $('run').textContent = t('Noch kein Nachtlauf. Der erste läuft um 04:15 Uhr.');
    return;
  }
  const mins = Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60_000));
  $('run').textContent =
    t('Letzter Lauf {wann} · Stand {version} · {min} min', { wann: when.format(new Date(run.finishedAt)), version: run.version, min: mins }) +
    (run.error ? t(' · gescheitert: {fehler}', { fehler: run.error }) : '');
  const tile = (id: string, value: string, small: string, bad = false) => {
    const box = $(id);
    box.querySelector('b')!.textContent = value;
    box.querySelector('small')!.textContent = small;
    box.classList.toggle('bad', bad);
  };
  tile('t-levels', fmt.format(run.probeOk + run.probeLua), t('von {n} · {fehler} Fehler, {lua} Lua-Fehler', { n: fmt.format(run.levels), fehler: fmt.format(run.probeFailed), lua: fmt.format(run.probeLua) }));
  tile('t-solved', fmt.format(run.solvedLevels), t('{p} % der Levels geprüft', { p: Math.round((run.solvedLevels / Math.max(1, run.levels)) * 100) }));
  tile('t-solutions', fmt.format(run.solved), t('von {n} · davon {stored} gespeichert', { n: fmt.format(run.solutions), stored: fmt.format(stored) }));
  tile('t-new', fmt.format(run.newFailures), run.newFailures ? t('seit dem Lauf davor') : t('nichts Neues'), run.newFailures > 0);

  const runs = [...history].reverse();
  $('history').replaceChildren(
    ...runs.map((r) => {
      const li = el('li');
      const share = r.solutions ? r.solved / r.solutions : 1;
      const col = el('div', '', `col${r.newFailures || r.error ? ' bad' : ''}`);
      col.style.height = `${Math.max(4, share * 100)}%`;
      const label =
        t('{wann}: {n} von {m} Lösungen gewinnen, {fehler} Ladefehler', { wann: when.format(new Date(r.finishedAt)), n: r.solved, m: r.solutions, fehler: r.probeFailed }) +
        (r.newFailures ? t(', {n} neu kaputt', { n: r.newFailures }) : '') +
        (r.error ? t(', Lauf gescheitert') : '');
      li.title = label;
      li.setAttribute('aria-label', label);
      li.append(col);
      return li;
    }),
  );
  $('h-first').textContent = runs.length ? day.format(new Date(runs[0].finishedAt)) : '';
  $('h-last').textContent = runs.length > 1 ? day.format(new Date(runs[runs.length - 1].finishedAt)) : '';
}

function renderProblems(): void {
  const q = $<HTMLInputElement>('filter').value.trim().toLowerCase();
  const rows = problems.filter((r) => !q || r.level.toLowerCase().includes(q));
  const body = $('problems');
  body.replaceChildren(
    ...rows.map((r) => {
      const tr = el('tr');
      const lv = el('td');
      lv.append(levelButton(r.level));
      tr.append(lv, el('td', what(r)), statusCell(r), el('td', note(r), 'note'));
      return tr;
    }),
  );
  if (!rows.length) {
    const td = el('td', q ? t('Keine Probleme bei diesen Levels.') : t('Keine Probleme – alle Levels laden, alle Lösungen gewinnen.'), 'muted');
    td.colSpan = 4;
    const tr = el('tr');
    tr.append(td);
    body.append(tr);
  }
}

async function showLevel(level: string): Promise<void> {
  const r = await api<{ verlauf: (Result & { runId: number; finishedAt: string; version: string })[] }>(`loesbarkeit/level?id=${encodeURIComponent(level)}`);
  if (!r.ok) return showError(r.status);
  $('level-title').textContent = t('Verlauf: {level}', { level });
  const body = $('level-rows');
  body.replaceChildren(
    ...r.data.verlauf.map((h) => {
      const tr = el('tr');
      tr.append(el('td', `${when.format(new Date(h.finishedAt))} · ${h.version}`), el('td', what(h)), statusCell(h), el('td', h.steps === null ? '–' : fmt.format(h.steps), 'num'), el('td', note(h), 'note'));
      return tr;
    }),
  );
  if (!r.data.verlauf.length) {
    const td = el('td', t('Zu diesem Level gibt es in den letzten Läufen kein Ergebnis.'), 'muted');
    td.colSpan = 5;
    const tr = el('tr');
    tr.append(td);
    body.append(tr);
  }
  const section = $('level');
  section.hidden = false;
  section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function renderSolutions(list: Solution[]): void {
  const body = $('solutions');
  body.replaceChildren(
    ...list.map((s) => {
      const tr = el('tr');
      const lv = el('td');
      lv.append(levelButton(s.level));
      const actions = el('td');
      const dl = el('a', t('Herunterladen'), 'button');
      dl.href = `/api/admin/loesungen/${s.id}`;
      dl.setAttribute('download', '');
      const del = el('button', t('Löschen'), 'danger');
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm(t('Lösung #{id} für {level} löschen? Das lässt sich nicht rückgängig machen.', { id: s.id, level: s.level }))) return;
        const r = await api<{ ok: true }>(`loesungen/${s.id}`, { method: 'DELETE' });
        if (r.ok) void load();
        else statusEl.textContent = t('Löschen hat nicht geklappt. Später noch einmal versuchen.');
      });
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.append(dl, del);
      const secs = Math.round(s.steps * PHYSICS_DT);
      tr.append(lv, el('td', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 'num'), el('td', when.format(new Date(s.createdAt))), actions);
      return tr;
    }),
  );
  if (!list.length) {
    const td = el('td', t('Noch keine. Nach einem Sieg im Spiel erscheint für Admins „Als Lösung speichern“.'), 'muted');
    td.colSpan = 4;
    const tr = el('tr');
    tr.append(td);
    body.append(tr);
  }
}

async function load(): Promise<void> {
  const [o, s] = await Promise.all([
    api<{ lauf: Run | null; verlauf: Run[]; probleme: Result[]; loesungen: number }>('loesbarkeit'),
    api<{ loesungen: Solution[] }>('loesungen'),
  ]);
  if (!o.ok) return showError(o.status);
  if (!s.ok) return showError(s.status);
  problems = o.data.probleme;
  renderSummary(o.data.lauf, o.data.verlauf, o.data.loesungen);
  renderProblems();
  renderSolutions(s.data.loesungen);
  statusEl.textContent = '';
  $('result').hidden = false;
}

const filter = $<HTMLInputElement>('filter');
filter.addEventListener('input', renderProblems);
filter.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && filter.value.trim()) void showLevel(filter.value.trim());
});
void load();

export {};
