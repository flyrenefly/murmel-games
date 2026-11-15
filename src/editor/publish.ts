// "Veröffentlichen" in the editor (docs/SPEC-spielerlevels.md): checks, the solved playtest, the
// account – then a short form. Each missing step says what to do next.

import type { LevelFile } from '../game/level';
import type { Recording } from '../game/session';
import { hochladen, LICENSE_LABEL, pruefungAbwarten, solutionFor } from '../spielerlevels';
import { basedOnText, encodeLevel, MAX_BASED_ON } from './link';

type Buttons = [string, () => void, string?][];

export interface PublishHost {
  /** The level as the playtest saw it (link data must match the solved run). */
  file(): LevelFile;
  /** Errors of the share checks (empty: ready). */
  errors(): string[];
  showDialog(title: string, body: (HTMLElement | string)[], buttons: Buttons): void;
  close(): void;
  playtest(): void;
  note(text: string): HTMLElement;
}

export interface Mine {
  id: number;
  titel: string;
  status: string;
  /** The version's Vorlage/Herkunft (null: none). */
  vorlage?: string | null;
}

async function getJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function publish(h: PublishHost): Promise<void> {
  const busy = (text: string) => {
    const p = h.note(text);
    p.classList.add('ed-busy');
    p.setAttribute('role', 'status');
    return p;
  };
  const errors = h.errors();
  if (errors.length) {
    const ul = document.createElement('ul');
    for (const e of errors) ul.append(Object.assign(document.createElement('li'), { textContent: e }));
    h.showDialog('Vor dem Veröffentlichen beheben', [ul], [['OK', h.close, 'primary']]);
    return;
  }
  const file = h.file();
  const solution = solutionFor(await encodeLevel(file));
  if (!solution) {
    h.showDialog(
      'Erst selbst lösen',
      [
        'Veröffentlichen kannst du ein Level, das du selbst gelöst hast: Spiel es probe bis zum Sieg. Der Server spielt deinen Lauf nach – so gibt es keine unlösbaren Levels.',
        'Nach jeder Änderung braucht es einen neuen Lauf.',
      ],
      [['Probespielen', () => (h.close(), h.playtest()), 'primary'], ['Abbrechen', h.close]],
    );
    return;
  }
  h.showDialog('Veröffentlichen', [busy('Konto wird geprüft …')], [['Abbrechen', h.close]]);
  const konto = await getJson('/api/konto');
  if (!konto) {
    h.showDialog('Gerade nicht erreichbar', ['Spieler-Levels sind gerade nicht erreichbar. Dein Level bleibt hier gespeichert – versuch es später noch einmal.'], [['OK', h.close, 'primary']]);
    return;
  }
  if (!konto.angemeldet) {
    h.showDialog('Anmelden', ['Zum Veröffentlichen brauchst du ein Konto. Melde dich im Spiel an und komm dann hierher zurück – dein Level und dein gelöster Lauf bleiben gespeichert.'], [
      ['Zum Anmelden', () => location.assign('./#konto'), 'primary'],
      ['Abbrechen', h.close],
    ]);
    return;
  }
  if ((konto.konto as { gesperrt?: boolean } | undefined)?.gesperrt) {
    h.showDialog('Konto gesperrt', ['Dein Konto ist gesperrt. Veröffentlichen geht deshalb nicht.'], [['OK', h.close, 'primary']]);
    return;
  }
  const [ich, meine] = await Promise.all([getJson('/api/forum/ich'), getJson('/api/spielerlevels/meine')]);
  const name = typeof ich?.name === 'string' ? ich.name : null;
  const mine = ((meine?.levels as Mine[] | undefined) ?? []).filter((l) => l.status !== 'ersetzt');
  form(h, file, solution, name, mine, busy);
}

/** Vorlage/Herkunft to offer: the level's own, else the one of the version it replaces ('' for none). */
export function basedOnFor(file: Pick<LevelFile, 'basedOn'>, mine: Pick<Mine, 'id' | 'vorlage'>[], replaces: string): string {
  return basedOnText(file.basedOn) || basedOnText(mine.find((m) => String(m.id) === replaces)?.vorlage);
}

function form(h: PublishHost, file: LevelFile, solution: Recording, name: string | null, mine: Mine[], busy: (t: string) => HTMLElement): void {
  const f = document.createElement('form');
  f.className = 'ed-form';
  f.noValidate = true;
  const label = (text: string, control: HTMLElement, extra?: HTMLElement) => {
    const l = document.createElement('label');
    l.append(text, control);
    if (extra) l.append(extra);
    return l;
  };
  const title = Object.assign(document.createElement('input'), { type: 'text', value: file.title.trim().slice(0, 60), maxLength: 60, autocomplete: 'off' });
  const desc = Object.assign(document.createElement('textarea'), { maxLength: 500, placeholder: 'Worum geht es? Ein Tipp für den Anfang? (freiwillig)' });
  const count = Object.assign(document.createElement('span'), { className: 'ed-count', textContent: '0 / 500' });
  desc.addEventListener('input', () => (count.textContent = `${desc.value.length} / 500`));
  const basedOn = Object.assign(document.createElement('input'), { type: 'text', value: file.basedOn ?? '', maxLength: MAX_BASED_ON, autocomplete: 'off', className: 'ed-based-on', placeholder: 'leer lassen, wenn es keine Vorlage gibt' });
  basedOn.setAttribute('aria-describedby', 'ed-publish-based-on');
  const basedOnHint = h.note('Erscheint beim Level als „Vorlage: …“.');
  basedOnHint.id = 'ed-publish-based-on';
  basedOnHint.classList.add('ed-hint');
  f.append(label('Titel', title), label('Beschreibung', desc, count));
  let nameIn: HTMLInputElement | null = null;
  if (!name) {
    nameIn = Object.assign(document.createElement('input'), { type: 'text', maxLength: 24, autocomplete: 'nickname', placeholder: '3 bis 24 Zeichen' });
    f.append(label('Anzeigename (steht als Autor beim Level)', nameIn));
  }
  const replace = document.createElement('select');
  replace.append(new Option('Neues Level', ''));
  for (const m of mine) replace.append(new Option(`Neue Version von „${m.titel}“`, String(m.id)));
  if (mine.length) f.append(label('Art', replace));
  f.append(label('Vorlage/Herkunft (optional)', basedOn), basedOnHint);
  // a new version takes over the Herkunft of the version it replaces, unless the author typed one
  let basedOnTouched = false;
  basedOn.addEventListener('input', () => (basedOnTouched = true));
  replace.addEventListener('change', () => {
    if (!basedOnTouched) basedOn.value = basedOnFor(file, mine, replace.value);
  });
  const lic = Object.assign(document.createElement('input'), { type: 'checkbox' });
  const licLabel = document.createElement('label');
  licLabel.className = 'ed-check';
  licLabel.append(lic, `Ich veröffentliche das Level unter ${LICENSE_LABEL}: Andere dürfen es spielen, verändern und weitergeben, mit Nennung meines Anzeigenamens${name ? ` „${name}“` : ''}.`);
  const err = Object.assign(document.createElement('p'), { className: 'ed-error' });
  err.setAttribute('role', 'alert');
  f.append(licLabel, h.note('Sichtbar wird es erst nach der Freigabe durch einen Admin. Gespeichert werden Level, Titel, Beschreibung, eine etwaige Herkunftsangabe und dein gelöster Lauf (nicht öffentlich).'), err);

  const fail = (text: string, focus?: HTMLElement) => {
    err.textContent = text;
    focus?.focus();
  };
  const send = async () => {
    err.textContent = '';
    const t = title.value.trim();
    if ([...t].length < 3) return fail('Der Titel braucht mindestens 3 Zeichen.', title);
    if (nameIn && nameIn.value.trim().length < 3) return fail('Bitte wähle einen Anzeigenamen mit 3 bis 24 Zeichen.', nameIn);
    if (!lic.checked) return fail(`Bitte bestätige die Lizenz ${LICENSE_LABEL}.`, lic);
    if (nameIn) {
      try {
        const res = await fetch('/api/forum/name', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nameIn.value.trim() }) });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          return fail(data?.error ?? 'Der Name ließ sich nicht speichern.', nameIn);
        }
      } catch {
        return fail('Spieler-Levels sind gerade nicht erreichbar.');
      }
    }
    const { basedOn: _old, ...rest } = file;
    const credit = basedOnText(basedOn.value);
    const sent = await hochladen({
      level: { ...rest, title: t, ...(credit ? { basedOn: credit } : {}) },
      loesung: solution,
      titel: t,
      beschreibung: desc.value,
      version: __MURMEL_VERSION__,
      ...(replace.value ? { ersetzt: Number(replace.value) } : {}),
    });
    if ('fehler' in sent) return fail(sent.fehler);
    h.showDialog('Veröffentlichen', [busy('Dein Lauf wird auf dem Server nachgespielt …')], [['Im Hintergrund weiter', h.close]]);
    const r = await pruefungAbwarten(sent.id);
    if (r.status === 'angenommen') {
      h.showDialog('Eingereicht', [`„${t}“ ist geprüft und wartet auf Freigabe. Unter „Meine Levels“ auf der Seite Spieler-Levels siehst du, wann es veröffentlicht ist.`], [
        ['Meine Levels', () => location.assign('./spielerlevels.html#meine'), 'primary'],
        ['Fertig', h.close],
      ]);
    } else {
      h.showDialog('Nicht angenommen', [r.grund], [['OK', h.close, 'primary']]);
    }
  };
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    void send();
  });
  h.showDialog('Veröffentlichen', [f], [
    ['Veröffentlichen', () => f.requestSubmit(), 'primary'],
    ['Abbrechen', h.close],
  ]);
  title.focus();
}
