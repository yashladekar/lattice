import { describe, expect, it } from "vitest";

import { docToMarkdown, extractPlainText, nodePlainText } from "./editor";
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
