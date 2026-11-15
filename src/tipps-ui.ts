// Tipps im Spiel (docs/SPEC-tipps.md): the quiet "Tipp?" in the header after a long time without progress,
// the tip card (stage 1: a sentence, stage 2: the way as a ghost) and the count per run. main.ts only
// forwards the level, the frames and the win; everything else lives here and in src/game/tipp.ts.
import type { ActorSprite } from './render/classic';
import type { LevelFile } from './game/level';
import type { GameSession, StartLua } from './game/session';
import { abschnitt, type Fahrplan, fenster, lageSchluessel, lageVon, satz, TippGeist } from './game/tipp';
import { fahrplanFuer, Haengen } from './tipps';
import { woerterbuch } from './i18n';
import EN from './i18n/en/dienste';

const t = woerterbuch(EN);

export interface TippHost {
  showOverlay(title: string, text: string, buttons: [string, () => void][]): void;
  showToast(text: string, ms?: number): void;
  /** Into the menu: the run stands still, the pointer is free. */
  menue(): void;
  /** Back to playing. */
  spielen(): void;
  /** No tips now (zu zweit, a level from a link that is being edited …). */
  aus(): boolean;
  /** The way was shown in this run (for the Auswertung, docs/SPEC-auswertung.md). */
  wegGezeigt?(s: GameSession): void;
}

/** Frames between two looks at the progress (the situation is cheap, but not free). */
const PRUEF_TAKT = 30;
const TITEL = t('Tipp');
const KEIN_TIPP = t('Für dieses Level gibt es noch keinen Tipp.');
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pause = () => new Promise<void>((ok) => setTimeout(ok, 0));

export function tippsUI(host: TippHost, knopf: HTMLButtonElement) {
  let session: GameSession | null = null;
  let file: LevelFile | null = null;
  let startLua: StartLua | undefined;
  let haengen = new Haengen();
  let frames = 0;
  let geist: TippGeist | null = null;
  /** The last window shown, to go on with the next part of the same stretch. */
  let zuletzt: { von: number; ende: number } | null = null;
  let saetze = 0;
  let wege = 0;
  let token = 0;

  const verbergen = () => {
    knopf.hidden = true;
    knopf.classList.remove('da');
  };
  const zeigen = () => {
    knopf.hidden = false;
    requestAnimationFrame(() => knopf.classList.add('da')); // fades in (CSS), none with reduced motion
  };

  knopf.addEventListener('click', (e) => {
    e.stopPropagation();
    void oeffnen();
  });

  /** A new run (level loaded or restarted): tips and their count start over. */
  function levelGeladen(s: GameSession, f: LevelFile, lua: StartLua): void {
    token++;
    session = s;
    file = f;
    startLua = lua;
    haengen = new Haengen();
    geist = null;
    zuletzt = null;
    saetze = 0;
    wege = 0;
    verbergen();
  }

  /** Every frame after the physics steps: the ghost follows, now and then a look at the progress. */
  function rechnen(s: GameSession): void {
    if (s !== session) return;
    if (geist) {
      geist.folgen(s.steps);
      if (geist.fertig) geist = null;
    }
    if (!knopf.hidden || host.aus() || s.won || ++frames % PRUEF_TAKT !== 0) return;
    if (!haengen.pruefen(lageSchluessel(lageVon(s)), s.steps, s.falls)) return;
    const tk = token;
    // only with a solution: the search replays it in small portions while the game goes on
    void fahrplanFuer(file!, { startLua, pause }).then((f) => {
      if (f && tk === token && !host.aus()) zeigen();
    });
  }

  function sprite(alpha: number): ActorSprite | null {
    return geist?.sprite(alpha) ?? null;
  }

  /** The tip card: the sentence to the next station, then on request the way. */
  async function oeffnen(): Promise<void> {
    const s = session;
    if (!s || !file || host.aus() || s.won) return;
    host.menue();
    const tk = token;
    host.showOverlay(TITEL, t('Einen Moment …'), [[t('Weiterspielen'), host.spielen]]);
    const f = await fahrplanFuer(file, { startLua, pause });
    if (tk !== token || s !== session) return;
    if (!f) return host.showOverlay(TITEL, KEIN_TIPP, [[t('Weiterspielen'), host.spielen]]);
    zeigen();
    const lage = lageVon(s);
    const a = abschnitt(f, lage);
    saetze++;
    const weiter = zuletzt !== null && zuletzt.von === a.von && zuletzt.ende < a.bis;
    host.showOverlay(TITEL, escapeHtml(satz(f, a, lage)), [
      [weiter ? t('Weiter zeigen') : t('Weg zeigen'), () => void wegZeigen(f, s)],
      [t('Weiterspielen'), host.spielen],
    ]);
  }

  async function wegZeigen(f: Fahrplan, s: GameSession): Promise<void> {
    const a = abschnitt(f, lageVon(s));
    const w = fenster(f, a, zuletzt && zuletzt.von === a.von ? zuletzt.ende : null);
    const tk = token;
    const g = await TippGeist.create(file!, f, w, s.steps, startLua);
    if (tk !== token || s !== session) return;
    geist = g;
    zuletzt = { von: a.von, ende: w.ende };
    wege++;
    host.wegGezeigt?.(s);
    host.spielen();
    host.showToast(t('Der Geist zeigt den Weg.'), 1800);
  }

  return {
    zustand: () => ({ knopf: !knopf.hidden, geist: geist ? { schritte: geist.schritte, start: geist.start, ende: geist.ende, sprite: geist.sprite(1) } : null, saetze, wege }),
    levelGeladen,
    rechnen,
    sprite,
    oeffnen,
    /** The pause menu's entry (none zu zweit). */
    menuePunkt: (): [string, () => void][] => (host.aus() ? [] : [[TITEL, () => void oeffnen()]]),
    /** A way was shown in this run: it goes to no ranking (docs/SPEC-tipps.md, Entscheidung). */
    wegGezeigt: () => wege > 0,
    /** The line of the win message, '' without tips. */
    siegZeile: (): string => {
      if (wege > 0) return `<br><span class="note">${wege === 1 ? t('Mit einem gezeigten Weg gelöst – dieser Lauf zählt nicht für die Bestenliste.') : t('Mit {n} gezeigten Wegen gelöst – dieser Lauf zählt nicht für die Bestenliste.', { n: wege })}</span>`;
      if (saetze > 0) return `<br><span class="note">${saetze === 1 ? t('Mit einem Tipp gelöst.') : t('Mit {n} Tipps gelöst.', { n: saetze })}</span>`;
      return '';
    },
  };
}
