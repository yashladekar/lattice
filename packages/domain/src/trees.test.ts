import { describe, expect, it } from "vitest";

import { descendantPageIds, planPageOrder } from "./trees";

const page = (id: string, parentId: string | null, deletedAt: string | null = null) => ({
  id,
  parentId,
  deletedAt,
});

describe("descendantPageIds", () => {
  it("collects the whole subtree whatever the row order", () => {
    const pages = [page("leaf", "branch"), page("root", null), page("branch", "root")];
    expect(descendantPageIds("root", pages)).toEqual(["branch", "leaf"]);
  });

  it("skips trashed pages by default", () => {
    const pages = [page("root", null), page("branch", "root"), page("leaf", "branch", "2026-01-01")];
    expect(descendantPageIds("root", pages)).toEqual(["branch"]);
  });

  it("includes trashed pages when asked", () => {
    const pages = [page("root", null), page("branch", "root"), page("leaf", "branch", "2026-01-01")];
    expect(descendantPageIds("root", pages, { includeDeleted: true })).toEqual([
      "branch",
      "leaf",
    ]);
  });

  it("terminates on a corrupt cycle", () => {
    const pages = [page("a", "b"), page("b", "a"), page("c", "a")];
    expect(new Set(descendantPageIds("a", pages))).toEqual(new Set(["b", "c"]));
  });
});

describe("planPageOrder", () => {
  const siblings = [
    { id: "a", sortOrder: 1000, title: "A" },
    { id: "b", sortOrder: 2000, title: "B" },
    { id: "c", sortOrder: 3000, title: "C" },
  ];

  it("appends after the last sibling", () => {
    expect(planPageOrder(siblings, { afterId: "c" })).toEqual({
      sortOrder: 4000,
      siblingUpdates: [],
    });
  });

  it("inserts before the first sibling", () => {
    expect(planPageOrder(siblings, { beforeId: "a" })).toEqual({
      sortOrder: 0,
      siblingUpdates: [],
    });
  });

  it("uses the midpoint when the neighbours leave a gap", () => {
    expect(planPageOrder(siblings, { beforeId: "b" })).toEqual({
      sortOrder: 1500,
      siblingUpdates: [],
    });
  });

  it("appends when the target is missing or the group is empty", () => {
    expect(planPageOrder(siblings, { beforeId: "missing" })).toEqual({
      sortOrder: 4000,
      siblingUpdates: [],
    });
    expect(planPageOrder([], {})).toEqual({ sortOrder: 1000, siblingUpdates: [] });
  });

  it("renumbers adjacent siblings instead of colliding", () => {
    const tight = [
      { id: "a", sortOrder: 1, title: "A" },
      { id: "b", sortOrder: 2, title: "B" },
    ];
    expect(planPageOrder(tight, { afterId: "a" })).toEqual({
      sortOrder: 2000,
      siblingUpdates: [
        { id: "a", sortOrder: 1000 },
        { id: "b", sortOrder: 3000 },
      ],
    });
  });

  it("sorts unsorted siblings before choosing a position", () => {
    const unsorted = [
      { id: "b", sortOrder: 2000, title: "B" },
      { id: "a", sortOrder: 1000, title: "A" },
    ];
    expect(planPageOrder(unsorted, { beforeId: "b" })).toEqual({
      sortOrder: 1500,
      siblingUpdates: [],
    });
  });
});
