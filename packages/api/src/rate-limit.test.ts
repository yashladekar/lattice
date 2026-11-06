import { describe, expect, it } from "vitest";

import { RateLimiter } from "./rate-limit";

describe("rate limiter", () => {
  it("allows requests up to the limit and refuses after it", () => {
    const limiter = new RateLimiter(60_000);
    const now = 1_000_000;
    expect(limiter.hit("ip:api", 2, now)).toBe(true);
    expect(limiter.hit("ip:api", 2, now)).toBe(true);
    expect(limiter.hit("ip:api", 2, now)).toBe(false);
  });

  it("resets the window once it expires", () => {
    const limiter = new RateLimiter(1_000);
    expect(limiter.hit("ip:api", 1, 0)).toBe(true);
    expect(limiter.hit("ip:api", 1, 500)).toBe(false);
    expect(limiter.hit("ip:api", 1, 1_000)).toBe(true);
  });

  it("keeps scopes and clients independent", () => {
    const limiter = new RateLimiter(1_000);
    expect(limiter.hit("a:api", 1, 0)).toBe(true);
    expect(limiter.hit("a:auth", 1, 0)).toBe(true);
    expect(limiter.hit("b:api", 1, 0)).toBe(true);
    expect(limiter.size).toBe(3);
  });

  it("sweeps expired buckets so the map does not grow forever", () => {
    const limiter = new RateLimiter(1_000);
    limiter.hit("old:api", 5, 0);
    limiter.hit("fresh:api", 5, 1_500);
    expect(limiter.size).toBe(2);
    expect(limiter.sweep(1_500)).toBe(1);
    expect(limiter.size).toBe(1);
  });
});
