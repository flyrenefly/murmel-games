// Zu zweit spielen (docs/SPEC-mehrspieler.md): menu, flow and the hooks main.ts calls.
// Without a room every hook answers "not active" and the game runs exactly as before.
import './zu-zweit.css';
import type { LevelFile } from '../game/level';
import type { ObjectWorld } from '../game/objects';
import { PHYSICS_DT } from '../game/physics';
import type { GameSession, StepControl } from '../game/session';
import { listPacks, packLevels, packTitle } from '../packs';
import type { ActorSprite } from '../render/classic';
import { KoopGast, KoopGastgeber } from './koop';
import type { Aktion, Art, Nachricht } from './nachrichten';
import { Rennen } from './rennen';
import { FEHLERTEXT, type Status, Verbindung } from './verbindung';
import { wettkampf } from './wettkampf-ui';

/** What the module needs from the game (src/main.ts). */
export interface SpielHost {
  session(): GameSession | null;
  packId(): string;
  levelIndex(): number;
  loadLevel(pack: string, index: number, seed?: number, carry?: number | null): Promise<void>;
  /** Like the "Spielen" button: pointer lock or tilt, then play. */
  spielen(): void;
  /** The level from the start (the R key). */
  neustart(): void;
  showOverlay(title: string, html: string, buttons: [string, () => void][]): void;
  showStart(): void;
  showToast(text: string, ms?: number): void;
  formatTime(steps: number): string;
}

/** A level two can solve together: it has a steered white marble (Enigma network levels). */
export function istKoopLevel(f: LevelFile): boolean {
  return (f.actors ?? []).some((a) => a.k === 'ac_marble_white' && a.a?.passive !== 'true' && a.a?.ownerless !== 'true');
}

type Phase = 'aus' | 'warte' | 'laden' | 'spiel' | 'ende';

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ART_NAME: Record<Art, string> = { gemeinsam: 'Gemeinsam', rennen: 'Wettrennen' };
const STATUS_TEXT: Record<Status, string> = {
  getrennt: 'getrennt',
  raum: 'warte auf Mitspieler',
  verbinde: 'verbinde …',
  verbunden: 'verbunden',
  abgebrochen: 'Verbindung unterbrochen',
};

export function zuZweit(host: SpielHost) {
  let v: Verbindung | null = null;
  let phase: Phase = 'aus';
  let art: Art = 'gemeinsam';
  let wahl: { pack: string; index: number } | null = null;
  let runde: { pack: string; index: number; seed: number; levelId: string } | null = null;
  let koopHost: KoopGastgeber | null = null;
  let koopGast: KoopGast | null = null;
  let rennen: Rennen | null = null;
  /** Set while this module loads a level itself (levelGeladen tells own loads from the player's). */
  let eigenesLaden = false;
  let endeGezeigt = false;
  let partnerImZielGemeldet = false;
  /** Race: game time of earlier tries of this round (starting over does not reset the clock). */
  let vorlauf = 0;
  let letzteSchritte = 0;
  const gastgeber = () => v?.rolle === 'gastgeber';
  /** Wettkampf (docs/SPEC-wettkampf.md): set while its level list is open, called with the choice. */
  let nachWahl: { fertig: (w: { pack: string; index: number }) => void; zurueck: () => void } | null = null;
  const wk = wettkampf({
    ...host,
    levelAuswahl(fertig, zurueck) {
      art = 'rennen';
      nachWahl = { fertig, zurueck };
      void paketWaehlen();
    },
  });

  // ---------- status mark ----------
  const marke = document.createElement('div');
  marke.id = 'zz-status';
  marke.setAttribute('role', 'status');
  marke.setAttribute('aria-live', 'polite');
  marke.hidden = true;
  document.body.append(marke);
  function zeigeStatus(): void {
    if (!v || v.status === 'getrennt') {
      marke.hidden = true;
      return;
    }
    marke.hidden = false;
    marke.dataset.status = v.status;
    marke.innerHTML = `<span class="zz-punkt" aria-hidden="true"></span>Zu zweit · ${ART_NAME[art]}${v.code ? ` · ${esc(v.code)}` : ''} · ${STATUS_TEXT[v.status]}`;
  }

  // ---------- menus ----------
  const levelList = () => document.getElementById('level-list') as HTMLElement;
  const ovForm = () => document.getElementById('ov-form') as HTMLElement;

  function liste(rows: [string, () => void][], leer: string): void {
    const el = levelList();
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = leer;
      el.replaceChildren(p);
    } else {
      el.replaceChildren(
        ...rows.map(([html, fn]) => {
          const b = document.createElement('button');
          b.className = 'level';
          b.innerHTML = html;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            fn();
          });
          return b;
        }),
      );
    }
    el.hidden = false;
  }

  /** Menu entry „Zu zweit“. */
  function menue(): void {
    nachWahl = null;
    if (wk.aktiv()) return wk.menue();
    if (v && v.status !== 'getrennt') return verbindungsMenue();
    host.showOverlay(
      'Zu zweit',
      'Spielt zu zweit an zwei Geräten. Einer öffnet einen Raum und nennt den Code, der andere tritt bei.<br><span class="keys">Die Verbindung läuft über unseren Server in Deutschland – ihr seht eure IP-Adressen gegenseitig nicht.</span>',
      [
        ['Raum öffnen', artWaehlen],
        ['Beitreten', beitretenForm],
        ['Wettkampf (bis 4)', wk.menue],
        ['Zurück', host.showStart],
      ],
    );
  }

  function artWaehlen(): void {
    host.showOverlay('Wie wollt ihr spielen?', '<b>Gemeinsam</b>: Jeder steuert eine Murmel, ihr löst ein Zwei-Murmel-Level zusammen.<br><b>Wettrennen</b>: Beide spielen dasselbe Level, der andere ist als Geist zu sehen. Wer schneller löst, gewinnt.', [
      ['Gemeinsam', () => ((art = 'gemeinsam'), void paketWaehlen())],
      ['Wettrennen', () => ((art = 'rennen'), rennLevel())],
      ['Zurück', menue],
    ]);
  }

  function rennLevel(): void {
    const s = host.session();
    host.showOverlay('Welches Level?', s ? `Aktuell: <b>${esc(s.level.title)}</b>` : '', [
      ['Dieses Level', () => ((wahl = { pack: host.packId(), index: host.levelIndex() }), void raumOeffnen())],
      ['Anderes Level', () => void paketWaehlen()],
      ['Zurück', artWaehlen],
    ]);
  }

  async function paketWaehlen(): Promise<void> {
    host.showOverlay(art === 'gemeinsam' ? 'Zwei-Murmel-Levels' : 'Level fürs Wettrennen', art === 'gemeinsam' ? 'Levelpaket wählen' : '', [['Zurück', nachWahl ? nachWahl.zurueck : artWaehlen]]);
    const packs = await listPacks();
    liste(
      packs.map((p) => [`<span>›</span><b>${esc(p.title)}</b>`, () => void levelWaehlen(p.id)]),
      'Keine Levelpakete gefunden.',
    );
  }

  async function levelWaehlen(pack: string): Promise<void> {
    const levels = await packLevels(pack).catch(() => null);
    host.showOverlay(await packTitle(pack), '', [['Zurück', () => void paketWaehlen()]]);
    if (!levels) return liste([], 'Das Paket ließ sich nicht laden.');
    liste(
      levels.flatMap((l, i): [string, () => void][] =>
        art === 'gemeinsam' && !istKoopLevel(l) ? [] : [[`<span>${i + 1}</span>${esc(l.title)}`, () => gewaehlt({ pack, index: i })]],
      ),
      'In diesem Paket gibt es kein Level für zwei Murmeln.',
    );
  }

  function gewaehlt(w: { pack: string; index: number }): void {
    const n = nachWahl;
    nachWahl = null;
    if (n) return n.fertig(w);
    wahl = w;
    void raumOeffnen();
  }

  function beitretenForm(): void {
    host.showOverlay('Raum beitreten', 'Gib den Code ein, den dein Mitspieler sieht.', [['Zurück', menue]]);
    const form = ovForm();
    form.innerHTML = `<form class="konto-form zz-form" novalidate>
      <label for="zz-code">Raumcode</label>
      <input id="zz-code" name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" placeholder="0000" required aria-describedby="zz-fehler">
      <p id="zz-fehler" class="konto-hinweis" aria-live="assertive"></p>
      <button type="submit" class="primary wide">Beitreten</button>
    </form>`;
    form.hidden = false;
    const input = form.querySelector('input') as HTMLInputElement;
    const fehler = form.querySelector('#zz-fehler') as HTMLElement;
    const knopf = form.querySelector('button') as HTMLButtonElement;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      fehler.textContent = '';
    });
    input.focus();
    form.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const code = input.value;
      if (!/^\d{4}$/.test(code)) {
        fehler.textContent = 'Der Code hat vier Ziffern.';
        return;
      }
      knopf.disabled = true;
      knopf.textContent = 'Verbinde …';
      try {
        await verbinden().beitreten(code);
        warteAufStart();
      } catch (err) {
        fehler.textContent = FEHLERTEXT[(err as Error).message] ?? 'Beitreten hat nicht geklappt.';
        knopf.disabled = false;
        knopf.textContent = 'Beitreten';
        trennen();
      }
    });
  }

  function verbinden(): Verbindung {
    v?.verlassen();
    const c = new Verbindung({ ohneTurnErlaubt: import.meta.env.DEV });
    v = c;
    c.onStatus = (s) => {
      if (v !== c) return;
      zeigeStatus();
      if (s === 'verbunden') c.senden({ t: 'hallo', version: __MURMEL_VERSION__ });
      if (s === 'verbunden' && gastgeber()) void rundeStarten();
      if (s === 'abgebrochen' && phase !== 'aus') abbruch();
      // host: the guest left; the room stays open and the guest can come back with the same code
      if (s === 'raum' && gastgeber() && (phase === 'spiel' || phase === 'ende')) host.showToast(`Dein Mitspieler ist weg. Mit dem Code ${c.code} kann er wieder beitreten.`, 4000);
    };
    c.onNachricht = (n) => v === c && empfangen(n);
    c.onFehler = (g) => g === 'verfallen' && host.showToast(FEHLERTEXT.verfallen, 3000);
    return c;
  }

  async function raumOeffnen(): Promise<void> {
    host.showOverlay('Raum öffnen', 'Einen Moment …', [['Abbrechen', () => (trennen(), menue())]]);
    try {
      const code = await verbinden().oeffnen();
      phase = 'warte';
      codeZeigen(code);
    } catch (err) {
      trennen();
      host.showOverlay('Raum öffnen', FEHLERTEXT[(err as Error).message] ?? 'Das hat nicht geklappt.', [
        ['Nochmal', () => void raumOeffnen()],
        ['Zurück', menue],
      ]);
    }
  }

  function codeZeigen(code: string): void {
    host.showOverlay(
      'Dein Raumcode',
      `<span class="zz-code" aria-label="Raumcode ${code.split('').join(' ')}">${esc(code)}</span>${ART_NAME[art]} · Nenne deinem Mitspieler diesen Code.<br><span class="zz-warte">Warte auf Mitspieler …</span>`,
      [['Abbrechen', () => (trennen(), menue())]],
    );
  }

  function warteAufStart(): void {
    phase = 'warte';
    host.showOverlay('Verbunden mit dem Raum', '<span class="zz-warte">Gleich geht es los …</span>', [['Verlassen', () => (trennen(), menue())]]);
  }

  /** Connection menu while a room is open (menu button „Zu zweit“ during play). */
  function verbindungsMenue(): void {
    host.showOverlay('Zu zweit', `${ART_NAME[art]}${v?.code ? ` · Raum ${esc(v.code)}` : ''} · ${STATUS_TEXT[v?.status ?? 'getrennt']}`, [
      ...(phase === 'spiel' ? ([['Weiterspielen', host.spielen]] as [string, () => void][]) : []),
      ...(v?.status === 'abgebrochen' ? ([['Neu verbinden', neuVerbinden]] as [string, () => void][]) : []),
      ['Zu zweit verlassen', () => (trennen(), host.showStart())],
    ]);
  }

  function trennen(): void {
    const c = v;
    v = null;
    c?.verlassen();
    phase = 'aus';
    koopHost = koopGast = null;
    rennen = null;
    runde = null;
    zeigeStatus();
  }

  // ---------- rounds ----------
  async function laden(pack: string, index: number, seed: number | undefined): Promise<GameSession | null> {
    eigenesLaden = true;
    try {
      await host.loadLevel(pack, index, seed);
    } finally {
      eigenesLaden = false;
    }
    return host.session();
  }

  /** Host: (re)starts the chosen level for both. */
  async function rundeStarten(): Promise<void> {
    const w = wahl ?? { pack: host.packId(), index: host.levelIndex() };
    phase = 'laden';
    host.showOverlay(ART_NAME[art], '<span class="zz-warte">Dein Mitspieler lädt das Level …</span>', [['Zu zweit verlassen', () => (trennen(), host.showStart())]]);
    const s = await laden(w.pack, w.index, undefined);
    if (!s || !v) return;
    rundeAnkuendigen(s, w);
  }

  function rundeAnkuendigen(s: GameSession, w: { pack: string; index: number }): void {
    if (!v) return;
    runde = { pack: w.pack, index: w.index, seed: s.seed, levelId: s.level.id };
    vorbereiten(s);
    phase = 'laden';
    v.senden({ t: 'start', art, ...runde });
  }

  /** New round on this session: co-op on, fresh helpers. */
  function vorbereiten(s: GameSession): void {
    endeGezeigt = false;
    partnerImZielGemeldet = false;
    vorlauf = 0;
    letzteSchritte = 0;
    delete marke.dataset.ergebnis;
    const senden = (n: Nachricht) => v?.senden(n);
    koopHost = koopGast = null;
    rennen = null;
    if (art === 'gemeinsam') {
      s.enableCoop();
      if (gastgeber()) koopHost = new KoopGastgeber(senden);
      else {
        koopGast = new KoopGast(senden);
        koopGast.onEnde = () => gewonnenZeigen(s);
      }
    } else rennen = new Rennen(senden);
  }

  async function empfangen(n: Nachricht): Promise<void> {
    switch (n.t) {
      case 'hallo':
        if (n.version !== __MURMEL_VERSION__) host.showToast('Ihr spielt verschiedene Spielversionen. Ladet am besten beide die Seite neu.', 4000);
        return;
      case 'start': {
        if (gastgeber()) return;
        art = n.art;
        zeigeStatus();
        phase = 'laden';
        host.showOverlay(ART_NAME[art], '<span class="zz-warte">Lade das Level …</span>', [['Zu zweit verlassen', () => (trennen(), host.showStart())]]);
        const s = await laden(n.pack, n.index, n.seed);
        if (!s || !v) return;
        if (s.level.id !== n.levelId || s.seed !== n.seed) {
          host.showOverlay('Level nicht gefunden', 'Dein Spiel hat dieses Level nicht. Ladet beide die Seite neu und versucht es noch einmal.', [['Zu zweit verlassen', () => (trennen(), host.showStart())]]);
          return;
        }
        runde = { pack: n.pack, index: n.index, seed: n.seed, levelId: n.levelId };
        vorbereiten(s);
        v.senden({ t: 'bereit', levelId: n.levelId });
        return;
      }
      case 'bereit':
        if (!gastgeber() || phase !== 'laden' || n.levelId !== runde?.levelId) return;
        v?.senden({ t: 'los' });
        los();
        return;
      case 'los':
        if (!gastgeber() && phase === 'laden') los();
        return;
      case 'eingabe':
        koopHost?.eingabe(n);
        return;
      case 'schritte':
        koopGast?.schritte(n);
        return;
      case 'stand':
      case 'ziel':
        rennen?.empfangen(n);
        if (n.t === 'ziel' && rennen && rennen.meinZiel === null && !partnerImZielGemeldet) {
          partnerImZielGemeldet = true;
          host.showToast(`Dein Mitspieler ist im Ziel (${host.formatTime(n.schritte)}). Weiter!`, 2600);
        }
        return;
      case 'neustart':
        if (gastgeber() && phase !== 'laden') host.neustart();
        return;
      case 'tschuess':
        rennen?.empfangen(n);
        host.showToast('Dein Mitspieler hat den Raum verlassen.', 3000);
        return;
    }
  }

  function los(): void {
    phase = 'spiel';
    host.showOverlay(
      ART_NAME[art],
      art === 'gemeinsam'
        ? `Es geht los! Du steuerst die <b>${gastgeber() ? 'schwarze' : 'weiße'}</b> Murmel.`
        : 'Es geht los! Die halbdurchsichtige Murmel ist dein Mitspieler.',
      [['Spielen', host.spielen]],
    );
  }

  function abbruch(): void {
    if (phase === 'aus') return;
    host.showOverlay('Verbindung verloren', 'Die Verbindung zu deinem Mitspieler ist abgebrochen.', [
      ['Neu verbinden', neuVerbinden],
      ['Allein weiter', () => (trennen(), host.neustart())],
    ]);
  }

  function neuVerbinden(): void {
    const c = v;
    if (!c) return menue();
    host.showOverlay('Neu verbinden', '<span class="zz-warte">Verbinde …</span>', [['Zu zweit verlassen', () => (trennen(), host.showStart())]]);
    c.neuVerbinden().then(
      () => {
        if (gastgeber() && c.status === 'raum') codeZeigen(c.code);
        else if (!gastgeber()) warteAufStart();
      },
      (err: Error) => host.showOverlay('Neu verbinden', FEHLERTEXT[err.message] ?? 'Das hat nicht geklappt.', [['Nochmal', neuVerbinden], ['Zu zweit verlassen', () => (trennen(), host.showStart())]]),
    );
  }

  function gewonnenZeigen(s: GameSession): void {
    if (endeGezeigt) return;
    endeGezeigt = true;
    phase = 'ende';
    const zeit = host.formatTime(vorlauf + s.steps);
    setTimeout(() => {
      if (art === 'gemeinsam') {
        host.showOverlay('Geschafft – zusammen!', `Zeit ${zeit} · Abstürze ${s.falls}`, gastgeber() ? nachDemSpiel() : [['Zu zweit verlassen', () => (trennen(), host.showStart())]]);
        if (!gastgeber()) document.getElementById('ov-text')!.insertAdjacentHTML('beforeend', '<br><span class="zz-warte">Dein Mitspieler wählt, wie es weitergeht …</span>');
      } else rennErgebnis();
    }, 900);
  }

  function nachDemSpiel(): [string, () => void][] {
    return [
      ['Nochmal', () => host.neustart()],
      ['Anderes Level', () => (art === 'gemeinsam' ? void paketWaehlen() : rennLevel())],
      ['Zu zweit verlassen', () => (trennen(), host.showStart())],
    ];
  }

  function rennErgebnis(): void {
    const r = rennen;
    if (!r || r.meinZiel === null) return;
    const e = r.ergebnis();
    const mein = host.formatTime(r.meinZiel);
    const sein = r.partnerZiel !== null ? ` · Mitspieler ${host.formatTime(r.partnerZiel)}` : '';
    const titel = e === 'gewonnen' ? 'Gewonnen!' : e === 'verloren' ? 'Knapp verloren' : e === 'gleich' ? 'Unentschieden!' : 'Im Ziel!';
    const knoepfe: [string, () => void][] = gastgeber() ? nachDemSpiel() : [['Zu zweit verlassen', () => (trennen(), host.showStart())]];
    host.showOverlay(titel, `Deine Zeit ${mein}${sein}${e === null ? '<br><span class="zz-warte">Warte auf deinen Mitspieler …</span>' : ''}`, knoepfe);
  }

  // Dev server only: the end-to-end test (tools/e2e-mehrspieler.mjs) looks inside
  if (import.meta.env.DEV) (window as unknown as { __zuZweit: object }).__zuZweit = { session: host.session, phase: () => phase, status: () => v?.status ?? 'getrennt', code: () => v?.code ?? '' };

  // ---------- hooks for main.ts ----------
  return {
    /** Menu button „Zu zweit“. */
    menue,
    /** Start value for a level load: the race keeps its seed when a player starts over. */
    seed(pack: string, index: number): number | undefined {
      if (wk.aktiv()) return wk.seed(pack, index);
      return phase !== 'aus' && art === 'rennen' && runde && runde.pack === pack && runde.index === index ? runde.seed : undefined;
    },
    /** After every level load. */
    levelGeladen(s: GameSession): void {
      if (wk.levelGeladen(s)) return;
      if (eigenesLaden || phase === 'aus' || !v) return;
      if (art === 'rennen') {
        // starting over in a race: same level and seed, the clock keeps running, the partner keeps going
        vorlauf += letzteSchritte;
        letzteSchritte = 0;
        void s;
        return;
      }
      // co-op: a restart must happen on both sides – the host announces it, the guest asks for it
      if (gastgeber()) {
        const w = { pack: host.packId(), index: host.levelIndex() };
        wahl = w;
        rundeAnkuendigen(s, w);
      } else {
        phase = 'laden';
        v.senden({ t: 'neustart' });
      }
    },
    /**
     * Physics of this frame: in co-op the module plays the steps (returns the rest of acc), else
     * null and main.ts steps as usual.
     */
    rechnen(s: GameSession, acc: number, control: StepControl): number | null {
      if (wk.aktiv()) return wk.rechnen(s, acc, control);
      if (rennen && phase !== 'aus') {
        const m = s.physics.marbles[s.physics.current];
        letzteSchritte = s.steps;
        if (m && phase === 'spiel') rennen.tick(m.pos.x, m.pos.y, m.color, vorlauf + s.steps);
        if (phase === 'ende' && rennen.meinZiel !== null) {
          const vorher = (marke.dataset.ergebnis ?? '') as string;
          const e = rennen.ergebnis() ?? '';
          if (e !== vorher) {
            marke.dataset.ergebnis = e;
            if (e) rennErgebnis();
          }
        }
        return null;
      }
      if (koopHost) return phase === 'spiel' || phase === 'ende' ? koopHost.rechnen(s, acc, control) : Math.min(acc, PHYSICS_DT * 0.999);
      if (koopGast) return phase === 'spiel' || phase === 'ende' ? koopGast.rechnen(s, acc, control) : Math.min(acc, PHYSICS_DT * 0.999);
      return null;
    },
    /** The run goes on while a player looks at a menu (the partner keeps playing). */
    laeuft(): boolean {
      if (wk.aktiv()) return wk.laeuft();
      return phase === 'spiel' || phase === 'ende';
    },
    /** Guest in co-op: the host decides restarts, the own session does not reload by itself. */
    folgt(): boolean {
      if (wk.aktiv()) return wk.folgt();
      return !!koopGast;
    },
    /** The marble the camera follows: the guest's white one in co-op. */
    kamera(s: GameSession): number | null {
      if (!koopGast) return null;
      const i = s.marbleOf(1);
      return i >= 0 ? i : null;
    },
    /** The race partner as a ghost. */
    geister(dt: number): ActorSprite[] {
      if (wk.aktiv()) return wk.geister(dt);
      const g = phase === 'spiel' || phase === 'ende' ? rennen?.geistSprite(dt) : null;
      return g ? [g] : [];
    },
    /** A win: true = handled here (no single-player progress, own overlay). */
    gewonnen(s: GameSession): boolean {
      if (wk.gewonnen(s)) return true;
      if (phase === 'aus' || !v) return false;
      rennen?.imZiel(vorlauf + s.steps);
      gewonnenZeigen(s);
      return true;
    },
    /** A player action: true/false = handled here (sent or queued), null = single play. */
    aktion(a: Aktion | 'swap'): boolean | null {
      if (koopHost) {
        if (a !== 'swap') koopHost.aktion(a);
        return a !== 'swap';
      }
      if (koopGast) {
        if (a !== 'swap') koopGast.aktion(a);
        return a !== 'swap';
      }
      return null;
    },
    /** The inventory to show: the guest's own (player 2) in co-op. */
    inventar(objects: ObjectWorld): string[] | null {
      return koopGast ? objects.inventories[1] : null;
    },
  };
}

export type ZuZweit = ReturnType<typeof zuZweit>;
