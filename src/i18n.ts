// Sprachen (docs/SPEC-englisch.md): Deutsch und Englisch. Der deutsche Text ist der Schlüssel, je
// Bereich gibt es ein englisches Wörterbuch unter src/i18n/en/. t() nimmt nur Schlüssel des eigenen
// Wörterbuchs an, fehlende Übersetzungen fallen also schon beim Typprüfen auf.

export type Sprache = 'de' | 'en';
export const SPRACHEN: readonly Sprache[] = ['de', 'en'];
const KEY = 'murmel.sprache';
/** Cache, aus dem der Service Worker die Sprache liest (Web-Push-Texte). */
export const SW_CACHE = 'murmel-einstellungen';

export type Werte = Record<string, string | number>;
export type Woerterbuch = Readonly<Record<string, string>>;

/** Gespeicherte Wahl oder null (privater Modus, nichts gewählt, alter/fremder Wert). */
export function gespeicherteSprache(): Sprache | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'de' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/** Sprache des Browsers: de* → Deutsch, alles andere → Englisch. */
export function browserSprache(langs: readonly string[] | undefined): Sprache {
  const first = langs?.find((l) => !!l);
  return first === undefined || /^de\b/i.test(first) ? 'de' : 'en';
}

/** Gespeicherte Wahl, sonst Adresse (/en/…), sonst Browser. Reine Funktion für Tests. */
export function ermittleSprache(gespeichert: Sprache | null, pfad: string, langs: readonly string[] | undefined): Sprache {
  if (gespeichert) return gespeichert;
  if (/(^|\/)en\//.test(pfad)) return 'en';
  return browserSprache(langs);
}

let aktuell: Sprache | null = null;

/** Die Sprache dieser Seite (einmal ermittelt). */
export function sprache(): Sprache {
  if (aktuell) return aktuell;
  // außerhalb des Browsers (Node: Tests, Server, Werkzeuge, die Spielcode laden) immer Deutsch –
  // Node hat ein navigator.language nach der Systemsprache, die CI ist englisch
  if (typeof document === 'undefined') return (aktuell = 'de');
  const nav = navigator.languages?.length ? navigator.languages : [navigator.language];
  const pfad = typeof location === 'undefined' ? '' : location.pathname;
  aktuell = ermittleSprache(gespeicherteSprache(), pfad, nav);
  return aktuell;
}

/** Sprache festlegen, ohne zu speichern (Tests; Web Worker ohne localStorage, src/enigma-upload). null = neu ermitteln. */
export function setzeSpracheFuerTest(s: Sprache | null): void {
  aktuell = s;
}

/** Gebietsschema für Zahlen und Daten. */
export function gebietsschema(s: Sprache = sprache()): string {
  return s === 'de' ? 'de-DE' : 'en-GB';
}

/** {name} durch Werte ersetzen; unbekannte Platzhalter bleiben stehen. */
export function einsetzen(text: string, werte?: Werte): string {
  if (!werte) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in werte ? String(werte[k]) : m));
}

/** Platzhalter eines Textes, sortiert (für Tests). */
export function platzhalter(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

/** Übersetzer für ein Wörterbuch: t(deutscherText, werte?). */
export function woerterbuch<const W extends Woerterbuch>(en: W): (de: keyof W & string, werte?: Werte) => string {
  return (de, werte) => einsetzen(sprache() === 'en' ? en[de] : de, werte);
}

/** Wahl speichern (auch für den Service Worker) und die Seite neu laden. */
export async function spracheWaehlen(s: Sprache, neuLaden = true): Promise<void> {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    /* privater Modus: gilt dann nur bis zum Neuladen */
  }
  aktuell = s;
  await spracheFuerServiceWorker(s);
  if (neuLaden) location.reload();
}

/** Sprache in den Cache des Service Workers legen (fehlt Cache Storage, gilt dort der Browser). */
export async function spracheFuerServiceWorker(s: Sprache = sprache()): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    const c = await caches.open(SW_CACHE);
    await c.put('sprache', new Response(s, { headers: { 'Content-Type': 'text/plain' } }));
  } catch {
    /* kein Cache Storage */
  }
}

/** Kopf für eigene API-Aufrufe: der Server antwortet in dieser Sprache (Fehler, Mails). */
export function sprachKopf(): Record<string, string> {
  return { 'Accept-Language': sprache() };
}

// ---------- statisches HTML ----------

/** Schlüssel eines Elements: Textinhalt mit zusammengefassten Leerzeichen. */
export function textSchluessel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Übersetzt Elemente mit data-i18n (Text), data-i18n-html (Text mit Markup; Wert im Wörterbuch ist HTML)
 * und data-i18n-attr="title,aria-label,…" (Attribute). Fehlt ein Eintrag, bleibt der deutsche Text.
 */
export function uebersetzeDom(root: ParentNode, en: Woerterbuch, s: Sprache = sprache()): void {
  if (s !== 'en') return;
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const v = en[textSchluessel(el.textContent ?? '')];
    if (v !== undefined) el.textContent = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-html]')) {
    const v = en[textSchluessel(el.textContent ?? '')];
    if (v !== undefined) el.innerHTML = v;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-attr]')) {
    for (const a of (el.dataset.i18nAttr ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
      const cur = el.getAttribute(a);
      const v = cur === null ? undefined : en[textSchluessel(cur)];
      if (v !== undefined) el.setAttribute(a, v);
    }
  }
}

/** Seite vorbereiten: lang-Attribut, Titel, statische Texte. */
export function seiteUebersetzen(en: Woerterbuch): void {
  const s = sprache();
  document.documentElement.lang = s;
  if (s !== 'en') return;
  const titel = en[textSchluessel(document.title)];
  if (titel !== undefined) document.title = titel;
  uebersetzeDom(document, en, s);
}

/**
 * Knopf zum Umschalten. Beschriftet mit der anderen Sprache in ihrer eigenen Sprache, damit ihn auch
 * findet, wer die aktuelle nicht liest.
 */
export function sprachKnopf(klasse = ''): HTMLButtonElement {
  const andere: Sprache = sprache() === 'de' ? 'en' : 'de';
  const b = document.createElement('button');
  b.type = 'button';
  if (klasse) b.className = klasse;
  b.lang = andere;
  b.textContent = andere === 'en' ? 'English' : 'Deutsch';
  b.title = andere === 'en' ? 'Switch to English' : 'Auf Deutsch umschalten';
  b.addEventListener('click', () => void spracheWaehlen(andere));
  return b;
}
