// Ladeprobe (docs/SPEC-loesbarkeit.md): every level starts and plays a few seconds without input.
//   node tools/check-load.mjs [--jobs N] [--seconds S] [--pack ID] [--json out.json] [--baseline file]
// Exit 1 if a level fails ("fehler") that the baseline does not list as known.
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { loadLevels } from './lib/levels.mjs';
import { runChecks } from './lib/pool.mjs';

const { values: o } = parseArgs({
  options: {
    jobs: { type: 'string', default: String(availableParallelism()) },
    seconds: { type: 'string', default: '5' },
    pack: { type: 'string' },
    json: { type: 'string' },
    baseline: { type: 'string' },
  },
});
const levels = loadLevels().filter((l) => !o.pack || l.pack === o.pack);
const seconds = Number(o.seconds);
const t0 = Date.now();
const results = await runChecks(
  levels.map(({ file }) => ({ kind: 'probe', file, seconds })),
  { parallel: Number(o.jobs), onResult: (r) => r.status === 'fehler' && console.log(`FEHLER ${r.level}: ${r.error}`) },
);
const count = (s) => results.filter((r) => r.status === s).length;
const known = new Set(o.baseline ? JSON.parse(readFileSync(o.baseline, 'utf8')).fehler : []);
const fresh = results.filter((r) => r.status === 'fehler' && !known.has(r.level));
const healed = [...known].filter((id) => results.some((r) => r.level === id && r.status !== 'fehler'));
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`Ladeprobe: ${levels.length} Levels, ${count('ok')} ok, ${count('lua')} mit Lua-Fehler, ${count('fehler')} Fehler (${secs} s, ${seconds} s Spielzeit je Level)`);
if (o.baseline) console.log(`  bekannte Fehler: ${known.size}, neue: ${fresh.length}${healed.length ? `, wieder ok: ${healed.join(', ')}` : ''}`);
if (o.json) writeFileSync(o.json, `${JSON.stringify({ seconds, results }, null, 1)}\n`);
process.exitCode = (o.baseline ? fresh.length : count('fehler')) ? 1 : 0;
