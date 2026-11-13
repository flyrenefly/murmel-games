// Child process of tools/lib/pool.mjs: runs one check at a time with the game code from src/.
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
const { probeLevel, checkSolution } = await import('../../src/game/check.ts');
const { startLuaNode } = await import('../../src/lua/node.ts');
const { LuaLevel } = await import('../../src/lua/runtime.ts');
LuaLevel.quiet = true;

process.on('message', async ({ id, kind, file, recording, seconds, seed }) => {
  let result;
  if (kind === 'probe') result = await probeLevel(file, startLuaNode, seconds);
  else if (kind === 'solution') result = await checkSolution(file, recording, startLuaNode);
  else {
    // tools/autosolve.mjs: a winning recording or null
    const { autoplay } = await import('./autopilot.mjs');
    result = { level: file.id, recording: await autoplay(file, startLuaNode, { seed }).catch(() => null) };
  }
  process.send({ id, result });
});
process.send({ ready: true });
