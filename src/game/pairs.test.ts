import { describe, expect, it } from 'vitest';
import { PairBoard } from './pairs';

describe('closeAll', () => {
  it('closes open stones and solved pairs', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    b.hit(0);
    b.hit(2); // A solved
    b.hit(1); // B open
    expect(b.closeAll()).toEqual([{ type: 'closed', indices: [0, 1, 2] }]);
    expect(b.states).toEqual(['closed', 'closed', 'closed', 'closed']);
    expect(b.hit(3)).toEqual([{ type: 'opened', index: 3 }]);
  });
});

describe('PairBoard (Enigma rules)', () => {
  it('opens the first hit stone and keeps it open', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    expect(b.hit(0)).toEqual([{ type: 'opened', index: 0 }]);
    expect(b.states).toEqual(['open', 'closed', 'closed', 'closed']);
  });

  it('solves a matching pair and reports completion at the end', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    b.hit(0);
    expect(b.hit(2)).toEqual([{ type: 'solved', a: 0, b: 2 }]);
    expect(b.solvedPairs).toBe(1);
    b.hit(1);
    expect(b.hit(3)).toContainEqual({ type: 'complete' });
    expect(b.complete).toBe(true);
  });

  it('a different symbol closes the first stone and stays open itself', () => {
    const b = new PairBoard(['A', 'B', 'A', 'B']);
    b.hit(0);
    expect(b.hit(1)).toEqual([
      { type: 'closed', indices: [0] },
      { type: 'opened', index: 1 },
    ]);
    expect(b.states).toEqual(['closed', 'open', 'closed', 'closed']);
    // the open one can now be paired
    expect(b.hit(3)).toEqual([{ type: 'solved', a: 1, b: 3 }]);
  });

  it('ignores hits on open or solved stones', () => {
    const b = new PairBoard(['A', 'A']);
    b.hit(0);
    expect(b.hit(0)).toEqual([]);
    b.hit(1);
    expect(b.hit(1)).toEqual([]);
  });

  it("close() closes a single open stone; shuffle() deals the colours of closed stones anew", () => {
    const b = new PairBoard(["A", "A", "B", "B", "C", "C"]);
    b.hit(0);
    expect(b.close(0)).toEqual([{ type: "closed", indices: [0] }]);
    expect(b.states[0]).toBe("closed");
    expect(b.hit(1)).toEqual([{ type: "opened", index: 1 }]); // no pair pending any more
    b.hit(0); // A pair solved
    expect(b.close(0)).toEqual([]); // solved pairs stay open
    let k = 0;
    b.shuffle(() => [0.9, 0.1, 0.5, 0.3][k++ % 4]);
    expect([0, 1].map((i) => b.symbolOf(i))).toEqual(["A", "A"]); // solved ones keep theirs
    expect([2, 3, 4, 5].map((i) => b.symbolOf(i)).sort()).toEqual(["B", "B", "C", "C"]);
  });
});
