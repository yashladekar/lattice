import { describe, expect, it } from "vitest";

import {
  docToMarkdown,
  extractOutline,
  extractPlainText,
  nodePlainText,
  stripUnsafeHrefs,
  withUniqueBlockIds,
} from "./editor";
import type { TipTapDoc, TipTapNode } from "./types";

const request = (attrs: Record<string, unknown>): TipTapNode => ({
  type: "request",
  attrs: { method: "GET", url: "", headers: "", body: "", label: "", ...attrs },
});

describe("request block", () => {
  it("reads as method and url in plain text", () => {
    expect(nodePlainText(request({ method: "POST", url: "https://api.test/items" }))).toBe(
      "POST https://api.test/items",
    );
    expect(nodePlainText(request({ method: "GET", url: "", label: "Health check" }))).toBe(
      "GET Health check",
    );
  });

  it("contributes to extracted plain text", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [request({ method: "GET", url: "https://api.test/health" })],
    };
    expect(extractPlainText(doc)).toContain("GET https://api.test/health");
  });

  it("exports as an http fence with headers and body", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        request({
          method: "POST",
          url: "https://api.test/items",
          headers: "Content-Type: application/json",
          body: '{"name":"x"}',
        }),
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toContain("```http");
    expect(markdown).toContain("POST https://api.test/items");
    expect(markdown).toContain("Content-Type: application/json");
    expect(markdown).toContain('{"name":"x"}');
  });

  it("omits empty sections from the export", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [request({ method: "GET", url: "https://api.test/health" })],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toBe("```http\nGET https://api.test/health\n```");
  });
});

describe("stripUnsafeHrefs", () => {
  it("keeps http, mailto, and tel targets", () => {
    const doc = stripUnsafeHrefs({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
          ],
        },
        { type: "image", attrs: { src: "http://example.com/a.png", alt: "x" } },
      ],
    });
    const paragraph = doc.content[0] as { content: Array<{ marks: unknown[] }> };
    expect(paragraph.content[0]?.marks).toHaveLength(1);
    const image = doc.content[1] as { attrs: Record<string, unknown> };
    expect(image.attrs.src).toBe("http://example.com/a.png");
  });

  it("drops javascript targets and other stray hrefs", () => {
    const doc = stripUnsafeHrefs({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "bad",
              marks: [
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                { type: "bold" },
              ],
            },
          ],
        },
        { type: "image", attrs: { src: "data:text/html;base64,AAAA" } },
      ],
    });
    const paragraph = doc.content[0] as { content: Array<{ marks: Array<{ type: string }> }> };
    expect(paragraph.content[0]?.marks.map((mark) => mark.type)).toEqual(["bold"]);
    expect((doc.content[1] as { attrs: Record<string, unknown> }).attrs.src).toBeUndefined();
  });

  it("returns an empty doc for junk", () => {
    expect(stripUnsafeHrefs("nope").content).toEqual([{ type: "paragraph" }]);
  });
});

describe("block id integrity", () => {
  const heading = (text: string, blockId?: string): TipTapNode => ({
    type: "heading",
    attrs: { level: 2, ...(blockId ? { blockId } : {}) },
    content: [{ type: "text", text }],
  });

  const duplicated: TipTapDoc = {
    type: "doc",
    content: [
      heading("First", "b1"),
      {
        type: "blockquote",
        attrs: { blockId: "q1" },
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "p1" },
            content: [{ type: "text", text: "quoted" }],
          },
        ],
      },
      heading("Second", "b1"),
    ],
  };

  it("keeps the document untouched when every id is unique", () => {
    const unique: TipTapDoc = {
      type: "doc",
      content: [heading("Only", "a1"), heading("Also", "a2")],
    };
    expect(withUniqueBlockIds(unique)).toBe(unique);
  });

  it("gives later occurrences of a duplicate id a fresh one", () => {
    const repaired = withUniqueBlockIds(duplicated);
    expect(repaired).not.toBe(duplicated);
    // the original doc keeps its shape — the repair returns a new tree
    expect(duplicated.content[2]?.attrs?.blockId).toBe("b1");
    expect(repaired.content[0]?.attrs?.blockId).toBe("b1");
    const second = repaired.content[2]?.attrs?.blockId;
    expect(typeof second).toBe("string");
    expect(second).not.toBe("b1");
    // nested ids are visited too, but unique ones stay as they are
    const quote = repaired.content[1]?.content?.[0];
    expect(quote?.attrs?.blockId).toBe("p1");
  });

  it("drops phantom outline entries for an id that appears twice", () => {
    const outline = extractOutline(duplicated);
    expect(outline.map((item) => item.id)).toEqual(["b1"]);
    expect(outline[0]?.text).toBe("First");
  });
});
