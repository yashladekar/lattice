import { describe, expect, it } from "vitest";

import {
  linkActiveAt,
  sortVersionTimeline,
  versionEntryAt,
  versionLinksAt,
  versionTimelineBounds,
} from "./version-timeline";

const at = (day: number) => new Date(Date.UTC(2024, 0, day)).toISOString();

const entries = [
  { pageId: "a", version: 1, createdAt: at(1), title: "A", links: [] },
  { pageId: "a", version: 2, createdAt: at(4), title: "A", links: ["b"] },
  { pageId: "a", version: 3, createdAt: at(9), title: "A", links: ["b", "c"] },
  { pageId: "a", version: 4, createdAt: at(12), title: "A", links: ["c"] },
  { pageId: "b", version: 1, createdAt: at(6), title: "B", links: ["c"] },
];

const time = (day: number) => new Date(Date.UTC(2024, 0, day)).getTime();

describe("version timeline", () => {
  it("sorts oldest first and resolves bounds", () => {
    const sorted = sortVersionTimeline([...entries].reverse());
    expect(sorted.map((entry) => `${entry.pageId}${entry.version}`)).toEqual([
      "a1",
      "a2",
      "b1",
      "a3",
      "a4",
    ]);
    expect(versionTimelineBounds(entries)).toEqual({ min: time(1), max: time(12) });
    expect(versionTimelineBounds([])).toBeNull();
  });

  it("uses the version that was current at a point in time", () => {
    const links = versionLinksAt(entries, time(5));
    expect([...(links.get("a") ?? [])]).toEqual(["b"]);
    expect([...(links.get("b") ?? [])]).toEqual([]);
    expect([...(versionLinksAt(entries, time(10)).get("a") ?? [])]).toEqual(["b", "c"]);
    expect([...(versionLinksAt(entries, time(20)).get("a") ?? [])]).toEqual(["c"]);
  });

  it("leaves pages without history unknown rather than empty", () => {
    const links = versionLinksAt(entries, time(2));
    expect(links.has("b")).toBe(false);
    expect(linkActiveAt(links, "b", "c")).toBe(true);
    expect(linkActiveAt(links, "a", "b")).toBe(false);
  });

  it("captions the latest event at or before the scrub point", () => {
    expect(versionEntryAt(entries, time(5))?.version).toBe(2);
    expect(versionEntryAt(entries, time(6))?.pageId).toBe("b");
    expect(versionEntryAt(entries, time(1))?.version).toBe(1);
    expect(versionEntryAt(entries, new Date(Date.UTC(2023, 0, 1)).getTime())).toBeNull();
  });

  it("keeps a link only while it exists in the note", () => {
    const day5 = versionLinksAt(entries, time(5));
    expect(linkActiveAt(day5, "a", "b")).toBe(true);
    expect(linkActiveAt(day5, "a", "c")).toBe(false);
    const day13 = versionLinksAt(entries, time(13));
    expect(linkActiveAt(day13, "a", "b")).toBe(false);
    expect(linkActiveAt(day13, "a", "c")).toBe(true);
  });

  it("handles unparseable timestamps without throwing", () => {
    const broken = [{ pageId: "x", version: 1, createdAt: "nope", title: "X", links: ["y"] }];
    expect(versionTimelineBounds(broken)).toBeNull();
    expect(versionLinksAt(broken, time(5)).size).toBe(0);
    expect(versionEntryAt(broken, time(5))).toBeNull();
  });
});
