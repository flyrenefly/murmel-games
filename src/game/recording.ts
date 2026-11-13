/**
 * Input recording of a run (docs/SPEC-aufzeichnung.md, stage A4): per physics step the force the
 * player added and the force of keys or tilt (rounded to 1/1024, so replaying uses exactly the same
 * numbers) and the actions taken before the step. Stored as run lengths: [count, fx, fy] or
 * [count, fx, fy, ax, ay] for steps (the axis force only when it is not 0), [count, "action"] for actions.
 */

export const ACTIONS = ['use', 'drop', 'rotate', 'swap', 'restart'] as const;
export type Action = (typeof ACTIONS)[number];

/** Input of one physics step. */
export interface StepInput {
  fx: number;
  fy: number;
  ax: number;
  ay: number;
  actions: Action[];
}

type Step = [number, number, number] | [number, number, number, number, number];
export type Entry = Step | [number, Action];

export interface RecordingInput {
  v: 1;
  steps: number;
  input: Entry[];
}

const SCALE = 1024;

/** Force in 1/1024 units (integer; -0 becomes 0). */
export function quantize(v: number): number {
  return Math.round(v * SCALE) || 0;
}

export class Recorder {
  private entries: Entry[] = [];
  private run: Step | null = null;
  steps = 0;

  /** Records one physics step; returns the rounded forces the simulation must use. */
  step(fx: number, fy: number, ax = 0, ay = 0): [number, number, number, number] {
    const q = [quantize(fx), quantize(fy), quantize(ax), quantize(ay)];
    const r = this.run;
    if (r && r[1] === q[0] && r[2] === q[1] && (r[3] ?? 0) === q[2] && (r[4] ?? 0) === q[3]) r[0]++;
    else {
      this.flush();
      this.run = q[2] || q[3] ? [1, q[0], q[1], q[2], q[3]] : [1, q[0], q[1]];
    }
    this.steps++;
    return [q[0] / SCALE, q[1] / SCALE, q[2] / SCALE, q[3] / SCALE];
  }

  /** Records an action taken before the next step. */
  action(name: Action): void {
    this.flush();
    const last = this.entries[this.entries.length - 1];
    // the same action twice before one step: [2, "drop"]
    if (last && last[1] === name) last[0]++;
    else this.entries.push([1, name]);
  }

  input(): Entry[] {
    return this.run ? [...this.entries, [...this.run] as Step] : [...this.entries];
  }

  private flush(): void {
    if (this.run) this.entries.push(this.run);
    this.run = null;
  }
}

export function encodeInput(r: Recorder): RecordingInput {
  return { v: 1, steps: r.steps, input: r.input() };
}

/** A validated recording: the number of steps and the input of each step in order. */
export interface DecodedInput extends Iterable<StepInput> {
  steps: number;
}

const isCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;
const isForce = (n: unknown): n is number => Number.isInteger(n) && Math.abs(n as number) <= 1e9;

/** Reads a recording (from JSON, i.e. untrusted) and checks every entry. */
export function decodeInput(data: unknown): DecodedInput {
  const d = data as Partial<RecordingInput>;
  if (!d || d.v !== 1 || !Array.isArray(d.input) || !Number.isInteger(d.steps)) throw new Error('Aufzeichnung: unbekanntes Format');
  const entries = d.input as unknown[];
  let total = 0;
  for (const e of entries) {
    if (!Array.isArray(e) || !isCount(e[0])) throw new Error('Aufzeichnung: ungültiger Eintrag');
    if ((e.length === 3 || (e.length === 5 && isForce(e[3]) && isForce(e[4]))) && isForce(e[1]) && isForce(e[2])) total += e[0];
    else if (e.length === 2 && (ACTIONS as readonly unknown[]).includes(e[1])) continue;
    else throw new Error('Aufzeichnung: ungültiger Eintrag');
  }
  if (total !== d.steps) throw new Error('Aufzeichnung: Schrittzahl passt nicht');
  const list = entries as Entry[];
  return {
    steps: total,
    *[Symbol.iterator]() {
      let pending: Action[] = [];
      for (const e of list) {
        if (typeof e[1] === 'string') {
          for (let k = 0; k < e[0]; k++) pending.push(e[1]);
          continue;
        }
        const [count, qx, qy, qax = 0, qay = 0] = e as [number, number, number, number?, number?];
        for (let k = 0; k < count; k++) {
          yield { fx: qx / SCALE, fy: qy / SCALE, ax: qax / SCALE, ay: qay / SCALE, actions: pending };
          pending = [];
        }
      }
    },
  };
}
