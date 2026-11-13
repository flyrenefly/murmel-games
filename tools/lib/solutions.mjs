// Where the repository keeps solutions: solutions/<pack>/<name>.json – "enigma:rb01" → enigma/rb01.json,
// Murmel's own "01" → murmel/01.json; a slash in the name ("m_tutor/adv_tutorial") becomes a folder.
import { join } from 'node:path';
import { ROOT } from './levels.mjs';

export const SOLUTIONS = join(ROOT, 'solutions');

export function solutionPath(levelId, root = SOLUTIONS) {
  const [prefix, name] = levelId.includes(':') ? levelId.split(':', 2) : ['murmel', levelId];
  const parts = name.split('/');
  // Names may hold spaces ("JuStA Kind of Magic"); nothing that Windows or a path could misread.
  const bad = (p) => !p || /[\\:*?"<>|\x00-\x1f]/.test(p) || /^[. ]|[. ]$/.test(p);
  if (!/^[\w-]+$/.test(prefix) || parts.some(bad)) throw new Error(`Level-Kennung ${levelId} passt nicht als Dateiname`);
  return join(root, prefix, ...parts.slice(0, -1), `${parts.at(-1)}.json`);
}
