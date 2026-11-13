// loesbarkeit.html (docs/SPEC-loesbarkeit.md): results of the nightly run for admins. Uses the session
// cookie of the game (same address); without an admin account the page says how to sign in.
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
const fmt = new Intl.NumberFormat('de-DE');
const when = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const day = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Berlin' });
const STATUS: Record<Result['status'], string> = { ok: 'ok', lua: 'Lua-Fehler', fehler: 'Fehler', geloest: 'gelöst', 'nicht-geloest': 'nicht gelöst' };
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
    const res = await fetch(`/api/admin/${path}`, { credentials: 'same-origin', cache: 'no-store', ...init });
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
    statusEl.append('Nur für angemeldete Admins. Im Spiel unter „Konto“ anmelden, dann hier neu laden. ');
    const a = el('a', 'Zum Spiel');
    a.href = './';
    statusEl.append(a);
  } else if (status === 403) statusEl.textContent = 'Dieses Konto ist kein Admin. Admins stehen auf dem Server in ADMIN_EMAILS.';
  else statusEl.textContent = 'Der Server antwortet gerade nicht. Später noch einmal versuchen.';
}

const statusCell = (r: Result): HTMLTableCellElement => {
  const bad = r.status === 'fehler' || r.status === 'nicht-geloest';
  const td = el('td', STATUS[r.status], bad ? 's-bad' : r.status === 'geloest' || r.status === 'ok' ? 's-good' : '');
  if (r.isNew) td.append(el('span', 'neu', 'tag'));
  return td;
};
const what = (r: Result) => (r.kind === 'probe' ? 'Ladeprobe' : `Lösung ${r.ref.replace(/^repo:/, 'Repo: ').replace(/^db:/, 'gespeichert #')}`);
const note = (r: Result) =>
  [r.levelChanged ? 'Level seit der Aufnahme geändert' : '', r.error ?? '', r.status === 'geloest' && r.recordedSteps !== null && r.steps !== r.recordedSteps ? `${r.steps} statt ${r.recordedSteps} Schritte` : '']
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
    $('run').textContent = 'Noch kein Nachtlauf. Der erste läuft um 04:15 Uhr.';
    return;
  }
  const mins = Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60_000));
  $('run').textContent = `Letzter Lauf ${when.format(new Date(run.finishedAt))} · Stand ${run.version} · ${mins} min${run.error ? ` · gescheitert: ${run.error}` : ''}`;
  const tile = (id: string, value: string, small: string, bad = false) => {
    const t = $(id);
    t.querySelector('b')!.textContent = value;
    t.querySelector('small')!.textContent = small;
    t.classList.toggle('bad', bad);
  };
  tile('t-levels', fmt.format(run.probeOk + run.probeLua), `von ${fmt.format(run.levels)} · ${run.probeFailed} Fehler, ${run.probeLua} Lua-Fehler`);
  tile('t-solved', fmt.format(run.solvedLevels), `${Math.round((run.solvedLevels / Math.max(1, run.levels)) * 100)} % der Levels geprüft`);
  tile('t-solutions', fmt.format(run.solved), `von ${fmt.format(run.solutions)} · davon ${stored} gespeichert`);
  tile('t-new', fmt.format(run.newFailures), run.newFailures ? 'seit dem Lauf davor' : 'nichts Neues', run.newFailures > 0);

  const runs = [...history].reverse();
  $('history').replaceChildren(
    ...runs.map((r) => {
      const li = el('li');
      const share = r.solutions ? r.solved / r.solutions : 1;
      const col = el('div', '', `col${r.newFailures || r.error ? ' bad' : ''}`);
      col.style.height = `${Math.max(4, share * 100)}%`;
      const label = `${when.format(new Date(r.finishedAt))}: ${r.solved} von ${r.solutions} Lösungen gewinnen, ${r.probeFailed} Ladefehler${r.newFailures ? `, ${r.newFailures} neu kaputt` : ''}${r.error ? ', Lauf gescheitert' : ''}`;
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
    const td = el('td', q ? 'Keine Probleme bei diesen Levels.' : 'Keine Probleme – alle Levels laden, alle Lösungen gewinnen.', 'muted');
    td.colSpan = 4;
    const tr = el('tr');
    tr.append(td);
    body.append(tr);
  }
}

async function showLevel(level: string): Promise<void> {
  const r = await api<{ verlauf: (Result & { runId: number; finishedAt: string; version: string })[] }>(`loesbarkeit/level?id=${encodeURIComponent(level)}`);
  if (!r.ok) return showError(r.status);
  $('level-title').textContent = `Verlauf: ${level}`;
  const body = $('level-rows');
  body.replaceChildren(
    ...r.data.verlauf.map((h) => {
      const tr = el('tr');
      tr.append(el('td', `${when.format(new Date(h.finishedAt))} · ${h.version}`), el('td', what(h)), statusCell(h), el('td', h.steps === null ? '–' : fmt.format(h.steps), 'num'), el('td', note(h), 'note'));
      return tr;
    }),
  );
  if (!r.data.verlauf.length) {
    const td = el('td', 'Zu diesem Level gibt es in den letzten Läufen kein Ergebnis.', 'muted');
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
      const dl = el('a', 'Herunterladen', 'button');
      dl.href = `/api/admin/loesungen/${s.id}`;
      dl.setAttribute('download', '');
      const del = el('button', 'Löschen', 'danger');
      del.type = 'button';
      del.addEventListener('click', async () => {
        if (!confirm(`Lösung #${s.id} für ${s.level} löschen? Das lässt sich nicht rückgängig machen.`)) return;
        const r = await api<{ ok: true }>(`loesungen/${s.id}`, { method: 'DELETE' });
        if (r.ok) void load();
        else statusEl.textContent = 'Löschen hat nicht geklappt. Später noch einmal versuchen.';
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
    const td = el('td', 'Noch keine. Nach einem Sieg im Spiel erscheint für Admins „Als Lösung speichern“.', 'muted');
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
