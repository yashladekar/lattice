import { describe, expect, it } from "vitest";

import { isPurgeable, retentionCutoff } from "./retention";

const now = new Date("2026-06-01T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("retention", () => {
  it("keeps trash forever when retention is zero or negative", () => {
    expect(retentionCutoff(0, now)).toBeNull();
    expect(retentionCutoff(-5, now)).toBeNull();
    expect(isPurgeable(daysAgo(4000), 0, now)).toBe(false);
  });

  it("computes a cutoff for a positive retention window", () => {
    expect(retentionCutoff(30, now)?.toISOString()).toBe("2026-05-02T00:00:00.000Z");
  });

  it("only marks rows older than the window as purgeable", () => {
    expect(isPurgeable(daysAgo(31), 30, now)).toBe(true);
    expect(isPurgeable(daysAgo(30), 30, now)).toBe(false);
    expect(isPurgeable(daysAgo(5), 30, now)).toBe(false);
    expect(isPurgeable(null, 30, now)).toBe(false);
  });

  it("accepts ISO strings and rejects invalid dates", () => {
    expect(isPurgeable(daysAgo(120).toISOString(), 90, now)).toBe(true);
    expect(isPurgeable("not-a-date", 90, now)).toBe(false);
  });
});
