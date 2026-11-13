// Zu zweit, gemeinsam (docs/SPEC-mehrspieler.md 5.3): the host computes the run with GameSession,
// the guest sends its input and gets the state 25 times a second. The guest replays the host's
// steps with its own session (same seed: doors, stones and Oxyd stones follow) and then puts the
// marbles where the host has them. Playback runs at physics pace behind a small buffer, so the
// picture stays smooth although messages arrive in bursts.
import { PHYSICS_DT } from '../game/physics';
import type { GameSession, StepControl } from '../game/session';
import { type Aktion, entpacken, type Murmeln, type Nachricht, packen, type Schritt, type Steuerung } from './nachrichten';

/** Host → guest: a batch every 40 ms (25 per second). */
export const SENDE_MS = 40;
/** Guest → host: input at most every 33 ms (30 per second), actions at once. */
export const EINGABE_MS = 33;
/** Guest: start (again) only with about one batch in the buffer. */
export const PUFFER_SCHRITTE = Math.round(SENDE_MS / 1000 / PHYSICS_DT);

const ctl = (s: Steuerung): StepControl => ({ fx: s[0], fy: s[1], ax: s[2], ay: s[3] });

function murmeln(s: GameSession): Murmeln {
  return s.physics.marbles.map((m) => [m.pos.x, m.pos.y, m.vel.x, m.vel.y]);
}

/** One co-op step on a session (the same on host and guest, so both stay in step). */
export function schrittAnwenden(s: GameSession, st: Schritt): void {
  s.objects.inhibitPickup = st.sperre === 1;
  for (const [spieler, aktion] of st.aktionen) s.coopAct(spieler, aktion);
  s.coopStep(ctl(st.host), ctl(st.gast));
}

export class KoopGastgeber {
  private gastMaus = { x: 0, y: 0 };
  private gastAchse = { x: 0, y: 0 };
  private eigeneMaus = { x: 0, y: 0 };
  private aktionen: [0 | 1, Aktion][] = [];
  private stapel: Schritt[] = [];
  private ab = 0;
  /** Send clock: a fixed 40 ms beat, so 60 Hz frames still give 25 batches a second. */
  private faellig = -Infinity;
  private endeGemeldet = false;

  constructor(
    private readonly senden: (n: Nachricht) => void,
    private readonly jetzt: () => number = () => performance.now(),
  ) {}

  /** Input of the guest (mouse adds up until the next step uses it). */
  eingabe(n: Extract<Nachricht, { t: 'eingabe' }>): void {
    this.gastMaus.x += n.fx;
    this.gastMaus.y += n.fy;
    this.gastAchse = { x: n.ax, y: n.ay };
    for (const a of n.aktionen) this.aktionen.push([1, a]);
  }

  /** An action of the host player (applied before the next step). */
  aktion(a: Aktion): void {
    this.aktionen.push([0, a]);
  }

  /** Plays all whole physics steps in acc with the input of both; returns the rest of acc. */
  rechnen(s: GameSession, acc: number, host: StepControl): number {
    this.eigeneMaus.x += host.fx;
    this.eigeneMaus.y += host.fy;
    while (acc >= PHYSICS_DT) {
      const st: Schritt = {
        host: [this.eigeneMaus.x, this.eigeneMaus.y, host.ax, host.ay],
        gast: [this.gastMaus.x, this.gastMaus.y, this.gastAchse.x, this.gastAchse.y],
        sperre: s.objects.inhibitPickup ? 1 : 0,
        aktionen: this.aktionen.splice(0),
      };
      this.eigeneMaus = { x: 0, y: 0 };
      this.gastMaus = { x: 0, y: 0 };
      schrittAnwenden(s, st);
      this.stapel.push(st);
      acc -= PHYSICS_DT;
    }
    const t = this.jetzt();
    if (this.stapel.length && t >= this.faellig) {
      // on beat; after a pause (or at the start) the beat starts anew
      this.faellig = this.faellig + SENDE_MS < t ? t + SENDE_MS : this.faellig + SENDE_MS;
      this.abschicken(s);
    }
    return acc;
  }

  /** Sends the steps since the last batch with the marble state at their end. */
  abschicken(s: GameSession): void {
    const ende = s.won && !this.endeGemeldet;
    if (ende) this.endeGemeldet = true;
    this.senden({ t: 'schritte', ab: this.ab, l: packen(this.stapel), m: murmeln(s), ...(ende ? { ende: true } : {}) });
    this.ab += this.stapel.length;
    this.stapel = [];
  }
}

interface Geplant extends Schritt {
  murmeln?: Murmeln;
  ende?: boolean;
}

export class KoopGast {
  private schlange: Geplant[] = [];
  private spielt = false;
  private maus = { x: 0, y: 0 };
  private achse = { x: 0, y: 0 };
  private aktionen: Aktion[] = [];
  private gesendet = -Infinity;
  private erwartet = 0;
  /** Largest marble correction seen (diagnostics and tests). */
  abweichung = 0;
  /** Called once when the host reports the win. */
  onEnde: () => void = () => {};

  constructor(
    private readonly senden: (n: Nachricht) => void,
    private readonly jetzt: () => number = () => performance.now(),
  ) {}

  get gepuffert(): number {
    return this.schlange.length;
  }

  /** A batch of the host. */
  schritte(n: Extract<Nachricht, { t: 'schritte' }>): void {
    if (n.ab !== this.erwartet) return; // a batch of an older run (before a restart)
    const neu: Geplant[] = entpacken(n.l);
    this.erwartet += neu.length;
    const last = neu.at(-1);
    if (last) {
      last.murmeln = n.m;
      if (n.ende) last.ende = true;
    } else if (n.ende) this.onEnde();
    this.schlange.push(...neu);
  }

  /** An action of the guest player: goes to the host with the next input. */
  aktion(a: Aktion): void {
    this.aktionen.push(a);
  }

  /** Sends the own input, plays buffered steps at physics pace; returns the rest of acc. */
  rechnen(s: GameSession, acc: number, eigene: StepControl): number {
    this.maus.x += eigene.fx;
    this.maus.y += eigene.fy;
    this.achse = { x: eigene.ax, y: eigene.ay };
    const t = this.jetzt();
    if (this.aktionen.length || t - this.gesendet >= EINGABE_MS) {
      this.senden({ t: 'eingabe', fx: this.maus.x, fy: this.maus.y, ax: this.achse.x, ay: this.achse.y, aktionen: this.aktionen.splice(0) });
      this.maus = { x: 0, y: 0 };
      this.gesendet = t;
    }
    if (!this.spielt && this.schlange.length >= PUFFER_SCHRITTE) this.spielt = true;
    if (!this.spielt) return Math.min(acc, PHYSICS_DT * 0.999);
    let n = Math.floor(acc / PHYSICS_DT);
    acc -= n * PHYSICS_DT;
    // more than three batches behind: catch up a little faster
    const zuviel = this.schlange.length - n - 3 * PUFFER_SCHRITTE;
    if (zuviel > 0) n += Math.ceil(zuviel / 8);
    while (n-- > 0) {
      const st = this.schlange.shift();
      if (!st) {
        this.spielt = false;
        return Math.min(acc, PHYSICS_DT * 0.999);
      }
      this.anwenden(s, st);
    }
    return acc;
  }

  private anwenden(s: GameSession, st: Geplant): void {
    schrittAnwenden(s, st);
    if (st.murmeln && st.murmeln.length === s.physics.marbles.length) {
      s.physics.marbles.forEach((m, i) => {
        const [x, y, vx, vy] = st.murmeln![i];
        this.abweichung = Math.max(this.abweichung, Math.hypot(m.pos.x - x, m.pos.y - y));
        m.pos.x = x;
        m.pos.y = y;
        m.vel.x = vx;
        m.vel.y = vy;
      });
    }
    if (st.ende) this.onEnde();
  }
}
