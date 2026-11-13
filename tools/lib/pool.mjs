// Runs checks in child processes: several at once (one per core asked for), each with a time limit.
// A level that hangs or crashes its process only costs its own result.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./check-worker.mjs', import.meta.url));
// Node 24 strips types by itself; the game code also uses parameter properties, which need the transform.
const EXEC_ARGV = ['--experimental-transform-types', '--no-warnings'];
/** Time a fresh process may take to load the game code. */
const START_MS = 60_000;
/** Extra time per physics step: at least 20 000 steps/s even on a busy core at the lowest priority. */
const MS_PER_STEP = 0.05;

function startWorker() {
  return new Promise((resolve, reject) => {
    const c = fork(WORKER, [], { execArgv: EXEC_ARGV, serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    // a send to a process that died in between reports here; the job's exit handler takes care of it
    c.on('error', () => {});
    const timer = setTimeout(() => {
      c.kill('SIGKILL');
      reject(new Error('Prüfprozess startet nicht (Zeitüberschreitung)'));
    }, START_MS);
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`Prüfprozess startet nicht (${code})`));
    };
    c.once('exit', onExit);
    c.once('message', () => {
      clearTimeout(timer);
      c.off('exit', onExit);
      resolve(c);
    });
  });
}

/** The physics steps a job plays (its time limit grows with them). */
function jobSteps(job) {
  if (job.kind === 'probe') return Math.round((job.seconds ?? 5) * 400);
  const steps = job.recording?.steps;
  return Number.isInteger(steps) && steps > 0 ? steps : 0;
}

/**
 * jobs: [{ kind: 'probe' | 'solution' | 'autosolve', file, recording?, seconds? }]; returns the results in
 * job order. A job that runs out of time or ends its process gets { status: 'fehler', error }.
 */
export async function runChecks(jobs, { parallel = 1, timeoutMs = 120_000, msPerStep = MS_PER_STEP, onResult = () => {} } = {}) {
  const results = new Array(jobs.length);
  const lanes = Number.isInteger(parallel) && parallel > 0 ? Math.min(parallel, jobs.length) : 1;
  let next = 0;
  const lane = async () => {
    let child = null;
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      const failed = (error) => ({ level: String(job.file?.id ?? '?'), status: 'fehler', steps: 0, error });
      let result;
      try {
        child ??= await startWorker();
      } catch (e) {
        result = failed(e.message);
      }
      if (!result) {
        const c = child;
        const limit = timeoutMs + jobSteps(job) * msPerStep;
        result = await new Promise((resolve) => {
          const finish = (r) => {
            clearTimeout(timer);
            c.off('exit', onExit);
            c.off('message', onMessage);
            resolve(r);
          };
          const fail = (error) => {
            child = null;
            c.kill('SIGKILL');
            finish(failed(error));
          };
          const onExit = (code, signal) => fail(`Prüfprozess beendet (${signal ?? code})`);
          const onMessage = (m) => m.id === i && finish(m.result);
          const timer = setTimeout(() => fail(`Zeitüberschreitung nach ${Math.round(limit / 1000)} s`), limit);
          c.on('exit', onExit);
          c.on('message', onMessage);
          if (!c.connected) return fail('Prüfprozess nicht mehr erreichbar');
          c.send({ id: i, ...job }, (err) => err && fail(`Prüfprozess nicht erreichbar: ${err.message}`));
        });
      }
      results[i] = result;
      onResult(result, i);
    }
    child?.kill();
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
