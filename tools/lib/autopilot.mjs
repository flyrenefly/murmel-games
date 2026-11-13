// Autopilot for simple levels (docs/SPEC-loesbarkeit.md, "Lösungen aus dem Autopiloten"): steers the
// marble with the key force only – like a player on the arrow keys – along free cells to each Oxyd
// pair in turn. It may look at the board (it knows which stones match); the recording it leaves holds
// nothing but the input, so the replay proves the win like any recorded run. Levels with puzzles,
// enemies or moving stones simply end without a win.
import { isDeadly } from '../../src/game/level.ts';
import { GameSession } from '../../src/game/session.ts';

/** Key force at full press (src/main.ts AXIS_FORCE). */
const AXIS = 10;
const STEPS_PER_PLAN = 40;
/** Steps one key force is held, and its grid: a few distinct values keep the recording small. */
const HOLD = 8;
const GRID = 2.5;

export async function autoplay(file, startLua, { seed = 1, maxSeconds = 600 } = {}) {
  const s = await GameSession.create(file, { seed, startLua });
  const lv = s.level;
  const W = lv.width;
  const H = lv.height;
  const maxSteps = Math.round(maxSeconds / 0.0025);

  const free = (c, r) => {
    if (c < 0 || r < 0 || c >= W || r >= H) return false;
    const cell = lv.cells[r * W + c];
    if (!cell || (cell.stone && !cell.hollow) || isDeadly(cell.floor) || /swamp|water|abyss|ice/.test(cell.floor)) return false;
    if (cell.force && Math.hypot(cell.force[0], cell.force[1]) > 0) return false;
    return !s.objects.stoneObjectAt(c, r);
  };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  /** Cells from (c, r) to the nearest goal cell (BFS), or null. */
  const path = (c, r, goals) => {
    const prev = new Map([[r * W + c, -1]]);
    const queue = [r * W + c];
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i];
      if (goals.has(k)) {
        const out = [];
        for (let x = k; x !== -1; x = prev.get(x)) out.unshift(x);
        return out;
      }
      for (const [dx, dy] of DIRS) {
        const nc = (k % W) + dx;
        const nr = Math.floor(k / W) + dy;
        const nk = nr * W + nc;
        if (!prev.has(nk) && free(nc, nr)) {
          prev.set(nk, k);
          queue.push(nk);
        }
      }
    }
    return null;
  };

  const marble = () => s.physics.marbles[s.physics.current];
  const clamp = (x, y) => {
    const n = Math.hypot(x, y);
    return n > AXIS ? [(x / n) * AXIS, (y / n) * AXIS] : [x, y];
  };
  const step = (ax, ay) => s.step({ fx: 0, fy: 0, ax, ay });
  const failed = () => s.falls > 0 || s.steps >= maxSteps || s.restartRequested;

  /** Brings the marble next to the Oxyd stone and bumps it until it opens. */
  const visit = async (sig) => {
    const goals = new Set();
    for (const [dx, dy] of DIRS) if (free(sig.col + dx, sig.row + dy)) goals.add((sig.row + dy) * W + sig.col + dx);
    if (!goals.size) return false;
    const before = s.board.states[sig.index];
    for (let tries = 0; tries < 400 && !failed(); tries++) {
      const m = marble();
      const c = Math.floor(m.pos.x);
      const r = Math.floor(m.pos.y);
      let tx;
      let ty;
      if (goals.has(r * W + c)) {
        tx = sig.col + 0.5;
        ty = sig.row + 0.5;
      } else {
        const p = path(c, r, goals);
        if (!p) return false;
        const next = p[Math.min(1, p.length - 1)];
        tx = (next % W) + 0.5;
        ty = Math.floor(next / W) + 0.5;
      }
      let held = [0, 0];
      for (let k = 0; k < STEPS_PER_PLAN && !failed(); k++) {
        const mm = marble();
        const dx = tx - mm.pos.x;
        const dy = ty - mm.pos.y;
        const d = Math.hypot(dx, dy) || 1;
        const speed = Math.min(3, 1 + d * 2);
        if (k % HOLD === 0) {
          const [fx, fy] = clamp(((dx / d) * speed - mm.vel.x) * 8, ((dy / d) * speed - mm.vel.y) * 8);
          held = [Math.round(fx / GRID) * GRID, Math.round(fy / GRID) * GRID];
        }
        step(held[0], held[1]);
        if (s.board.states[sig.index] !== before || s.won) return true;
      }
    }
    return false;
  };

  const bySymbol = new Map();
  for (const sig of lv.signals) {
    const sym = s.board.symbolOf(sig.index);
    if (!bySymbol.has(sym)) bySymbol.set(sym, []);
    bySymbol.get(sym).push(sig);
  }
  for (const group of bySymbol.values()) {
    if (group.length !== 2) continue;
    for (const sig of group) {
      if (s.won || failed()) break;
      if (s.board.states[sig.index] === 'solved') continue;
      if (!(await visit(sig))) break;
    }
  }
  // The pair rule needs the second stone right after the first; a short rest lets the last one settle.
  for (let k = 0; k < 400 && !s.won && !failed(); k++) step(0, 0);
  return s.won ? s.recording() : null;
}
