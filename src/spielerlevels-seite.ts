// spielerlevels.html (docs/SPEC-spielerlevels.md): released levels with search and sorting, rating and
// reporting; "Meine Levels" for authors; "Freigabe" for admins. Uses the game's session cookie.
import { PHYSICS_DT } from './game/physics';
import { LICENSE_LABEL, type LevelStatus, ratingText, STATUS_TEXT } from './spielerlevels';

interface Card {
  id: number;
  titel: string;
  beschreibung: string;
  autor: string;
  datum: string;
  sterne: number | null;
  stimmen: number;
  breite: number;
  hoehe: number;
}
interface FullCard extends Card {
  status: LevelStatus;
  grund: string | null;
  zeit: number;
  meldungen: number;
  gesperrt: boolean;
  erstellt?: string;
  gruende?: string[];
}
interface Detail extends Card {
  eigen: boolean;
  admin: boolean;
  meineSterne: number | null;
  darfBewerten: boolean;
}

type View = 'alle' | 'meine' | 'freigabe';

const $ = (id: string) => document.getElementById(id)!;
const ich: { angemeldet: boolean; admin: boolean; gesperrt: boolean } = { angemeldet: false, admin: false, gesperrt: false };
let sort: 'neu' | 'beliebt' = 'neu';
let page = 1;
let target: number | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
function zeit(steps: number): string {
  const t = Math.round(steps * PHYSICS_DT * 10);
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')},${t % 10}`;
}
const status = (text: string) => ($('status').textContent = text);

async function api<T>(method: string, url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; fehler: string; status: number }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    const msg = (data as { error?: string } | null)?.error;
    return { ok: false, status: res.status, fehler: res.status === 401 ? 'Bitte melde dich zuerst im Spiel an.' : msg && res.status !== 404 ? msg : res.status === 404 ? msg ?? 'Nicht gefunden.' : 'Gerade nicht erreichbar.' };
  } catch {
    return { ok: false, status: 0, fehler: 'Spieler-Levels sind gerade nicht erreichbar. Spielen geht trotzdem.' };
  }
}

const playUrl = (id: number) => `./#spieler=${id}`;

/** Title, author, size, date, rating, description, licence. */
function cardBody(c: Card, h: 'h2' | 'h3' = 'h2'): Node[] {
  const stars = el('span', { className: c.stimmen ? 'stars' : '' }, ratingText(c.sterne, c.stimmen));
  return [
    el(h, { textContent: c.titel }),
    el('p', { className: 'meta' }, `von ${c.autor} · ${c.breite}×${c.hoehe} · ${datum(c.datum)} · `, stars),
    ...(c.beschreibung ? [el('p', { className: 'desc', textContent: c.beschreibung })] : []),
  ];
}

const licence = () => el('p', { className: 'lic' }, `Lizenz ${LICENSE_LABEL} – spielen, verändern und weitergeben mit Nennung des Autors.`);

// ---------- Entdecken ----------

/** Rating and reporting open below the card. */
function publicCard(c: Card): HTMLLIElement {
  const li = el('li', { className: 'card', id: `level-${c.id}` });
  const panel = el('div', { className: 'panel', hidden: true });
  panel.setAttribute('aria-live', 'polite');
  const rateB = el('button', { type: 'button', textContent: 'Bewerten' });
  const reportB = el('button', { type: 'button', textContent: 'Melden' });
  rateB.setAttribute('aria-expanded', 'false');
  reportB.setAttribute('aria-expanded', 'false');
  const toggle = (b: HTMLButtonElement, fill: () => Promise<void> | void) => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    for (const x of [rateB, reportB]) x.setAttribute('aria-expanded', 'false');
    panel.hidden = !open;
    if (!open) return;
    b.setAttribute('aria-expanded', 'true');
    void fill();
  };
  rateB.addEventListener('click', () => toggle(rateB, () => ratePanel(c, panel, li)));
  reportB.addEventListener('click', () => toggle(reportB, () => reportPanel(c, panel, li)));
  li.append(...cardBody(c), licence(), el('div', { className: 'actions' }, el('a', { className: 'button primary', href: playUrl(c.id), textContent: 'Spielen' }), rateB, reportB), panel);
  return li;
}

async function ratePanel(c: Card, panel: HTMLElement, li: HTMLElement): Promise<void> {
  panel.replaceChildren(el('p', { className: 'muted', textContent: 'Lade …' }));
  if (!ich.angemeldet) return void panel.replaceChildren(el('p', {}, 'Bewerten kann, wer angemeldet ist und das Level gelöst hat. ', el('a', { href: './#konto', textContent: 'Anmelden' })));
  const d = await api<Detail>('GET', `/api/spielerlevels/${c.id}`);
  if (!d.ok) return void panel.replaceChildren(el('p', { textContent: d.fehler }));
  if (d.data.eigen) return void panel.replaceChildren(el('p', { textContent: 'Eigene Levels kannst du nicht bewerten.' }));
  if (!d.data.darfBewerten) {
    return void panel.replaceChildren(el('p', {}, 'Bewerten kannst du, sobald du das Level angemeldet gelöst hast (dein Lauf kommt dabei in die Bestenliste). ', el('a', { href: playUrl(c.id), textContent: 'Jetzt spielen' })));
  }
  const row = el('div', { className: 'rate', role: 'group' });
  row.setAttribute('aria-label', 'Sterne vergeben');
  const msg = el('p', { className: 'muted' }, d.data.meineSterne ? `Deine Bewertung: ${d.data.meineSterne} von 5.` : 'Wie gut ist das Level? 1 = gar nicht, 5 = großartig.');
  for (let n = 1; n <= 5; n++) {
    const b = el('button', { type: 'button', textContent: `${n} ★` });
    b.setAttribute('aria-label', `${n} von 5 Sternen`);
    b.setAttribute('aria-pressed', String(d.data.meineSterne === n));
    b.addEventListener('click', async () => {
      const r = await api<{ sterne: number; stimmen: number; meineSterne: number }>('PUT', `/api/spielerlevels/${c.id}/bewertung`, { sterne: n });
      if (!r.ok) return void (msg.textContent = r.fehler);
      for (const x of row.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      msg.textContent = `Danke! Deine Bewertung: ${n} von 5.`;
      c.sterne = r.data.sterne;
      c.stimmen = r.data.stimmen;
      li.querySelector('.meta')?.replaceWith(cardBody(c)[1]);
    });
    row.append(b);
  }
  panel.replaceChildren(msg, row);
}

function reportPanel(c: Card, panel: HTMLElement, li: HTMLElement): void {
  if (!ich.angemeldet) return void panel.replaceChildren(el('p', {}, 'Melden kann, wer angemeldet ist. ', el('a', { href: './#konto', textContent: 'Anmelden' })));
  const reason = el('textarea', { maxLength: 300, placeholder: 'Was stimmt nicht? Zum Beispiel: beleidigender Titel, kopiertes Level …' });
  const label = el('label', { className: 'sr', htmlFor: `grund-${c.id}`, textContent: 'Grund der Meldung' });
  reason.id = `grund-${c.id}`;
  const msg = el('p', { className: 'muted', textContent: 'Ein gemeldetes Level ist sofort für alle ausgeblendet, bis ein Admin entscheidet.' });
  const send = el('button', { type: 'button', className: 'danger', textContent: 'Melden' });
  send.addEventListener('click', async () => {
    if (reason.value.trim().length < 3) {
      msg.textContent = 'Bitte nenne kurz den Grund (mindestens 3 Zeichen).';
      return reason.focus();
    }
    send.disabled = true;
    const r = await api('POST', `/api/spielerlevels/${c.id}/meldung`, { grund: reason.value });
    send.disabled = false;
    if (!r.ok) return void (msg.textContent = r.fehler);
    li.replaceChildren(el('p', { className: 'muted', textContent: `„${c.titel}“ ist gemeldet und ausgeblendet. Danke!` }));
  });
  panel.replaceChildren(msg, label, reason, el('div', { className: 'actions' }, send));
  reason.focus();
}

async function loadList(reset = true): Promise<void> {
  if (reset) page = 1;
  const q = ($('suche') as HTMLInputElement).value.trim();
  const r = await api<{ levels: Card[]; mehr: boolean }>('GET', `/api/spielerlevels?${new URLSearchParams({ sort, seite: String(page), ...(q ? { suche: q } : {}) })}`);
  if (!r.ok) return void status(r.fehler);
  status('');
  const items = r.data.levels.map(publicCard);
  const list = $('liste');
  if (reset) {
    const empty = el('li', { className: 'card empty muted' }, q ? `Kein Level passt zu „${q}“.` : 'Noch keine Spieler-Levels freigegeben. ', ...(q ? [] : [el('a', { href: 'editor.html', textContent: 'Bau das erste!' })]));
    list.replaceChildren(...(items.length ? items : [empty]));
  } else list.append(...items);
  ($('mehr') as HTMLButtonElement).hidden = !r.data.mehr;
  if (target !== null) await showTarget(target);
}

/** '#level-<id>': that level at the top with its rating panel (from the game's "Bewerten"). */
async function showTarget(id: number): Promise<void> {
  target = null;
  let li = document.getElementById(`level-${id}`) as HTMLLIElement | null;
  if (!li) {
    const d = await api<Detail>('GET', `/api/spielerlevels/${id}`);
    if (!d.ok) return void status('Dieses Level ist nicht (mehr) in der Liste – vielleicht wurde es gemeldet oder zurückgezogen.');
    li = publicCard(d.data);
    $('liste').prepend(li);
  }
  li.classList.add('target');
  li.scrollIntoView({ block: 'center' });
  (li.querySelector('.actions button') as HTMLButtonElement | null)?.click();
}

// ---------- Meine Levels ----------

function ownCard(c: FullCard): HTMLLIElement {
  const li = el('li', { className: 'card' }, ...cardBody(c), el('span', { className: `chip ${c.status}`, textContent: STATUS_TEXT[c.status] }));
  if (c.status === 'abgelehnt' && c.grund) li.append(el('p', { className: 'reason' }, el('strong', { textContent: 'Grund: ' }), c.grund));
  if (c.meldungen > 0) li.append(el('p', { className: 'reason', textContent: 'Gemeldet – ausgeblendet, bis ein Admin entscheidet.' }));
  li.append(el('p', { className: 'lic', textContent: `Deine Lösung: ${zeit(c.zeit)}` }));
  const actions = el('div', { className: 'actions' }, el('a', { className: 'button primary', href: playUrl(c.id), textContent: 'Spielen' }));
  const act = (label: string, run: () => Promise<boolean>, cls = '') => {
    const b = el('button', { type: 'button', className: cls, textContent: label });
    b.addEventListener('click', async () => {
      b.disabled = true;
      if (await run()) await loadMine();
      b.disabled = false;
    });
    actions.append(b);
  };
  const setStatus = (s: 'zurueckgezogen' | 'wartet') => async () => {
    const r = await api('PUT', `/api/spielerlevels/${c.id}/status`, { status: s });
    status(r.ok ? (s === 'wartet' ? `„${c.titel}“ wartet wieder auf Freigabe.` : `„${c.titel}“ ist zurückgezogen.`) : r.fehler);
    return r.ok;
  };
  if (c.status === 'wartet' || c.status === 'frei') act('Zurückziehen', setStatus('zurueckgezogen'));
  if (c.status === 'zurueckgezogen') act('Wieder einreichen', setStatus('wartet'));
  act(
    'Löschen',
    async () => {
      if (!confirm(`„${c.titel}“ endgültig löschen? Bewertungen und Bestenlisten-Einträge des Levels werden mit gelöscht.`)) return false;
      const r = await api('DELETE', `/api/spielerlevels/${c.id}`);
      status(r.ok ? `„${c.titel}“ ist gelöscht.` : r.fehler);
      return r.ok;
    },
    'danger',
  );
  li.append(actions);
  return li;
}

async function loadMine(): Promise<void> {
  if (!ich.angemeldet) {
    status('');
    $('meine-liste').replaceChildren(el('li', { className: 'card empty' }, 'Melde dich an, um deine Levels zu sehen. ', el('a', { href: './#konto', textContent: 'Anmelden' })));
    return;
  }
  const r = await api<{ levels: FullCard[] }>('GET', '/api/spielerlevels/meine');
  if (!r.ok) return void status(r.fehler);
  if ($('status').textContent === 'Lade …') status('');
  const empty = el('li', { className: 'card empty muted' }, 'Du hast noch kein Level veröffentlicht. Bau eins im ', el('a', { href: 'editor.html', textContent: 'Editor' }), ', löse es im Probespiel und tippe auf „Veröffentlichen“.');
  $('meine-liste').replaceChildren(...(r.data.levels.length ? r.data.levels.map(ownCard) : [empty]));
}

// ---------- Freigabe (admins) ----------

function reviewCard(c: FullCard, reported: boolean): HTMLLIElement {
  const li = el('li', { className: 'card' }, ...cardBody(c), el('span', { className: `chip ${c.status}`, textContent: STATUS_TEXT[c.status] }));
  if (c.gesperrt) li.append(el('p', { className: 'reason', textContent: 'Der Autor ist gesperrt.' }));
  if (reported && c.gruende?.length) {
    li.append(el('p', { className: 'reason' }, el('strong', { textContent: `${c.gruende.length === 1 ? 'Meldung' : `${c.gruende.length} Meldungen`}: ` }), c.gruende.join(' · ')));
  }
  li.append(el('p', { className: 'lic', textContent: `Lösung des Autors: ${zeit(c.zeit)} · eingereicht ${datum(c.erstellt ?? c.datum)}` }));
  const panel = el('div', { className: 'panel', hidden: true });
  const actions = el('div', { className: 'actions' }, el('a', { className: 'button', href: playUrl(c.id), target: '_blank', rel: 'noopener', textContent: 'Probespielen' }));
  const run = async (b: HTMLButtonElement, fn: () => Promise<{ ok: boolean; fehler?: string }>, done: string) => {
    b.disabled = true;
    const r = await fn();
    b.disabled = false;
    status(r.ok ? done : (r.fehler ?? 'Fehler'));
    if (r.ok) await loadReview();
  };
  const btn = (label: string, cls: string, on: (b: HTMLButtonElement) => void) => {
    const b = el('button', { type: 'button', className: cls, textContent: label });
    b.addEventListener('click', () => on(b));
    actions.append(b);
  };
  if (c.status !== 'frei') btn('Freigeben', 'primary', (b) => void run(b, () => api('PUT', `/api/admin/spielerlevels/${c.id}`, { entscheidung: 'frei' }), `„${c.titel}“ ist freigegeben.`));
  if (reported) btn('Meldungen verwerfen', '', (b) => void run(b, () => api('DELETE', `/api/admin/spielerlevels/${c.id}/meldungen`), `Meldungen zu „${c.titel}“ verworfen – wieder sichtbar.`));
  btn('Ablehnen', 'danger', () => {
    panel.hidden = false;
    const reason = el('textarea', { maxLength: 300, placeholder: 'Grund für den Autor (Pflicht)' });
    reason.setAttribute('aria-label', 'Grund der Ablehnung');
    const send = el('button', { type: 'button', className: 'danger', textContent: 'Ablehnen' });
    send.addEventListener('click', () => void run(send, () => api('PUT', `/api/admin/spielerlevels/${c.id}`, { entscheidung: 'abgelehnt', grund: reason.value }), `„${c.titel}“ ist abgelehnt.`));
    panel.replaceChildren(reason, el('div', { className: 'actions' }, send));
    reason.focus();
  });
  btn('Löschen', 'danger', (b) => {
    if (confirm(`„${c.titel}“ endgültig löschen?`)) void run(b, () => api('DELETE', `/api/spielerlevels/${c.id}`), `„${c.titel}“ ist gelöscht.`);
  });
  li.append(actions, panel);
  return li;
}

async function loadReview(): Promise<void> {
  const r = await api<{ wartend: FullCard[]; gemeldet: FullCard[] }>('GET', '/api/admin/spielerlevels');
  if (!r.ok) return void status(r.fehler);
  const none = (t: string) => el('li', { className: 'card empty muted', textContent: t });
  $('wartend').replaceChildren(...(r.data.wartend.length ? r.data.wartend.map((c) => reviewCard(c, false)) : [none('Nichts wartet auf Freigabe.')]));
  $('gemeldet').replaceChildren(...(r.data.gemeldet.length ? r.data.gemeldet.map((c) => reviewCard(c, true)) : [none('Keine offenen Meldungen.')]));
  const n = r.data.wartend.length + r.data.gemeldet.length;
  const tab = document.querySelector('[data-view="freigabe"]')!;
  tab.querySelector('.count')?.remove();
  if (n) {
    const badge = el('span', { className: 'count', textContent: String(n) });
    badge.setAttribute('aria-label', `${n} offen`);
    tab.append(badge);
  }
}

// ---------- views ----------

function viewFromHash(): View {
  const h = location.hash;
  const m = /^#level-([1-9][0-9]{0,15})$/.exec(h);
  if (m) target = Number(m[1]);
  if (h === '#meine') return 'meine';
  if (h === '#freigabe' && ich.admin) return 'freigabe';
  return 'alle';
}

async function show(): Promise<void> {
  const v = viewFromHash();
  for (const a of document.querySelectorAll<HTMLAnchorElement>('#views a')) {
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  for (const id of ['alle', 'meine', 'freigabe'] as const) $(id).hidden = id !== v;
  status('Lade …');
  if (v === 'alle') await loadList();
  else if (v === 'meine') await loadMine();
  else {
    status('');
    await loadReview();
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
$('suche').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => void loadList(), 250);
});
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sort]')) {
  b.addEventListener('click', () => {
    sort = b.dataset.sort as typeof sort;
    for (const x of document.querySelectorAll('[data-sort]')) x.setAttribute('aria-pressed', String(x === b));
    void loadList();
  });
}
$('mehr').addEventListener('click', () => {
  page++;
  void loadList(false);
});
window.addEventListener('hashchange', () => void show());

const konto = await api<{ angemeldet: boolean; admin?: boolean; gesperrt?: boolean }>('GET', '/api/forum/ich');
if (konto.ok) Object.assign(ich, { angemeldet: konto.data.angemeldet, admin: !!konto.data.admin, gesperrt: !!konto.data.gesperrt });
($('views').querySelector('[data-view="freigabe"]') as HTMLElement).hidden = !ich.admin;
await show();
if (ich.admin && viewFromHash() !== 'freigabe') void loadReview();
