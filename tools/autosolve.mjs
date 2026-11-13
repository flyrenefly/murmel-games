// Autopilot solutions (docs/SPEC-loesbarkeit.md): tries the simple key-steering autopilot on every
// level without a solution and stores each win as solutions/<pack>/<level>.json.
//   node tools/autosolve.mjs [--pack ID] [--jobs N] [--all]   (--all: also levels that have a solution)
// The written files are ordinary recordings; tools/check-solutions.mjs replays them.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { levelHash, loadLevels } from './lib/levels.mjs';
import { runChecks } from './lib/pool.mjs';
import { solutionPath } from './lib/solutions.mjs';

const { values: o } = parseArgs({
  options: {
    jobs: { type: 'string', default: String(availableParallelism()) },
    pack: { type: 'string' },
    all: { type: 'boolean', default: false },
  },
});
const levels = loadLevels().filter((l) => (!o.pack || l.pack === o.pack) && (o.all || !existsSync(solutionPath(l.file.id))));
let won = 0;
await runChecks(
  levels.map(({ file }) => ({ kind: 'autosolve', file, seed: 1 })),
  {
    parallel: Number(o.jobs),
    timeoutMs: 300_000,
    onResult: (r, i) => {
      if (!r.recording) return;
      won++;
      const { file } = levels[i];
      const path = solutionPath(file.id);
      mkdirSync(dirname(path), { recursive: true });
      const { v, level, seed, dt, steps, result, input } = r.recording;
      const rec = { v, level, levelHash: levelHash(file), seed, dt, steps, result, source: 'autopilot', input };
      writeFileSync(path, `${JSON.stringify(rec)}\n`);
      console.log(`gelöst: ${file.id} (${(steps * dt).toFixed(1)} s)`);
    },
  },
);
console.log(`Autopilot: ${won} von ${levels.length} Levels gelöst`);
