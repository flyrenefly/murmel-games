/**
 * Random numbers with a seed: one generator per run, so a run can be replayed exactly
 * (docs/SPEC-aufzeichnung.md, stage A1). mulberry32 – small, fast, 32-bit state, same results on
 * every platform (only integer operations). Changing the algorithm invalidates stored recordings.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new start value for a run (from the browser's crypto source when available). */
export function randomSeed(): number {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 2 ** 32);
}
