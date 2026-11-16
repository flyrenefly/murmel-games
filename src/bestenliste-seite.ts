// bestenliste.html?level=<id>&titel=<name> (docs/SPEC-bestenliste.md): the top 100 of a level and the
// own place. Uses the session cookie of the game (same address); open to everybody.
import { PHYSICS_DT } from './game/physics';
import { gebietsschema, seiteUebersetzen, sprachKnopf, sprachKopf, woerterbuch } from './i18n';
import { browserHerkunft, herkunftMelden } from './herkunft';
import EN from './i18n/en/bestenliste-seite';
import EN_SEITE from './i18n/en/seite-bestenliste';

const t = woerterbuch(EN);
seiteUebersetzen(EN_SEITE);
herkunftMelden(browserHerkunft()); // docs/SPEC-herkunft.md
document.querySelector('main > nav')?.append(sprachKnopf('sprache'));

interface Row {
  id: number;
  platz: number;
  name: string | null;
  zeit: number;
  datum: string;
  ich: boolean;
}
interface Ranking {
  level: string;
  anzahl: number;
  eintraege: Row[];
  ich: { id: number; platz: number; zeit: number } | null;
  admin?: boolean;
}

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const level = params.get('level') ?? '';
const titel = params.get('titel') || level;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** Decimal separator of the page language (1:23,4 or 1:23.4). */
const KOMMA = (0.5).toLocaleString(gebietsschema()).charAt(1);

/** m:ss,t from physics steps, like the game. */
function zeit(steps: number): string {
  const z = Math.round(steps * PHYSICS_DT * 10);
  const s = Math.floor(z / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${KOMMA}${z % 10}`;
}

const datum = (iso: string) => new Date(iso).toLocaleDateString(gebietsschema(), { day: 'numeric', month: 'short', year: 'numeric' });

function status(text: string): void {
  $('status').textContent = text;
}

async function remove(id: number, own: boolean): Promise<void> {
  const q = own ? t('Deinen Eintrag löschen? Zeit und gespeicherter Lauf werden entfernt.') : t('Diesen Eintrag entfernen? Zeit und gespeicherter Lauf werden gelöscht.');
  if (!confirm(q)) return;
  try {
    const res = await fetch(`/api/bestenliste/eintrag/${id}`, { method: 'DELETE', credentials: 'same-origin', headers: sprachKopf() });
    if (res.status !== 204) throw new Error(String(res.status));
    status(own ? t('Dein Eintrag ist gelöscht.') : t('Eintrag entfernt.'));
  } catch {
    status(t('Löschen hat nicht geklappt. Bitte versuch es später noch einmal.'));
  }
  await load(false);
}

function render(r: Ranking): void {
  const me = $('me');
  me.replaceChildren();
  if (r.ich) {
    me.append(
      el('span', { className: 'muted' }, t('Dein Platz')),
      el('b', { textContent: `${r.ich.platz}` }),
      el('span', { className: 'grow' }, t('von {n} · {zeit}', { n: r.anzahl, zeit: zeit(r.ich.zeit) })),
      el('button', { type: 'button', className: 'danger', textContent: t('Eintrag löschen'), onclick: () => void remove(r.ich!.id, true) }),
    );
    if (r.eintraege.some((e) => e.ich && !e.name)) {
      const hint = el('p', { className: 'muted' }, t('Du stehst hier ohne Namen. Einen Anzeigenamen wählst du im'), ' ', el('a', { href: 'forum.html', textContent: t('Forum') }), t('.'));
      hint.style.cssText = 'flex-basis: 100%; margin: 0; font-size: 15px';
      me.append(hint);
    }
  }
  me.hidden = !r.ich;

  const rows = r.eintraege.map((e) => {
    const name = e.name ? el('span', { className: 'name', textContent: e.name }) : el('span', { className: 'noname', textContent: t('ohne Namen') });
    const action = r.admin && !e.ich ? el('button', { type: 'button', className: 'danger small', textContent: t('Entfernen'), onclick: () => void remove(e.id, false) }) : '';
    const tr = el(
      'tr',
      { className: [e.platz <= 3 ? 'top' : '', e.ich ? 'mine' : ''].join(' ').trim() },
      el('td', { className: 'rank', textContent: `${e.platz}.` }),
      el('td', {}, name, ...(e.ich ? [el('span', { className: 'tag', textContent: t('Du') })] : [])),
      el('td', { className: 'num', textContent: zeit(e.zeit) }),
      el('td', { className: 'date', textContent: datum(e.datum) }),
      el('td', { className: 'num' }, action),
    );
    if (e.ich) tr.setAttribute('aria-current', 'true');
    return tr;
  });
  const empty = el('tr', {}, el('td', { colSpan: 5, className: 'empty muted', textContent: t('Noch keine Einträge. Löse das Level angemeldet, um den ersten Platz zu belegen.') }));
  $('rows').replaceChildren(...(rows.length ? rows : [empty]));
  $('list').hidden = false;
  $('sub').textContent = `${r.anzahl === 1 ? t('1 Eintrag') : t('{n} Einträge', { n: r.anzahl })}${r.anzahl > 100 ? t(', die besten 100') : ''} · ${t('jede Zeit durch Nachspielen geprüft')}`;
}

async function load(clear = true): Promise<void> {
  try {
    const res = await fetch(`/api/bestenliste/level?${new URLSearchParams({ id: level })}`, { credentials: 'same-origin', cache: 'no-store', headers: sprachKopf() });
    if (!res.ok) throw new Error(String(res.status));
    render((await res.json()) as Ranking);
    if (clear) status('');
  } catch {
    status(t('Die Rangliste ist gerade nicht erreichbar. Spielen geht trotzdem.'));
  }
}

document.title = t('Rangliste: {titel} – Murmel', { titel });
$('title').textContent = titel;
if (!level) status(t('Kein Level angegeben. Öffne die Rangliste aus dem Spiel nach einem Sieg.'));
else void load();
