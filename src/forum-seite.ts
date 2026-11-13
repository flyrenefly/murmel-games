// Forum page (forum.html): talks to /api/forum (server/src/forum.ts). Reading works without an
// account; writing needs one. All user text goes into the page via textContent, links are built as
// <a rel="nofollow ugc noopener">. Admin buttons only show for admins; the server checks again.
import { KATEGORIEN, type Kategorie, route, STATUS, type Status, textTeile, wann } from './forum-text';

interface Ich {
  angemeldet: boolean;
  name?: string | null;
  admin?: boolean;
  gesperrt?: boolean;
}
interface Thema {
  id: number;
  kategorie: Kategorie;
  status: Status;
  titel: string;
  autor: string;
  team: boolean;
  level: string | null;
  version: string | null;
  erstellt: string;
  letzte: string;
  antworten: number;
  stimmen: number;
  gestimmt: boolean;
  ausgeblendet?: boolean;
}
interface Beitrag {
  id: number;
  autor: string;
  team: boolean;
  erster: boolean;
  text: string | null;
  ausgeblendet: boolean;
  erstellt: string;
  eigen: boolean;
  kontoId?: number;
  gesperrt?: boolean;
}
interface Meldung extends Beitrag {
  themaId: number;
  thema: string;
  anzahl: number;
  gruende: string[];
}

type Antwort<T> = { ok: true; daten: T } | { ok: false; fehler: string; status: number; name?: boolean };

const OFFLINE = 'Das Forum ist gerade nicht erreichbar. Bitte versuch es später noch einmal.';

async function api<T>(method: string, path: string, body?: unknown): Promise<Antwort<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/forum${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, fehler: OFFLINE, status: 0 };
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no JSON: no API behind this address */
  }
  if (res.ok && data !== null) return { ok: true, daten: data as T };
  const d = data as { error?: unknown; name?: boolean } | null;
  if (typeof d?.error !== 'string') return { ok: false, fehler: OFFLINE, status: res.status };
  return { ok: false, fehler: d.error, status: res.status, name: d.name === true };
}

// ---------- DOM helpers ----------

type Kind = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { aria?: Record<string, string> } = {}, ...children: Kind[]): HTMLElementTagNameMap[K] {
  const { aria, ...rest } = props;
  const e = Object.assign(document.createElement(tag), rest);
  for (const [k, v] of Object.entries(aria ?? {})) e.setAttribute(k, v);
  e.append(...children.filter((c): c is Node | string => c !== null && c !== false && c !== undefined));
  return e;
}
function knopf(label: string, onClick: () => void | Promise<void>, className = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label, className });
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await onClick();
    } finally {
      b.disabled = false;
    }
  });
  return b;
}
const chip = (text: string, cls: string) => el('span', { className: `chip ${cls}`, textContent: text });
const statusChip = (s: Status) => chip(STATUS[s], s);

/** Post text: plain text, web addresses as links that search engines do not follow. */
function textKnoten(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const t of textTeile(text)) {
    if ('link' in t) f.append(el('a', { href: t.link, rel: 'nofollow ugc noopener', target: '_blank', textContent: t.link }));
    else f.append(t.text);
  }
  return f;
}

const daumen = () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', 'M7 10v11H3V10h4Zm2 11V10l4.4-7.2a1.6 1.6 0 0 1 2.9 1.2L15.5 9H20a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 18.7 21H9Z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
};

// ---------- state ----------

const view = document.getElementById('view')!;
const ichBox = document.getElementById('ich')!;
let ich: Ich = { angemeldet: false };
const filter = {
  kategorie: '' as Kategorie | '',
  status: '' as Status | '',
  sort: 'neu' as 'neu' | 'stimmen',
};
try {
  Object.assign(filter, JSON.parse(sessionStorage.getItem('forumFilter') ?? '{}'));
} catch {
  /* private mode: defaults */
}
const merkeFilter = () => {
  try {
    sessionStorage.setItem('forumFilter', JSON.stringify(filter));
  } catch {
    /* ignore */
  }
};

const kannSchreiben = () => ich.angemeldet && !ich.gesperrt;
const meldung = (text: string, fehler = false) => el('p', { className: `msg${fehler ? ' error' : ''}`, textContent: text, role: fehler ? 'alert' : 'status' });

async function ichLaden(): Promise<void> {
  const r = await api<Ich>('GET', '/ich');
  ich = r.ok ? r.daten : { angemeldet: false };
  ichZeigen();
}

function ichZeigen(): void {
  if (!ich.angemeldet) {
    ichBox.replaceChildren(el('a', { href: './#konto', textContent: 'Anmelden' }));
  } else {
    ichBox.replaceChildren(el('span', {}, ich.name ? `Als ${ich.name}` : 'Angemeldet'));
    if (ich.admin) ichBox.append(chip('Admin', 'team'), el('a', { href: '#meldungen', textContent: 'Meldungen' }));
  }
}

/** Why writing is not possible, with the way to change it; null when it is. */
function schreibHinweis(): HTMLElement | null {
  if (!ich.angemeldet) {
    return el('p', { className: 'msg' }, 'Zum Schreiben brauchst du ein Konto. ', el('a', { href: './#konto', textContent: 'Im Spiel anmelden' }), ', danach diese Seite neu laden.');
  }
  if (ich.gesperrt) return meldung('Dein Konto ist für das Forum gesperrt. Lesen geht weiter, schreiben nicht.');
  return null;
}

/** Form to pick the display name; calls done() once it is set. */
function nameFormular(done: () => void, grund = 'Im Forum steht dein Anzeigename, nie deine Mailadresse.'): HTMLElement {
  const input = el('input', { id: 'name', aria: { autocomplete: 'nickname' }, maxLength: 24, minLength: 3, required: true, value: ich.name ?? '' });
  const msg = el('p', { className: 'msg error', role: 'alert' });
  const form = el(
    'form',
    { className: 'card' },
    el('h3', { textContent: ich.name ? 'Anzeigename ändern' : 'Anzeigename wählen' }),
    el('p', { className: 'muted small', textContent: grund }),
    el('label', { htmlFor: 'name', textContent: 'Anzeigename' }),
    input,
    el('p', { className: 'hint', textContent: '3 bis 24 Zeichen: Buchstaben, Ziffern, Leerzeichen, Punkt, Strich.' }),
    msg,
    el('div', { className: 'buttons' }, el('button', { type: 'submit', className: 'primary', textContent: 'Namen speichern' })),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api<{ name: string }>('PUT', '/name', { name: input.value });
    if (!r.ok) {
      msg.textContent = r.fehler;
      input.focus();
      return;
    }
    ich.name = r.daten.name;
    ichZeigen();
    done();
  });
  return form;
}

// ---------- list ----------

let seite = 1;

async function liste(): Promise<void> {
  document.title = 'Forum – Murmel';
  const kopf = el(
    'div',
    {},
    el('h1', { textContent: 'Forum' }),
    el('p', { className: 'muted', textContent: 'Fehler, Wünsche, Fragen und Levels rund um Murmel. Lesen kann jeder, schreiben mit Konto.' }),
  );
  const seg = el('div', { className: 'segmented', role: 'group', aria: { 'aria-label': 'Kategorie' } });
  for (const [k, label] of [['', 'Alle'], ...Object.entries(KATEGORIEN)] as [Kategorie | '', string][]) {
    const b = el('button', { type: 'button', textContent: label, aria: { 'aria-pressed': String(filter.kategorie === k) } });
    b.addEventListener('click', () => {
      filter.kategorie = k;
      seite = 1;
      merkeFilter();
      void liste();
    });
    seg.append(b);
  }
  const statusSel = el('select', { aria: { 'aria-label': 'Status' } }, el('option', { value: '', textContent: 'Jeder Status' }), ...Object.entries(STATUS).map(([v, t]) => el('option', { value: v, textContent: t })));
  statusSel.value = filter.status;
  statusSel.addEventListener('change', () => {
    filter.status = statusSel.value as Status | '';
    seite = 1;
    merkeFilter();
    void liste();
  });
  const sortSel = el('select', { aria: { 'aria-label': 'Reihenfolge' } }, el('option', { value: 'neu', textContent: 'Neueste zuerst' }), el('option', { value: 'stimmen', textContent: 'Meiste Stimmen' }));
  sortSel.value = filter.sort;
  sortSel.addEventListener('change', () => {
    filter.sort = sortSel.value === 'stimmen' ? 'stimmen' : 'neu';
    seite = 1;
    merkeFilter();
    void liste();
  });
  const neu = knopf('Neues Thema', () => {
    location.hash = `neu?kategorie=${filter.kategorie || 'verbesserung'}`;
  }, 'primary');
  const toolbar = el('div', { className: 'toolbar' }, seg, statusSel, sortSel, el('span', { className: 'spacer' }), neu);

  const q = new URLSearchParams({ sort: filter.sort, seite: String(seite) });
  if (filter.kategorie) q.set('kategorie', filter.kategorie);
  if (filter.status) q.set('status', filter.status);
  const r = await api<{ themen: Thema[]; weitere: boolean; seite: number }>('GET', `/themen?${q}`);
  if (!r.ok) {
    view.replaceChildren(kopf, toolbar, meldung(r.fehler, true));
    return;
  }
  const now = new Date();
  const { themen, weitere } = r.daten;
  const body: HTMLElement =
    themen.length === 0
      ? el('div', { className: 'empty' }, el('p', { textContent: filter.kategorie || filter.status ? 'Hier gibt es noch keine Themen.' : 'Noch ist es still hier. Schreib das erste Thema!' }))
      : el(
          'ul',
          { className: 'list' },
          ...themen.map((t) =>
            el(
              'li',
              {},
              el(
                'a',
                { className: `row${t.ausgeblendet ? ' hidden-topic' : ''}`, href: `#thema/${t.id}` },
                el('b', {}, statusChip(t.status), t.ausgeblendet ? chip('Ausgeblendet', 'warn') : null, t.titel),
                el('span', { className: 'meta' }, `${KATEGORIEN[t.kategorie]} · ${t.autor}${t.team ? ' (Team)' : ''} · ${wann(t.letzte, now)} · ${t.antworten === 1 ? '1 Antwort' : `${t.antworten} Antworten`}`),
                el('span', { className: 'votes', aria: { 'aria-label': `${t.stimmen} Stimmen${t.gestimmt ? ', auch deine' : ''}` } }, daumen(), String(t.stimmen)),
              ),
            ),
          ),
        );
  const nav = el('div', { className: 'more' });
  if (seite > 1) nav.append(knopf('Neuere', () => { seite--; void liste(); }, 'link'));
  if (weitere) nav.append(knopf('Ältere Themen', () => { seite++; void liste(); }, 'link'));
  view.replaceChildren(kopf, toolbar, body, nav);
}

// ---------- topic ----------

async function thema(id: number, fokus?: 'antwort'): Promise<void> {
  const r = await api<{ thema: Thema; beitraege: Beitrag[] }>('GET', `/themen/${id}`);
  const zurueck = el('a', { href: '#', textContent: '‹ Alle Themen' });
  if (!r.ok) {
    view.replaceChildren(zurueck, meldung(r.fehler, true));
    return;
  }
  const { thema: t, beitraege } = r.daten;
  document.title = `${t.titel} – Forum – Murmel`;
  const now = new Date();

  const stimme = el('button', { type: 'button', className: 'vote', aria: { 'aria-pressed': String(t.gestimmt), 'aria-label': `Daumen hoch, ${t.stimmen} Stimmen` } }, daumen(), String(t.stimmen));
  stimme.disabled = !kannSchreiben();
  stimme.title = kannSchreiben() ? (t.gestimmt ? 'Stimme zurücknehmen' : 'Daumen hoch') : 'Zum Abstimmen anmelden';
  stimme.addEventListener('click', async () => {
    stimme.disabled = true;
    const v = await api<{ stimmen: number; gestimmt: boolean }>('POST', `/themen/${t.id}/stimme`, { an: !t.gestimmt });
    stimme.disabled = false;
    if (!v.ok) return void status.replaceChildren(meldung(v.fehler, true));
    t.gestimmt = v.daten.gestimmt;
    t.stimmen = v.daten.stimmen;
    stimme.setAttribute('aria-pressed', String(t.gestimmt));
    stimme.setAttribute('aria-label', `Daumen hoch, ${t.stimmen} Stimmen`);
    stimme.title = t.gestimmt ? 'Stimme zurücknehmen' : 'Daumen hoch';
    stimme.replaceChildren(daumen(), String(t.stimmen));
  });

  const status = el('div', {});
  const bar = el('div', { className: 'topic-bar' }, stimme);
  if (ich.admin) {
    const sel = el('select', { aria: { 'aria-label': 'Status setzen' } }, ...Object.entries(STATUS).map(([v, s]) => el('option', { value: v, textContent: s })));
    sel.value = t.status;
    sel.addEventListener('change', async () => {
      const s = await api('PUT', `/themen/${t.id}/status`, { status: sel.value });
      if (!s.ok) status.replaceChildren(meldung(s.fehler, true));
      else void thema(t.id);
    });
    bar.append(el('div', { className: 'admin' }, el('span', { className: 'small muted', textContent: 'Admin: Status' }), sel));
  }

  const facts = el(
    'div',
    { className: 'facts' },
    el('span', {}, `${KATEGORIEN[t.kategorie]} · von ${t.autor} · ${wann(t.erstellt, now)}`),
    t.level ? el('span', {}, 'Level ', el('code', { textContent: t.level })) : null,
    t.version ? el('span', {}, 'Version ', el('code', { textContent: t.version })) : null,
  );

  const posts = beitraege.map((b) => beitragKarte(b, t, now, status));
  view.replaceChildren(
    zurueck,
    el('h2', {}, statusChip(t.status), t.ausgeblendet ? chip('Ausgeblendet', 'warn') : null, t.titel),
    facts,
    bar,
    status,
    ...posts,
    antwortBereich(t, fokus),
  );
  if (!fokus) window.scrollTo({ top: 0 });
}

function beitragKarte(b: Beitrag, t: Thema, now: Date, status: HTMLElement): HTMLElement {
  const actions = el('div', { className: 'actions' });
  if (kannSchreiben() && !b.eigen) {
    actions.append(knopf('Melden', () => melden(b, actions), 'link'));
  }
  if (b.eigen) {
    actions.append(
      knopf(b.erster ? 'Thema löschen' : 'Löschen', async () => {
        const frage = b.erster ? 'Das ganze Thema mit allen Antworten löschen? Das lässt sich nicht rückgängig machen.' : 'Diesen Beitrag löschen? Das lässt sich nicht rückgängig machen.';
        if (!confirm(frage)) return;
        const r = await api<{ thema: boolean }>('DELETE', `/beitraege/${b.id}`);
        if (!r.ok) return void status.replaceChildren(meldung(r.fehler, true));
        if (r.daten.thema) location.hash = '';
        else void thema(t.id);
      }, 'link danger'),
    );
  }
  if (ich.admin) {
    actions.append(
      knopf(b.ausgeblendet ? 'Einblenden' : 'Ausblenden', async () => {
        const r = await api('PUT', `/beitraege/${b.id}/ausgeblendet`, { ausgeblendet: !b.ausgeblendet });
        if (!r.ok) return void status.replaceChildren(meldung(r.fehler, true));
        void thema(t.id);
      }, 'link'),
    );
    if (b.kontoId !== undefined && !b.team) {
      actions.append(
        knopf(b.gesperrt ? 'Konto entsperren' : 'Konto sperren', async () => {
          if (!b.gesperrt && !confirm(`${b.autor} sperren? Das Konto kann dann noch lesen, aber nichts mehr schreiben.`)) return;
          const r = await api('PUT', `/konten/${b.kontoId}/gesperrt`, { gesperrt: !b.gesperrt });
          if (!r.ok) return void status.replaceChildren(meldung(r.fehler, true));
          void thema(t.id);
        }, 'link danger'),
      );
    }
  }
  return el(
    'article',
    { className: `post${b.erster ? ' first' : ''}${b.ausgeblendet ? ' is-hidden' : ''}` },
    el(
      'header',
      {},
      el('strong', { textContent: b.autor }),
      b.team ? chip('Team', 'team') : null,
      b.gesperrt ? chip('Gesperrt', 'warn') : null,
      el('time', { dateTime: b.erstellt, textContent: wann(b.erstellt, now), title: new Date(b.erstellt).toLocaleString('de-DE') }),
      b.ausgeblendet ? chip('Ausgeblendet', 'warn') : null,
    ),
    b.text === null ? el('p', { className: 'body muted', textContent: 'Dieser Beitrag wurde von der Moderation ausgeblendet.' }) : el('div', { className: 'body' }, textKnoten(b.text)),
    actions,
  );
}

function melden(b: Beitrag, actions: HTMLElement): void {
  const grund = el('input', { id: `grund-${b.id}`, maxLength: 300, placeholder: 'z. B. Werbung, beleidigend' });
  const msg = el('p', { className: 'msg error', role: 'alert' });
  const form: HTMLFormElement = el(
    'form',
    { className: 'card' },
    el('label', { htmlFor: grund.id, textContent: 'Warum meldest du diesen Beitrag? (freiwillig)' }),
    grund,
    msg,
    el('div', { className: 'buttons' }, el('button', { type: 'submit', className: 'primary', textContent: 'Beitrag melden' }), knopf('Abbrechen', () => form.remove())),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('POST', `/beitraege/${b.id}/melden`, { grund: grund.value });
    if (!r.ok) {
      msg.textContent = r.fehler;
      return;
    }
    form.replaceWith(meldung('Danke, der Beitrag ist gemeldet. Ein Admin schaut ihn sich an.'));
  });
  actions.after(form);
  grund.focus();
}

function antwortBereich(t: Thema, fokus?: 'antwort'): HTMLElement {
  const hinweis = schreibHinweis();
  if (hinweis) return hinweis;
  if (!ich.name) return nameFormular(() => void thema(t.id, 'antwort'), 'Bevor du antwortest: Im Forum steht dein Anzeigename, nie deine Mailadresse.');
  const text = el('textarea', { id: 'antwort', maxLength: 5000, required: true, rows: 5 });
  const msg = el('p', { className: 'msg error', role: 'alert' });
  const senden = el('button', { type: 'submit', className: 'primary', textContent: 'Antworten' });
  const form = el(
    'form',
    { className: 'card' },
    el('label', { htmlFor: 'antwort', textContent: `Antworten als ${ich.name}` }),
    text,
    el('p', { className: 'hint', textContent: 'Nur Text, keine Bilder. Links werden als Text angezeigt und nicht von Suchmaschinen verfolgt.' }),
    msg,
    el('div', { className: 'buttons' }, senden),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    senden.disabled = true;
    const r = await api<{ id: number }>('POST', `/themen/${t.id}/antworten`, { text: text.value });
    senden.disabled = false;
    if (!r.ok) {
      msg.textContent = r.fehler;
      return;
    }
    await thema(t.id, 'antwort');
    view.querySelector('article:last-of-type')?.scrollIntoView({ block: 'center' });
  });
  if (fokus) queueMicrotask(() => text.focus());
  return form;
}

// ---------- new topic ----------

function neuesThema(kategorie: Kategorie, level: string, version: string): void {
  document.title = 'Neues Thema – Forum – Murmel';
  const zurueck = el('a', { href: '#', textContent: '‹ Alle Themen' });
  const kopf = el('h1', { textContent: kategorie === 'fehler' && level ? 'Fehler melden' : 'Neues Thema' });
  const hinweis = schreibHinweis();
  if (hinweis) return void view.replaceChildren(zurueck, kopf, hinweis);
  if (!ich.name) return void view.replaceChildren(zurueck, kopf, nameFormular(() => neuesThema(kategorie, level, version)));

  const kat = el('select', { id: 'kategorie' }, ...Object.entries(KATEGORIEN).map(([v, s]) => el('option', { value: v, textContent: s })));
  kat.value = kategorie;
  const titel = el('input', { id: 'titel', maxLength: 120, minLength: 3, required: true, autocomplete: 'off' });
  const text = el('textarea', { id: 'text', maxLength: 5000, required: true, rows: 8 });
  if (kategorie === 'fehler' && level) {
    text.placeholder = 'Was ist passiert? Was hättest du erwartet? Wie lässt es sich wiederholen?';
  }
  const msg = el('p', { className: 'msg error', role: 'alert' });
  const senden = el('button', { type: 'submit', className: 'primary', textContent: 'Thema veröffentlichen' });
  const form = el(
    'form',
    {},
    el('label', { htmlFor: 'kategorie', textContent: 'Kategorie' }),
    kat,
    el('label', { htmlFor: 'titel', textContent: 'Titel' }),
    titel,
    el('label', { htmlFor: 'text', textContent: 'Beschreibung' }),
    text,
    el('p', { className: 'hint', textContent: `Öffentlich sichtbar als ${ich.name}. Nur Text, keine Bilder.` }),
    level || version
      ? el('div', { className: 'facts' }, level ? el('span', {}, 'Level ', el('code', { textContent: level })) : null, version ? el('span', {}, 'Spielversion ', el('code', { textContent: version })) : null, el('span', { textContent: 'wird mitgeschickt' }))
      : null,
    msg,
    el('div', { className: 'buttons' }, senden, knopf('Abbrechen', () => void (location.hash = ''))),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    senden.disabled = true;
    const body: Record<string, string> = { kategorie: kat.value, titel: titel.value, text: text.value };
    if (level) body.level = level;
    if (version) body.version = version;
    const r = await api<{ id: number }>('POST', '/themen', body);
    senden.disabled = false;
    if (!r.ok) {
      msg.textContent = r.fehler;
      return;
    }
    location.hash = `thema/${r.daten.id}`;
  });
  view.replaceChildren(zurueck, kopf, form);
  titel.focus();
}

// ---------- reports (admins) ----------

async function meldungen(): Promise<void> {
  document.title = 'Meldungen – Forum – Murmel';
  const zurueck = el('a', { href: '#', textContent: '‹ Alle Themen' });
  const kopf = el('h1', { textContent: 'Gemeldete Beiträge' });
  const r = await api<{ meldungen: Meldung[] }>('GET', '/meldungen');
  if (!r.ok) return void view.replaceChildren(zurueck, kopf, meldung(r.status === 401 || r.status === 403 ? 'Diese Seite ist nur für Admins.' : r.fehler, true));
  const now = new Date();
  const list = r.daten.meldungen;
  if (!list.length) return void view.replaceChildren(zurueck, kopf, el('div', { className: 'empty' }, el('p', { textContent: 'Keine offenen Meldungen.' })));
  view.replaceChildren(
    zurueck,
    kopf,
    ...list.map((m) => {
      const status = el('div', {});
      const done = () => void meldungen();
      return el(
        'article',
        { className: `post${m.ausgeblendet ? ' is-hidden' : ''}` },
        el('header', {}, el('strong', { textContent: m.autor }), m.gesperrt ? chip('Gesperrt', 'warn') : null, el('span', { textContent: `${wann(m.erstellt, now)} · ${m.anzahl}× gemeldet` })),
        el('p', { className: 'small' }, 'In ', el('a', { href: `#thema/${m.themaId}`, textContent: m.thema })),
        el('div', { className: 'body' }, textKnoten(m.text ?? '')),
        m.gruende.length ? el('p', { className: 'small muted' }, `Gründe: ${m.gruende.join(' · ')}`) : null,
        status,
        el(
          'div',
          { className: 'actions' },
          knopf(m.ausgeblendet ? 'Einblenden' : 'Ausblenden', async () => {
            const x = await api('PUT', `/beitraege/${m.id}/ausgeblendet`, { ausgeblendet: !m.ausgeblendet });
            if (!x.ok) return void status.replaceChildren(meldung(x.fehler, true));
            done();
          }, 'link'),
          knopf('Meldung verwerfen', async () => {
            const x = await api('DELETE', `/beitraege/${m.id}/meldungen`);
            if (!x.ok) return void status.replaceChildren(meldung(x.fehler, true));
            done();
          }, 'link'),
        ),
      );
    }),
  );
}

// ---------- routing ----------

async function zeigen(): Promise<void> {
  const r = route(location.hash);
  if (r.seite === 'thema') return thema(r.id);
  if (r.seite === 'neu') return neuesThema(r.kategorie, r.level, r.version);
  if (r.seite === 'meldungen') return meldungen();
  return liste();
}

window.addEventListener('hashchange', () => void zeigen());
await ichLaden();
await zeigen();
