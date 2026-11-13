// Node-Ladehaken für die Vorschaubilder (docs/SPEC-levelseiten.md): Vite ersetzt im Spiel
// `import.meta.env.BASE_URL`; in Node gibt es import.meta.env nicht. Für die Dateien aus src/
// steht dort hier "/", die Bild-Attrappe (vorschau.mjs) liest die Pfade dann aus public/.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function load(url, context, next) {
  if (url.startsWith('file:') && /\/src\/.*\.ts$/.test(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    if (source.includes('import.meta.env')) {
      return { format: 'module-typescript', source: source.replaceAll('import.meta.env.BASE_URL', '"/"'), shortCircuit: true };
    }
  }
  return next(url, context);
}
