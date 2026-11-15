// spielerlevels.html (docs/SPEC-spielerlevels.md): released levels with search and sorting, rating and
// reporting; "Meine Levels" for authors; "Freigabe" for admins. Uses the game's session cookie.
import { PHYSICS_DT } from './game/physics';
import { LICENSE_LABEL, type LevelStatus, ratingText, STATUS_TEXT } from './spielerlevels';
import { gebietsschema, seiteUebersetzen, sprachKnopf, sprachKopf, woerterbuch } from './i18n';
import EN from './i18n/en/spielerlevels-seite';
import EN_SEITE from './i18n/en/seite-spielerlevels';

// `t` is a level text in this file, so the translator is `tr`.
const tr = woerterbuch(EN);
seiteUebersetzen(EN_SEITE);
document.querySelector('nav.back .back-rechts')?.append(sprachKnopf('sprache'));

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
  /** Vorlage/Herkunft, shown as „Vorlage: …“; null without (docs/SPEC-enigma-upload.md). */
  vorlage?: string | null;
}
interface FullCard extends Card {
  status: LevelStatus;
  grund: string | null;
  zeit: number;
  meldungen: number;
  gesperrt: boolean;
  erstellt?: string;
  gruende?: string[];
  /** Admin review: every document text of the level (plain text). */
  texte?: { x: number; y: number; text: string }[];
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

const datum = (iso: string) => new Date(iso).toLocaleDateString(gebietsschema(), { day: 'numeric', month: 'short', year: 'numeric' });
/** Decimal separator of the page language (1:23,4 or 1:23.4). */
const KOMMA = (0.5).toLocaleString(gebietsschema()).charAt(1);
function zeit(steps: number): string {
  const t = Math.round(steps * PHYSICS_DT * 10);
  const s = Math.floor(t / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${KOMMA}${t % 10}`;
}
const status = (text: string) => ($('status').textContent = text);

async function api<T>(method: string, url: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; fehler: string; status: number }> {
  try {
    const res = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? sprachKopf() : { ...sprachKopf(), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: data as T };
    const msg = (data as { error?: string } | null)?.error;
    return { ok: false, status: res.status, fehler: res.status === 401 ? tr('Bitte melde dich zuerst im Spiel an.') : msg && res.status !== 404 ? msg : res.status === 404 ? msg ?? tr('Nicht gefunden.') : tr('Gerade nicht erreichbar.') };
  } catch {
    return { ok: false, status: 0, fehler: tr('Spieler-Levels sind gerade nicht erreichbar. Spielen geht trotzdem.') };
  }
}

const playUrl = (id: number) => `./#spieler=${id}`;

/** Title, author, size, date, rating, origin of a converted Enigma level, description. */
function cardBody(c: Card, h: 'h2' | 'h3' = 'h2'): Node[] {
  const stars = el('span', { className: c.stimmen ? 'stars' : '' }, ratingText(c.sterne, c.stimmen));
  return [
    el(h, { textContent: c.titel }),
    el('p', { className: 'meta' }, tr('von {autor} · {breite}×{hoehe} · {datum} · ', { autor: c.autor, breite: c.breite, hoehe: c.hoehe, datum: datum(c.datum) }), stars),
    ...(c.vorlage ? [el('p', { className: 'meta vorlage', textContent: tr('Vorlage: {vorlage}', { vorlage: c.vorlage }) })] : []),
    ...(c.beschreibung ? [el('p', { className: 'desc', textContent: c.beschreibung })] : []),
  ];
}

const licence = () => el('p', { className: 'lic' }, tr('Lizenz {lizenz} – spielen, verändern und weitergeben mit Nennung des Autors.', { lizenz: LICENSE_LABEL }));

// ---------- Entdecken ----------

/** Rating and reporting open below the card. */
function publicCard(c: Card): HTMLLIElement {
  const li = el('li', { className: 'card', id: `level-${c.id}` });
  const panel = el('div', { className: 'panel', hidden: true });
  panel.setAttribute('aria-live', 'polite');
  const rateB = el('button', { type: 'button', textContent: tr('Bewerten') });
  const reportB = el('button', { type: 'button', textContent: tr('Melden') });
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
  li.append(...cardBody(c), licence(), el('div', { className: 'actions' }, el('a', { className: 'button primary', href: playUrl(c.id), textContent: tr('Spielen') }), rateB, reportB), panel);
  return li;
}

async function ratePanel(c: Card, panel: HTMLElement, li: HTMLElement): Promise<void> {
  panel.replaceChildren(el('p', { className: 'muted', textContent: tr('Lade …') }));
  if (!ich.angemeldet) return void panel.replaceChildren(el('p', {}, tr('Bewerten kann, wer angemeldet ist und das Level gelöst hat.'), ' ', el('a', { href: './#konto', textContent: tr('Anmelden') })));
  const d = await api<Detail>('GET', `/api/spielerlevels/${c.id}`);
  if (!d.ok) return void panel.replaceChildren(el('p', { textContent: d.fehler }));
  if (d.data.eigen) return void panel.replaceChildren(el('p', { textContent: tr('Eigene Levels kannst du nicht bewerten.') }));
  if (!d.data.darfBewerten) {
    return void panel.replaceChildren(el('p', {}, tr('Bewerten kannst du, sobald du das Level angemeldet gelöst hast (dein Lauf kommt dabei in die Bestenliste).'), ' ', el('a', { href: playUrl(c.id), textContent: tr('Jetzt spielen') })));
  }
  const row = el('div', { className: 'rate', role: 'group' });
  row.setAttribute('aria-label', tr('Sterne vergeben'));
  const msg = el('p', { className: 'muted' }, d.data.meineSterne ? tr('Deine Bewertung: {n} von 5.', { n: d.data.meineSterne }) : tr('Wie gut ist das Level? 1 = gar nicht, 5 = großartig.'));
  for (let n = 1; n <= 5; n++) {
    const b = el('button', { type: 'button', textContent: `${n} ★` });
    b.setAttribute('aria-label', tr('{n} von 5 Sternen', { n }));
    b.setAttribute('aria-pressed', String(d.data.meineSterne === n));
    b.addEventListener('click', async () => {
      const r = await api<{ sterne: number; stimmen: number; meineSterne: number }>('PUT', `/api/spielerlevels/${c.id}/bewertung`, { sterne: n });
      if (!r.ok) return void (msg.textContent = r.fehler);
      for (const x of row.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      msg.textContent = tr('Danke! Deine Bewertung: {n} von 5.', { n });
      c.sterne = r.data.sterne;
      c.stimmen = r.data.stimmen;
      li.querySelector('.meta')?.replaceWith(cardBody(c)[1]);
    });
    row.append(b);
  }
  panel.replaceChildren(msg, row);
}

function reportPanel(c: Card, panel: HTMLElement, li: HTMLElement): void {
  if (!ich.angemeldet) return void panel.replaceChildren(el('p', {}, tr('Melden kann, wer angemeldet ist.'), ' ', el('a', { href: './#konto', textContent: tr('Anmelden') })));
  const reason = el('textarea', { maxLength: 300, placeholder: tr('Was stimmt nicht? Zum Beispiel: beleidigender Titel, kopiertes Level …') });
  const label = el('label', { className: 'sr', htmlFor: `grund-${c.id}`, textContent: tr('Grund der Meldung') });
  reason.id = `grund-${c.id}`;
  const msg = el('p', { className: 'muted', textContent: tr('Ein gemeldetes Level ist sofort für alle ausgeblendet, bis ein Admin entscheidet.') });
  const send = el('button', { type: 'button', className: 'danger', textContent: tr('Melden') });
  send.addEventListener('click', async () => {
    if (reason.value.trim().length < 3) {
      msg.textContent = tr('Bitte nenne kurz den Grund (mindestens 3 Zeichen).');
      return reason.focus();
    }
    send.disabled = true;
    const r = await api('POST', `/api/spielerlevels/${c.id}/meldung`, { grund: reason.value });
    send.disabled = false;
    if (!r.ok) return void (msg.textContent = r.fehler);
    li.replaceChildren(el('p', { className: 'muted', textContent: tr('„{titel}“ ist gemeldet und ausgeblendet. Danke!', { titel: c.titel }) }));
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
    const empty = el('li', { className: 'card empty muted' }, q ? tr('Kein Level passt zu „{suche}“.', { suche: q }) : tr('Noch keine Spieler-Levels freigegeben.') + ' ', ...(q ? [] : [el('a', { href: 'editor.html', textContent: tr('Bau das erste!') })]));
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
    if (!d.ok) return void status(tr('Dieses Level ist nicht (mehr) in der Liste – vielleicht wurde es gemeldet oder zurückgezogen.'));
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
  if (c.status === 'abgelehnt' && c.grund) li.append(el('p', { className: 'reason' }, el('strong', { textContent: tr('Grund:') + ' ' }), c.grund));
  if (c.meldungen > 0) li.append(el('p', { className: 'reason', textContent: tr('Gemeldet – ausgeblendet, bis ein Admin entscheidet.') }));
  li.append(el('p', { className: 'lic', textContent: tr('Deine Lösung: {zeit}', { zeit: zeit(c.zeit) }) }));
  const actions = el('div', { className: 'actions' }, el('a', { className: 'button primary', href: playUrl(c.id), textContent: tr('Spielen') }));
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
    status(r.ok ? (s === 'wartet' ? tr('„{titel}“ wartet wieder auf Freigabe.', { titel: c.titel }) : tr('„{titel}“ ist zurückgezogen.', { titel: c.titel })) : r.fehler);
    return r.ok;
  };
  if (c.status === 'wartet' || c.status === 'frei') act(tr('Zurückziehen'), setStatus('zurueckgezogen'));
  if (c.status === 'zurueckgezogen') act(tr('Wieder einreichen'), setStatus('wartet'));
  act(
    tr('Löschen'),
    async () => {
      if (!confirm(tr('„{titel}“ endgültig löschen? Bewertungen und Bestenlisten-Einträge des Levels werden mit gelöscht.', { titel: c.titel }))) return false;
      const r = await api('DELETE', `/api/spielerlevels/${c.id}`);
      status(r.ok ? tr('„{titel}“ ist gelöscht.', { titel: c.titel }) : r.fehler);
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
    $('meine-liste').replaceChildren(el('li', { className: 'card empty' }, tr('Melde dich an, um deine Levels zu sehen.'), ' ', el('a', { href: './#konto', textContent: tr('Anmelden') })));
    return;
  }
  const r = await api<{ levels: FullCard[] }>('GET', '/api/spielerlevels/meine');
  if (!r.ok) return void status(r.fehler);
  if ($('status').textContent === tr('Lade …')) status('');
  const empty = el('li', { className: 'card empty muted' }, tr('Du hast noch kein Level veröffentlicht. Bau eins im'), ' ', el('a', { href: 'editor.html', textContent: tr('Editor') }), tr(', löse es im Probespiel und tippe auf „Veröffentlichen“.'));
  $('meine-liste').replaceChildren(...(r.data.levels.length ? r.data.levels.map(ownCard) : [empty]));
}

// ---------- Freigabe (admins) ----------

function reviewCard(c: FullCard, reported: boolean): HTMLLIElement {
  const li = el('li', { className: 'card' }, ...cardBody(c), el('span', { className: `chip ${c.status}`, textContent: STATUS_TEXT[c.status] }));
  if (c.gesperrt) li.append(el('p', { className: 'reason', textContent: tr('Der Autor ist gesperrt.') }));
  if (reported && c.gruende?.length) {
    li.append(el('p', { className: 'reason' }, el('strong', { textContent: c.gruende.length === 1 ? tr('Meldung:') + ' ' : tr('{n} Meldungen:', { n: c.gruende.length }) + ' ' }), c.gruende.join(' · ')));
  }
  li.append(el('p', { className: 'lic', textContent: tr('Lösung des Autors: {zeit} · eingereicht {datum}', { zeit: zeit(c.zeit), datum: datum(c.erstellt ?? c.datum) }) }));
  // everything the level will show as text, so it can be judged before release (always as text, never HTML)
  if (c.texte?.length) {
    const list = el('ol', { className: 'texte' }, ...c.texte.map((t) => el('li', {}, el('span', { className: 'pos', textContent: tr('Feld {x}, {y}:', { x: t.x + 1, y: t.y + 1 }) + ' ' }), t.text ? el('span', { textContent: t.text }) : el('em', { textContent: tr('ohne Text') }))));
    li.append(el('details', { className: 'texte', open: true }, el('summary', { textContent: tr('Texte im Level ({n})', { n: c.texte.length }) }), list));
  }
  const panel = el('div', { className: 'panel', hidden: true });
  const actions = el('div', { className: 'actions' }, el('a', { className: 'button', href: playUrl(c.id), target: '_blank', rel: 'noopener', textContent: tr('Probespielen') }));
  const run = async (b: HTMLButtonElement, fn: () => Promise<{ ok: boolean; fehler?: string }>, done: string) => {
    b.disabled = true;
    const r = await fn();
    b.disabled = false;
    status(r.ok ? done : (r.fehler ?? tr('Fehler')));
    if (r.ok) await loadReview();
  };
  const btn = (label: string, cls: string, on: (b: HTMLButtonElement) => void) => {
    const b = el('button', { type: 'button', className: cls, textContent: label });
    b.addEventListener('click', () => on(b));
    actions.append(b);
  };
  if (c.status !== 'frei') btn(tr('Freigeben'), 'primary', (b) => void run(b, () => api('PUT', `/api/admin/spielerlevels/${c.id}`, { entscheidung: 'frei' }), tr('„{titel}“ ist freigegeben.', { titel: c.titel })));
  if (reported) btn(tr('Meldungen verwerfen'), '', (b) => void run(b, () => api('DELETE', `/api/admin/spielerlevels/${c.id}/meldungen`), tr('Meldungen zu „{titel}“ verworfen – wieder sichtbar.', { titel: c.titel })));
  btn(tr('Ablehnen'), 'danger', () => {
    panel.hidden = false;
    const reason = el('textarea', { maxLength: 300, placeholder: tr('Grund für den Autor (Pflicht)') });
    reason.setAttribute('aria-label', tr('Grund der Ablehnung'));
    const send = el('button', { type: 'button', className: 'danger', textContent: tr('Ablehnen') });
    send.addEventListener('click', () => void run(send, () => api('PUT', `/api/admin/spielerlevels/${c.id}`, { entscheidung: 'abgelehnt', grund: reason.value }), tr('„{titel}“ ist abgelehnt.', { titel: c.titel })));
    panel.replaceChildren(reason, el('div', { className: 'actions' }, send));
    reason.focus();
  });
  btn(tr('Löschen'), 'danger', (b) => {
    if (confirm(tr('„{titel}“ endgültig löschen?', { titel: c.titel }))) void run(b, () => api('DELETE', `/api/spielerlevels/${c.id}`), tr('„{titel}“ ist gelöscht.', { titel: c.titel }));
  });
  li.append(actions, panel);
  return li;
}

async function loadReview(): Promise<void> {
  const r = await api<{ wartend: FullCard[]; gemeldet: FullCard[] }>('GET', '/api/admin/spielerlevels');
  if (!r.ok) return void status(r.fehler);
  const none = (t: string) => el('li', { className: 'card empty muted', textContent: t });
  $('wartend').replaceChildren(...(r.data.wartend.length ? r.data.wartend.map((c) => reviewCard(c, false)) : [none(tr('Nichts wartet auf Freigabe.'))]));
  $('gemeldet').replaceChildren(...(r.data.gemeldet.length ? r.data.gemeldet.map((c) => reviewCard(c, true)) : [none(tr('Keine offenen Meldungen.'))]));
  const n = r.data.wartend.length + r.data.gemeldet.length;
  const tab = document.querySelector('[data-view="freigabe"]')!;
  tab.querySelector('.count')?.remove();
  if (n) {
    const badge = el('span', { className: 'count', textContent: String(n) });
    badge.setAttribute('aria-label', tr('{n} offen', { n }));
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
  status(tr('Lade …'));
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
