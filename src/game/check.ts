/**
 * Level checks without the browser (docs/SPEC-loesbarkeit.md): the load probe starts a level and lets
 * it run a few seconds without input; the solution check replays a recorded win and says whether it
 * still wins. Both only report – they never throw for a broken level.
 */
import type { LevelFile } from './level';
import { PHYSICS_DT } from './physics';
import { replay } from './replay';
import { GameSession, NO_CONTROL, type StartLua } from './session';

/** Seconds the load probe plays without input. */
export const PROBE_SECONDS = 5;

/** ok: runs; lua: runs, but its Lua script reported an error; fehler: start or play threw. */
export type ProbeStatus = 'ok' | 'lua' | 'fehler';

export interface ProbeResult {
  level: string;
  status: ProbeStatus;
  /** Physics steps played. */
  steps: number;
  error?: string;
}

/** geloest: the replay wins; nicht-geloest: it ends without the win; fehler: it could not be replayed. */
export type SolutionStatus = 'geloest' | 'nicht-geloest' | 'fehler';

export interface SolutionResult {
  level: string;
  status: SolutionStatus;
  /** Steps of the replay (to the win, or to the end of the input). */
  steps: number;
  /** Steps the recording says it took (a win with other steps is still a win, but worth a look). */
  recordedSteps: number | null;
  error?: string;
  /** Last Lua error during the replay (the level still ran). */
  luaError?: string;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Starts the level with a fixed start value and plays PROBE_SECONDS without input. */
export async function probeLevel(file: LevelFile, startLua: StartLua, seconds = PROBE_SECONDS, seed = 1): Promise<ProbeResult> {
  const level = String(file?.id ?? '?');
  let s: GameSession | null = null;
  try {
    s = await GameSession.create(file, { seed, startLua });
    const steps = Math.round(seconds / PHYSICS_DT);
    for (let i = 0; i < steps; i++) s.step(NO_CONTROL);
  } catch (e) {
    return { level, status: 'fehler', steps: s?.steps ?? 0, error: message(e) };
  }
  const lua = s.lua?.lastError;
  return lua ? { level, status: 'lua', steps: s.steps, error: message(lua) } : { level, status: 'ok', steps: s.steps };
}

/** Replays a recording (untrusted JSON) of `file`; a solution must reach the win. */
export async function checkSolution(file: LevelFile, recording: unknown, startLua: StartLua): Promise<SolutionResult> {
  const level = String(file?.id ?? '?');
  const declared = (recording as { steps?: unknown } | null)?.steps;
  const recordedSteps = typeof declared === 'number' && Number.isInteger(declared) ? declared : null;
  try {
    const s = await replay(file, recording, { startLua });
    const luaError = s.lua?.lastError ? message(s.lua.lastError) : undefined;
    return { level, status: s.won ? 'geloest' : 'nicht-geloest', steps: s.steps, recordedSteps, ...(luaError ? { luaError } : {}) };
  } catch (e) {
    return { level, status: 'fehler', steps: 0, recordedSteps, error: message(e) };
  }
}
