// Wettkampf (docs/SPEC-wettkampf.md): menus, lobby, countdown, standings and watching, over the
// WebSocket /api/wettkampf. Hooked into the same places as „Zu zweit“ (src/mehrspieler/index.ts);
// without a room every hook answers "not active".
import './wettkampf.css';
import { PHYSICS_DT } from '../game/physics';
import { decodeInput, type Entry, type StepInput } from '../game/recording';
import { type GameSession, NO_CONTROL, type StepControl } from '../game/session';
import { packLevels } from '../packs';
import type { ActorSprite } from '../render/classic';
import { aufholen, Geister, GRUND_TEXT, type LevelWahl, type Platz, parseWk, rangliste, type Rolle, SCHRITT_MS, SENDEN_MS, type StandZeile, Strom, type WkNachricht } from './wettkampf';

/** What the module needs from the game (src/main.ts through src/mehrspieler/index.ts). */
export interface WkHost {
  session(): GameSession | null;
  packId(): string;
  levelIndex(): number;
  loadLevel(pack: string, index: number, seed?: number, carry?: number | null): Promise<void>;
  spielen(): void;
  showOverlay(title: string, html: string, buttons: [string, () => void][]): void;
  showStart(): void;
  showToast(text: string, ms?: number): void;
  formatTime(steps: number): string;
  /** The level list of „Zu zweit“; calls back with the choice. */
  levelAuswahl(fertig: (w: { pack: string; index: number }) => void, zurueck: () => void): void;
}

export const WK_FEHLERTEXT: Record<string, string> = {
  'code-unbekannt': 'Diesen Code gibt es nicht. Prüfe die fünf Ziffern.',
  'raum-voll': 'In diesem Raum fahren schon vier. Du kannst zuschauen.',
  'zuschauer-voll': 'Diesem Rennen schauen schon acht zu.',
  'zu-viele-raeume': 'Du hast schon Räume offen, oder der Server ist voll. Versuche es gleich noch einmal.',
  'zu-viele-versuche': 'Zu viele Versuche. Warte ein paar Minuten.',
  ausgelastet: 'Gerade laufen zu viele Rennen. Versuche es in ein paar Minuten noch einmal.',
  aus: 'Wettkämpfe sind gerade abgeschaltet.',
  'level-unbekannt': 'Dieses Level kennt der Server nicht. Wähle ein Level aus den Levelpaketen.',
  verfallen: 'Der Raum wurde geschlossen.',
  'kein-server': 'Keine Verbindung zum Server. Bist du online?',
};

type Ansicht = 'aus' | 'lobby' | 'laden' | 'rennen' | 'ziel' | 'ergebnis' | 'anderes';
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const name = (nr: number, du: number) => `Spieler ${nr}${nr === du ? ' (du)' : ''}`;
/** Spectators play the followed racer this far behind the clock (its input arrives in batches). */
const ZUSCHAUER_VERZUG_MS = 400;

class Sockel {
  onNachricht: (m: WkNachricht) => void = () => {};
  onZu: () => void = () => {};
  private ws: WebSocket | null = null;

  verbinden(): Promise<void> {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/wettkampf`;
    return new Promise((ok, fail) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => ok();
      ws.onerror = () => fail(new Error('kein-server'));
      ws.onclose = () => this.ws === ws && this.onZu();
      ws.onmessage = (ev) => {
        const m = parseWk(ev.data);
        if (m && this.ws === ws) this.onNachricht(m);
      };
    });
  }

  senden(m: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  schliessen(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }
}

export function wettkampf(host: WkHost) {
  let sock: Sockel | null = null;
  let ansicht: Ansicht = 'aus';
  let code = '';
  let du = 0;
  let rolle: Rolle = 'fahrer';
  let lobby: Extract<WkNachricht, { t: 'lobby' }> | null = null;
  let runde: Extract<WkNachricht, { t: 'runde' }> | null = null;
  /** performance.now() of the start (0 = no start yet). */
  let losAt = 0;
  let stand: StandZeile[] = [];
  let ergebnis: Extract<WkNachricht, { t: 'ergebnis' }> | null = null;
  let eigenesLaden = false;
  const geister = new Geister();
  // racer
  let strom = new Strom();
  let vorlauf = 0;
  let aktiv: GameSession | null = null;
  let gesendet = 0;
  let imZiel = false;
  // spectator
  let folgt = 0;
  let puffer: Entry[] = [];
  let pos = 0;
  let neuLaden = false;
  const titel = new Map<string, string>();
  const zuschauer = () => rolle === 'zuschauer';
  const imRennen = () => runde !== null && losAt > 0;

  // ---------- standings board and countdown ----------
  const tafel = document.createElement('section');
  tafel.id = 'wk-tafel';
  tafel.setAttribute('aria-label', 'Wettkampf');
  tafel.hidden = true;
  const zahl = document.createElement('div');
  zahl.id = 'wk-countdown';
  zahl.setAttribute('role', 'status');
  zahl.setAttribute('aria-live', 'assertive');
  zahl.hidden = true;
  document.body.append(tafel, zahl);

  function tafelZeigen(): void {
    if (ansicht === 'aus' || !runde) {
      tafel.hidden = true;
      return;
    }
    const zeilen = stand.length ? rangliste(stand, zuschauer() ? folgt : du) : runde.fahrer.map((nr) => ({ nr, du: nr === du, platz: null, status: 'faehrt' as const, schritte: 0 }));
    const rows = zeilen.map((p) => {
      const zustand = p.status === 'ziel' ? `<span class="wk-ziel" aria-hidden="true">✓</span> ${host.formatTime(p.schritte)}` : p.status === 'raus' ? 'raus' : `${host.formatTime(p.schritte)}`;
      const platz = p.platz !== null ? `${p.platz}.` : p.status === 'raus' ? '–' : '';
      const label = zuschauer()
        ? `<button type="button" class="wk-folgen" data-nr="${p.nr}" aria-pressed="${p.nr === folgt}"><kbd>${p.nr}</kbd> Spieler ${p.nr}</button>`
        : `<span class="wk-name">${esc(name(p.nr, du))}</span>`;
      return `<li data-status="${p.status}"${p.du ? ' data-du=""' : ''}><span class="wk-platz">${platz}</span>${label}<span class="wk-zeit">${zustand}</span></li>`;
    });
    const kopf = zuschauer() ? `Zuschauen · Spieler ${folgt}` : `Wettkampf · ${esc(code)}`;
    tafel.innerHTML = `<h2>${kopf}</h2><ol>${rows.join('')}</ol>${zuschauer() ? '<button type="button" class="wk-raus">Verlassen</button>' : ''}`;
    tafel.hidden = false;
  }

  tafel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    e.stopPropagation();
    const b = t.closest<HTMLButtonElement>('.wk-folgen');
    if (b) folgen(Number(b.dataset.nr));
    else if (t.closest('.wk-raus')) verlassen();
  });
  window.addEventListener('keydown', (e) => {
    if (!zuschauer() || ansicht === 'aus' || !runde) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && runde.fahrer.includes(n)) folgen(n);
  });

  let countdownTimer = 0;
  function countdown(): void {
    clearInterval(countdownTimer);
    const tick = () => {
      const rest = losAt - performance.now();
      if (rest > 0) {
        zahl.textContent = String(Math.ceil(rest / 1000));
        zahl.hidden = false;
        return;
      }
      zahl.textContent = 'Los!';
      if (rest < -700) {
        zahl.hidden = true;
        clearInterval(countdownTimer);
      }
    };
    tick();
    countdownTimer = window.setInterval(tick, 100);
  }

  // ---------- connection ----------
  async function verbinden(): Promise<Sockel> {
    sock?.schliessen();
    const s = new Sockel();
    sock = s;
    s.onNachricht = (m) => sock === s && empfangen(m);
    s.onZu = () => {
      if (sock !== s || ansicht === 'aus') return;
      aufraeumen();
      host.showOverlay('Wettkampf', 'Die Verbindung zum Server ist abgebrochen.', [['Zurück', host.showStart]]);
    };
    await s.verbinden();
    return s;
  }

  /** Waits for the room (or an error) after opening or joining. */
  function raumAntwort(s: Sockel): Promise<void> {
    return new Promise((ok, fail) => {
      const vorher = s.onNachricht;
      s.onNachricht = (m) => {
        if (m.t === 'fehler') {
          s.onNachricht = vorher;
          fail(new Error(m.grund));
        } else if (m.t === 'raum') {
          s.onNachricht = vorher;
          vorher(m);
          ok();
        }
      };
    });
  }

  function aufraeumen(): void {
    const s = sock;
    sock = null;
    s?.schliessen();
    ansicht = 'aus';
    runde = null;
    lobby = null;
    ergebnis = null;
    stand = [];
    losAt = 0;
    aktiv = null;
    geister.leeren();
    tafel.hidden = true;
    zahl.hidden = true;
    clearInterval(countdownTimer);
  }

  function verlassen(): void {
    aufraeumen();
    host.showStart();
  }

  function fehlerZeigen(titel: string, grund: string, nochmal: () => void): void {
    host.showOverlay(titel, esc(WK_FEHLERTEXT[grund] ?? 'Das hat nicht geklappt.'), [
      ['Nochmal', nochmal],
      ['Zurück', menue],
    ]);
  }

  // ---------- menus ----------
  function menue(): void {
    if (ansicht !== 'aus') return laufendMenue();
    host.showOverlay(
      'Wettkampf',
      'Ein Wettrennen für bis zu vier im selben Level, dazu Zuschauer. Unser Server rechnet jeden Lauf mit und entscheidet, wer gewinnt.<br><span class="keys">Alles läuft über unseren Server in Deutschland; die anderen sehen deine IP-Adresse nicht. Gespeichert wird nichts.</span>',
      [
        ['Raum öffnen', levelFrage],
        ['Mitfahren', () => codeForm('fahrer')],
        ['Zuschauen', () => codeForm('zuschauer')],
        ['Zurück', host.showStart],
      ],
    );
  }

  function levelFrage(): void {
    const s = host.session();
    host.showOverlay('Welches Level?', s ? `Aktuell: <b>${esc(s.level.title)}</b>` : '', [
      ['Dieses Level', () => void oeffnen({ pack: host.packId(), index: host.levelIndex() })],
      ['Anderes Level', () => host.levelAuswahl((w) => void oeffnen(w), levelFrage)],
      ['Zurück', menue],
    ]);
  }

  async function levelVon(w: { pack: string; index: number }): Promise<LevelWahl | null> {
    const levels = await packLevels(w.pack).catch(() => null);
    const l = levels?.[w.index];
    if (!l) return null;
    titel.set(l.id, l.title);
    return { pack: w.pack, index: w.index, id: l.id };
  }

  async function oeffnen(w: { pack: string; index: number }): Promise<void> {
    host.showOverlay('Raum öffnen', '<span class="zz-warte">Einen Moment …</span>', [['Abbrechen', () => (aufraeumen(), menue())]]);
    const level = await levelVon(w);
    if (!level) return fehlerZeigen('Raum öffnen', 'level-unbekannt', levelFrage);
    try {
      const s = await verbinden();
      const antwort = raumAntwort(s);
      s.senden({ t: 'oeffnen', level });
      await antwort;
    } catch (err) {
      aufraeumen();
      fehlerZeigen('Raum öffnen', (err as Error).message, () => void oeffnen(w));
    }
  }

  function codeForm(als: Rolle): void {
    host.showOverlay(als === 'fahrer' ? 'Mitfahren' : 'Zuschauen', 'Gib den fünfstelligen Code ein, den die Spielleitung sieht.', [['Zurück', menue]]);
    const form = document.getElementById('ov-form') as HTMLElement;
    form.innerHTML = `<form class="konto-form zz-form" novalidate>
      <label for="wk-code">Raumcode</label>
      <input id="wk-code" name="code" inputmode="numeric" autocomplete="off" pattern="[0-9]{5}" maxlength="5" placeholder="00000" required aria-describedby="wk-fehler">
      <p id="wk-fehler" class="konto-hinweis" aria-live="assertive"></p>
      <button type="submit" class="primary wide">${als === 'fahrer' ? 'Mitfahren' : 'Zuschauen'}</button>
    </form>`;
    form.hidden = false;
    const input = form.querySelector('input') as HTMLInputElement;
    const fehler = form.querySelector('#wk-fehler') as HTMLElement;
    const knopf = form.querySelector('button') as HTMLButtonElement;
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 5);
      fehler.textContent = '';
    });
    input.focus();
    form.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!/^\d{5}$/.test(input.value)) {
        fehler.textContent = 'Der Code hat fünf Ziffern.';
        return;
      }
      knopf.disabled = true;
      knopf.textContent = 'Verbinde …';
      try {
        const s = await verbinden();
        const antwort = raumAntwort(s);
        s.senden({ t: 'beitreten', code: input.value, als });
        await antwort;
      } catch (err) {
        aufraeumen();
        fehler.textContent = WK_FEHLERTEXT[(err as Error).message] ?? 'Das hat nicht geklappt.';
        knopf.disabled = false;
        knopf.textContent = als === 'fahrer' ? 'Mitfahren' : 'Zuschauen';
      }
    });
  }

  /** The menu while in a room (menu button „Zu zweit“ during play). */
  function laufendMenue(): void {
    if (ansicht === 'lobby' || ansicht === 'anderes') return void lobbyZeigen();
    if (ansicht === 'ergebnis') return ergebnisZeigen();
    const knoepfe: [string, () => void][] = [];
    if (!zuschauer() && ansicht === 'rennen' && !imZiel) knoepfe.push(['Weiterspielen', host.spielen], ['Aufgeben', aufgeben]);
    if (zuschauer()) knoepfe.push(['Weiter zuschauen', zuschauen]);
    knoepfe.push(['Wettkampf verlassen', verlassen]);
    host.showOverlay('Wettkampf', `Raum ${esc(code)} · ${zuschauer() ? 'du schaust zu' : esc(name(du, du))}`, knoepfe);
  }

  function aufgeben(): void {
    if (runde && !imZiel) sock?.senden({ t: 'aufgeben', runde: runde.runde });
    imZiel = true;
    host.showOverlay('Aufgegeben', '<span class="zz-warte">Die anderen fahren noch …</span>', [['Wettkampf verlassen', verlassen]]);
  }

  async function lobbyZeigen(): Promise<void> {
    ansicht = 'lobby';
    const l = lobby;
    if (!l) return;
    if (!titel.has(l.level.id)) await levelVon(l.level);
    if (ansicht !== 'lobby' || lobby !== l) return;
    const leiter = !zuschauer() && l.leiter === du;
    const liste = l.fahrer.map((nr) => `<li>${esc(name(nr, du))}${nr === l.leiter ? ' · Spielleitung' : ''}</li>`).join('');
    const warten =
      l.phase !== 'lobby'
        ? '<span class="zz-warte">Ein Rennen läuft – du bist in der nächsten Runde dabei.</span>'
        : leiter
          ? l.fahrer.length < 2
            ? '<span class="zz-warte">Warte auf mindestens einen Mitfahrer …</span>'
            : 'Alle da? Dann starte das Rennen.'
          : '<span class="zz-warte">Die Spielleitung startet das Rennen …</span>';
    const knoepfe: [string, () => void][] = [];
    if (leiter && l.phase === 'lobby' && l.fahrer.length >= 2) knoepfe.push(['Start', () => sock?.senden({ t: 'start' })]);
    if (leiter && l.phase === 'lobby') knoepfe.push(['Level ändern', levelAendern]);
    knoepfe.push(['Verlassen', verlassen]);
    host.showOverlay(
      zuschauer() ? 'Zuschauen' : 'Wettkampf',
      `<span class="zz-code" aria-label="Raumcode ${code.split('').join(' ')}">${esc(code)}</span>` +
        `Level: <b>${esc(titel.get(l.level.id) ?? l.level.id)}</b>` +
        `<ul class="wk-liste" aria-label="Fahrer">${liste}</ul>` +
        `${l.zuschauer ? `${l.zuschauer} ${l.zuschauer === 1 ? 'schaut' : 'schauen'} zu · ` : ''}${l.fahrer.length} von 4 Fahrern<br>${warten}`,
      knoepfe,
    );
  }

  function levelAendern(): void {
    ansicht = 'anderes';
    host.levelAuswahl(
      (w) =>
        void levelVon(w).then((level) => {
          if (!level) return fehlerZeigen('Level ändern', 'level-unbekannt', levelAendern);
          sock?.senden({ t: 'level', level });
          void lobbyZeigen();
        }),
      () => void lobbyZeigen(),
    );
  }

  // ---------- messages ----------
  function empfangen(m: WkNachricht): void {
    switch (m.t) {
      case 'raum':
        code = m.code;
        du = m.du;
        rolle = m.rolle;
        ansicht = 'lobby';
        return;
      case 'lobby':
        lobby = m;
        if (ansicht === 'lobby') void lobbyZeigen();
        return;
      case 'runde':
        void rundeLaden(m);
        return;
      case 'los':
        if (!runde || m.runde !== runde.runde) return;
        losAt = performance.now() + m.in;
        countdown();
        if (zuschauer()) zuschauen();
        else if (ansicht === 'laden') {
          ansicht = 'rennen';
          host.showOverlay('Gleich geht’s los', 'Die halbdurchsichtigen Murmeln sind die anderen. Rechts oben siehst du, wer vorn liegt.', [['Spielen', host.spielen]]);
        }
        tafelZeigen();
        return;
      case 'stand':
        if (!runde || m.runde !== runde.runde) return;
        // someone else is through: the others have two more minutes (docs/SPEC-wettkampf.md 4)
        if (!stand.some((z) => z[5] === 'ziel') && m.f.some((z) => z[5] === 'ziel' && z[0] !== du) && !imZiel) {
          const erster = m.f.find((z) => z[5] === 'ziel')!;
          host.showToast(`Spieler ${erster[0]} ist im Ziel (${host.formatTime(erster[6] ?? 0)}). ${zuschauer() ? 'Die anderen' : 'Du'} ${zuschauer() ? 'haben' : 'hast'} noch 2 Minuten.`, 3500);
        }
        stand = m.f;
        geister.stand(m.f, zuschauer() ? folgt : du);
        tafelZeigen();
        return;
      case 'verlauf':
        if (!zuschauer() || !runde || m.runde !== runde.runde || m.fahrer !== folgt) return;
        if (m.i === puffer.length) puffer.push(...m.e);
        else if (m.i > puffer.length) sock?.senden({ t: 'folgen', fahrer: folgt }); // a gap: everything again
        return;
      case 'ergebnis':
        if (!runde || m.runde !== runde.runde) return;
        ergebnis = m;
        ansicht = 'ergebnis';
        zahl.hidden = true;
        ergebnisZeigen();
        return;
      case 'fehler':
        if (m.grund === 'verfallen') {
          aufraeumen();
          host.showOverlay('Wettkampf', WK_FEHLERTEXT.verfallen, [['Zurück', host.showStart]]);
        } else if (WK_FEHLERTEXT[m.grund]) host.showToast(WK_FEHLERTEXT[m.grund], 3500);
        return;
    }
  }

  async function laden(level: LevelWahl, seed: number, carry: number | null): Promise<GameSession | null> {
    eigenesLaden = true;
    try {
      await host.loadLevel(level.pack, level.index, seed, carry);
    } finally {
      eigenesLaden = false;
    }
    const s = host.session();
    return s && s.level.id === level.id && s.seed === seed ? s : null;
  }

  async function rundeLaden(m: Extract<WkNachricht, { t: 'runde' }>): Promise<void> {
    runde = m;
    ergebnis = null;
    stand = [];
    losAt = 0;
    geister.leeren();
    strom = new Strom();
    vorlauf = 0;
    gesendet = 0;
    imZiel = false;
    auto = null;
    titel.set(m.level.id, titel.get(m.level.id) ?? m.level.id);
    const mitdabei = zuschauer() || m.fahrer.includes(du);
    if (!mitdabei) return; // joined during the round: next round
    ansicht = 'laden';
    host.showOverlay(zuschauer() ? 'Zuschauen' : 'Wettkampf', '<span class="zz-warte">Lade das Level …</span>', [['Wettkampf verlassen', verlassen]]);
    if (zuschauer()) {
      folgt = m.fahrer.includes(folgt) ? folgt : m.fahrer[0];
      puffer = [];
      pos = 0;
    }
    const s = await laden(m.level, m.seed, null);
    if (runde !== m) return;
    if (!s) {
      host.showOverlay('Level nicht gefunden', 'Dein Spiel hat dieses Level nicht. Lade die Seite neu und tritt noch einmal bei.', [['Wettkampf verlassen', verlassen]]);
      return;
    }
    aktiv = s;
    if (zuschauer()) {
      sock?.senden({ t: 'folgen', fahrer: folgt });
      host.showOverlay('Zuschauen', '<span class="zz-warte">Gleich geht es los …</span>', [['Wettkampf verlassen', verlassen]]);
    } else sock?.senden({ t: 'bereit', runde: m.runde });
    tafelZeigen();
  }

  function ergebnisZeigen(): void {
    const e = ergebnis;
    if (!e) return void lobbyZeigen();
    const zeilen = e.plaetze.map((p: Platz) => {
      const was = p.status === 'ziel' && p.zeit !== null ? host.formatTime(p.zeit) : esc(GRUND_TEXT[p.grund ?? ''] ?? 'nicht im Ziel');
      return `<li${p.nr === du && !zuschauer() ? ' data-du=""' : ''}><span class="wk-platz">${p.platz !== null ? `${p.platz}.` : '–'}</span><span class="wk-name">${esc(name(p.nr, zuschauer() ? 0 : du))}</span><span class="wk-zeit">${was}</span></li>`;
    });
    const mein = e.plaetze.find((p) => p.nr === du);
    const titel = e.abbruch ? 'Rennen abgebrochen' : zuschauer() ? 'Ergebnis' : mein?.platz === 1 ? 'Gewonnen!' : mein?.platz ? `Platz ${mein.platz}` : 'Ergebnis';
    const leiter = !zuschauer() && lobby?.leiter === du;
    const knoepfe: [string, () => void][] = leiter
      ? [
          ['Nochmal', () => sock?.senden({ t: 'start' })],
          ['Anderes Level', levelAendern],
          ['Wettkampf verlassen', verlassen],
        ]
      : [
          ['Zur Lobby', () => void lobbyZeigen()],
          ['Wettkampf verlassen', verlassen],
        ];
    host.showOverlay(
      titel,
      `${e.abbruch ? 'Der Server konnte das Rennen nicht zu Ende rechnen. Es zählt nicht.<br>' : ''}<ol class="wk-ergebnis">${zeilen.join('')}</ol><span class="keys">Zeiten und Plätze hat der Server aus euren Eingaben nachgerechnet.</span>`,
      knoepfe,
    );
    tafel.hidden = true;
  }

  // ---------- watching ----------
  function zuschauen(): void {
    ansicht = 'rennen';
    const ov = document.getElementById('overlay');
    if (ov) ov.hidden = true;
    tafelZeigen();
  }

  function folgen(nr: number): void {
    if (!runde || !runde.fahrer.includes(nr) || nr === folgt) return;
    folgt = nr;
    puffer = [];
    pos = 0;
    vorlauf = 0;
    geister.stand(stand, folgt);
    const r = runde;
    neuLaden = true;
    void laden(r.level, r.seed, null).then((s) => {
      neuLaden = false;
      if (runde !== r || !s) return;
      aktiv = s;
      sock?.senden({ t: 'folgen', fahrer: nr });
    });
    tafelZeigen();
  }

  /** Spectator: plays the followed racer's input, a little behind the clock (fast when far behind). */
  function nachspielen(s: GameSession): void {
    if (neuLaden || s !== aktiv || s.won) return;
    const soll = Math.floor((performance.now() - losAt - ZUSCHAUER_VERZUG_MS) / SCHRITT_MS) - vorlauf;
    let n = Math.min(soll - s.steps, 4000);
    while (n > 0 && pos < puffer.length) {
      const e = puffer[pos];
      if (e[1] === 'restart') {
        // the racer starts over: lives carried as the run decides, like the shell in main.ts
        const carry = s.restartRequested === 'keep' ? s.livesLeft() : null;
        vorlauf += s.steps;
        pos++;
        neuLaden = true;
        const r = runde!;
        void laden(r.level, r.seed, carry).then((neu) => {
          neuLaden = false;
          if (runde === r && neu) aktiv = neu;
        });
        return;
      }
      if (typeof e[1] === 'string') {
        for (let k = 0; k < e[0]; k++) s.act(e[1] as Parameters<GameSession['act']>[0]);
        pos++;
        continue;
      }
      const [anzahl, fx, fy, ax = 0, ay = 0] = e as number[];
      const c = { fx: fx / 1024, fy: fy / 1024, ax: ax / 1024, ay: ay / 1024 };
      const k = Math.min(anzahl, n);
      for (let i = 0; i < k; i++) s.step(c);
      n -= k;
      if (k === anzahl) pos++;
      else puffer[pos] = [anzahl - k, fx, fy, ax, ay] as Entry;
      if (s.won) return;
    }
  }

  // Dev server only: the browser test drives a racer with a stored solution (its input, step by step
  // with the clock, also in a background tab) and looks inside.
  let auto: Iterator<StepInput> | null = null;
  if (import.meta.env.DEV) {
    const autoTick = () => {
      const s = host.session();
      if (!auto || !runde || !losAt || imZiel || !s || s !== aktiv) return;
      const soll = Math.floor((performance.now() - losAt) / SCHRITT_MS);
      while (vorlauf + s.steps < soll && !s.won) {
        const n = auto.next();
        if (n.done) break;
        for (const a of n.value.actions) s.act(a);
        s.step(n.value);
      }
      // the same pace as the game (the server allows 200 messages per 10 s)
      const t = performance.now();
      if (imZiel || t - gesendet < SENDEN_MS) return;
      gesendet = t;
      const teil = strom.nehmen(s);
      if (teil.e.length) sock?.senden({ t: 'eingabe', runde: runde.runde, ...teil });
    };
    setInterval(autoTick, 50);
    (window as unknown as { __wettkampf: object }).__wettkampf = {
      zustand: () => ({ ansicht, code, du, rolle, folgt, los: losAt > 0, stand, ergebnis, schritte: vorlauf + (host.session()?.steps ?? 0), level: host.session()?.level.id, puffer: puffer.length }),
      autopilot: (rec: { steps: number; input: Entry[] }) => (auto = decodeInput({ v: 1, steps: rec.steps, input: rec.input })[Symbol.iterator]()),
    };
  }

  // ---------- hooks ----------
  return {
    menue,
    aktiv: () => ansicht !== 'aus',
    laeuft: () => imRennen() && (ansicht === 'rennen' || ansicht === 'ziel' || ansicht === 'ergebnis' || ansicht === 'laden'),
    /** Spectators follow the input; the own run does not restart by itself. */
    folgt: () => ansicht !== 'aus' && zuschauer(),
    seed(pack: string, index: number): number | undefined {
      return ansicht !== 'aus' && runde && runde.level.pack === pack && runde.level.index === index ? runde.seed : undefined;
    },
    /** After a level load not made here: a racer starting over. */
    levelGeladen(s: GameSession): boolean {
      if (ansicht === 'aus') return false;
      // own loads, spectators, after the finish, or another level picked from the menu: nothing to send
      if (eigenesLaden || zuschauer() || !runde || !imRennen() || imZiel || s.level.id !== runde.level.id) return true;
      const teil = strom.neustart(aktiv);
      if (aktiv) vorlauf += aktiv.steps;
      aktiv = s;
      sock?.senden({ t: 'eingabe', runde: runde.runde, ...teil });
      return true;
    },
    rechnen(s: GameSession, acc: number, _control: StepControl): number | null {
      void _control;
      if (ansicht === 'aus' || !runde) return null;
      const halten = Math.min(acc, PHYSICS_DT * 0.999);
      if (!losAt || performance.now() < losAt) return halten;
      if (zuschauer()) {
        nachspielen(s);
        return halten;
      }
      if (s !== aktiv || imZiel) return imZiel ? null : halten;
      if (auto) return halten;
      // keep up with the clock: a tab in the background or a slow device must not race in slow motion
      const fehlt = aufholen(performance.now() - losAt, vorlauf + s.steps);
      for (let i = 0; i < fehlt && !s.won; i++) s.step(NO_CONTROL);
      const t = performance.now();
      if (t - gesendet >= SENDEN_MS) {
        gesendet = t;
        const teil = strom.nehmen(s);
        if (teil.e.length) sock?.senden({ t: 'eingabe', runde: runde.runde, ...teil });
      }
      return null;
    },
    geister(dt: number): ActorSprite[] {
      return imRennen() && ansicht !== 'aus' ? geister.sprites(dt) : [];
    },
    /** A win: true = handled here (no single-player progress). */
    gewonnen(s: GameSession): boolean {
      if (ansicht === 'aus') return false;
      if (zuschauer() || !runde || imZiel || s !== aktiv) return true;
      imZiel = true;
      ansicht = 'ziel';
      const teil = strom.nehmen(s, true);
      if (teil.e.length) sock?.senden({ t: 'eingabe', runde: runde.runde, ...teil });
      sock?.senden({ t: 'ziel', runde: runde.runde, schritte: vorlauf + s.steps });
      const r = runde;
      setTimeout(() => {
        if (runde !== r || ansicht !== 'ziel') return;
        host.showOverlay('Im Ziel!', `Deine Zeit ${host.formatTime(vorlauf + s.steps)}<br><span class="zz-warte">Der Server prüft deinen Lauf, die anderen fahren noch …</span>`, [['Wettkampf verlassen', verlassen]]);
      }, 700);
      return true;
    },
  };
}

export type Wettkampf = ReturnType<typeof wettkampf>;
