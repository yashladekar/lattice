/**
 * Fixed-window request counters, one per client and scope.
 *
 * Expired buckets are dropped when they are next seen, and `sweep` clears keys
 * that never come back — without it a long-lived server keeps one entry for
 * every address it has ever met. Counters live in this process; running more
 * than one API instance multiplies every limit, which the self-hosting docs say
 * out loud.
 */
export interface RateBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly windowMs = 60_000) {}

  /** Counts one request. Returns false once the key is over its limit. */
  hit(key: string, limit: number, now = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  }

  /** Drops expired buckets. Returns how many were removed. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }
}
