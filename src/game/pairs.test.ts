import { describe, expect, it } from 'vitest';
import { MISMATCH_SECONDS, PairBoard } from './pairs';

describe('PairBoard', () => {
  it('opens the first touched stone', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    expect(b.hit(0, 0)).toEqual([{ type: 'opened', index: 0 }]);
    expect(b.states).toEqual(['open', 'closed', 'closed', 'closed']);
  });

  it('solves a matching pair and reports completion at the end', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    b.hit(0, 0);
    expect(b.hit(2, 0)).toContainEqual({ type: 'solved', a: 0, b: 2 });
    expect(b.solvedPairs).toBe(1);
    b.hit(1, 0);
    const ev = b.hit(3, 0);
    expect(ev).toContainEqual({ type: 'complete' });
    expect(b.complete).toBe(true);
  });

  it('shows a mismatch and closes both after the delay', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    b.hit(0, 0);
    expect(b.hit(1, 0)).toContainEqual({ type: 'mismatch', a: 0, b: 1 });
    expect(b.update(MISMATCH_SECONDS - 0.01)).toEqual([]);
    expect(b.update(MISMATCH_SECONDS)).toEqual([{ type: 'closed', indices: [0, 1] }]);
    expect(b.states).toEqual(['closed', 'closed', 'closed', 'closed']);
  });

  it('touching a new stone during a mismatch closes it and opens the new one', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    b.hit(0, 0);
    b.hit(1, 0);
    const ev = b.hit(2, 0.2);
    expect(ev[0]).toEqual({ type: 'closed', indices: [0, 1] });
    expect(ev[1]).toEqual({ type: 'opened', index: 2 });
    expect(b.states).toEqual(['closed', 'closed', 'open', 'closed']);
  });

  it('ignores touches on open or solved stones', () => {
    const b = new PairBoard(['A', 'A']);
    b.hit(0, 0);
    expect(b.hit(0, 0)).toEqual([]);
    b.hit(1, 0);
    expect(b.hit(1, 0)).toEqual([]);
  });
});
