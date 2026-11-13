// Zu zweit, Wettrennen (docs/SPEC-mehrspieler.md 5.4): both compute the same level with the same
// seed; each sends its position (shown to the other as a ghost) and its finishing time. The winner
// is who solves in less game time (physics steps since the start) – the same answer on both sides,
// however the messages cross.
import type { ActorSprite } from '../render/classic';
import type { Nachricht } from './nachrichten';

/** Position updates per second. */
export const STAND_MS = 66;

export type Ergebnis = 'gewonnen' | 'verloren' | 'gleich';

export class Rennen {
  private ziel: { x: number; y: number; farbe: number } | null = null;
  private geist: { x: number; y: number } | null = null;
  private gesendet = -Infinity;
  /** Steps of the partner so far (from the position updates). */
  partnerSchritte = 0;
  partnerZiel: number | null = null;
  meinZiel: number | null = null;
  aufgegeben = false;

  constructor(
    private readonly senden: (n: Nachricht) => void,
    private readonly jetzt: () => number = () => performance.now(),
  ) {}

  /** Every frame: sends the own position now and then. */
  tick(x: number, y: number, farbe: number, schritte: number): void {
    const t = this.jetzt();
    if (this.meinZiel !== null || t - this.gesendet < STAND_MS) return;
    this.gesendet = t;
    this.senden({ t: 'stand', x, y, farbe, schritte });
  }

  empfangen(n: Nachricht): void {
    if (n.t === 'stand') {
      this.ziel = { x: n.x, y: n.y, farbe: n.farbe };
      this.partnerSchritte = Math.max(this.partnerSchritte, n.schritte);
    } else if (n.t === 'ziel') {
      this.partnerZiel = n.schritte;
      this.partnerSchritte = Math.max(this.partnerSchritte, n.schritte);
    } else if (n.t === 'tschuess') this.aufgegeben = true;
  }

  /** The own run is solved after `schritte` physics steps. */
  imZiel(schritte: number): void {
    if (this.meinZiel !== null) return;
    this.meinZiel = schritte;
    this.senden({ t: 'ziel', schritte });
  }

  /** Decided once both finished, or once the partner's game time passed the own finishing time. */
  ergebnis(): Ergebnis | null {
    const mine = this.meinZiel;
    const theirs = this.partnerZiel;
    if (mine !== null && theirs !== null) return mine < theirs ? 'gewonnen' : mine > theirs ? 'verloren' : 'gleich';
    if (mine !== null && (this.partnerSchritte > mine || this.aufgegeben)) return 'gewonnen';
    if (theirs !== null && mine === null) return null; // still racing: the partner is through, the own run decides nothing yet
    return null;
  }

  /** The partner's marble, smoothed towards the last reported position. */
  geistSprite(dt: number): ActorSprite | null {
    const z = this.ziel;
    if (!z || this.partnerZiel !== null) return null;
    const g = (this.geist ??= { x: z.x, y: z.y });
    // exponential smoothing: about 90 % of the way in 100 ms; jumps (respawn) at once
    if (Math.hypot(z.x - g.x, z.y - g.y) > 3) {
      g.x = z.x;
      g.y = z.y;
    } else {
      const k = 1 - Math.exp(-dt * 23);
      g.x += (z.x - g.x) * k;
      g.y += (z.y - g.y) * k;
    }
    return { kind: 'marble', color: z.farbe, x: g.x, y: g.y, fall: -1, ghost: true };
  }
}
