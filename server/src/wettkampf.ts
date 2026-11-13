import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { RateLimit } from './limit.ts';
import { upgradeIp, wsPfad } from './raum.ts';
import type { Auftrag, Eintrag, LaufStand, Rechner } from './wettkampf-rechner.ts';

/**
 * Wettkampf (docs/SPEC-wettkampf.md): races of up to 4 racers plus spectators, the server as referee.
 * Every browser plays its own run and streams its input per physics step; the server plays the same
 * input in its own process (wettkampf-rechner.ts) and only its result counts. Everything lives in
 * memory only: no database, no IP addresses in logs.
 */

/** Physics step of the game in ms (src/game/physics.ts PHYSICS_DT = 0.0025 s; the server has no game code). */
export const DT_MS = 2.5;
export const PFAD = '/api/wettkampf';

export const WK = {
  maxFahrer: 4,
  maxZuschauer: 8,
  maxRaeume: 40,
  maxRennen: 6,
  /** Share of one core the referee process may use before no new race starts. */
  maxLast: 0.7,
  raeumeJeIp: 2,
  socketsJeIp: 10,
  oeffnenJeIp: { max: 20, windowMs: 10 * 60_000 },
  beitritteJeIp: { max: 30, windowMs: 10 * 60_000 },
  nachrichten: { max: 200, windowMs: 10_000 },
  maxBytes: 16 * 1024,
  taktMs: 100,
  ladenMs: 20_000,
  countdownMs: 3000,
  /** A racer may be this far ahead of the clock (the countdown starts on arrival)… */
  vorlaufMs: 1000,
  /** …and at most this far behind it. */
  rueckstandMs: 20_000,
  /** 15 min of play per round. */
  maxSchritte: 360_000,
  maxEintraege: 300_000,
  eintraegeJeNachricht: 4000,
  verlaufStueck: 2000,
  lobbyIdleMs: 15 * 60_000,
};

export type Rolle = 'fahrer' | 'zuschauer';
export type Status = 'faehrt' | 'ziel' | 'raus';
export type Grund = 'aufgegeben' | 'weg' | 'abweichung' | 'zu-schnell' | 'zu-langsam' | 'zeit' | 'ungueltig' | 'fehler';
export type Phase = 'lobby' | 'laden' | 'rennen';
export type Fehler =
  | 'code-unbekannt'
  | 'raum-voll'
  | 'zuschauer-voll'
  | 'zu-viele-raeume'
  | 'zu-viele-versuche'
  | 'ausgelastet'
  | 'aus'
  | 'level-unbekannt'
  | 'ungueltig'
  | 'zu-gross'
  | 'verfallen';

export interface LevelWahl {
  pack: string;
  index: number;
  id: string;
}

export interface Platz {
  nr: number;
  platz: number | null;
  zeit: number | null;
  status: Status;
  grund?: Grund;
}

/** [nr, x, y, colour, steps, status, time] */
export type StandZeile = [number, number, number, number, number, Status, number | null];

export type WkNachricht =
  | { t: 'raum'; code: string; du: number; rolle: Rolle }
  | { t: 'lobby'; leiter: number; fahrer: number[]; zuschauer: number; level: LevelWahl; phase: Phase }
  | { t: 'runde'; runde: number; level: LevelWahl; seed: number; fahrer: number[] }
  | { t: 'los'; runde: number; in: number }
  | { t: 'stand'; runde: number; f: StandZeile[] }
  | { t: 'verlauf'; runde: number; fahrer: number; i: number; e: Eintrag[] }
  | { t: 'ergebnis'; runde: number; plaetze: Platz[]; abbruch?: true }
  | { t: 'fehler'; grund: Fehler };

/** One connected browser (a WebSocket, or a stand-in in tests). */
export interface WkPeer {
  readonly ip: string;
  send(msg: WkNachricht): void;
  close(): void;
}

interface Teilnehmer {
  peer: WkPeer;
  rolle: Rolle;
  /** 1–4 for racers, 0 for spectators. */
  nr: number;
  /** Spectators: the racer whose input they get. */
  folgt: number | null;
}

interface Lauf {
  nr: number;
  bereit: boolean;
  /** Steps received (total, across restarts). */
  empfangen: number;
  /** All entries of this round (spectators joining later get them). */
  eintraege: Eintrag[];
  /** Entries not yet given to the referee. */
  neu: Eintrag[];
  gestartet: boolean;
  sim: LaufStand | null;
  status: Status;
  zeit: number | null;
  grund?: Grund;
  /** Steps the browser said it needed (its claim of the win). */
  claim: number | null;
}

interface Runde {
  nr: number;
  level: LevelWahl;
  seed: number;
  phase: 'laden' | 'rennen';
  ladenBis: number;
  losAt: number;
  laeufe: Map<number, Lauf>;
}

interface Raum {
  code: string;
  leiter: number;
  fahrer: Map<number, Teilnehmer>;
  zuschauer: Set<Teilnehmer>;
  level: LevelWahl;
  runde: Runde | null;
  rundeNr: number;
  zuletzt: number;
}

export interface WettkampfOptions {
  rechner: Rechner;
  now?: () => number;
  /** Random 5-digit code (tests). */
  code?: () => string;
  seed?: () => number;
}

const str = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const int = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const AKTIONEN = new Set(['use', 'drop', 'rotate', 'swap']);

export function levelWahl(x: unknown): LevelWahl | null {
  const l = x as Partial<LevelWahl> | null;
  if (!l || typeof l !== 'object') return null;
  return str(l.pack, 100) && int(l.index, 0, 100_000) && str(l.id, 200) ? { pack: l.pack, index: l.index, id: l.id } : null;
}

/** Checks input entries from a browser (like decodeInput); returns the number of steps, or null. */
export function eintraegePruefen(e: unknown): number | null {
  if (!Array.isArray(e) || e.length > WK.eintraegeJeNachricht) return null;
  let schritte = 0;
  for (const x of e) {
    if (!Array.isArray(x) || !int(x[0], 1, WK.maxSchritte)) return null;
    if (typeof x[1] === 'string') {
      if (x.length !== 2) return null;
      if (x[1] === 'restart' ? x[0] !== 1 : !AKTIONEN.has(x[1]) || x[0] > 16) return null;
      continue;
    }
    if (!(x.length === 3 || x.length === 5) || !x.slice(1).every((v: unknown) => int(v, -1e9, 1e9))) return null;
    schritte += x[0];
  }
  return schritte;
}

export class WettkampfHub {
  private readonly raeume = new Map<string, Raum>();
  private readonly raumVon = new Map<WkPeer, Raum>();
  private readonly teilnehmer = new Map<WkPeer, Teilnehmer>();
  private readonly verbunden = new Set<WkPeer>();
  private readonly sockets = new Map<string, number>();
  private readonly oeffnen = new RateLimit(WK.oeffnenJeIp.max, WK.oeffnenJeIp.windowMs);
  private readonly beitritte = new RateLimit(WK.beitritteJeIp.max, WK.beitritteJeIp.windowMs);
  private readonly zaehler = new WeakMap<WkPeer, { start: number; count: number }>();
  private readonly rechner: Rechner;
  private readonly now: () => number;
  private readonly neuerCode: () => string;
  private readonly neuerSeed: () => number;
  /** Runs the referee may forget. */
  private weg: string[] = [];
  private beschaeftigt = false;
  /** Compute time of the referee process [at, ms] over the last 10 s. */
  private lastFenster: [number, number][] = [];

  constructor({ rechner, now = Date.now, code = () => String(randomInt(100_000)).padStart(5, '0'), seed = () => randomInt(2 ** 32) }: WettkampfOptions) {
    this.rechner = rechner;
    this.now = now;
    this.neuerCode = code;
    this.neuerSeed = seed;
  }

  get raumZahl(): number {
    return this.raeume.size;
  }

  get rennenZahl(): number {
    let n = 0;
    for (const r of this.raeume.values()) if (r.runde) n++;
    return n;
  }

  /** Share of one core the referee used over the last 10 s. */
  get last(): number {
    const ab = this.now() - 10_000;
    this.lastFenster = this.lastFenster.filter(([t]) => t >= ab);
    return this.lastFenster.reduce((s, [, ms]) => s + ms, 0) / 10_000;
  }

  /** A new connection; false = too many from this IP (the caller closes it). */
  connect(peer: WkPeer): boolean {
    const n = this.sockets.get(peer.ip) ?? 0;
    if (n >= WK.socketsJeIp) return false;
    this.sockets.set(peer.ip, n + 1);
    this.verbunden.add(peer);
    return true;
  }

  disconnect(peer: WkPeer): void {
    if (!this.verbunden.delete(peer)) return;
    const n = (this.sockets.get(peer.ip) ?? 1) - 1;
    if (n > 0) this.sockets.set(peer.ip, n);
    else this.sockets.delete(peer.ip);
    this.verlassen(peer);
  }

  /** One text message of a browser. */
  async message(peer: WkPeer, raw: string): Promise<void> {
    const now = this.now();
    if (raw.length > WK.maxBytes) return peer.send({ t: 'fehler', grund: 'zu-gross' });
    const z = this.zaehler.get(peer);
    if (!z || now - z.start >= WK.nachrichten.windowMs) this.zaehler.set(peer, { start: now, count: 1 });
    else if (++z.count > WK.nachrichten.max) return peer.send({ t: 'fehler', grund: 'zu-viele-versuche' });
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      return peer.send({ t: 'fehler', grund: 'ungueltig' });
    }
    if (!m || typeof m !== 'object') return peer.send({ t: 'fehler', grund: 'ungueltig' });
    const raum = this.raumVon.get(peer);
    const tn = this.teilnehmer.get(peer);
    if (raum) raum.zuletzt = now;
    switch (m.t) {
      case 'oeffnen':
        return raum ? peer.send({ t: 'fehler', grund: 'ungueltig' }) : this.oeffnenRaum(peer, m.level, now);
      case 'beitreten':
        return raum ? peer.send({ t: 'fehler', grund: 'ungueltig' }) : this.beitreten(peer, m.code, m.als, now);
      case 'ping':
        return;
    }
    if (!raum || !tn) return peer.send({ t: 'fehler', grund: 'ungueltig' });
    const lauf = tn.rolle === 'fahrer' && raum.runde && m.runde === raum.runde.nr ? raum.runde.laeufe.get(tn.nr) : undefined;
    switch (m.t) {
      case 'level':
        return this.levelSetzen(raum, tn, m.level);
      case 'start':
        return this.start(raum, tn, now);
      case 'bereit':
        if (!lauf || raum.runde?.phase !== 'laden') return;
        lauf.bereit = true;
        if ([...raum.runde.laeufe.values()].every((l) => l.bereit)) this.los(raum, now);
        return;
      case 'eingabe':
        return lauf ? this.eingabe(raum, lauf, m.ab, m.e, now) : undefined;
      case 'ziel':
        if (lauf && lauf.status === 'faehrt' && int(m.schritte, 1, WK.maxSchritte)) lauf.claim = m.schritte;
        return;
      case 'aufgeben':
        if (lauf && lauf.status === 'faehrt') this.raus(raum, lauf, 'aufgegeben');
        return;
      case 'folgen':
        return this.folgen(raum, tn, m.fahrer);
      default:
        return peer.send({ t: 'fehler', grund: 'ungueltig' });
    }
  }

  // ---------- rooms ----------

  private async oeffnenRaum(peer: WkPeer, rawLevel: unknown, now: number): Promise<void> {
    if (!this.rechner.verfuegbar()) return peer.send({ t: 'fehler', grund: 'aus' });
    const level = levelWahl(rawLevel);
    if (!level) return peer.send({ t: 'fehler', grund: 'ungueltig' });
    let mine = 0;
    for (const r of this.raeume.values()) if (r.fahrer.get(r.leiter)?.peer.ip === peer.ip) mine++;
    if (mine >= WK.raeumeJeIp || this.raeume.size >= WK.maxRaeume) return peer.send({ t: 'fehler', grund: 'zu-viele-raeume' });
    if (!this.oeffnen.take(peer.ip, now)) return peer.send({ t: 'fehler', grund: 'zu-viele-versuche' });
    if (!(await this.kennt(level.id))) return peer.send({ t: 'fehler', grund: 'level-unbekannt' });
    // the browser may have left or opened another room meanwhile
    if (!this.verbunden.has(peer) || this.raumVon.has(peer) || this.raeume.size >= WK.maxRaeume) return;
    let code = this.neuerCode();
    for (let i = 0; this.raeume.has(code); i++) {
      if (i > 50) return peer.send({ t: 'fehler', grund: 'zu-viele-raeume' });
      code = this.neuerCode();
    }
    const tn: Teilnehmer = { peer, rolle: 'fahrer', nr: 1, folgt: null };
    const raum: Raum = { code, leiter: 1, fahrer: new Map([[1, tn]]), zuschauer: new Set(), level, runde: null, rundeNr: 0, zuletzt: now };
    this.raeume.set(code, raum);
    this.raumVon.set(peer, raum);
    this.teilnehmer.set(peer, tn);
    peer.send({ t: 'raum', code, du: 1, rolle: 'fahrer' });
    this.lobby(raum);
  }

  private async kennt(level: string): Promise<boolean> {
    try {
      return await this.rechner.kennt(level);
    } catch {
      return false;
    }
  }

  private beitreten(peer: WkPeer, code: unknown, als: unknown, now: number): void {
    if (!this.beitritte.take(peer.ip, now)) return peer.send({ t: 'fehler', grund: 'zu-viele-versuche' });
    if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return peer.send({ t: 'fehler', grund: 'code-unbekannt' });
    const raum = this.raeume.get(code);
    if (!raum) return peer.send({ t: 'fehler', grund: 'code-unbekannt' });
    const rolle: Rolle = als === 'zuschauer' ? 'zuschauer' : 'fahrer';
    let tn: Teilnehmer;
    if (rolle === 'fahrer') {
      if (raum.fahrer.size >= WK.maxFahrer) return peer.send({ t: 'fehler', grund: 'raum-voll' });
      let nr = 1;
      while (raum.fahrer.has(nr)) nr++;
      tn = { peer, rolle, nr, folgt: null };
      raum.fahrer.set(nr, tn);
    } else {
      if (raum.zuschauer.size >= WK.maxZuschauer) return peer.send({ t: 'fehler', grund: 'zuschauer-voll' });
      tn = { peer, rolle, nr: 0, folgt: null };
      raum.zuschauer.add(tn);
    }
    raum.zuletzt = now;
    this.raumVon.set(peer, raum);
    this.teilnehmer.set(peer, tn);
    peer.send({ t: 'raum', code, du: tn.nr, rolle });
    this.lobby(raum);
    // a spectator joining a running round: the round and its start, then the input of whom they follow
    const r = raum.runde;
    if (rolle === 'zuschauer' && r) {
      peer.send({ t: 'runde', runde: r.nr, level: r.level, seed: r.seed, fahrer: [...r.laeufe.keys()] });
      if (r.phase === 'rennen') peer.send({ t: 'los', runde: r.nr, in: Math.max(0, r.losAt - now) });
    }
  }

  private levelSetzen(raum: Raum, tn: Teilnehmer, raw: unknown): void {
    const level = levelWahl(raw);
    if (!level || tn.nr !== raum.leiter || tn.rolle !== 'fahrer' || raum.runde) return tn.peer.send({ t: 'fehler', grund: 'ungueltig' });
    void this.kennt(level.id).then((ok) => {
      if (!ok) return tn.peer.send({ t: 'fehler', grund: 'level-unbekannt' });
      if (this.raeume.get(raum.code) !== raum || raum.runde) return;
      raum.level = level;
      this.lobby(raum);
    });
  }

  private start(raum: Raum, tn: Teilnehmer, now: number): void {
    if (tn.rolle !== 'fahrer' || tn.nr !== raum.leiter || raum.runde || raum.fahrer.size < 2) return tn.peer.send({ t: 'fehler', grund: 'ungueltig' });
    if (!this.rechner.verfuegbar()) return tn.peer.send({ t: 'fehler', grund: 'aus' });
    if (this.rennenZahl >= WK.maxRennen || this.last > WK.maxLast) return tn.peer.send({ t: 'fehler', grund: 'ausgelastet' });
    const nr = ++raum.rundeNr;
    const laeufe = new Map<number, Lauf>();
    for (const f of raum.fahrer.keys()) {
      laeufe.set(f, { nr: f, bereit: false, empfangen: 0, eintraege: [], neu: [], gestartet: false, sim: null, status: 'faehrt', zeit: null, claim: null });
    }
    raum.runde = { nr, level: raum.level, seed: this.neuerSeed(), phase: 'laden', ladenBis: now + WK.ladenMs, losAt: 0, laeufe };
    this.alle(raum, { t: 'runde', runde: nr, level: raum.level, seed: raum.runde.seed, fahrer: [...laeufe.keys()] });
    this.lobby(raum);
  }

  /** All ready (or the time is up): who is not ready sits this round out; the countdown starts. */
  private los(raum: Raum, now: number): void {
    const r = raum.runde;
    if (!r || r.phase !== 'laden') return;
    for (const [nr, l] of r.laeufe) if (!l.bereit) r.laeufe.delete(nr);
    if (!r.laeufe.size) {
      raum.runde = null;
      this.lobby(raum);
      return;
    }
    r.phase = 'rennen';
    r.losAt = now + WK.countdownMs;
    this.alle(raum, { t: 'los', runde: r.nr, in: WK.countdownMs });
    this.lobby(raum);
  }

  private eingabe(raum: Raum, lauf: Lauf, ab: unknown, e: unknown, now: number): void {
    const r = raum.runde!;
    if (r.phase !== 'rennen' || lauf.status !== 'faehrt') return;
    const schritte = eintraegePruefen(e);
    if (schritte === null || ab !== lauf.empfangen) return this.raus(raum, lauf, 'ungueltig');
    const bis = lauf.empfangen + schritte;
    if (bis * DT_MS > now - r.losAt + WK.vorlaufMs) return this.raus(raum, lauf, 'zu-schnell');
    if (bis > WK.maxSchritte) return this.raus(raum, lauf, 'zeit');
    const liste = e as Eintrag[];
    if (lauf.eintraege.length + liste.length > WK.maxEintraege) return this.raus(raum, lauf, 'ungueltig');
    const i = lauf.eintraege.length;
    lauf.empfangen = bis;
    for (const x of liste) {
      lauf.eintraege.push(x);
      lauf.neu.push(x);
    }
    for (const z of raum.zuschauer) if (z.folgt === lauf.nr) z.peer.send({ t: 'verlauf', runde: r.nr, fahrer: lauf.nr, i, e: liste });
  }

  private folgen(raum: Raum, tn: Teilnehmer, fahrer: unknown): void {
    if (tn.rolle !== 'zuschauer' || !int(fahrer, 1, WK.maxFahrer)) return tn.peer.send({ t: 'fehler', grund: 'ungueltig' });
    tn.folgt = fahrer;
    const r = raum.runde;
    const lauf = r?.laeufe.get(fahrer);
    if (!r || !lauf) return;
    // everything so far, in pieces; new entries follow as they come
    for (let i = 0; i < lauf.eintraege.length; i += WK.verlaufStueck) {
      tn.peer.send({ t: 'verlauf', runde: r.nr, fahrer, i, e: lauf.eintraege.slice(i, i + WK.verlaufStueck) });
    }
  }

  private raus(raum: Raum, lauf: Lauf, grund: Grund): void {
    if (lauf.status !== 'faehrt') return;
    lauf.status = 'raus';
    lauf.grund = grund;
    if (lauf.gestartet && raum.runde) this.weg.push(this.key(raum, raum.runde, lauf));
  }

  private key(raum: Raum, r: Runde, l: Lauf): string {
    return `${raum.code}/${r.nr}/${l.nr}`;
  }

  /** A browser leaves: a racer in a race is out; without racers the room closes; the next racer leads. */
  private verlassen(peer: WkPeer): void {
    const raum = this.raumVon.get(peer);
    const tn = this.teilnehmer.get(peer);
    this.raumVon.delete(peer);
    this.teilnehmer.delete(peer);
    if (!raum || !tn) return;
    if (tn.rolle === 'zuschauer') {
      raum.zuschauer.delete(tn);
      return this.lobby(raum);
    }
    raum.fahrer.delete(tn.nr);
    const lauf = raum.runde?.laeufe.get(tn.nr);
    if (lauf) {
      if (raum.runde!.phase === 'laden') raum.runde!.laeufe.delete(tn.nr);
      else this.raus(raum, lauf, 'weg');
    }
    if (!raum.fahrer.size) return this.schliessen(raum);
    if (raum.leiter === tn.nr) raum.leiter = Math.min(...raum.fahrer.keys());
    if (raum.runde?.phase === 'laden' && [...raum.runde.laeufe.values()].every((l) => l.bereit)) this.los(raum, this.now());
    this.lobby(raum);
  }

  private schliessen(raum: Raum): void {
    this.raeume.delete(raum.code);
    if (raum.runde) for (const l of raum.runde.laeufe.values()) if (l.gestartet) this.weg.push(this.key(raum, raum.runde, l));
    raum.runde = null;
    for (const t of [...raum.fahrer.values(), ...raum.zuschauer]) {
      this.raumVon.delete(t.peer);
      this.teilnehmer.delete(t.peer);
      t.peer.send({ t: 'fehler', grund: 'verfallen' });
      t.peer.close();
    }
  }

  private alle(raum: Raum, msg: WkNachricht): void {
    for (const t of raum.fahrer.values()) t.peer.send(msg);
    for (const t of raum.zuschauer) t.peer.send(msg);
  }

  private lobby(raum: Raum): void {
    const phase: Phase = raum.runde ? raum.runde.phase : 'lobby';
    this.alle(raum, { t: 'lobby', leiter: raum.leiter, fahrer: [...raum.fahrer.keys()].sort(), zuschauer: raum.zuschauer.size, level: raum.level, phase });
  }

  // ---------- the referee's clock ----------

  /** Every 100 ms: feeds the input to the referee, applies its result, judges, sends the standings. */
  async takt(): Promise<void> {
    if (this.beschaeftigt) return;
    this.beschaeftigt = true;
    try {
      await this.taktIntern();
    } finally {
      this.beschaeftigt = false;
    }
  }

  private async taktIntern(): Promise<void> {
    const now = this.now();
    const auf: Auftrag[] = [];
    const wer = new Map<string, [Raum, Runde, Lauf]>();
    for (const raum of this.raeume.values()) {
      const r = raum.runde;
      if (!r) continue;
      if (r.phase === 'laden') {
        if (now >= r.ladenBis) this.los(raum, now);
        continue;
      }
      for (const l of r.laeufe.values()) {
        if (l.status !== 'faehrt') continue;
        const k = this.key(raum, r, l);
        wer.set(k, [raum, r, l]);
        auf.push({ k, ...(l.gestartet ? {} : { neu: { level: r.level.id, seed: r.seed } }), e: l.neu });
        l.gestartet = true;
        l.neu = [];
      }
    }
    const weg = this.weg;
    this.weg = [];
    if (auf.length || weg.length) {
      try {
        const { staende, ms } = await this.rechner.takt(auf, weg);
        this.lastFenster.push([this.now(), ms]);
        for (const s of staende) {
          const w = wer.get(s.k);
          if (w) this.urteil(w[0], w[2], s);
        }
      } catch {
        // the referee crashed or hung: running races end without a result
        for (const [raum] of wer.values()) if (raum.runde) this.ende(raum, true);
        return;
      }
    }
    const jetzt = this.now();
    for (const raum of this.raeume.values()) {
      const r = raum.runde;
      if (!r || r.phase !== 'rennen') continue;
      for (const l of r.laeufe.values()) {
        if (l.status !== 'faehrt') continue;
        const uhr = jetzt - r.losAt;
        if (uhr > WK.maxSchritte * DT_MS + WK.rueckstandMs) this.raus(raum, l, 'zeit');
        else if (uhr - WK.rueckstandMs > l.empfangen * DT_MS) this.raus(raum, l, 'zu-langsam');
      }
      this.alle(raum, { t: 'stand', runde: r.nr, f: [...r.laeufe.values()].map((l): StandZeile => [l.nr, l.sim?.x ?? 0, l.sim?.y ?? 0, l.sim?.farbe ?? 0, l.sim?.schritte ?? 0, l.status, l.zeit]) });
      if ([...r.laeufe.values()].every((l) => l.status !== 'faehrt')) this.ende(raum, false);
    }
  }

  /** The referee's verdict on one run. */
  private urteil(raum: Raum, l: Lauf, s: LaufStand): void {
    l.sim = s;
    if (l.status !== 'faehrt') return;
    if (s.fehler) return this.raus(raum, l, 'fehler');
    if (s.ziel !== null) {
      l.status = 'ziel';
      l.zeit = s.ziel;
      if (raum.runde) this.weg.push(this.key(raum, raum.runde, l));
      return;
    }
    // the browser says it won, but the referee played all its steps up to there without the win
    if (l.claim !== null && s.schritte >= l.claim) this.raus(raum, l, 'abweichung');
  }

  private ende(raum: Raum, abbruch: boolean): void {
    const r = raum.runde;
    if (!r) return;
    const laeufe = [...r.laeufe.values()];
    for (const l of laeufe) if (l.gestartet && l.status === 'faehrt') this.weg.push(this.key(raum, r, l));
    const zeiten = laeufe.filter((l) => l.status === 'ziel').map((l) => l.zeit!);
    const plaetze: Platz[] = laeufe
      .map((l): Platz => {
        const zeit = !abbruch && l.status === 'ziel' ? l.zeit : null;
        return { nr: l.nr, platz: zeit === null ? null : 1 + zeiten.filter((z) => z < zeit).length, zeit, status: l.status, ...(l.grund ? { grund: l.grund } : {}) };
      })
      .sort((a, b) => (a.platz ?? 99) - (b.platz ?? 99) || a.nr - b.nr);
    raum.runde = null;
    this.alle(raum, { t: 'ergebnis', runde: r.nr, plaetze, ...(abbruch ? { abbruch: true as const } : {}) });
    this.lobby(raum);
  }

  /** Closes lobbies idle for 15 min. */
  sweep(): void {
    const now = this.now();
    for (const raum of [...this.raeume.values()]) if (!raum.runde && now - raum.zuletzt >= WK.lobbyIdleMs) this.schliessen(raum);
  }

  close(): void {
    for (const raum of [...this.raeume.values()]) this.schliessen(raum);
    this.rechner.close();
  }
}

/** GET /api/wettkampf as a WebSocket on the API's HTTP server. */
export function wettkampfRoutes(app: FastifyInstance, hub: WettkampfHub): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WK.maxBytes });
  const bekannt = wsPfad(app, PFAD);
  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== PFAD) {
      if (!bekannt(path)) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => attach(ws, upgradeIp(req)));
  };
  const alive = new WeakMap<WebSocket, boolean>();
  const attach = (ws: WebSocket, ip: string) => {
    alive.set(ws, true);
    const peer: WkPeer = {
      ip,
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
      close: () => ws.close(1000),
    };
    if (!hub.connect(peer)) {
      ws.send(JSON.stringify({ t: 'fehler', grund: 'zu-viele-versuche' } satisfies WkNachricht));
      ws.close(1008);
      return;
    }
    ws.on('message', (data, binary) => {
      if (binary) return peer.send({ t: 'fehler', grund: 'ungueltig' });
      void hub.message(peer, data.toString());
    });
    ws.on('pong', () => alive.set(ws, true));
    ws.on('close', () => hub.disconnect(peer));
    ws.on('error', () => ws.terminate());
  };
  const takt = setInterval(() => void hub.takt(), WK.taktMs);
  // Dead connections (no pong for 30 s) are dropped; idle lobbies expire.
  const pruefen = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) ws.terminate();
      else {
        alive.set(ws, false);
        ws.ping();
      }
    }
    hub.sweep();
  }, 30_000);
  takt.unref();
  pruefen.unref();
  app.server.on('upgrade', onUpgrade);
  app.addHook('onClose', async () => {
    clearInterval(takt);
    clearInterval(pruefen);
    app.server.off('upgrade', onUpgrade);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    hub.close();
  });
}
