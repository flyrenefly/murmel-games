// Account dialogs inside the game's menu card: sign in (passkey or mail link), account page.
import {
  type Anbieter,
  ANBIETER_NAME,
  anbieterFehlerText,
  anbieterRueckkehr,
  anbieterStart,
  type Konto,
  KontoApi,
  type KontoStand,
  loginTokenFromHash,
  passkeyFehler,
  passkeysMoeglich,
} from './konto';
import { freigabeLaden, freigabeSetzen } from './geister';
import { gebietsschema, woerterbuch } from './i18n';
import EN from './i18n/en/konto';

const t = woerterbuch(EN);

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
export const kontoLabel = (): string => (stand?.angemeldet ? t('Konto') : t('Anmelden'));

/** Signed in and not blocked: runs go to the leaderboard (docs/SPEC-bestenliste.md). */
export const darfEinreichen = (): boolean => stand?.angemeldet === true && !stand.konto.gesperrt;

/** Signed in as admin (e.g. "Als Lösung speichern" after a win, docs/SPEC-loesbarkeit.md). */
export const istAdmin = (): boolean => stand?.angemeldet === true && stand.konto.rolle === 'admin';

let wechsel: (angemeldet: boolean) => void = () => {};
/** Called when the sign-in state becomes known or changes (sync: docs/SPEC-sync.md). */
export function beiKontoWechsel(f: (angemeldet: boolean) => void): void {
  wechsel = f;
}
function setStand(s: KontoStand): KontoStand {
  const vorher = stand?.angemeldet;
  // Most answers do not repeat which providers are on; keep the last known list.
  if (s.anbieter === undefined && stand?.anbieter) s = { ...s, anbieter: stand.anbieter };
  stand = s;
  if (vorher !== s.angemeldet) wechsel(s.angemeldet);
  return s;
}

/** Asks the server once in the background who is signed in (for the menu label). */
export async function kontoLaden(): Promise<void> {
  const r = await api.stand();
  if (r.ok) stand = setStand(r.daten);
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
  host.showOverlay(t('Konto'), t('Einen Moment …'), [[t('Zurück'), host.back]]);
  const r = await api.stand();
  if (!r.ok) {
    host.showOverlay(t('Konto'), r.fehler, [[t('Zurück'), host.back]]);
    return;
  }
  stand = setStand(r.daten);
  if (stand.angemeldet) kontoSeite(host, stand.konto);
  else anmelden(host);
}

/** Opened from a mail link: one click signs in (a click, so mail scanners do not use up the link). */
export function mailLinkPruefen(host: KontoHost): boolean {
  const token = loginTokenFromHash(location.hash);
  if (!token) return false;
  history.replaceState(null, '', location.pathname + location.search);
  host.showOverlay(t('Anmelden'), t('Du hast einen Anmeldelink geöffnet.'), [
    [
      t('Jetzt anmelden'),
      async () => {
        const r = await api.linkEinloesen(token);
        if (!r.ok) {
          host.showOverlay(t('Anmelden'), r.fehler, [[t('Neuen Link anfordern'), () => anmelden(host)], [t('Zurück'), host.back]]);
          return;
        }
        stand = setStand(r.daten);
        if (stand.angemeldet) kontoSeite(host, stand.konto, true);
      },
    ],
    [t('Abbrechen'), host.back],
  ]);
  return true;
}

function anmelden(host: KontoHost, email = ''): void {
  host.showOverlay(
    t('Anmelden'),
    t('Ein Konto ist freiwillig – Murmel spielst du auch ohne. Murmel speichert keine Passwörter.'),
    [[t('Zurück'), host.back]],
  );
  const meldung = el('div');
  const parts: Node[] = [];
  const anbieter = REIHENFOLGE.filter((a) => stand?.anbieter?.includes(a));

  if (passkeysMoeglich()) parts.push(button(t('Mit Passkey anmelden'), () => void passkeyAnmelden(host, meldung), 'primary wide'));
  // Google, Apple, GitHub (Konten Stufe 2): all the same size, in the providers' own button styles
  if (anbieter.length) parts.push(el('div', { className: 'anbieter-knoepfe' }, ...anbieter.map((a) => anbieterKnopf(a, meldung))));
  if (passkeysMoeglich() || anbieter.length) parts.push(el('div', { className: 'konto-oder', textContent: t('oder per Mail') }));
  const mailPrimaer = !passkeysMoeglich() && !anbieter.length;

  const input = el('input', {
    type: 'email',
    id: 'konto-mail',
    name: 'email',
    autocomplete: 'email',
    required: true,
    placeholder: t('name@beispiel.de'),
    value: email,
  });
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  const senden = el('button', { type: 'submit', textContent: t('Anmeldelink per Mail schicken'), className: mailPrimaer ? 'primary wide' : 'wide' });
  const form = el(
    'form',
    { className: 'konto-form', noValidate: true },
    el('label', { htmlFor: 'konto-mail', textContent: t('Mailadresse') }),
    input,
    senden,
    el('p', {
      className: 'konto-hinweis',
      textContent: t('Passwort vergessen oder neu hier? Murmel braucht kein Passwort: Du bekommst einen Link per Mail, der dich anmeldet. Das legt beim ersten Mal auch dein Konto an.'),
    }),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    senden.disabled = true;
    meldung.replaceChildren(status(t('Link wird verschickt …')));
    const r = await api.linkSchicken(input.value);
    senden.disabled = false;
    if (!r.ok) {
      meldung.replaceChildren(status(r.fehler, 'fehler'));
      return;
    }
    host.showOverlay(
      t('Schau in dein Postfach'),
      t('Wir haben einen Anmeldelink an {adresse} geschickt. Er gilt 15 Minuten und nur einmal. Keine Mail? Sieh im Spam-Ordner nach.', { adresse: escape(input.value.trim()) }),
      [['OK', host.back], [t('Andere Adresse'), () => anmelden(host, input.value)]],
    );
  });
  parts.push(form, meldung);
  host.form.replaceChildren(...parts);
  host.form.hidden = false;
  quietBack(host);
  if (mailPrimaer) input.focus();
}

const REIHENFOLGE: Anbieter[] = ['apple', 'google', 'github'];

/**
 * Logos as the providers publish them: Apple and GitHub single-colour (black on the white button),
 * Google's "G" in its four colours. Constant markup, never built from input.
 */
const LOGO: Record<Anbieter, string> = {
  apple:
    '<svg viewBox="0 0 814 1000" aria-hidden="true" focusable="false"><path fill="currentColor" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"/></svg>',
  google:
    '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  github:
    '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
};

/** "Mit Apple anmelden" etc.: leaves the game page for the provider and comes back with #anbieter=… */
function anbieterKnopf(a: Anbieter, meldung: HTMLElement): HTMLButtonElement {
  const b = el('button', { type: 'button', className: `anbieter anbieter-${a}` });
  b.append(el('span', { className: 'anbieter-logo', innerHTML: LOGO[a] }), el('span', { textContent: t('Mit {anbieter} anmelden', { anbieter: ANBIETER_NAME[a] }) }));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const k of b.parentElement?.querySelectorAll('button') ?? []) k.disabled = true;
    meldung.replaceChildren(status(t('Weiter zu {anbieter} …', { anbieter: ANBIETER_NAME[a] })));
    location.assign(anbieterStart(a));
  });
  return b;
}

/** Back from Google, Apple or GitHub (#anbieter=… or #anbieter-fehler=…): finish, or say what went wrong. */
export function anbieterRueckkehrPruefen(host: KontoHost): boolean {
  const r = anbieterRueckkehr(location.hash);
  if (!r) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if ('fehler' in r) {
    host.showOverlay(t('Anmelden'), anbieterFehlerText(r.fehler), [[t('Noch einmal'), () => void kontoOeffnen(host)], [t('Zurück'), host.back]]);
    return true;
  }
  host.showOverlay(t('Anmelden'), t('Einen Moment …'), [[t('Zurück'), host.back]]);
  void api.anbieterAbschliessen(r.vorgang).then(async (res) => {
    if (!res.ok) {
      host.showOverlay(t('Anmelden'), res.fehler, [[t('Noch einmal'), () => void kontoOeffnen(host)], [t('Zurück'), host.back]]);
      return;
    }
    const verbunden = res.daten.angemeldet ? res.daten.verbunden : undefined;
    // the status call also says which providers are on (for "Verbinden" on the account page)
    const s = await api.stand();
    stand = setStand(s.ok && s.daten.angemeldet ? s.daten : res.daten);
    if (stand.angemeldet) kontoSeite(host, stand.konto, verbunden ? t('{anbieter} ist jetzt mit deinem Konto verbunden.', { anbieter: ANBIETER_NAME[verbunden] }) : t('Du bist angemeldet.'));
  });
  return true;
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
  stand = setStand(r.daten);
  if (stand.angemeldet) kontoSeite(host, stand.konto);
}

function datum(iso: string): string {
  return new Date(iso).toLocaleDateString(gebietsschema(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function kontoSeite(host: KontoHost, konto: Konto, neuAngemeldet: boolean | string = false): void {
  host.showOverlay(t('Dein Konto'), '', [[t('Zurück'), host.back]]);
  const meldung = el('div');
  const parts: Node[] = [
    el(
      'div',
      { className: 'konto-kopf' },
      el('strong', { textContent: konto.email }),
      ...(konto.rolle === 'admin' ? [el('span', { className: 'konto-admin', textContent: 'Admin' })] : []),
      el('small', { textContent: t('Konto seit {datum}', { datum: datum(konto.erstellt) }) }),
    ),
  ];
  if (neuAngemeldet) parts.push(status(typeof neuAngemeldet === 'string' ? neuAngemeldet : t('Du bist angemeldet.')));
  if (konto.gesperrt) parts.push(status(t('Dieses Konto ist gesperrt. Spielen geht weiter; schreiben kannst du nicht. Fragen an info@murmel.games.'), 'fehler'));

  // Passkeys: after the first mail login the page offers one, so the next sign-in needs no mail.
  const liste = el('ul', { className: 'konto-passkeys' });
  for (const p of konto.passkeys) {
    liste.append(
      el(
        'li',
        {},
        el('span', {}, el('b', { textContent: p.name }), el('small', { textContent: p.zuletzt ? t('zuletzt {datum}', { datum: datum(p.zuletzt) }) : t('seit {datum}', { datum: datum(p.erstellt) }) })),
        button(t('Entfernen'), async () => {
          const r = await api.passkeyEntfernen(p.id);
          if (!r.ok) return void meldung.replaceChildren(status(r.fehler, 'fehler'));
          if (r.daten.angemeldet) kontoSeite(host, r.daten.konto);
        }, 'klein'),
      ),
    );
  }
  const section = el('section', { className: 'konto-abschnitt' }, el('h2', { textContent: 'Passkeys' }));
  if (konto.passkeys.length) section.append(liste);
  else section.append(el('p', { className: 'konto-hinweis', textContent: t('Mit einem Passkey meldest du dich per Fingerabdruck, Gesicht oder Geräte-PIN an – ohne Mail und ohne Passwort.') }));
  if (passkeysMoeglich()) {
    section.append(button(konto.passkeys.length ? t('Passkey hinzufügen') : t('Passkey einrichten'), () => void passkeyEinrichten(host, meldung), konto.passkeys.length ? 'wide' : 'primary wide'));
  } else {
    section.append(el('p', { className: 'konto-hinweis', textContent: t('Dieser Browser unterstützt keine Passkeys.') }));
  }
  const wege = anmeldewegeAbschnitt(host, konto, meldung);
  parts.push(section, ...(wege ? [wege] : []), meldung, geisterAbschnitt());
  if (passkeysMoeglich() && !konto.passkeys.length) quietBack(host);

  parts.push(
    el(
      'div',
      { className: 'konto-aktionen' },
      button(t('Abmelden'), () => void abmelden(host, false)),
      button(t('Überall abmelden'), () => void abmelden(host, true)),
      button(t('Konto löschen …'), () => loeschenFragen(host, konto), 'gefahr'),
    ),
  );
  host.form.replaceChildren(...parts);
  host.form.hidden = false;
}

/**
 * Sign-in methods (Konten Stufe 2): which are connected (with the address the provider confirmed, so an
 * Apple relay address stays findable), disconnect, and connect the other active providers. The last way
 * in cannot be removed (the server checks it too).
 */
function anmeldewegeAbschnitt(host: KontoHost, konto: Konto, meldung: HTMLElement): HTMLElement | null {
  const wege = konto.anmeldewege ?? [];
  const offen = REIHENFOLGE.filter((a) => stand?.anbieter?.includes(a) && !wege.some((w) => w.anbieter === a));
  if (!wege.length && !offen.length) return null;
  const letzter = wege.length + konto.passkeys.length <= 1;
  const liste = el('ul', { className: 'konto-passkeys konto-wege' });
  for (const w of wege) {
    const zeile = el('li', {}, el('span', {}, el('b', { textContent: ANBIETER_NAME[w.anbieter] }), el('small', { textContent: w.email ?? t('seit {datum}', { datum: datum(w.seit) }) })));
    if (w.anbieter !== 'mail') {
      const trennen = button(t('Trennen'), async () => {
        const r = await api.anbieterTrennen(w.anbieter as Anbieter, w.kennung);
        if (!r.ok) return void meldung.replaceChildren(status(r.fehler, 'fehler'));
        stand = setStand(r.daten);
        if (stand.angemeldet) kontoSeite(host, stand.konto, t('{anbieter} ist getrennt.', { anbieter: ANBIETER_NAME[w.anbieter] }));
      }, 'klein');
      trennen.disabled = letzter;
      trennen.setAttribute('aria-label', t('{anbieter} trennen', { anbieter: ANBIETER_NAME[w.anbieter] }));
      zeile.append(trennen);
    }
    liste.append(zeile);
  }
  for (const a of offen) {
    const verbinden = button(t('Verbinden'), () => {
      meldung.replaceChildren(status(t('Weiter zu {anbieter} …', { anbieter: ANBIETER_NAME[a] })));
      location.assign(anbieterStart(a));
    }, 'klein');
    verbinden.setAttribute('aria-label', t('Mit {anbieter} verbinden', { anbieter: ANBIETER_NAME[a] }));
    liste.append(el('li', {}, el('span', {}, el('b', { textContent: ANBIETER_NAME[a] }), el('small', { textContent: t('nicht verbunden') })), verbinden));
  }
  const section = el('section', { className: 'konto-abschnitt' }, el('h2', { textContent: t('Anmeldewege') }), liste);
  if (letzter && wege.some((w) => w.anbieter !== 'mail')) {
    section.append(el('p', { className: 'konto-hinweis', textContent: t('Ein Anmeldeweg bleibt immer bestehen. Richte einen Passkey ein oder verbinde einen weiteren Anbieter, dann kannst du diesen trennen.') }));
  }
  return section;
}

/** Geister (docs/SPEC-geister.md): the own leaderboard runs as ghosts for others – off unless switched on. */
function geisterAbschnitt(): HTMLElement {
  const box = el('input', { type: 'checkbox', id: 'konto-geist', disabled: true });
  box.setAttribute('role', 'switch');
  const meldung = el('div');
  void freigabeLaden().then((an) => {
    if (an === null) return void meldung.replaceChildren(status(t('Die Einstellung ist gerade nicht erreichbar.'), 'fehler'));
    box.checked = an;
    box.disabled = false;
  });
  box.addEventListener('click', (e) => e.stopPropagation());
  box.addEventListener('change', async () => {
    box.disabled = true;
    if (await freigabeSetzen(box.checked)) meldung.replaceChildren();
    else {
      box.checked = !box.checked;
      meldung.replaceChildren(status(t('Das hat nicht geklappt. Bitte versuch es später noch einmal.'), 'fehler'));
    }
    box.disabled = false;
  });
  return el(
    'section',
    { className: 'konto-abschnitt' },
    el('h2', { textContent: t('Geister') }),
    el('label', { className: 'konto-schalter', htmlFor: 'konto-geist' }, box, el('span', { textContent: t('Meine Läufe als Geist zeigen') })),
    el('p', { className: 'konto-hinweis', textContent: t('Andere können dann gegen deine Läufe aus der Bestenliste spielen – als durchscheinende Murmel mit deinem Anzeigenamen. Ausschalten macht sie sofort wieder privat.') }),
    meldung,
  );
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
  stand = setStand(r.daten);
  if (stand.angemeldet) {
    kontoSeite(host, stand.konto);
    host.form.append(status(t('Passkey eingerichtet. Beim nächsten Mal: „Mit Passkey anmelden“.')));
  }
}

async function abmelden(host: KontoHost, alle: boolean): Promise<void> {
  const r = await api.abmelden(alle);
  if (!r.ok) return void host.form.append(status(r.fehler, 'fehler'));
  stand = setStand(r.daten);
  host.showOverlay(t('Abgemeldet'), alle ? t('Du bist auf allen Geräten abgemeldet.') : t('Du bist abgemeldet. Dein Spielstand auf diesem Gerät bleibt.'), [['OK', host.back]]);
}

function loeschenFragen(host: KontoHost, konto: Konto): void {
  // Cancel first (primary): deleting cannot be undone.
  host.showOverlay(
    t('Konto löschen?'),
    t('Das Konto {email} wird sofort und endgültig gelöscht, mit allen Passkeys und Anmeldungen. Das lässt sich nicht rückgängig machen. Dein Spielstand auf diesem Gerät bleibt.', { email: escape(konto.email) }),
    [[t('Abbrechen'), () => kontoSeite(host, konto)]],
  );
  host.form.replaceChildren(
    el(
      'div',
      { className: 'konto-aktionen' },
      button(t('Konto endgültig löschen'), async () => {
        const r = await api.loeschen();
        if (!r.ok) return void host.form.append(status(r.fehler, 'fehler'));
        stand = setStand(r.daten);
        host.showOverlay(t('Konto gelöscht'), t('Dein Konto ist gelöscht. Murmel spielst du weiter wie bisher.'), [['OK', host.back]]);
      }, 'gefahr'),
    ),
  );
  host.form.hidden = false;
}
