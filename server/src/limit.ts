/**
 * Fixed-window request limit per key (here: client IP), in memory. One API container, so memory is
 * enough; a restart only resets the windows. Old windows are dropped when the map grows.
 */
export class RateLimit {
  private readonly hits = new Map<string, { start: number; count: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Counts one request; false when the key already used up its window. */
  take(key: string, now: number): boolean {
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
    }
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(key, { start: now, count: 1 });
      return true;
    }
    if (h.count >= this.max) return false;
    h.count++;
    return true;
  }
}
