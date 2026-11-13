// node --test "tools/**/*.test.mjs": the check tools as the CI and the nightly run call them.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import { loadLevels, ROOT } from './levels.mjs';
import { runChecks } from './pool.mjs';
import { solutionPath } from './solutions.mjs';

const run = promisify(execFile);
const tmp = mkdtempSync(join(tmpdir(), 'murmel-check-'));
after(() => rmSync(tmp, { recursive: true, force: true }));
const level01 = loadLevels().find((l) => l.file.id === '01').file;

test('Lösungsdateien: Pfad aus der Level-Kennung, nichts außerhalb von solutions/', () => {
  const root = join('x', 'solutions');
  assert.equal(solutionPath('enigma:rb01', root), join(root, 'enigma', 'rb01.json'));
  assert.equal(solutionPath('01', root), join(root, 'murmel', '01.json'));
  assert.equal(solutionPath('enigma:m_tutor/m_tut1', root), join(root, 'enigma', 'm_tutor', 'm_tut1.json'));
  assert.equal(solutionPath('enigma:JuStA Kind of Magic', root), join(root, 'enigma', 'JuStA Kind of Magic.json'));
  for (const bad of ['enigma:../x', 'enigma:a/../../b', '../x:y', 'enigma:a\\b', 'enigma:', 'enigma:a/']) {
    assert.throws(() => solutionPath(bad, root), undefined, bad);
  }
});

test('Prüfprozesse: Zeitlimit kostet nur das eine Ergebnis, danach geht es weiter', async () => {
  const seen = [];
  const results = await runChecks(
    [
      { kind: 'probe', file: level01, seconds: 36_000 }, // 14,4 Mio. Schritte: weit länger als das Limit
      { kind: 'probe', file: level01, seconds: 0.5 },
    ],
    { parallel: 1, timeoutMs: 1500, msPerStep: 0, onResult: (r, i) => seen.push(i) },
  );

  assert.equal(results[0].status, 'fehler');
  assert.match(results[0].error, /Zeitüberschreitung/);
  assert.deepEqual(results[1], { level: '01', status: 'ok', steps: 200 });
  assert.deepEqual(seen, [0, 1]);
});

test('check-solutions: gelöst, abgeschnitten, unlesbar, unbekanntes Level – Exit 1 und JSON je Datei', async () => {
  const good = JSON.parse(readFileSync(solutionPath('01'), 'utf8'));
  writeFileSync(join(tmp, 'a-gut.json'), JSON.stringify(good));
  writeFileSync(join(tmp, 'b-kurz.json'), JSON.stringify({ ...good, steps: 10, input: [[10, 0, 0]] }));
  writeFileSync(join(tmp, 'c-kaputt.json'), '{');
  writeFileSync(join(tmp, 'd-fremd.json'), JSON.stringify({ ...good, level: 'enigma:gibtsnicht' }));
  writeFileSync(join(tmp, 'e-geaendert.json'), JSON.stringify({ ...good, levelHash: 'alt' }));
  const out = join(tmp, 'out.json');

  const err = await run(process.execPath, [join(ROOT, 'tools', 'check-solutions.mjs'), tmp, '--jobs', '2', '--json', out]).catch((e) => e);

  assert.equal(err.code, 1);
  assert.match(err.stdout, /Lösungen: 5 für 1 Levels, 2 gelöst, 1 nicht gelöst, 2 Fehler/);
  const { results } = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(results.map((r) => r.status), ['geloest', 'nicht-geloest', 'fehler', 'fehler', 'geloest']);
  assert.equal(results[0].steps, good.steps);
  assert.match(results[0].levelHash, /^[0-9a-f]{64}$/);
  assert.equal(results[4].levelChanged, true);
  assert.match(results[3].error, /gibt es nicht/);
});

test('check-load: ein Paket, JSON mit Ergebnis je Level', async () => {
  const out = join(tmp, 'load.json');
  const { stdout } = await run(process.execPath, [join(ROOT, 'tools', 'check-load.mjs'), '--pack', 'murmel', '--seconds', '1', '--json', out]);

  assert.match(stdout, /Ladeprobe: 3 Levels, 3 ok/);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).results.map((r) => r.level), ['01', '02', '03']);
});
