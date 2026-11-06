import { describe, expect, it } from "vitest";

import { isSuggestionStatus, suggestionIsStale } from "./suggestions";

describe("suggestions", () => {
  it("recognizes statuses", () => {
    expect(isSuggestionStatus("PENDING")).toBe(true);
    expect(isSuggestionStatus("ACCEPTED")).toBe(true);
    expect(isSuggestionStatus("DRAFT")).toBe(false);
    expect(isSuggestionStatus(null)).toBe(false);
  });

  it("flags a suggestion written against an older revision", () => {
    expect(suggestionIsStale(2, 3)).toBe(true);
    expect(suggestionIsStale(3, 3)).toBe(false);
    expect(suggestionIsStale(0, 0)).toBe(false);
  });
});
