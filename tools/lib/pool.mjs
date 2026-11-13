// Runs checks in child processes: several at once (one per core asked for), each with a time limit.
// A level that hangs or crashes its process only costs its own result.
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./check-worker.mjs', import.meta.url));
// Node 24 strips types by itself; the game code also uses parameter properties, which need the transform.
const EXEC_ARGV = ['--experimental-transform-types', '--no-warnings'];

function startWorker() {
  return new Promise((resolve, reject) => {
    const c = fork(WORKER, [], { execArgv: EXEC_ARGV, serialization: 'advanced', stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const onExit = (code) => reject(new Error(`Prüfprozess startet nicht (${code})`));
    c.once('exit', onExit);
    c.once('message', () => {
      c.off('exit', onExit);
      resolve(c);
    });
  });
}

/**
 * jobs: [{ kind: 'probe' | 'solution', file, recording?, seconds? }]; returns the results in job order.
 * A job that runs out of time or ends its process gets { status: 'fehler', error }.
 */
export async function runChecks(jobs, { parallel = 1, timeoutMs = 120_000, onResult = () => {} } = {}) {
  const results = new Array(jobs.length);
  let next = 0;
  const lane = async () => {
    let child = null;
    while (next < jobs.length) {
      const i = next++;
      const job = jobs[i];
      child ??= await startWorker();
      const c = child;
      const result = await new Promise((resolve) => {
        const finish = (r) => {
          clearTimeout(timer);
          c.off('exit', onExit);
          c.off('message', onMessage);
          resolve(r);
        };
        const fail = (error) => {
          child = null;
          c.kill('SIGKILL');
          finish({ level: String(job.file?.id ?? '?'), status: 'fehler', steps: 0, error });
        };
        const onExit = (code, signal) => fail(`Prüfprozess beendet (${signal ?? code})`);
        const onMessage = (m) => m.id === i && finish(m.result);
        const timer = setTimeout(() => fail(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} s`), timeoutMs);
        c.on('exit', onExit);
        c.on('message', onMessage);
        c.send({ id: i, ...job });
      });
      results[i] = result;
      onResult(result, i);
    }
    child?.kill();
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, jobs.length)) }, lane));
  return results;
}
