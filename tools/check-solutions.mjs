// Lösbarkeitsprüfung (docs/SPEC-loesbarkeit.md): replays recorded wins (format of
// docs/SPEC-aufzeichnung.md) without graphics and reports per solution: gelöst / nicht gelöst / Fehler.
//   node tools/check-solutions.mjs [dir-or-file …] [--jobs N] [--json out.json] [--levels root]
// Default: solutions/ of the repository. Exit 1 if any solution no longer wins.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { levelHash, loadLevels, ROOT } from './lib/levels.mjs';
import { runChecks } from './lib/pool.mjs';

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    jobs: { type: 'string', default: String(availableParallelism()) },
    json: { type: 'string' },
    levels: { type: 'string' },
  },
});

/** Every .json below the given paths. */
function solutionFiles(paths) {
  const out = [];
  const walk = (p) => {
    if (statSync(p).isDirectory()) for (const n of readdirSync(p).sort()) walk(join(p, n));
    else if (p.endsWith('.json')) out.push(p);
  };
  paths.forEach(walk);
  return out;
}

const files = solutionFiles(positionals.length ? positionals : [join(ROOT, 'solutions')]);
const byId = new Map(loadLevels(o.levels ?? ROOT).map((l) => [l.file.id, l]));
const t0 = Date.now();

const entries = files.map((path) => {
  const name = relative(process.cwd(), path).replaceAll('\\', '/');
  try {
    const recording = JSON.parse(readFileSync(path, 'utf8'));
    const level = byId.get(recording?.level);
    if (!level) return { name, error: `Level ${recording?.level} gibt es nicht (mehr)` };
    const changed = typeof recording.levelHash === 'string' && recording.levelHash !== levelHash(level.file);
    return { name, level, recording, changed };
  } catch (e) {
    return { name, error: `nicht lesbar: ${e.message}` };
  }
});
const runnable = entries.filter((e) => !e.error);
const replayed = await runChecks(
  runnable.map((e) => ({ kind: 'solution', file: e.level.file, recording: e.recording })),
  { parallel: Number(o.jobs) },
);
const results = entries.map((e) => {
  if (e.error) return { file: e.name, level: null, status: 'fehler', steps: 0, recordedSteps: null, error: e.error };
  const r = replayed[runnable.indexOf(e)];
  return { file: e.name, pack: e.level.pack, levelHash: levelHash(e.level.file), ...r, ...(e.changed ? { levelChanged: true } : {}) };
});

const label = { geloest: 'gelöst', 'nicht-geloest': 'NICHT GELÖST', fehler: 'FEHLER' };
for (const r of results) {
  if (r.status === 'geloest' && r.steps === r.recordedSteps && !r.levelChanged) continue;
  const notes = [
    r.status === 'geloest' && r.recordedSteps !== null && r.steps !== r.recordedSteps ? `${r.steps} statt ${r.recordedSteps} Schritte` : '',
    r.levelChanged ? 'Level seit der Aufnahme geändert' : '',
    r.error ?? '',
    r.luaError ? `Lua: ${r.luaError}` : '',
  ].filter(Boolean);
  console.log(`${label[r.status]} ${r.level ?? '?'} (${r.file})${notes.length ? `: ${notes.join('; ')}` : ''}`);
}
const count = (s) => results.filter((r) => r.status === s).length;
const levels = new Set(results.filter((r) => r.level).map((r) => r.level)).size;
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`Lösungen: ${results.length} für ${levels} Levels, ${count('geloest')} gelöst, ${count('nicht-geloest')} nicht gelöst, ${count('fehler')} Fehler (${secs} s)`);
if (o.json) writeFileSync(o.json, `${JSON.stringify({ results }, null, 1)}\n`);
process.exitCode = results.length === count('geloest') ? 0 : 1;
