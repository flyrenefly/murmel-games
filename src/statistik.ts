// statistik.html: reads GET /api/statistik with the token from /opt/murmel/.env (STATS_TOKEN), or as a
// signed-in admin without it; admins also see the section „Konten“ (GET /api/admin/konten).
// The token stays in this browser only (sessionStorage) and is sent as a bearer header.
// The section „Wo Spieler hängen“ reads GET /api/statistik/auswertung with the same rights.
// The section „Herkunft“ reads GET /api/statistik/herkunft with the same rights.
import { type LevelCounts, paketQuoten, schwersteLevels } from './auswertung-seite';
import { gebietsschema, seiteUebersetzen, sprachKnopf, sprachKopf, woerterbuch } from './i18n';
import EN from './i18n/en/statistik';
import EN_SEITE from './i18n/en/seite-statistik';

seiteUebersetzen(EN_SEITE);
const t = woerterbuch(EN);
document.getElementById('sprache')?.replaceWith(sprachKnopf('sprache'));
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

const fmt = new Intl.NumberFormat(gebietsschema());
const dayFmt = new Intl.DateTimeFormat(gebietsschema(), { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });

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
      value.textContent = t('{spieler} Spieler · {starts} Starts', { spieler: fmt.format(d.players), starts: fmt.format(d.starts) });
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
    td.textContent = t('In diesem Zeitraum wurde noch kein Level gestartet.');
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
    const res = await fetch(`/api/admin/konten?tage=${count}`, { headers: sprachKopf(), cache: 'no-store' });
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
      td.textContent = t('In diesem Zeitraum gab es weder neue Konten noch Anmeldungen.');
      tr.append(td);
      body.append(tr);
    }
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}

const pct = new Intl.NumberFormat(gebietsschema(), { style: 'percent', maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat(gebietsschema(), { maximumFractionDigits: 1 });

/** One table row of texts; or one muted row spanning the table when there is nothing to show. */
function rows(body: HTMLElement, cols: number, lines: string[][], empty: string): void {
  body.replaceChildren(
    ...lines.map((cells) => {
      const tr = document.createElement('tr');
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      return tr;
    }),
  );
  if (!lines.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols;
    td.className = 'muted';
    td.textContent = empty;
    tr.append(td);
    body.append(tr);
  }
}

/** Section „Wo Spieler hängen“ (docs/SPEC-auswertung.md): hidden unless the server answers. */
async function loadAuswertung(count: number, headers: Record<string, string>): Promise<void> {
  const section = $<HTMLElement>('auswertung');
  try {
    const res = await fetch(`/api/statistik/auswertung?tage=${count}`, { headers, cache: 'no-store' });
    if (!res.ok) {
      section.hidden = true;
      return;
    }
    const { levels } = (await res.json()) as { levels: LevelCounts[] };
    rows(
      $('a-levels'),
      9,
      schwersteLevels(levels).map((l) => [l.level, l.pack, fmt.format(l.laeufe), pct.format(l.geloest), dec.format(l.neustartsJeLauf), fmt.format(l.abbrueche), dec.format(l.abstuerzeJeLauf), fmt.format(l.wegGezeigt), l.typischeZeit ? t(l.typischeZeit) : '–']),
      t('Noch kein Level mit mindestens 5 beendeten Läufen in diesem Zeitraum.'),
    );
    rows(
      $('a-packs'),
      4,
      paketQuoten(levels).map((p) => [p.pack, fmt.format(p.laeufe), pct.format(p.geloest), pct.format(p.abbruch)]),
      t('In diesem Zeitraum wurde noch kein Lauf beendet.'),
    );
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}

interface Zusammenfassung {
  besucher: number;
  domains: { domain: string; anzahl: number }[];
  andere: { domains: number; anzahl: number };
  /** Visits with a campaign but without a foreign referrer. */
  ohneDomain: number;
  /** Per campaign mark `?von=` (allow list or „sonstige“). */
  kampagnen: { von: string; anzahl: number }[];
}

/** Section „Herkunft“ (docs/SPEC-herkunft.md): hidden unless the server answers. Rare domains arrive only as a sum. */
async function loadHerkunft(count: number, headers: Record<string, string>): Promise<void> {
  const section = $<HTMLElement>('herkunft');
  try {
    const res = await fetch(`/api/statistik/herkunft?tage=${count}`, { headers, cache: 'no-store' });
    if (!res.ok) {
      section.hidden = true;
      return;
    }
    const { tage, gesamt } = (await res.json()) as { tage: (Zusammenfassung & { day: string })[]; gesamt: Zusammenfassung };
    const leer = t('In diesem Zeitraum kam noch niemand von einer fremden Seite.');
    const gesamtZeilen = gesamt.domains.map((d) => [d.domain, fmt.format(d.anzahl)]);
    if (gesamt.andere.anzahl) gesamtZeilen.push([t('andere (Domains: {n})', { n: fmt.format(gesamt.andere.domains) }), fmt.format(gesamt.andere.anzahl)]);
    if (gesamt.ohneDomain) gesamtZeilen.push([t('ohne fremde Seite (nur Kampagne)'), fmt.format(gesamt.ohneDomain)]);
    rows($('h-gesamt'), 2, gesamtZeilen, leer);
    rows(
      $('h-kampagnen'),
      2,
      gesamt.kampagnen.map((k) => [k.von, fmt.format(k.anzahl)]),
      t('In diesem Zeitraum kam niemand über einen Kampagnen-Link (?von=).'),
    );
    const liste = (xs: { name: string; anzahl: number }[]) => xs.map((x) => `${x.name} ${fmt.format(x.anzahl)}`).join(' · ') || '–';
    rows(
      $('h-tage'),
      4,
      tage.map((d) => {
        const teile = d.domains.map((x) => ({ name: x.domain, anzahl: x.anzahl }));
        if (d.andere.anzahl) teile.push({ name: t('andere'), anzahl: d.andere.anzahl });
        if (d.ohneDomain) teile.push({ name: t('ohne'), anzahl: d.ohneDomain });
        return [dayFmt.format(new Date(`${d.day}T00:00:00Z`)), fmt.format(d.besucher), liste(teile), liste(d.kampagnen.map((k) => ({ name: k.von, anzahl: k.anzahl })))];
      }),
      leer,
    );
    for (const td of $('h-tage').querySelectorAll('td:nth-child(n+3)')) td.classList.add('text');
    section.hidden = false;
  } catch {
    section.hidden = true;
  }
}

/** Loads the statistics: with the token from the form, or without it for a signed-in admin (cookie). */
async function load(quiet = false): Promise<void> {
  const token = tokenInput.value.trim();
  const count = Number(range.value);
  if (!quiet) statusEl.textContent = t('Lade …');
  try {
    const headers: Record<string, string> = { ...sprachKopf(), ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await fetch(`/api/statistik?tage=${count}`, { headers, cache: 'no-store' });
    if (res.status === 401) {
      statusEl.textContent = token
        ? t('Der Zugangsschlüssel stimmt nicht. Er steht auf dem Server in /opt/murmel/.env unter STATS_TOKEN.')
        : t('Nicht als Admin angemeldet. Melde dich im Spiel unter „Konto“ an, dann erscheint die Statistik ohne Schlüssel – oder gib den Zugangsschlüssel ein.');
      result.hidden = true;
      return;
    }
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { days: StatDay[]; levels: StatLevel[] };
    // signed in as admin: no key needed
    if (!token) form.hidden = true;
    void loadAccounts(count);
    void loadAuswertung(count, headers);
    void loadHerkunft(count, headers);
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
    statusEl.textContent = t('Der Server antwortet gerade nicht. Später noch einmal versuchen.');
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
