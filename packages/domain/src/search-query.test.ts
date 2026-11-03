import { describe, expect, it } from "vitest";

import { hasSearchFilters, parseSearchQuery } from "./search";

describe("parseSearchQuery", () => {
  it("keeps plain words as text", () => {
    expect(parseSearchQuery("local first sync")).toEqual({
      text: "local first sync",
      tags: [],
      types: [],
      notebooks: [],
    });
  });

  it("extracts tag filters and treats #tag as shorthand", () => {
    const parsed = parseSearchQuery("graph tag:ml #research");
    expect(parsed.text).toBe("graph");
    expect(parsed.tags).toEqual(["ml", "research"]);
  });

  it("supports quoted values with spaces", () => {
    const parsed = parseSearchQuery('tag:"deep work" notebook:"My knowledge"');
    expect(parsed.tags).toEqual(["deep work"]);
    expect(parsed.notebooks).toEqual(["my knowledge"]);
    expect(parsed.text).toBe("");
  });

  it("accepts known types only", () => {
    const parsed = parseSearchQuery("type:page type:canvas type:podcast");
    expect(parsed.types).toEqual(["page", "canvas"]);
  });

  it("ignores empty operators and keeps unknown ones as text", () => {
    const parsed = parseSearchQuery("tag: type: status:open");
    expect(parsed.tags).toEqual([]);
    expect(parsed.text).toContain("tag:");
    expect(parsed.text).toContain("status:open");
  });

  it("annotates whether any filter is active", () => {
    expect(hasSearchFilters(parseSearchQuery("just words"))).toBe(false);
    expect(hasSearchFilters(parseSearchQuery("type:canvas"))).toBe(true);
    expect(hasSearchFilters(parseSearchQuery("#tag"))).toBe(true);
  });

  it("handles an empty query", () => {
    expect(parseSearchQuery("   ")).toEqual({ text: "", tags: [], types: [], notebooks: [] });
  });
});
