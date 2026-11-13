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

/** Symbol of a fake Oxyd stone (OxydStone FAKE). */
const FAKE = '-';

export class PairBoard {
  readonly states: StoneState[];
  private single: number | null = null;

  private readonly symbols: string[];

  constructor(symbols: readonly string[]) {
    this.symbols = [...symbols];
    this.states = symbols.map(() => 'closed');
  }

  /** Current symbol (colour) of a stone; shuffle changes the closed ones. */
  symbolOf(index: number): string {
    return this.symbols[index];
  }

  /** An Oxyd stone made during play (closed); its index is the next one. */
  add(symbol: string): void {
    this.symbols.push(symbol);
    this.states.push('closed');
  }

  /** OxydStone::initColors for stones made during play: their colour is known now. */
  setSymbol(index: number, symbol: string): void {
    this.symbols[index] = symbol;
  }

  /** OxydStone::setState(0) ("close", "off", "signal" 0): a single open stone closes. */
  close(index: number): PairEvent[] {
    if (this.states[index] !== 'open') return [];
    this.states[index] = 'closed';
    if (this.single === index) this.single = null;
    return [{ type: 'closed', indices: [index] }];
  }

  /**
   * OxydStone::shuffleColors: the colours of all closed stones are dealt out again.
   * (Enigma's fair shuffle also honours wo:shuffleOxyd rules; here a uniform permutation.)
   */
  shuffle(random: () => number = Math.random): void {
    const closed = this.states.flatMap((s, i) => (s === 'closed' ? [i] : []));
    const syms = closed.map((i) => this.symbols[i]);
    for (let k = syms.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [syms[k], syms[j]] = [syms[j], syms[k]];
    }
    closed.forEach((i, k) => (this.symbols[i] = syms[k]));
  }

  get solvedPairs(): number {
    return this.states.filter((s) => s === 'solved').length / 2;
  }

  get totalPairs(): number {
    return Math.floor(this.symbols.filter((s) => s !== FAKE).length / 2);
  }

  /** All real stones are solved (a fake one never opens). */
  get complete(): boolean {
    return this.states.every((s, i) => s === 'solved' || this.symbols[i] === FAKE);
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
    // OxydStone::tryOpen with FAKE: a single open stone closes, the fake one stays closed
    if (this.symbols[index] === FAKE) {
      if (first === null) return [];
      this.states[first] = 'closed';
      this.single = null;
      return [{ type: 'closed', indices: [first] }];
    }
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
