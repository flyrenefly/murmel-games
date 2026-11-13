/**
 * Geister (docs/SPEC-geister.md): a stored run plays along as a see-through marble. It is a second run
 * of the same level with the recording's start value, fed the recorded input step by step, in step with
 * the player. Only its controlled marble is drawn; its world stays invisible and never touches the own run.
 */
import type { ActorSprite } from '../render/classic';
import type { LevelFile } from './level';
import { PHYSICS_DT } from './physics';
import type { StepInput } from './recording';
import { startReplay } from './replay';
import type { GameSession, StartLua } from './session';

/** Catching up at most this many steps per frame (normally it is one or two). */
export const MAX_AUFHOLEN = 400;

export class Geist {
  private constructor(
    private readonly session: GameSession,
    private readonly input: Iterator<StepInput>,
  ) {}

  /** Throws when the recording does not fit the level (other level, invalid). */
  static async create(file: LevelFile, data: unknown, startLua?: StartLua): Promise<Geist> {
    const { session, input } = await startReplay(file, data, { startLua });
    return new Geist(session, input[Symbol.iterator]());
  }

  /** Physics steps played so far. */
  get schritte(): number {
    return this.session.steps;
  }

  get imZiel(): boolean {
    return this.session.won;
  }

  /** Steps to the win, once there. */
  get zeit(): number | null {
    return this.session.won ? this.session.steps : null;
  }

  /** Plays on until it has as many steps as the player (`steps`), or the recording ends. */
  folgen(steps: number): void {
    const s = this.session;
    for (let n = 0; n < MAX_AUFHOLEN && s.steps < steps && !s.won; n++) {
      const next = this.input.next();
      if (next.done) return;
      for (const a of next.value.actions) s.act(a);
      s.step(next.value);
    }
  }

  /** The controlled marble, interpolated like the own one (`alpha` 0…1 between the last two steps). */
  sprite(alpha: number): ActorSprite | null {
    if (this.session.won) return null;
    const ph = this.session.physics;
    const m = ph.marbles[ph.current];
    if (!m) return null;
    return { kind: 'marble', color: m.color, x: m.prev.x + (m.pos.x - m.prev.x) * alpha, y: m.prev.y + (m.pos.y - m.prev.y) * alpha, fall: -1, ghost: true };
  }
}

/** The line of the win message: own time against the ghost's (`zeit` formats physics steps). */
export function vergleich(eigene: number, geist: number, zeit: (steps: number) => string): string {
  const d = ((Math.abs(eigene - geist) * PHYSICS_DT).toFixed(1)).replace('.', ',');
  const urteil = eigene === geist ? 'gleich schnell' : `du warst ${d} s ${eigene < geist ? 'schneller' : 'langsamer'}`;
  return `Geist: ${zeit(geist)} – ${urteil}`;
}
