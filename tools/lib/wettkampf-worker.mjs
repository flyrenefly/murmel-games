// Child process of server/src/wettkampf-rechner.ts (docs/SPEC-wettkampf.md 2.4): the referee's
// physics. One GameSession per racer, fed the racer's input entries (recording format of
// docs/SPEC-aufzeichnung.md, plus [1, "restart"]) step by step – the same numbers the browser used.
//
// Messages from the API:
//   { id, kennt: levelId }                       → { id, ok }
//   { id, auf: [{ k, neu?: { level, seed }, e }], weg: [k] }
//                                                → { id, ms, s: [{ k, schritte, x, y, farbe, ziel, fehler? }] }
import { register } from 'node:module';

register('./ts-hooks.mjs', import.meta.url);
const { GameSession } = await import('../../src/game/session.ts');
const { startLuaNode } = await import('../../src/lua/node.ts');
const { LuaLevel } = await import('../../src/lua/runtime.ts');
const { loadLevels } = await import('./levels.mjs');
LuaLevel.quiet = true;

const SCALE = 1024;
const ACTIONS = new Set(['use', 'drop', 'rotate', 'swap']);

/** Level files by id, loaded on first use (the game's packs in the game directory = cwd). */
let byId = null;
const levels = () => (byId ??= new Map(loadLevels(process.cwd()).map((l) => [l.file.id, l.file])));

/** k → { file, seed, s: GameSession, vorher: steps of earlier tries, ziel: total steps at the win or null, fehler } */
const runs = new Map();

async function neu(k, level, seed) {
  const file = levels().get(level);
  if (!file) return runs.set(k, { fehler: 'level-unbekannt', vorher: 0, ziel: null, s: null });
  try {
    const s = await GameSession.create(file, { seed, startLua: startLuaNode });
    runs.set(k, { file, seed, s, vorher: 0, ziel: null, fehler: null });
  } catch (e) {
    runs.set(k, { fehler: `start: ${String(e?.message ?? e).slice(0, 200)}`, vorher: 0, ziel: null, s: null });
  }
}

/** Plays the entries of one racer; stops at the win (later input does not count). */
async function spielen(r, entries) {
  for (const e of entries) {
    if (r.fehler || r.ziel !== null) return;
    const [n, a, b, c = 0, d = 0] = e;
    if (a === 'restart') {
      // like the shell in src/main.ts: lives carried only when the run itself asked for it
      const carry = r.s.restartRequested === 'keep' ? r.s.livesLeft() : null;
      r.vorher += r.s.steps;
      try {
        r.s = await GameSession.create(r.file, { seed: r.seed, carryLives: carry, startLua: startLuaNode });
        r.pending.length = 0;
      } catch (err) {
        r.fehler = `neustart: ${String(err?.message ?? err).slice(0, 200)}`;
      }
      continue;
    }
    if (typeof a === 'string') {
      if (ACTIONS.has(a)) for (let i = 0; i < n; i++) r.pending.push(a);
      continue;
    }
    const control = { fx: a / SCALE, fy: b / SCALE, ax: c / SCALE, ay: d / SCALE };
    for (let i = 0; i < n; i++) {
      for (const act of r.pending) r.s.act(act);
      r.pending.length = 0;
      r.s.step(control);
      if (r.s.won) {
        r.ziel = r.vorher + r.s.steps;
        return;
      }
    }
  }
}

function stand(k, r) {
  if (!r.s) return { k, schritte: 0, x: 0, y: 0, farbe: 0, ziel: null, fehler: r.fehler };
  const ph = r.s.physics;
  const m = ph.marbles[ph.current] ?? ph.marbles[0];
  return { k, schritte: r.vorher + r.s.steps, x: m?.pos.x ?? 0, y: m?.pos.y ?? 0, farbe: m?.color ?? 0, ziel: r.ziel, ...(r.fehler ? { fehler: r.fehler } : {}) };
}

process.on('message', async (m) => {
  if (m.kennt !== undefined) return process.send({ id: m.id, ok: levels().has(m.kennt) });
  const t0 = performance.now();
  for (const k of m.weg ?? []) runs.delete(k);
  const out = [];
  for (const { k, neu: start, e } of m.auf ?? []) {
    if (start) await neu(k, start.level, start.seed);
    const r = runs.get(k);
    if (!r) continue;
    r.pending ??= [];
    if (e?.length) {
      try {
        await spielen(r, e);
      } catch (err) {
        r.fehler = `rechnen: ${String(err?.message ?? err).slice(0, 200)}`;
      }
    }
    out.push(stand(k, r));
  }
  process.send({ id: m.id, ms: performance.now() - t0, s: out });
});
process.send({ ready: true });
