import { describe, expect, it } from "vitest";

import { liveWriteWouldClobber } from "./document-writes";

describe("live document writes", () => {
  it("allows an editor whose revision is current", () => {
    expect(
      liveWriteWouldClobber({ lastWrittenRev: 4, currentRev: 4, lastChangeSource: "write" }),
    ).toBe(false);
  });

  it("allows a revision another session produced", () => {
    expect(
      liveWriteWouldClobber({ lastWrittenRev: 4, currentRev: 5, lastChangeSource: "session" }),
    ).toBe(false);
  });

  it("blocks when an out-of-band write landed under the editor", () => {
    expect(
      liveWriteWouldClobber({ lastWrittenRev: 4, currentRev: 5, lastChangeSource: "write" }),
    ).toBe(true);
  });

  it("does not block on an unknown origin", () => {
    expect(liveWriteWouldClobber({ lastWrittenRev: 4, currentRev: 5, lastChangeSource: null })).toBe(
      false,
    );
    expect(liveWriteWouldClobber({ lastWrittenRev: 4, currentRev: 5 })).toBe(false);
  });
});
