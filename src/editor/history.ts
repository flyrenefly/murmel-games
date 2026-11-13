// Undo/redo as snapshots: levels are small, so a copy per step is simple and safe.

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 200) {}

  /** Call with the state before a change; a new change drops what could be redone. */
  record(before: T): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The previous state (the current one becomes redoable), or null. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** For keeping the history across a playtest (sessionStorage). */
  toJSON(): { past: T[]; future: T[] } {
    return { past: this.past, future: this.future };
  }

  static from<T>(data: { past?: T[]; future?: T[] } | null, limit = 200): History<T> {
    const h = new History<T>(limit);
    if (data && Array.isArray(data.past) && Array.isArray(data.future)) {
      h.past = data.past.slice(-limit);
      h.future = data.future;
    }
    return h;
  }
}
