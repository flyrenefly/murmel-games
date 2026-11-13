// Kindprozess von tools/levelseiten/bauen.mjs: macht Vorschaubilder, eines nach dem anderen.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { vorschau } from './vorschau.mjs';

process.on('message', async ({ i, file, dir }) => {
  try {
    const { webp, width, height, thumb } = await vorschau(file);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'vorschau.webp'), webp);
    writeFileSync(join(dir, 'klein.webp'), thumb);
    process.send({ i, width, height, bytes: webp.length + thumb.length });
  } catch (e) {
    process.send({ i, error: e instanceof Error ? e.message : String(e) });
  }
});
process.send({ ready: true });
