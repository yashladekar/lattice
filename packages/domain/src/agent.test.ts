import { describe, expect, it } from "vitest";

import {
  AGENT_LIMITS,
  applyBlockEdits,
  describeAgentOp,
  normalizeAgentNodes,
  normalizeAgentPlan,
  planRefs,
  type AgentOp,
} from "./agent";
import type { TipTapDoc, TipTapNode } from "./types";

const doc = (content: TipTapNode[]): TipTapDoc => ({ type: "doc", content });

const block = (blockId: string, text: string): TipTapNode => ({
  type: "paragraph",
  attrs: { blockId },
  content: [{ type: "text", text }],
});

describe("node allowlist", () => {
  it("keeps ordinary blocks and text", () => {
    const nodes = normalizeAgentNodes([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Next steps" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Do the thing." }] },
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
  });

  it("drops blocks that can embed or execute", () => {
    const nodes = normalizeAgentNodes([
      { type: "pageEmbed", attrs: { pageId: "secret" } },
      { type: "liveBlock", attrs: { pageId: "secret" } },
      { type: "request", attrs: { url: "https://example.com" } },
      { type: "image", attrs: { src: "https://example.com/x.png" } },
      { type: "paragraph", content: [{ type: "text", text: "kept" }] },
    ]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe("paragraph");
  });

  it("strips marks outside the allowlist", () => {
    const [paragraph] = normalizeAgentNodes([
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "hello",
            marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://evil.test" } }],
          },
        ],
      },
    ]);
    expect(paragraph?.content?.[0]?.marks).toEqual([{ type: "bold" }]);
  });

  it("clamps heading levels and ignores garbage attrs", () => {
    const nodes = normalizeAgentNodes([
      { type: "heading", attrs: { level: 99, blockId: "injected" }, content: [{ type: "text", text: "x" }] },
      { type: "heading", attrs: { level: "nope" }, content: [{ type: "text", text: "y" }] },
    ]);
    expect(nodes[0]?.attrs).toEqual({ level: 3 });
    expect(nodes[1]?.attrs).toEqual({ level: 2 });
  });

  it("keeps a valid Mermaid diagram", () => {
    const [node] = normalizeAgentNodes([
      {
        type: "diagram",
        attrs: { source: "flowchart TD\n  a[Client] --> b[Server]", caption: "Request path" },
      },
    ]);
    expect(node?.type).toBe("diagram");
    expect(node?.attrs?.source).toContain("flowchart TD");
    expect(node?.attrs?.caption).toBe("Request path");
  });

  it("drops a diagram Mermaid could not render", () => {
    expect(
      normalizeAgentNodes([{ type: "diagram", attrs: { source: "draw something nice" } }]),
    ).toEqual([]);
    expect(normalizeAgentNodes([{ type: "diagram", attrs: {} }])).toEqual([]);
  });

  it("clamps the number of nodes per operation", () => {
    const many = Array.from({ length: AGENT_LIMITS.maxNodesPerOp + 10 }, () => ({
      type: "paragraph",
      content: [{ type: "text", text: "x" }],
    }));
    expect(normalizeAgentNodes(many)).toHaveLength(AGENT_LIMITS.maxNodesPerOp);
  });
});

describe("plan validation", () => {
  it("accepts a mixed plan", () => {
    const { plan, warnings } = normalizeAgentPlan({
      title: "Tidy this note",
      ops: [
        { kind: "append_blocks", pageId: "page-1", nodes: [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }] },
        { kind: "link_pages", sourcePageId: "page-1", targetPageId: "page-2", relationType: "RELATED_TO" },
      ],
    });
    expect(warnings).toEqual([]);
    expect(plan?.ops).toHaveLength(2);
  });

  it("accepts a create_canvas op and keeps its outline", () => {
    const { plan, warnings } = normalizeAgentPlan({
      title: "Whiteboard",
      ops: [
        {
          kind: "create_canvas",
          title: "System design",
          layout: "mindmap",
          nodes: [
            { text: "System design", level: 1 },
            { text: "Scaling", level: 2 },
          ],
        },
      ],
    });
    expect(warnings).toEqual([]);
    expect(plan?.ops[0]).toMatchObject({ kind: "create_canvas", layout: "mindmap" });
  });

  it("rejects an unknown canvas layout and an empty outline", () => {
    expect(
      normalizeAgentPlan({
        title: "x",
        ops: [{ kind: "create_canvas", title: "x", layout: "spiral", nodes: [{ text: "a" }] }],
      }).plan,
    ).toBeNull();
    expect(
      normalizeAgentPlan({
        title: "x",
        ops: [{ kind: "create_canvas", title: "x", layout: "flow", nodes: [] }],
      }).plan,
    ).toBeNull();
  });

  it("rejects unknown relation types", () => {
    const { plan } = normalizeAgentPlan({
      title: "x",
      ops: [{ kind: "link_pages", sourcePageId: "a", targetPageId: "b", relationType: "MUTATES" }],
    });
    expect(plan).toBeNull();
  });

  it("drops ops whose blocks are all unsupported, and reports it", () => {
    const { plan, warnings } = normalizeAgentPlan({
      title: "x",
      ops: [
        { kind: "append_blocks", pageId: "page-1", nodes: [{ type: "pageEmbed", attrs: { pageId: "secret" } }] },
        { kind: "create_page", title: "Note", markdown: "hello" },
      ],
    });
    expect(plan?.ops).toHaveLength(1);
    expect(warnings[0]).toMatch(/no supported blocks/i);
  });

  it("truncates a plan longer than the op cap", () => {
    const ops = Array.from({ length: AGENT_LIMITS.maxOps + 5 }, () => ({ kind: "create_page", title: "n", markdown: "m" }));
    const { plan, warnings } = normalizeAgentPlan({ title: "many", ops });
    expect(plan?.ops).toHaveLength(AGENT_LIMITS.maxOps);
    expect(warnings.join(" ")).toMatch(/first 12 changes/i);
  });

  it("returns null rather than throwing on junk", () => {
    expect(normalizeAgentPlan("not a plan").plan).toBeNull();
    expect(normalizeAgentPlan({ title: "x", ops: [] }).plan).toBeNull();
  });
});

describe("plan aliases", () => {
  it("resolves refs declared by create_page in later ops", () => {
    const { plan, warnings } = normalizeAgentPlan({
      title: "System design",
      ops: [
        { kind: "create_page", ref: "ref:fundamentals", title: "Fundamentals", markdown: "# Basics" },
        { kind: "create_page", ref: "scaling", title: "Scaling", markdown: "# Scaling" },
        {
          kind: "link_pages",
          sourcePageId: "scaling",
          targetPageId: "fundamentals",
          relationType: "PART_OF",
        },
      ],
    });
    expect(warnings).toEqual([]);
    expect(plan?.ops[0]).toMatchObject({ kind: "create_page", ref: "ref:fundamentals" });
    // A bare slug is normalised to the prefixed form.
    expect(plan?.ops[1]).toMatchObject({ kind: "create_page", ref: "ref:scaling" });
    expect(plan?.ops[2]).toMatchObject({
      kind: "link_pages",
      sourcePageId: "ref:scaling",
      targetPageId: "ref:fundamentals",
    });
  });

  it("leaves real page ids untouched", () => {
    const id = "0b2c7f7e-1f4a-4c1e-9d2a-2f6a1c3b4d5e";
    const { plan } = normalizeAgentPlan({
      title: "x",
      ops: [
        {
          kind: "append_blocks",
          pageId: id,
          nodes: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
        },
      ],
    });
    expect(plan?.ops[0]).toMatchObject({ pageId: id });
  });

  it("drops a duplicate alias and reports it", () => {
    const { plan, warnings } = normalizeAgentPlan({
      title: "x",
      ops: [
        { kind: "create_page", ref: "ref:basics", title: "Basics", markdown: "a" },
        { kind: "create_page", ref: "basics", title: "Basics again", markdown: "a" },
      ],
    });
    expect(plan?.ops).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/declared twice/i);
  });

  it("only counts aliases the plan declares", () => {
    const { plan } = normalizeAgentPlan({
      title: "x",
      ops: [
        { kind: "create_page", ref: "ref:a", title: "A", markdown: "a" },
        { kind: "create_page", title: "No alias", markdown: "b" },
      ],
    });
    expect(planRefs(plan!)).toEqual(new Set(["ref:a"]));
  });
});

describe("applying block edits", () => {
  it("appends blocks and gives each a fresh block id", () => {
    const result = applyBlockEdits(doc([block("a", "one")]), [
      { kind: "append_blocks", pageId: "p", nodes: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
    ]);
    expect(result.applied).toBe(1);
    expect(result.doc.content).toHaveLength(2);
    const appended = result.doc.content[1];
    expect(typeof appended?.attrs?.blockId).toBe("string");
    expect(appended?.attrs?.blockId).not.toBe("a");
  });

  it("replaces the empty starter paragraph on append", () => {
    const result = applyBlockEdits(doc([{ type: "paragraph" }]), [
      { kind: "append_blocks", pageId: "p", nodes: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    ]);
    expect(result.doc.content).toHaveLength(1);
    expect(result.doc.content[0]?.content?.[0]?.text).toBe("hi");
  });

  it("inserts after the referenced block", () => {
    const result = applyBlockEdits(
      doc([block("a", "one"), block("b", "two")]),
      [
        {
          kind: "insert_blocks",
          pageId: "p",
          afterBlockId: "a",
          nodes: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }],
        },
      ],
    );
    expect(result.doc.content).toHaveLength(3);
    expect(result.doc.content[1]?.content?.[0]?.text).toBe("new");
  });

  it("replaces in place and drops later duplicates of the same id", () => {
    const result = applyBlockEdits(
      doc([block("a", "one"), block("b", "two"), block("a", "one again")]),
      [
        {
          kind: "replace_blocks",
          pageId: "p",
          blockIds: ["a", "b"],
          nodes: [{ type: "paragraph", content: [{ type: "text", text: "merged" }] }],
        },
      ],
    );
    expect(result.doc.content).toHaveLength(1);
    expect(result.doc.content[0]?.content?.[0]?.text).toBe("merged");
  });

  it("skips an unknown block instead of throwing", () => {
    const result = applyBlockEdits(doc([block("a", "one")]), [
      {
        kind: "insert_blocks",
        pageId: "p",
        afterBlockId: "missing",
        nodes: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
      },
    ]);
    expect(result.applied).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.doc.content).toHaveLength(1);
  });
});

describe("op descriptions", () => {
  it("reads like a change list", () => {
    const ops: AgentOp[] = [
      { kind: "append_blocks", pageId: "p", nodes: [{ type: "paragraph" }] },
      { kind: "create_page", title: "Ideas", markdown: "x" },
      { kind: "link_pages", sourcePageId: "a", targetPageId: "b", relationType: "DEPENDS_ON" },
      { kind: "create_flashcards", pageId: "p", cards: [{ front: "f", back: "b" }] },
    ];
    expect(ops.map(describeAgentOp)).toEqual([
      "Append 1 block",
      "Create page “Ideas”",
      "Link pages (depends on)",
      "1 flashcard",
    ]);
  });
});
