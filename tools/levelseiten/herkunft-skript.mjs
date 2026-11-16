// Herkunftszählung der Levelseiten (docs/SPEC-herkunft.md): bündelt src/herkunft-seite.ts (dieselbe
// Logik wie im Spiel, src/herkunft.ts und src/stats.ts) zu einer kleinen Datei ohne Importe, die
// tools/levelseiten/bauen.mjs als level/herkunft.js schreibt. Ein eigener Vite-Build statt einer
// Kopie: so gibt es die Regeln nur einmal; und kein Eintrag im Haupt-Build, damit die Datei nicht
// an einem Chunk des Spiels hängt und einen festen Namen hat.
import { join } from 'node:path';
import { build } from 'vite';
import { ROOT } from '../lib/levels.mjs';

/** Der gebündelte, minifizierte Code (ES-Modul ohne Importe und Exporte). */
export async function herkunftSkript() {
  const out = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    build: {
      write: false,
      target: 'es2022',
      minify: true,
      rolldownOptions: { output: { minify: true } },
      lib: { entry: join(ROOT, 'src/herkunft-seite.ts'), formats: ['es'], fileName: 'herkunft' },
    },
  });
  const chunks = (Array.isArray(out) ? out : [out]).flatMap((o) => o.output).filter((c) => c.type === 'chunk');
  if (chunks.length !== 1) throw new Error(`herkunft.js: ${chunks.length} Teile statt einem`);
  return chunks[0].code;
}
