/**
 * Replaying a recorded run without the browser (docs/SPEC-aufzeichnung.md, stage A5): same level,
 * same start value, the same input before the same physics steps – the same result.
 */
import type { LevelFile } from './level';
import { PHYSICS_DT } from './physics';
import { decodeInput } from './recording';
import { GameSession, type SessionUI, type StartLua } from './session';

export interface ReplayOptions {
  startLua?: StartLua;
  ui?: SessionUI;
}

/** Plays a recording (untrusted JSON) of `file` to its end or to the win; returns the finished run. */
export async function replay(file: LevelFile, data: unknown, opts: ReplayOptions = {}): Promise<GameSession> {
  const meta = (data ?? {}) as { level?: unknown; seed?: unknown; dt?: unknown };
  if (meta.level !== file.id) throw new Error('Aufzeichnung gehört zu einem anderen Level');
  if (meta.dt !== PHYSICS_DT) throw new Error('Aufzeichnung mit anderem Physiktakt');
  const seed = meta.seed;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= 2 ** 32) throw new Error('Aufzeichnung ohne gültigen Startwert');
  const input = decodeInput(data);
  const s = await GameSession.create(file, { seed, startLua: opts.startLua, ui: opts.ui });
  for (const step of input) {
    for (const a of step.actions) s.act(a);
    s.step({ fx: step.fx, fy: step.fy, ax: step.ax, ay: step.ay });
    if (s.won) break;
  }
  return s;
}
