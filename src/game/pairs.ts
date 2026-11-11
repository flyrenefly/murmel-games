// Pair rules for signal stones, as in Enigma (stones/OxydStone.cc, Enigma mode):
// - Hitting a closed stone opens it; it stays open (blinking) on its own.
// - Hitting a second stone with the same symbol opens both for good.
// - Hitting a second stone with a different symbol closes the first one;
//   the new one stays open instead.

export type StoneState = 'closed' | 'open' | 'solved';

export type PairEvent =
  | { type: 'opened'; index: number }
  | { type: 'solved'; a: number; b: number }
  | { type: 'closed'; indices: number[] }
  | { type: 'complete' };

export class PairBoard {
  readonly states: StoneState[];
  private single: number | null = null;

  constructor(private readonly symbols: readonly string[]) {
    this.states = symbols.map(() => 'closed');
  }

  get solvedPairs(): number {
    return this.states.filter((s) => s === 'solved').length / 2;
  }

  get totalPairs(): number {
    return this.symbols.length / 2;
  }

  get complete(): boolean {
    return this.states.every((s) => s === 'solved');
  }

  /** OxydStone::closeAllStandardOxyds (st_quake): every open stone closes, solved pairs too. */
  closeAll(): PairEvent[] {
    const indices = this.states.flatMap((s, i) => (s === 'closed' ? [] : [i]));
    for (const i of indices) this.states[i] = 'closed';
    this.single = null;
    return indices.length ? [{ type: 'closed', indices }] : [];
  }

  hit(index: number): PairEvent[] {
    if (this.states[index] !== 'closed') return [];

    const first = this.single;
    if (first === null) {
      this.states[index] = 'open';
      this.single = index;
      return [{ type: 'opened', index }];
    }

    if (this.symbols[first] === this.symbols[index]) {
      this.single = null;
      this.states[first] = 'solved';
      this.states[index] = 'solved';
      const events: PairEvent[] = [{ type: 'solved', a: first, b: index }];
      if (this.complete) events.push({ type: 'complete' });
      return events;
    }

    this.states[first] = 'closed';
    this.states[index] = 'open';
    this.single = index;
    return [
      { type: 'closed', indices: [first] },
      { type: 'opened', index },
    ];
  }
}
