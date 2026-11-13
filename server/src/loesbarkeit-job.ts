/**
 * Nachtlauf der Lösbarkeitsprüfung (docs/SPEC-loesbarkeit.md). Runs in the API image as the compose
 * service "loesbarkeit" (one core, lowest priority), with a copy of the active game version at GAME_DIR.
 * Started by /opt/murmel/loesbarkeit.sh (murmel-loesbarkeit.timer).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db.ts';
import { parseAdminEmails } from './konten.ts';
import { type Recording, runNight, type StoredSolution, type ToolOutput } from './loesbarkeit.ts';
import { solvabilityStore } from './loesbarkeit-db.ts';
import { mailerFromEnv } from './mail.ts';

/** Runs a tool of the game; exit 0 = all fine, 1 = something failed (both have a result). */
function tool(gameDir: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd: gameDir, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', reject);
    p.on('exit', (code, signal) => (code === 0 || code === 1 ? resolve() : reject(new Error(`${basename(args[0])} endete mit ${signal ?? code}`))));
  });
}

function readJson<T>(path: string, what: string): T {
  if (!existsSync(path)) throw new Error(`${what}: kein Ergebnis`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** The load probe of every level and the replay of the repository solutions plus the stored ones. */
export async function runTools(gameDir: string, stored: (StoredSolution & { recording: Recording })[], jobs = 1): Promise<ToolOutput> {
  const tmp = mkdtempSync(join(tmpdir(), 'loesbarkeit-'));
  try {
    const dbDir = join(tmp, 'db');
    mkdirSync(dbDir);
    for (const s of stored) writeFileSync(join(dbDir, `${s.id}.json`), JSON.stringify({ ...s.recording, ...(s.levelHash ? { levelHash: s.levelHash } : {}) }));
    const load = join(tmp, 'load.json');
    const sol = join(tmp, 'solutions.json');
    await tool(gameDir, [join(gameDir, 'tools', 'check-load.mjs'), '--jobs', String(jobs), '--json', load]);
    const repo = join(gameDir, 'solutions');
    await tool(gameDir, [join(gameDir, 'tools', 'check-solutions.mjs'), ...(existsSync(repo) ? [repo] : []), dbDir, '--jobs', String(jobs), '--json', sol]);
    const probes = readJson<{ results: ToolOutput['probes'] }>(load, 'Ladeprobe').results;
    const solutions = readJson<{ results: (Omit<ToolOutput['solutions'][number], 'ref'> & { file: string })[] }>(sol, 'Lösungen').results.map(({ file, ...r }) => ({
      ...r,
      ref: file.startsWith('solutions/') ? `repo:${file.slice('solutions/'.length)}` : `db:${basename(file, '.json')}`,
    }));
    return { probes, solutions };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL fehlt');
  const gameDir = process.env.GAME_DIR || '/game';
  const sql = connect(url);
  try {
    await runNight({
      store: solvabilityStore(sql),
      version: process.env.MURMEL_VERSION || 'dev',
      check: (stored) => runTools(gameDir, stored, Number(process.env.LOESBARKEIT_JOBS || 1)),
      mailer: mailerFromEnv(process.env),
      admins: parseAdminEmails(process.env.ADMIN_EMAILS),
      origin: process.env.PUBLIC_ORIGIN || 'https://murmel.games',
      log: (m) => console.log(`[loesbarkeit] ${m}`),
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
