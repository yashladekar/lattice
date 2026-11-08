import { describe, expect, it } from "vitest";

import { docToMarkdown } from "./editor";
import { simpleMarkdownToDoc, inlineMarkdown, inlineMarkdownToNodes } from "./markdown-doc";
import type { TipTapNode } from "./types";

function types(node: TipTapNode, acc: string[] = []): string[] {
  acc.push(String(node.type));
  for (const child of node.content ?? []) types(child, acc);
  return acc;
}

function find(node: TipTapNode, type: string): TipTapNode | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const match = find(child, type);
    if (match) return match;
  }
  return undefined;
}

const textOf = (node: TipTapNode | undefined): string =>
  (node?.content ?? [])
    .map((child) => (child.type === "text" ? (child.text ?? "") : textOf(child)))
    .join("");

describe("simpleMarkdownToDoc", () => {
  it("keeps paragraphs and headings in order", () => {
    const doc = simpleMarkdownToDoc("# Title\n\nSome words here.\n\n## Section");
    expect(doc.content?.map((node) => node.type)).toEqual(["heading", "paragraph", "heading"]);
    expect(find(doc, "heading")?.attrs?.level).toBe(1);
    expect(doc.content?.[2]?.attrs?.level).toBe(2);
  });

  it("joins wrapped lines and splits on blank lines", () => {
    const doc = simpleMarkdownToDoc("one line\ncontinues here\n\nsecond paragraph");
    expect(doc.content).toHaveLength(2);
    expect(textOf(doc.content?.[0])).toBe("one line continues here");
  });

  it("nests bullet lists by indentation", () => {
    const doc = simpleMarkdownToDoc("- first\n  - nested\n- second");
    const list = find(doc, "bulletList");
    expect(list?.content).toHaveLength(2);
    const nested = find(list!.content![0]!, "bulletList");
    expect(textOf(nested)).toBe("nested");
  });

  it("parses ordered and task lists", () => {
    const doc = simpleMarkdownToDoc("1. one\n2. two\n\n- [ ] open\n- [x] done");
    expect(types(doc, []).filter((type) => type === "orderedList")).toHaveLength(1);
    const tasks = doc.content?.filter((node) => node.type === "taskList") ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.content?.[0]?.attrs?.checked).toBe(false);
    expect(tasks[0]?.content?.[1]?.attrs?.checked).toBe(true);
  });

  it("starts a sibling list when the type changes at the same depth", () => {
    const doc = simpleMarkdownToDoc("- bullet\n1. number");
    expect(types(doc, []).filter((type) => type.endsWith("List"))).toEqual([
      "bulletList",
      "orderedList",
    ]);
  });

  it("groups consecutive quote lines", () => {
    const doc = simpleMarkdownToDoc("> first\n> second\n\nplain");
    const quote = find(doc, "blockquote");
    expect(textOf(quote)).toBe("first second");
    expect(doc.content?.[1]?.type).toBe("paragraph");
  });

  it("parses fenced code with a language and rules", () => {
    const doc = simpleMarkdownToDoc("```ts\nconst a = 1;\n```\n\n---");
    const code = find(doc, "codeBlock");
    expect(code?.attrs?.language).toBe("ts");
    expect(textOf(code)).toBe("const a = 1;");
    expect(types(doc, [])).toContain("horizontalRule");
  });

  it("keeps an unterminated code fence", () => {
    const doc = simpleMarkdownToDoc("```\nstill code");
    expect(textOf(find(doc, "codeBlock"))).toBe("still code");
  });

  it("applies inline marks and only links http(s) targets", () => {
    const doc = simpleMarkdownToDoc("**bold** *italic* `code` [site](https://example.com)");
    const paragraph = doc.content?.[0];
    const marks = (paragraph?.content ?? [])
      .filter((child) => child.marks?.length)
      .map((child) => child.marks?.[0]?.type);
    expect(marks).toEqual(["bold", "italic", "code", "link"]);
    const link = (paragraph?.content ?? []).find((child) => child.marks?.[0]?.type === "link");
    expect(link?.marks?.[0]?.attrs?.href).toBe("https://example.com");
    const unsafe = simpleMarkdownToDoc("[click](javascript:alert(1))");
    expect((unsafe.content?.[0]?.content ?? []).every((child) => !child.marks)).toBe(true);
    expect(textOf(unsafe.content?.[0])).toBe("[click](javascript:alert(1))");
  });

  it("round-trips through the Markdown serializer", () => {
    const markdown = "# Notes\n\nA paragraph with **bold** text.\n\n- one\n- two\n\n- [x] done";
    const back = docToMarkdown(simpleMarkdownToDoc(markdown) as never);
    expect(back).toContain("# Notes");
    expect(back).toContain("**bold**");
    expect(back).toContain("- one");
    expect(back).toContain("[x]");
  });

  it("always returns a valid document", () => {
    expect(simpleMarkdownToDoc("").type).toBe("doc");
    expect(simpleMarkdownToDoc("").content).toEqual([{ type: "paragraph" }]);
    expect(simpleMarkdownToDoc("   \n\n  ").content).toEqual([{ type: "paragraph" }]);
  });
});

describe("inline markdown helpers", () => {
  it("parses formatting, links, page links, and hard breaks", () => {
    const nodes = inlineMarkdownToNodes(
      "a **bold** *italic* ~~gone~~ `code` [site](https://example.com) [[page-1|Home]]\nnext",
    );
    const marks = nodes
      .filter((node) => node.type === "text" && node.marks)
      .map((node) => node.marks?.map((mark) => mark.type).join("+"));
    expect(marks).toEqual(["bold", "italic", "strike", "code", "link"]);
    expect(nodes.some((node) => node.type === "pageLink")).toBe(true);
    const pageLink = nodes.find((node) => node.type === "pageLink");
    expect(pageLink?.attrs).toMatchObject({ pageId: "page-1", title: "Home" });
    expect(nodes.some((node) => node.type === "hardBreak")).toBe(true);
  });

  it("round-trips inline marks and page links", () => {
    const source =
      "A **bold** *italic* ~~gone~~ `code` [site](https://example.com) [[page-1|Home]]";
    expect(inlineMarkdown(inlineMarkdownToNodes(source))).toBe(source);
  });
});
