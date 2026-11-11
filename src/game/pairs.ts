// Pair rules for signal stones (memory style):
// - Touching a closed stone opens it.
// - A second open stone with the same symbol solves the pair.
// - A different symbol shows both briefly, then both close.
// - Touching another stone while a mismatch is shown closes the mismatch
//   at once and opens the new stone.

export type StoneState = 'closed' | 'open' | 'solved';

export const MISMATCH_SECONDS = 1.0;

export type PairEvent =
  | { type: 'opened'; index: number }
  | { type: 'solved'; a: number; b: number }
  | { type: 'mismatch'; a: number; b: number }
  | { type: 'closed'; indices: number[] }
  | { type: 'complete' };

export class PairBoard {
  readonly states: StoneState[];
  private pending: number | null = null;
  private mismatch: { a: number; b: number; until: number } | null = null;

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

  hit(index: number, now: number): PairEvent[] {
    if (this.states[index] !== 'closed') return [];
    const events: PairEvent[] = [];

    if (this.mismatch) events.push(this.closeMismatch());

    if (this.pending === null) {
      this.states[index] = 'open';
      this.pending = index;
      events.push({ type: 'opened', index });
      return events;
    }

    const first = this.pending;
    this.pending = null;
    this.states[index] = 'open';
    events.push({ type: 'opened', index });

    if (this.symbols[first] === this.symbols[index]) {
      this.states[first] = 'solved';
      this.states[index] = 'solved';
      events.push({ type: 'solved', a: first, b: index });
      if (this.complete) events.push({ type: 'complete' });
    } else {
      this.mismatch = { a: first, b: index, until: now + MISMATCH_SECONDS };
      events.push({ type: 'mismatch', a: first, b: index });
    }
    return events;
  }

  update(now: number): PairEvent[] {
    if (this.mismatch && now >= this.mismatch.until) return [this.closeMismatch()];
    return [];
  }

  private closeMismatch(): PairEvent {
    const { a, b } = this.mismatch!;
    this.mismatch = null;
    this.states[a] = 'closed';
    this.states[b] = 'closed';
    return { type: 'closed', indices: [a, b] };
  }
}
