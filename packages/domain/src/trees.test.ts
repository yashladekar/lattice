import { describe, expect, it } from "vitest";

import {
  buildTrashTree,
  descendantPageIds,
  pageDropPosition,
  pageDropTarget,
  planPageOrder,
} from "./trees";

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

describe("pageDropTarget", () => {
  const layouts = [
    { id: "a", y: 100, height: 40 },
    { id: "b", y: 200, height: 40 },
  ];

  it("classifies the top, middle, and bottom of a row", () => {
    expect(pageDropTarget(layouts, 102)).toEqual({ pageId: "a", position: "before" });
    expect(pageDropTarget(layouts, 120)).toEqual({ pageId: "a", position: "inside" });
    expect(pageDropTarget(layouts, 138)).toEqual({ pageId: "a", position: "after" });
  });

  it("returns null in a gap and over a forbidden row", () => {
    expect(pageDropTarget(layouts, 170)).toBeNull();
    expect(pageDropTarget(layouts, 120, new Set(["a"]))).toBeNull();
  });

  it("uses the shared placement thresholds", () => {
    expect(pageDropPosition(0.29)).toBe("before");
    expect(pageDropPosition(0.3)).toBe("inside");
    expect(pageDropPosition(0.75)).toBe("inside");
    expect(pageDropPosition(0.76)).toBe("after");
  });
});

describe("buildTrashTree", () => {
  const trashed = (
    id: string,
    parentId: string | null,
    deletedAt: string | null,
    sortOrder = 0,
    title = id,
  ) => ({ id, parentId, deletedAt, sortOrder, title });

  it("groups a subtree under its newest root and counts the descendants", () => {
    const groups = buildTrashTree([
      trashed("root", null, "2026-01-02T00:00:00.000Z", 0, "Root"),
      trashed("second", "root", "2026-01-02T00:00:02.000Z", 2000, "Second"),
      trashed("first", "root", "2026-01-02T00:00:01.000Z", 1000, "First"),
      trashed("grand", "second", "2026-01-02T00:00:03.000Z", 0, "Grand"),
      trashed("newer", null, "2026-01-03T00:00:00.000Z", 0, "Newer"),
    ]);

    expect(groups.map((group) => group.page.id)).toEqual(["newer", "root"]);
    expect(groups[1].descendantCount).toBe(3);
    expect(groups[1].children.map((child) => child.page.id)).toEqual(["first", "second"]);
    expect(groups[1].children[1].children[0].page.id).toBe("grand");
  });

  it("promotes a trashed child whose parent is not trashed", () => {
    const groups = buildTrashTree([
      trashed("active", null, null),
      trashed("orphan", "active", "2026-01-01T00:00:00.000Z"),
      trashed("root", null, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(groups.map((group) => group.page.id)).toEqual(["root", "orphan"]);
  });

  it("terminates on a corrupt trash cycle", () => {
    const groups = buildTrashTree([
      trashed("a", "b", "2026-01-01T00:00:00.000Z"),
      trashed("b", "a", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].descendantCount).toBe(1);
  });
});
