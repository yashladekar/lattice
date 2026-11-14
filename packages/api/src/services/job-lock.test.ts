import { describe, expect, it } from "vitest";

import { createJobLocks, isDatabaseUnavailable } from "@notes-learning/db";

import { describeWithDatabase } from "../../test/helpers";

describe("database availability errors", () => {
  it("recognises connection failures and ignores ordinary errors", () => {
    expect(isDatabaseUnavailable({ code: "ECONNREFUSED" })).toBe(true);
    expect(isDatabaseUnavailable({ code: "08006" })).toBe(true);
    expect(isDatabaseUnavailable({ errors: [{ code: "ECONNREFUSED" }] })).toBe(true);
    expect(isDatabaseUnavailable(new Error("nope"))).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });
});

describeWithDatabase("background job leases", () => {
  it("runs one holder at a time and reacquires after release", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
    const locks = createJobLocks(process.env.DATABASE_URL);
    const key = 0x4c415454fe;
    const order: string[] = [];
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquiredGate = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    let first: Promise<unknown> | undefined;

    try {
      first = locks.run(key, async () => {
        order.push("first");
        acquired();
        await gate;
      });
      await acquiredGate;

      const second = await locks.run(key, async () => {
        order.push("second");
      });
      expect(second).toBeUndefined();

      release();
      await first;

      const third = await locks.run(key, async () => {
        order.push("third");
        return "third";
      });
      expect(third).toBe("third");
      expect(order).toEqual(["first", "third"]);
    } finally {
      release();
      await first?.catch(() => undefined);
      await locks.close();
    }
  });
});
