import { describe, expect, it } from "vitest";

import { descendantPageIds } from "./trees";

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
