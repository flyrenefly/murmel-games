// All levels of the game as Node sees them: Murmel's own (src/levels/*.json) and the imported
// Enigma packs (public/levels/enigma/<pack>.json, listed in index.json).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * [{ pack, file, ref }] in game order; `root` is the repository (or a copy of it). `ref`: a cross
 * reference – the level of another pack (its source.pack), shown here as in Enigma's tutorials; it
 * counts for the positions in its pack, while pages, catalogue and checks take every level once.
 */
export function loadLevels(root = ROOT) {
  const out = [];
  const own = join(root, 'src', 'levels');
  for (const name of readdirSync(own).filter((n) => /^\d+\.json$/.test(n)).sort()) {
    out.push({ pack: 'murmel', file: JSON.parse(readFileSync(join(own, name), 'utf8')), ref: false });
  }
  const dir = join(root, 'public', 'levels', 'enigma');
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
  for (const { pack } of index) {
    const { levels } = JSON.parse(readFileSync(join(dir, `${pack}.json`), 'utf8'));
    for (const file of levels) out.push({ pack, file, ref: file.source?.pack !== undefined && file.source.pack !== pack });
  }
  return out;
}

/**
 * Number of different playable levels (Murmel's own included), without the cross references: the
 * same count as "Alle Levels" on the level pages. The press kit and the app manifest use it
 * (src/levelzahl.ts).
 */
export function levelAnzahl(root = ROOT) {
  return loadLevels(root).filter((l) => !l.ref).length;
}

/** SHA-256 of a level's content (docs/SPEC-aufzeichnung.md: levelHash binds a recording to the level). */
export function levelHash(file) {
  return createHash('sha256').update(JSON.stringify(file)).digest('hex');
}
