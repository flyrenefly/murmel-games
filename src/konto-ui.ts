// Account dialogs inside the game's menu card: sign in (passkey or mail link), account page.
import { type Konto, KontoApi, type KontoStand, loginTokenFromHash, passkeyFehler, passkeysMoeglich } from './konto';

/** What the dialogs need from the game (src/main.ts). */
export interface KontoHost {
  /** Shows the menu card with title, text and buttons (first = primary). */
  showOverlay(title: string, text: string, buttons: [string, () => void][]): void;
  /** Container below the text for form content; emptied and hidden by showOverlay. */
  form: HTMLElement;
  /** Back to the game menu. */
  back(): void;
}

const api = new KontoApi();
let stand: KontoStand | null = null;

/** Menu label: "Anmelden" or "Konto" (known after the first status call). */
export const kontoLabel = (): string => (stand?.angemeldet ? 'Konto' : 'Anmelden');

/** Signed in and not blocked: runs go to the leaderboard (docs/SPEC-bestenliste.md). */
export const darfEinreichen = (): boolean => stand?.angemeldet === true && !stand.konto.gesperrt;

/** Signed in as admin (e.g. "Als Lösung speichern" after a win, docs/SPEC-loesbarkeit.md). */
export const istAdmin = (): boolean => stand?.angemeldet === true && stand.konto.rolle === 'admin';

/** Asks the server once in the background who is signed in (for the menu label). */
export async function kontoLaden(): Promise<void> {
  const r = await api.stand();
  if (r.ok) stand = r.daten;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

function button(label: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', textContent: label, className });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** The form brings its own main action: the card's back button steps down to a plain one. */
function quietBack(host: KontoHost): void {
  host.form.parentElement?.querySelector('#ov-buttons button.primary')?.classList.remove('primary');
}

function status(text: string, kind: 'info' | 'fehler' = 'info'): HTMLParagraphElement {
  return el('p', { className: `konto-status ${kind}`, textContent: text, role: kind === 'fehler' ? 'alert' : 'status' });
}

/** Opens the account dialog: sign-in when signed out, otherwise the account page. */
export async function kontoOeffnen(host: KontoHost): Promise<void> {
  host.showOverlay('Konto', 'Einen Moment …', [['Zurück', host.back]]);
  const r = await api.stand();
  if (!r.ok) {
    host.showOverlay('Konto', r.fehler, [['Zurück', host.back]]);
    return;
  }
  stand = r.daten;
  if (stand.angemeldet) kontoSeite(host, stand.konto);
  else anmelden(host);
}

/** Opened from a mail link: one click signs in (a click, so mail scanners do not use up the link). */
export function mailLinkPruefen(host: KontoHost): boolean {
  const token = loginTokenFromHash(location.hash);
  if (!token) return false;
  history.replaceState(null, '', location.pathname + location.search);
  host.showOverlay('Anmelden', 'Du hast einen Anmeldelink geöffnet.', [
    [
      'Jetzt anmelden',
      async () => {
        const r = await api.linkEinloesen(token);
        if (!r.ok) {
          host.showOverlay('Anmelden', r.fehler, [['Neuen Link anfordern', () => anmelden(host)], ['Zurück', host.back]]);
          return;
        }
        stand = r.daten;
        if (stand.angemeldet) kontoSeite(host, stand.konto, true);
      },
    ],
    ['Abbrechen', host.back],
  ]);
  return true;
}

function anmelden(host: KontoHost, email = ''): void {
  host.showOverlay(
    'Anmelden',
    'Ein Konto ist freiwillig – Murmel spielst du auch ohne. Murmel speichert keine Passwörter.',
    [['Zurück', host.back]],
  );
  const meldung = el('div');
  const parts: Node[] = [];

  if (passkeysMoeglich()) {
    parts.push(
      button('Mit Passkey anmelden', () => void passkeyAnmelden(host, meldung), 'primary wide'),
      el('div', { className: 'konto-oder', textContent: 'oder per Mail' }),
    );
  }

  const input = el('input', {
    type: 'email',
    id: 'konto-mail',
    name: 'email',
    autocomplete: 'email',
    required: true,
    placeholder: 'name@beispiel.de',
    value: email,
  });
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  const senden = el('button', { type: 'submit', textContent: 'Anmeldelink per Mail schicken', className: passkeysMoeglich() ? 'wide' : 'primary wide' });
  const form = el(
    'form',
    { className: 'konto-form', noValidate: true },
    el('label', { htmlFor: 'konto-mail', textContent: 'Mailadresse' }),
    input,
    senden,
    el('p', {
      className: 'konto-hinweis',
      textContent: 'Passwort vergessen oder neu hier? Murmel braucht kein Passwort: Du bekommst einen Link per Mail, der dich anmeldet. Das legt beim ersten Mal auch dein Konto an.',
    }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    senden.disabled = true;
    meldung.replaceChildren(status('Link wird verschickt …'));
    const r = await api.linkSchicken(input.value);
    senden.disabled = false;
    if (!r.ok) {
      meldung.replaceChildren(status(r.fehler, 'fehler'));
      return;
    }
    host.showOverlay(
      'Schau in dein Postfach',
      `Wir haben einen Anmeldelink an ${escape(input.value.trim())} geschickt. Er gilt 15 Minuten und nur einmal. Keine Mail? Sieh im Spam-Ordner nach.`,
      [['OK', host.back], ['Andere Adresse', () => anmelden(host, input.value)]],
    );
  });
  parts.push(form, meldung);
  host.form.replaceChildren(...parts);
  host.form.hidden = false;
  quietBack(host);
  if (!passkeysMoeglich()) input.focus();
}

const escape = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function passkeyAnmelden(host: KontoHost, meldung: HTMLElement): Promise<void> {
  const start = await api.anmeldenStart();
  if (!start.ok) return void meldung.replaceChildren(status(start.fehler, 'fehler'));
  let antwort: unknown;
  try {
    const { startAuthentication } = await import('@simplewebauthn/browser');
    antwort = await startAuthentication({ optionsJSON: start.daten.optionen as Parameters<typeof startAuthentication>[0]['optionsJSON'] });
  } catch (err) {
    return void meldung.replaceChildren(status(passkeyFehler(err), 'fehler'));
  }
  const r = await api.anmeldenAbschliessen(start.daten.vorgang, antwort);
  if (!r.ok) return void meldung.replaceChildren(status(r.fehler, 'fehler'));
  stand = r.daten;
  if (stand.angemeldet) kontoSeite(host, stand.konto);
}

function datum(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function kontoSeite(host: KontoHost, konto: Konto, neuAngemeldet = false): void {
  host.showOverlay('Dein Konto', '', [['Zurück', host.back]]);
  const meldung = el('div');
  const parts: Node[] = [
    el(
      'div',
      { className: 'konto-kopf' },
      el('strong', { textContent: konto.email }),
      ...(konto.rolle === 'admin' ? [el('span', { className: 'konto-admin', textContent: 'Admin' })] : []),
      el('small', { textContent: `Konto seit ${datum(konto.erstellt)}` }),
    ),
  ];
  if (neuAngemeldet) parts.push(status('Du bist angemeldet.'));
  if (konto.gesperrt) parts.push(status('Dieses Konto ist gesperrt. Spielen geht weiter; schreiben kannst du nicht. Fragen an info@murmel.games.', 'fehler'));

  // Passkeys: after the first mail login the page offers one, so the next sign-in needs no mail.
  const liste = el('ul', { className: 'konto-passkeys' });
  for (const p of konto.passkeys) {
    liste.append(
      el(
        'li',
        {},
        el('span', {}, el('b', { textContent: p.name }), el('small', { textContent: p.zuletzt ? `zuletzt ${datum(p.zuletzt)}` : `seit ${datum(p.erstellt)}` })),
        button('Entfernen', async () => {
          const r = await api.passkeyEntfernen(p.id);
          if (!r.ok) return void meldung.replaceChildren(status(r.fehler, 'fehler'));
          if (r.daten.angemeldet) kontoSeite(host, r.daten.konto);
        }, 'klein'),
      ),
    );
  }
  const section = el('section', { className: 'konto-abschnitt' }, el('h2', { textContent: 'Passkeys' }));
  if (konto.passkeys.length) section.append(liste);
  else section.append(el('p', { className: 'konto-hinweis', textContent: 'Mit einem Passkey meldest du dich per Fingerabdruck, Gesicht oder Geräte-PIN an – ohne Mail und ohne Passwort.' }));
  if (passkeysMoeglich()) {
    section.append(button(konto.passkeys.length ? 'Passkey hinzufügen' : 'Passkey einrichten', () => void passkeyEinrichten(host, meldung), konto.passkeys.length ? 'wide' : 'primary wide'));
  } else {
    section.append(el('p', { className: 'konto-hinweis', textContent: 'Dieser Browser unterstützt keine Passkeys.' }));
  }
  parts.push(section, meldung);
  if (passkeysMoeglich() && !konto.passkeys.length) quietBack(host);

  parts.push(
    el(
      'div',
      { className: 'konto-aktionen' },
      button('Abmelden', () => void abmelden(host, false)),
      button('Überall abmelden', () => void abmelden(host, true)),
      button('Konto löschen …', () => loeschenFragen(host, konto), 'gefahr'),
    ),
  );
  host.form.replaceChildren(...parts);
  host.form.hidden = false;
}

async function passkeyEinrichten(host: KontoHost, meldung: HTMLElement): Promise<void> {
  const start = await api.passkeyStart();
  if (!start.ok) return void meldung.replaceChildren(status(start.fehler, 'fehler'));
  let antwort: unknown;
  try {
    const { startRegistration } = await import('@simplewebauthn/browser');
    antwort = await startRegistration({ optionsJSON: start.daten.optionen as Parameters<typeof startRegistration>[0]['optionsJSON'] });
  } catch (err) {
    return void meldung.replaceChildren(status(passkeyFehler(err), 'fehler'));
  }
  const r = await api.passkeyAbschliessen(start.daten.vorgang, antwort);
  if (!r.ok) return void meldung.replaceChildren(status(r.fehler, 'fehler'));
  stand = r.daten;
  if (stand.angemeldet) {
    kontoSeite(host, stand.konto);
    host.form.append(status('Passkey eingerichtet. Beim nächsten Mal: „Mit Passkey anmelden“.'));
  }
}

async function abmelden(host: KontoHost, alle: boolean): Promise<void> {
  const r = await api.abmelden(alle);
  if (!r.ok) return void host.form.append(status(r.fehler, 'fehler'));
  stand = r.daten;
  host.showOverlay('Abgemeldet', alle ? 'Du bist auf allen Geräten abgemeldet.' : 'Du bist abgemeldet. Dein Spielstand auf diesem Gerät bleibt.', [['OK', host.back]]);
}

function loeschenFragen(host: KontoHost, konto: Konto): void {
  // Cancel first (primary): deleting cannot be undone.
  host.showOverlay(
    'Konto löschen?',
    `Das Konto ${escape(konto.email)} wird sofort und endgültig gelöscht, mit allen Passkeys und Anmeldungen. Das lässt sich nicht rückgängig machen. Dein Spielstand auf diesem Gerät bleibt.`,
    [['Abbrechen', () => kontoSeite(host, konto)]],
  );
  host.form.replaceChildren(
    el(
      'div',
      { className: 'konto-aktionen' },
      button('Konto endgültig löschen', async () => {
        const r = await api.loeschen();
        if (!r.ok) return void host.form.append(status(r.fehler, 'fehler'));
        stand = r.daten;
        host.showOverlay('Konto gelöscht', 'Dein Konto ist gelöscht. Murmel spielst du weiter wie bisher.', [['OK', host.back]]);
      }, 'gefahr'),
    ),
  );
  host.form.hidden = false;
}
