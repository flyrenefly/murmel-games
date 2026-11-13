// statistik.html: reads GET /api/statistik with the token from /opt/murmel/.env (STATS_TOKEN), or as a
// signed-in admin without it; admins also see the section „Konten“ (GET /api/admin/konten).
// The token stays in this browser only (sessionStorage) and is sent as a bearer header.
interface StatDay {
  day: string;
  players: number;
  starts: number;
  solved: number;
}
interface StatLevel {
  level: string;
  starts: number;
  solved: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('login');
const tokenInput = $<HTMLInputElement>('token');
const range = $<HTMLSelectElement>('range');
const statusEl = $<HTMLParagraphElement>('status');
const result = $<HTMLElement>('result');

const fmt = new Intl.NumberFormat('de-DE');
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

try {
  tokenInput.value = sessionStorage.getItem('murmel-stats-token') ?? '';
} catch {
  // private mode: just ask again
}

/** Every day of the range, also those without a single event. */
function fillDays(days: StatDay[], count: number): StatDay[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const last = days.length ? new Date(`${days[days.length - 1].day}T00:00:00Z`) : new Date();
  const today = new Date(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date())}T00:00:00Z`);
  const end = today > last ? today : last;
  const out: StatDay[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, players: 0, starts: 0, solved: 0 });
  }
  return out;
}

function render(daysIn: StatDay[], levels: StatLevel[], count: number): void {
  const days = fillDays(daysIn, count);
  const sum = (k: 'players' | 'starts' | 'solved') => days.reduce((n, d) => n + d[k], 0);
  $('today').textContent = fmt.format(days[days.length - 1]?.players ?? 0);
  $('avg').textContent = fmt.format(Math.round((sum('players') / days.length) * 10) / 10);
  $('starts').textContent = fmt.format(sum('starts'));
  $('solved').textContent = fmt.format(sum('solved'));

  const max = Math.max(1, ...days.map((d) => d.players));
  const chart = $('chart');
  chart.replaceChildren(
    ...[...days].reverse().map((d) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'listitem');
      const label = document.createElement('span');
      label.className = 'muted';
      label.textContent = dayFmt.format(new Date(`${d.day}T00:00:00Z`));
      const track = document.createElement('div');
      track.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'fill';
      fill.style.width = `${(d.players / max) * 80}%`;
      const value = document.createElement('span');
      value.textContent = `${fmt.format(d.players)} Spieler · ${fmt.format(d.starts)} Starts`;
      track.append(fill, value);
      row.append(label, track);
      return row;
    }),
  );

  const body = $('levels');
  body.replaceChildren(
    ...levels.map((l) => {
      const tr = document.createElement('tr');
      for (const text of [l.level, fmt.format(l.starts), fmt.format(l.solved)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
  if (!levels.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'muted';
    td.textContent = 'In diesem Zeitraum wurde noch kein Level gestartet.';
    tr.append(td);
    body.append(tr);
  }
}

interface AccountStats {
  accounts: number;
  admins: number;
  passkeys: number;
  blocked: number;
  created: { day: string; count: number }[];
  signIns: { day: string; signIns: number; accounts: number }[];
}

/** Section „Konten“: only for admins (GET /api/admin/konten answers 401/403 to everyone else). */
async function loadAccounts(count: number): Promise<void> {
  const section = $<HTMLElement>('konten');
  try {
    const res = await fetch(`/api/admin/konten?tage=${count}`, { cache: 'no-store' });
    if (!res.ok) {
      section.hidden = true;
      return;
    }
    const k = (await res.json()) as AccountStats;
    const created = new Map(k.created.map((d) => [d.day, d.count]));
    const signIns = new Map(k.signIns.map((d) => [d.day, d]));
    $('k-total').textContent = fmt.format(k.accounts);
    $('k-new').textContent = fmt.format(k.created.reduce((n, d) => n + d.count, 0));
    $('k-signins').textContent = fmt.format(k.signIns.reduce((n, d) => n + d.signIns, 0));
    $('k-misc').textContent = `${fmt.format(k.admins)} · ${fmt.format(k.passkeys)} · ${fmt.format(k.blocked)}`;
    // only days with activity, newest first
    const days = [...new Set([...created.keys(), ...signIns.keys()])].sort().reverse();
    const body = $('k-days');
    body.replaceChildren(
      ...days.map((day) => {
        const tr = document.createElement('tr');
        const s = signIns.get(day);
        for (const text of [dayFmt.format(new Date(`${day}T00:00:00Z`)), fmt.format(created.get(day) ?? 0), fmt.format(s?.signIns ?? 0), fmt.format(s?.accounts ?? 0)]) {
          const td = document.createElement('td');
          td.textContent = text;
          tr.append(td);
        }
        return tr;
      }),
    );
    if (!days.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'muted';
      td.textContent = 'In diesem Zeitraum gab es weder neue Konten noch Anmeldungen.';
      tr.append(td);
      body.append(tr);
    }
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}

/** Loads the statistics: with the token from the form, or without it for a signed-in admin (cookie). */
async function load(quiet = false): Promise<void> {
  const token = tokenInput.value.trim();
  const count = Number(range.value);
  if (!quiet) statusEl.textContent = 'Lade …';
  try {
    const res = await fetch(`/api/statistik?tage=${count}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
    if (res.status === 401) {
      if (!quiet) statusEl.textContent = 'Der Zugangsschlüssel stimmt nicht. Er steht auf dem Server in /opt/murmel/.env unter STATS_TOKEN.';
      result.hidden = true;
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { days: StatDay[]; levels: StatLevel[] };
    // signed in as admin: no key needed
    if (!token) form.hidden = true;
    void loadAccounts(count);
    if (token) {
      try {
        sessionStorage.setItem('murmel-stats-token', token);
      } catch {
        // not stored, still shown
      }
    }
    render(data.days, data.levels, count);
    statusEl.textContent = '';
    result.hidden = false;
  } catch {
    statusEl.textContent = 'Der Server antwortet gerade nicht. Später noch einmal versuchen.';
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  void load();
});
range.addEventListener('change', () => {
  void load(!tokenInput.value);
});
// With a stored key load right away; otherwise try quietly as a signed-in admin.
void load(!tokenInput.value);
