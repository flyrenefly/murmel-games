/**
 * Replays leaderboard runs with the game code of the running version (docs/SPEC-bestenliste.md), the
 * same check as the nightly Lösbarkeitsprüfung: tools/lib/check-worker.mjs runs checkSolution from
 * src/game/check.ts in a child process. The API image has no game code; GAME_DIR (/game in the
 * container) is the active version's copy, mounted read-only.
 *
 * One child process stays up between checks (loading the game code takes a moment). A check that runs
 * out of time, or a crash, ends the process; the next check starts a new one.
 */
import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setPriority } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Checker } from './bestenliste.ts';
import type { Recording } from './loesbarkeit.ts';

// Node strips types by itself; the game code also uses parameter properties, which need the transform.
const EXEC_ARGV = ['--experimental-transform-types', '--no-warnings'];
const START_MS = 60_000;
/** Level files are dropped from memory after this long without a check. */
const LEVELS_IDLE_MS = 15 * 60_000;

interface LevelFile {
  id: string;
}
interface WorkerResult {
  status: 'geloest' | 'nicht-geloest' | 'fehler';
  steps: number;
  error?: string;
}

export interface GameCheckerOptions {
  /** Hard limit per check (the process is killed). */
  timeoutMs?: number;
  /** Niceness of the child process (0 = like the API). */
  nice?: number;
}

export function gameChecker(gameDir: string, { timeoutMs = 60_000, nice = 10 }: GameCheckerOptions = {}): Checker & { close(): void } {
  const dir = resolve(gameDir);
  const worker = join(dir, 'tools', 'lib', 'check-worker.mjs');
  const levelsModule = join(dir, 'tools', 'lib', 'levels.mjs');
  let child: ChildProcess | null = null;
  let starting: Promise<ChildProcess> | null = null;
  let levels: { byId: Map<string, LevelFile>; hash: (f: LevelFile) => string } | null = null;
  let levelsTimer: NodeJS.Timeout | null = null;
  let seq = 0;

  async function levelIndex() {
    if (levelsTimer) clearTimeout(levelsTimer);
    levelsTimer = setTimeout(() => (levels = null), LEVELS_IDLE_MS);
    levelsTimer.unref();
    if (!levels) {
      const m = (await import(pathToFileURL(levelsModule).href)) as { loadLevels(root: string): { file: LevelFile }[]; levelHash(f: LevelFile): string };
      levels = { byId: new Map(m.loadLevels(dir).map((l) => [l.file.id, l.file])), hash: m.levelHash };
    }
    return levels;
  }

  function start(): Promise<ChildProcess> {
    starting ??= new Promise<ChildProcess>((ok, fail) => {
      const c = fork(worker, [], { cwd: dir, execArgv: EXEC_ARGV, serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
      c.on('error', () => {});
      const timer = setTimeout(() => {
        c.kill('SIGKILL');
        fail(new Error('Prüfprozess startet nicht'));
      }, START_MS);
      const onExit = (code: number | null) => {
        clearTimeout(timer);
        fail(new Error(`Prüfprozess startet nicht (${code})`));
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
          // not allowed here: the check still runs, only at normal priority
        }
        child = c;
        ok(c);
      });
    }).finally(() => (starting = null));
    return starting;
  }

  function run(c: ChildProcess, file: LevelFile, recording: Recording): Promise<WorkerResult> {
    const id = ++seq;
    return new Promise((ok) => {
      const finish = (r: WorkerResult) => {
        clearTimeout(timer);
        c.off('exit', onExit);
        c.off('message', onMessage);
        ok(r);
      };
      const fail = (error: string) => {
        c.kill('SIGKILL');
        if (child === c) child = null;
        finish({ status: 'fehler', steps: 0, error });
      };
      const onExit = (code: number | null, signal: string | null) => fail(`Prüfprozess beendet (${signal ?? code})`);
      const onMessage = (m: { id?: number; result?: WorkerResult }) => m.id === id && m.result && finish(m.result);
      const timer = setTimeout(() => fail(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
      c.on('exit', onExit);
      c.on('message', onMessage);
      c.send({ id, kind: 'solution', file, recording }, (err) => err && fail(`Prüfprozess nicht erreichbar: ${err.message}`));
    });
  }

  return {
    available: () => existsSync(worker) && existsSync(levelsModule),

    async check(rec) {
      const idx = await levelIndex();
      const file = idx.byId.get(rec.level);
      if (!file) return { status: 'unbekannt', steps: 0 };
      const levelHash = idx.hash(file);
      let c: ChildProcess;
      try {
        c = child ?? (await start());
      } catch (e) {
        return { status: 'fehler', steps: 0, levelHash, error: (e as Error).message };
      }
      const r = await run(c, file, rec);
      return { status: r.status, steps: r.steps, levelHash, ...(r.error ? { error: r.error } : {}) };
    },

    close() {
      child?.kill();
      child = null;
      if (levelsTimer) clearTimeout(levelsTimer);
    },
  };
}
