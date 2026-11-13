// Child process of tools/lib/pool.mjs: runs one check at a time with the game code from src/.
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
const { probeLevel, checkSolution } = await import('../../src/game/check.ts');
const { startLuaNode } = await import('../../src/lua/node.ts');
const { LuaLevel } = await import('../../src/lua/runtime.ts');
LuaLevel.quiet = true;

/**
 * A level uploaded from the editor (docs/SPEC-spielerlevels.md): only what the editor can make
 * (sanitizeLevel, never Lua), then the author's solution must win. The recording's level id (link:…
 * from the playtest) becomes the id of the level for the replay. Returns the checked level to store.
 */
async function checkPlayerLevel(raw, recording) {
  const { sanitizeLevel, LinkError } = await import('../../src/editor/link.ts');
  let file;
  try {
    file = sanitizeLevel(raw, String(recording?.level ?? ''));
  } catch (e) {
    return { status: 'ungueltig', steps: 0, error: e instanceof LinkError ? e.message : 'Das ist kein gültiges Level.' };
  }
  return { ...(await checkSolution(file, recording, startLuaNode)), file };
}

process.on('message', async ({ id, kind, file, recording, seconds, seed }) => {
  let result;
  if (kind === 'probe') result = await probeLevel(file, startLuaNode, seconds);
  else if (kind === 'solution') result = await checkSolution(file, recording, startLuaNode);
  else if (kind === 'player') result = await checkPlayerLevel(file, recording);
  else {
    // tools/autosolve.mjs: a winning recording or null
    const { autoplay } = await import('./autopilot.mjs');
    result = { level: file.id, recording: await autoplay(file, startLuaNode, { seed }).catch(() => null) };
  }
  process.send({ id, result });
});
process.send({ ready: true });
