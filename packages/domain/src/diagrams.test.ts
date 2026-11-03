import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIAGRAM_SOURCE,
  MAX_DIAGRAM_SOURCE,
  diagramBlock,
  diagramSummary,
  diagramTypeOf,
  normalizeDiagramSource,
  outlineToMermaid,
} from "./diagrams";
import { docToMarkdown } from "./editor";
import type { TipTapDoc, TipTapNode } from "./types";

const heading = (level: number, value: string): TipTapNode => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text: value }],
});

const bulletList = (...items: string[]): TipTapNode => ({
  type: "bulletList",
  content: items.map((item) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text: item }] }],
  })),
});

describe("diagram sources", () => {
  it("identifies the diagram type from the first meaningful line", () => {
    expect(diagramTypeOf("flowchart TD\n  a --> b")).toBe("flowchart");
    expect(diagramTypeOf("graph LR\n  a --> b")).toBe("flowchart");
    expect(diagramTypeOf("%% a comment\nsequenceDiagram\n  A->>B: hi")).toBe("sequence");
    expect(diagramTypeOf("erDiagram\n  A ||--o{ B : has")).toBe("entity relationship");
    expect(diagramTypeOf("")).toBe("diagram");
  });

  it("normalizes line endings, tabs, and length", () => {
    expect(normalizeDiagramSource("a\r\n\tb")).toBe("a\n  b");
    expect(normalizeDiagramSource("x".repeat(MAX_DIAGRAM_SOURCE + 500))).toHaveLength(
      MAX_DIAGRAM_SOURCE,
    );
  });

  it("summarizes without repeating the diagram keyword", () => {
    const summary = diagramSummary(DEFAULT_DIAGRAM_SOURCE);
    expect(summary).not.toMatch(/flowchart/i);
    expect(summary.length).toBeGreaterThan(0);
    expect(diagramSummary("")).toBe("Empty diagram");
  });

  it("builds a diagram node with a normalized source", () => {
    const node = diagramBlock("flowchart TD\r\n  a --> b", "Flow");
    expect(node.type).toBe("diagram");
    expect(node.attrs?.source).toBe("flowchart TD\n  a --> b");
    expect(node.attrs?.caption).toBe("Flow");
  });
});

describe("outline to mermaid", () => {
  const doc: TipTapDoc = {
    type: "doc",
    content: [
      heading(2, "Getting started"),
      heading(3, "Install"),
      bulletList("Clone the repo", "Run the tests"),
      heading(3, "Configure"),
      heading(2, "Shipping"),
    ],
  };

  it("nests headings by level and hangs lists off their section", () => {
    const source = outlineToMermaid(doc);
    expect(source.startsWith("flowchart TD")).toBe(true);
    expect(source).toContain('["Getting started"]');
    expect(source).toContain('["Install"]');
    expect(source).toContain('(["Clone the repo"])');
    expect(source).toContain('(["Run the tests"])');

    const lines = source.split("\n");
    const idOf = (label: string) => {
      const line = lines.find((value) => value.includes(`"${label}"`)) ?? "";
      return /^\s*(n\d+)/.exec(line)?.[1] ?? "";
    };

    // Install hangs off Getting started; Configure does not hang off Install.
    expect(source).toContain(`${idOf("Getting started")} --> ${idOf("Install")}`);
    expect(source).toContain(`${idOf("Getting started")} --> ${idOf("Configure")}`);
    expect(source).toContain(`${idOf("Install")} --> ${idOf("Clone the repo")}`);
    expect(source).not.toContain(`${idOf("Install")} --> ${idOf("Configure")}`);
    // Siblings at the same level are not chained to each other.
    expect(source).not.toContain(`${idOf("Configure")} --> ${idOf("Shipping")}`);
  });

  it("can skip lists and accepts a title root", () => {
    const source = outlineToMermaid(doc, { includeLists: false, title: "Handbook" });
    expect(source).toContain('(["Handbook"])');
    expect(source).toContain("--> n1");
    expect(source).not.toContain("Clone the repo");
  });

  it("returns an empty string when there is nothing to chart", () => {
    expect(outlineToMermaid({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
    expect(outlineToMermaid(null)).toBe("");
  });

  it("caps the number of nodes", () => {
    const many: TipTapDoc = {
      type: "doc",
      content: Array.from({ length: 30 }, (_, index) => heading(2, `Section ${index}`)),
    };
    const source = outlineToMermaid(many, { maxNodes: 5 });
    const declared = source.split("\n").filter((line) => /^\s*n\d+/.test(line));
    expect(declared).toHaveLength(5);
    expect(source).not.toContain("Section 5");
  });
});

describe("diagram markdown round trip", () => {
  it("exports a diagram as a mermaid fence", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        diagramBlock("flowchart TD\n  a --> b", "The flow"),
        {
          type: "codeBlock",
          attrs: { language: "typescript" },
          content: [{ type: "text", text: "const a = 1;" }],
        },
      ],
    };
    const markdown = docToMarkdown(doc);
    expect(markdown).toContain("```mermaid\nflowchart TD\n  a --> b\n```");
    expect(markdown).toContain("*The flow*");
    expect(markdown).toContain("```typescript");
  });
});
