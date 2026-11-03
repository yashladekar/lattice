import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor, isAfterCursor } from "./sync";
import { scheduleReview } from "./learning";
import { canEditPage, hasRole } from "./permissions";
import { docFromText, docToMarkdown, extractPageLinks, extractPlainText } from "./editor";

describe("sync cursors", () => {
  it("round-trips and compares composite cursors", () => {
    const cursor = { version: 12, id: "abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(isAfterCursor(cursor, 12, "abd")).toBe(true);
    expect(isAfterCursor(cursor, 12, "aaa")).toBe(false);
    expect(isAfterCursor(cursor, 13, "aaa")).toBe(true);
    expect(isAfterCursor(null, 1, "a")).toBe(true);
  });
});

describe("spaced repetition", () => {
  it("advances intervals and preserves the ease floor", () => {
    const first = scheduleReview({ interval: 0, ease: 2.5, reps: 0, lapses: 0 }, 3, new Date("2026-01-01"));
    expect(first.interval).toBe(1);
    expect(first.reps).toBe(1);
    const second = scheduleReview(first, 3, new Date("2026-01-02"));
    expect(second.interval).toBe(3);
    const lapse = scheduleReview(second, 1, new Date("2026-01-05"));
    expect(lapse.lapses).toBe(1);
    expect(lapse.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe("permissions", () => {
  it("ranks workspace roles", () => {
    expect(hasRole("MEMBER", "EDITOR")).toBe(true);
    expect(hasRole("VIEWER", "EDITOR")).toBe(false);
  });

  it("lets creators edit private pages but not other members", () => {
    const page = { createdById: "a", visibility: "PRIVATE" as const };
    expect(canEditPage({ page, userId: "a", role: "EDITOR" })).toBe(true);
    expect(canEditPage({ page, userId: "b", role: "MEMBER" })).toBe(false);
  });
});

describe("editor extraction", () => {
  it("extracts text, links, and markdown", () => {
    const doc = docFromText("# Hello\n\nWorld with #tag");
    doc.content.push({
      type: "paragraph",
      content: [{ type: "pageLink", attrs: { pageId: "p2", title: "Second" } }],
    });
    expect(extractPlainText(doc)).toContain("Hello");
    expect(extractPageLinks(doc)).toEqual([{ pageId: "p2", label: "Second" }]);
    expect(docToMarkdown(doc)).toContain("# Hello");
    expect(docToMarkdown(doc)).toContain("[[Second]](p2)");
  });
});
