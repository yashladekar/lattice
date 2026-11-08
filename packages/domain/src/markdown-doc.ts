import type { TipTapNode } from "./types";

/**
 * A DOM-free Markdown subset for hosts that cannot run the HTML importer —
 * the React Native editor and offline paths. It covers the blocks Lattice
 * writes: headings, paragraphs, bullet/ordered/task lists, quotes, fenced code,
 * rules, and the inline marks bold, italic, code, and links.
 *
 * The web app keeps using the marked-based importer, which understands more
 * HTML; this stays deliberately small and predictable.
 */

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;
const TASK = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

const INLINE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|\[\[[^\]\n]+\]\]|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function inlineNodes(text: string): TipTapNode[] {
  if (!text) return [];
  const nodes: TipTapNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push({ type: "text", text: text.slice(cursor, index) });
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "bold" }] });
    } else if (token.startsWith("~~")) {
      nodes.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "strike" }] });
    } else if (token.startsWith("[[")) {
      const body = token.slice(2, -2);
      const separator = body.indexOf("|");
      const pageId = separator >= 0 ? body.slice(0, separator) : body;
      const title = separator >= 0 ? body.slice(separator + 1) : body;
      nodes.push({
        type: "pageLink",
        attrs: { pageId: pageId.trim(), title: title.trim() || "Untitled", icon: "◇" },
      });
    } else if (token.startsWith("`")) {
      nodes.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "code" }] });
    } else if (token.startsWith("[")) {
      const parsed = /^\[([^\]]+)\]\((.+)\)$/.exec(token);
      if (parsed) {
        nodes.push({
          type: "text",
          text: parsed[1]!,
          marks: [
            { type: "link", attrs: { href: parsed[2], target: "_blank", rel: "noopener noreferrer" } },
          ],
        });
      } else {
        nodes.push({ type: "text", text: token });
      }
    } else {
      nodes.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "italic" }] });
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) nodes.push({ type: "text", text: text.slice(cursor) });
  return nodes;
}

function paragraphNode(text: string): TipTapNode {
  const content = inlineNodes(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
}

interface ListFrame {
  type: "bulletList" | "orderedList" | "taskList";
  indent: number;
  node: TipTapNode;
}

export function simpleMarkdownToDoc(markdown: string): TipTapNode {
  const content: TipTapNode[] = [];
  const frames: ListFrame[] = [];
  let paragraphLines: string[] = [];
  let quoteLines: string[] = [];
  let codeLines: string[] | null = null;
  let codeLanguage = "";

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    content.push(paragraphNode(paragraphLines.join(" ")));
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (!quoteLines.length) return;
    const paragraphs: TipTapNode[] = [];
    for (const group of quoteLines.join("\n").split(/\n\s*\n/)) {
      const lines = group.split("\n").filter((line) => line.trim());
      if (lines.length) paragraphs.push(paragraphNode(lines.join(" ")));
    }
    if (paragraphs.length) content.push({ type: "blockquote", content: paragraphs });
    quoteLines = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushQuote();
  };

  const resetLists = () => {
    frames.length = 0;
  };

  const appendItem = (frame: ListFrame, item: TipTapNode) => {
    const items = (frame.node.content ??= []);
    items.push(item);
  };

  /**
   * Finds or creates the list a line at `indent` belongs to. A deeper indent
   * nests inside the previous item; a shallower one closes deeper lists; a
   * different list type at the same depth starts a sibling list.
   */
  const listFor = (kind: ListFrame["type"], indent: number): ListFrame => {
    while (frames.length && frames[frames.length - 1]!.indent > indent) frames.pop();
    const top = frames[frames.length - 1];
    if (top && top.indent === indent) {
      if (top.type === kind) return top;
      frames.pop();
    }
    const parent = frames[frames.length - 1];
    const listNode: TipTapNode = { type: kind, content: [] };
    if (parent) {
      const items = parent.node.content ?? [];
      const lastItem = items[items.length - 1];
      if (lastItem) (lastItem.content ??= []).push(listNode);
      else appendItem(parent, { type: "listItem", content: [listNode] });
    } else {
      content.push(listNode);
    }
    const frame: ListFrame = { type: kind, indent, node: listNode };
    frames.push(frame);
    return frame;
  };

  const pushListItem = (kind: ListFrame["type"], indent: number, text: string, checked?: boolean) => {
    const frame = listFor(kind, indent);
    appendItem(
      frame,
      kind === "taskList"
        ? {
            type: "taskItem",
            attrs: { checked: Boolean(checked) },
            content: [paragraphNode(text)],
          }
        : { type: "listItem", content: [paragraphNode(text)] },
    );
  };

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (codeLines) {
      if (FENCE.test(line)) {
        content.push({
          type: "codeBlock",
          attrs: { language: codeLanguage },
          content: codeLines.length ? [{ type: "text", text: codeLines.join("\n") }] : [],
        });
        codeLines = null;
        codeLanguage = "";
        continue;
      }
      codeLines.push(rawLine);
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushAll();
      resetLists();
      codeLines = [];
      codeLanguage = fence[1] ?? "";
      continue;
    }

    if (!line.trim()) {
      flushAll();
      resetLists();
      continue;
    }

    if (RULE.test(line)) {
      flushAll();
      resetLists();
      content.push({ type: "horizontalRule" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      resetLists();
      content.push({
        type: "heading",
        attrs: { level: Math.min(heading[1]!.length, 4) },
        content: inlineNodes(heading[2]!.trim()),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flushParagraph();
      resetLists();
      quoteLines.push(quote[1] ?? "");
      continue;
    }
    flushQuote();

    const task = TASK.exec(line);
    if (task) {
      flushParagraph();
      pushListItem("taskList", task[1]!.length, task[3]!.trim(), task[2]!.toLowerCase() === "x");
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      pushListItem("bulletList", bullet[1]!.length, bullet[2]!.trim());
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      pushListItem("orderedList", ordered[1]!.length, ordered[2]!.trim());
      continue;
    }

    resetLists();
    paragraphLines.push(line.trim());
  }

  if (codeLines) {
    content.push({
      type: "codeBlock",
      attrs: { language: codeLanguage },
      content: codeLines.length ? [{ type: "text", text: codeLines.join("\n") }] : [],
    });
  }
  flushAll();

  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

/**
 * Parses the inline subset used by the mobile block editor back into TipTap
 * inline nodes. Kept beside the block parser so both directions share one
 * grammar (bold, italic, strike, code, links, page links, hard breaks).
 */
export function inlineMarkdownToNodes(text: string): TipTapNode[] {
  const lines = text.split("\n");
  const nodes: TipTapNode[] = [];
  lines.forEach((line, index) => {
    if (index > 0) nodes.push({ type: "hardBreak" });
    nodes.push(...inlineNodes(line));
  });
  return nodes;
}

/** Serializes inline TipTap nodes to the Markdown subset above. */
export function inlineMarkdown(nodes: TipTapNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "hardBreak") return "\n";
      if (node.type === "pageLink") {
        const pageId = typeof node.attrs?.pageId === "string" ? node.attrs.pageId : "";
        const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Untitled";
        return `[[${pageId}|${title}]]`;
      }
      if (node.type !== "text") return node.text ?? "";
      let value = node.text ?? "";
      for (const mark of node.marks ?? []) {
        if (mark.type === "bold") value = `**${value}**`;
        else if (mark.type === "italic") value = `*${value}*`;
        else if (mark.type === "strike") value = `~~${value}~~`;
        else if (mark.type === "code") value = `\`${value}\``;
      }
      const link = (node.marks ?? []).find((mark) => mark.type === "link");
      const href = typeof link?.attrs?.href === "string" ? link.attrs.href : "";
      if (href) value = `[${value}](${href})`;
      return value;
    })
    .join("");
}
