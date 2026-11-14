/**
 * The referee's physics for Wettkampf (docs/SPEC-wettkampf.md 2.4): a child process with the game code
 * of the running version (GAME_DIR, like the leaderboard's checker) holds one GameSession per racer and
 * plays the racers' input. The API never runs game code itself.
 *
 * One request at a time. A crash or a hang ends the process (the rooms abort their races); the next
 * request starts a new one.
 */
import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setPriority } from 'node:os';
import { join, resolve } from 'node:path';

/** One input entry (docs/SPEC-aufzeichnung.md): [n, fx, fy], [n, fx, fy, ax, ay] or [n, action]. */
export type Eintrag = [number, number, number] | [number, number, number, number, number] | [number, string];

export interface Auftrag {
  /** Key of the run (room, round, racer). */
  k: string;
  /** First request of a run: the level and its start value. */
  neu?: { level: string; seed: number };
  e: Eintrag[];
}

/** State of one run after a request: total steps played, the steered marble, the win. */
export interface LaufStand {
  k: string;
  schritte: number;
  x: number;
  y: number;
  farbe: number;
  /** Total steps at the win, or null. */
  ziel: number | null;
  fehler?: string;
}

export interface Rechner {
  verfuegbar(): boolean;
  /** Is the level in the game's packs? */
  kennt(level: string): Promise<boolean>;
  /** Plays the new input of the runs, drops the runs in `weg`; `ms` = time the process computed. */
  takt(auf: Auftrag[], weg: string[]): Promise<{ staende: LaufStand[]; ms: number }>;
  close(): void;
}

const EXEC_ARGV = ['--experimental-transform-types', '--no-warnings'];
const START_MS = 60_000;

export function wettkampfRechner(gameDir: string, { timeoutMs = 30_000, nice = 10 } = {}): Rechner {
  const dir = resolve(gameDir);
  const worker = join(dir, 'tools', 'lib', 'wettkampf-worker.mjs');
  let child: ChildProcess | null = null;
  let starting: Promise<ChildProcess> | null = null;
  let seq = 0;
  let queue: Promise<unknown> = Promise.resolve();

  function start(): Promise<ChildProcess> {
    starting ??= new Promise<ChildProcess>((ok, fail) => {
      const c = fork(worker, [], { cwd: dir, execArgv: EXEC_ARGV, serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      c.on('error', () => {});
      const timer = setTimeout(() => {
        c.kill('SIGKILL');
        fail(new Error('Rechenprozess startet nicht'));
      }, START_MS);
      const onExit = (code: number | null) => {
        clearTimeout(timer);
        fail(new Error(`Rechenprozess startet nicht (${code})`));
      };
      c.once('exit', onExit);
      c.once('message', () => {
        clearTimeout(timer);
        c.off('exit', onExit);
        c.once('exit', () => {
          if (child === c) child = null;
        });
        try {
          if (c.pid && nice) setPriority(c.pid, nice);
        } catch {
          // not allowed here: it still runs, only at normal priority
        }
        child = c;
        ok(c);
      });
    }).finally(() => (starting = null));
    return starting;
  }

  /** One request to the process, after the previous one. */
  function ask<T>(msg: object): Promise<T> {
    const run = async (): Promise<T> => {
      const c = child ?? (await start());
      const id = ++seq;
      return new Promise<T>((ok, fail) => {
        const done = () => {
          clearTimeout(timer);
          c.off('exit', onExit);
          c.off('message', onMessage);
        };
        const kill = (why: string) => {
          done();
          c.kill('SIGKILL');
          if (child === c) child = null;
          fail(new Error(why));
        };
        const onExit = () => kill('Rechenprozess beendet');
        const onMessage = (m: { id?: number }) => {
          if (m.id !== id) return;
          done();
          ok(m as T);
        };
        const timer = setTimeout(() => kill('Rechenprozess antwortet nicht'), timeoutMs);
        c.on('exit', onExit);
        c.on('message', onMessage);
        c.send({ id, ...msg }, (err) => err && kill(`Rechenprozess nicht erreichbar: ${err.message}`));
      });
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  return {
    verfuegbar: () => existsSync(worker),
    async kennt(level) {
      return (await ask<{ ok: boolean }>({ kennt: level })).ok;
    },
    async takt(auf, weg) {
      const r = await ask<{ ms: number; s: LaufStand[] }>({ auf, weg });
      return { staende: r.s, ms: r.ms };
    },
    close() {
      child?.kill();
      child = null;
    },
  };
}
