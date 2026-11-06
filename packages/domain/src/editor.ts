import type { OutlineItem, PageLinkInfo, TipTapDoc, TipTapNode } from "./types";

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "image",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "details",
  "callout",
  "pageEmbed",
  "liveBlock",
  "database",
  "bookmark",
  "mathBlock",
  "youtube",
  "diagram",
  "request",
]);

export function emptyDoc(): TipTapDoc {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function paragraph(text = ""): TipTapNode {
  return text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
}

export function heading(text: string, level = 2): TipTapNode {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

export function docFromText(text: string): TipTapDoc {
  const lines = text.split(/\r?\n/);
  const content: TipTapNode[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      content.push({ type: "paragraph" });
      continue;
    }
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      content.push(heading(headingMatch[2] ?? "", headingMatch[1]?.length ?? 1));
      continue;
    }
    const bulletMatch = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bulletMatch) {
      content.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [paragraph(bulletMatch[1] ?? "")],
          },
        ],
      });
      continue;
    }
    content.push(paragraph(trimmed));
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function nodePlainText(node: TipTapNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "pageLink") {
    const title = node.attrs?.title;
    return typeof title === "string" ? title : "Untitled";
  }
  if (node.type === "hardBreak") return "\n";
  if (node.type === "image") {
    const alt = node.attrs?.alt;
    return typeof alt === "string" ? alt : "";
  }
  if (node.type === "database") {
    return "Database";
  }
  if (node.type === "diagram") {
    const caption = node.attrs?.caption;
    return typeof caption === "string" && caption.trim() ? caption.trim() : "Diagram";
  }
  if (node.type === "request") {
    const method = typeof node.attrs?.method === "string" ? node.attrs.method : "GET";
    const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
    const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
    return [method, url || label].filter(Boolean).join(" ");
  }
  const children = node.content ?? [];
  const text = children.map((child) => nodePlainText(child)).join("");
  if (BLOCK_TYPES.has(node.type)) {
    return `${text}\n`;
  }
  return text;
}

export function extractPlainText(doc: TipTapDoc | null | undefined): string {
  if (!doc?.content) return "";
  return doc.content
    .map((node) => nodePlainText(node))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPageLinks(doc: TipTapDoc | null | undefined): PageLinkInfo[] {
  const found = new Map<string, PageLinkInfo>();
  walk(doc, (node) => {
    if (node.type !== "pageLink") return;
    const pageId = node.attrs?.pageId;
    if (typeof pageId !== "string") return;
    const title = node.attrs?.title;
    found.set(pageId, {
      pageId,
      label: typeof title === "string" ? title : "Untitled",
    });
  });
  return [...found.values()];
}

export function extractBlockLinks(
  doc: TipTapDoc | null | undefined,
): Array<{ pageId: string; blockId?: string }> {
  const found: Array<{ pageId: string; blockId?: string }> = [];
  walk(doc, (node) => {
    if (node.type !== "pageEmbed" && node.type !== "liveBlock") return;
    const pageId = node.attrs?.pageId;
    if (typeof pageId !== "string") return;
    const blockId = node.attrs?.blockId;
    found.push({
      pageId,
      blockId: typeof blockId === "string" ? blockId : undefined,
    });
  });
  return found;
}

export function extractTags(doc: TipTapDoc | null | undefined): string[] {
  const tags = new Set<string>();
  const text = extractPlainText(doc);
  const regex = /(?:^|\s)#([a-z0-9][a-z0-9_-]{0,40})/gi;
  let match = regex.exec(text);
  while (match) {
    if (match[1]) tags.add(match[1].toLowerCase());
    match = regex.exec(text);
  }
  return [...tags];
}

export function extractOutline(doc: TipTapDoc | null | undefined): OutlineItem[] {
  const out: OutlineItem[] = [];
  if (!doc?.content) return out;
  let index = 0;
  const visit = (node: TipTapNode, inheritedLevel = 0) => {
    if (node.type === "heading") {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      out.push({
        id: blockIdOf(node) ?? `outline-${index++}`,
        level,
        text: nodePlainText(node).trim(),
        pos: out.length,
      });
      return;
    }
    if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
      for (const item of node.content ?? []) {
        const text = nodePlainText(item).trim();
        if (text) {
          out.push({
            id: blockIdOf(item) ?? `outline-${index++}`,
            level: Math.max(3, inheritedLevel + 3),
            text,
            pos: out.length,
          });
        }
      }
      return;
    }
    for (const child of node.content ?? []) {
      visit(child, inheritedLevel + 1);
    }
  };
  for (const node of doc.content) {
    if (node.type === "heading") visit(node);
  }
  return out;
}

export function blockIdOf(node: TipTapNode | undefined): string | null {
  if (!node?.attrs) return null;
  const value = node.attrs.blockId ?? node.attrs.id;
  return typeof value === "string" ? value : null;
}

export function findBlock(
  doc: TipTapDoc | null | undefined,
  blockId: string,
): TipTapNode | null {
  if (!doc) return null;
  let match: TipTapNode | null = null;
  walk(doc, (node) => {
    if (match) return;
    if (blockIdOf(node) === blockId) match = node;
  });
  return match;
}

export function collectBlockIds(doc: TipTapDoc | null | undefined): string[] {
  const ids: string[] = [];
  walk(doc, (node) => {
    const id = blockIdOf(node);
    if (id) ids.push(id);
  });
  return ids;
}

export function walk(
  doc: TipTapDoc | null | undefined,
  visit: (node: TipTapNode) => void,
): void {
  if (!doc) return;
  const visitNode = (node: TipTapNode) => {
    visit(node);
    for (const child of node.content ?? []) visitNode(child);
  };
  for (const node of doc.content) visitNode(node);
}

export function docHasContent(doc: TipTapDoc | null | undefined): boolean {
  if (!doc?.content) return false;
  return doc.content.some((node) => {
    if (node.type !== "paragraph") return true;
    return Boolean(node.content?.length);
  });
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+.!|-])/g, "\\$1");
}

function renderMarks(node: TipTapNode, text: string): string {
  if (!node.marks?.length) return text;
  let result = text;
  for (const mark of node.marks) {
    switch (mark.type) {
      case "bold":
        result = `**${result}**`;
        break;
      case "italic":
        result = `*${result}*`;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "underline":
        result = `<u>${result}</u>`;
        break;
      case "highlight":
        result = `==${result}==`;
        break;
      case "link": {
        const href = mark.attrs?.href;
        if (typeof href === "string") result = `[${result}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return result;
}

function inlineMarkdown(node: TipTapNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return renderMarks(node, escapeMarkdown(node.text ?? ""));
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "pageLink") {
    const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Untitled";
    const pageId = typeof node.attrs?.pageId === "string" ? node.attrs.pageId : "";
    return `[[${title}]](${pageId})`;
  }
  if (node.type === "mathInline") {
    const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
    return `$${latex}$`;
  }
  return (node.content ?? []).map((child) => inlineMarkdown(child)).join("");
}

function renderList(node: TipTapNode, ordered: boolean, depth = 0): string {
  const items = node.content ?? [];
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : "-";
      const children = item.content ?? [];
      const first = children[0];
      const rest = children.slice(1);
      const firstText = inlineMarkdown(first).trim();
      const restText = rest.map((child) => blockMarkdown(child, depth + 1)).join("");
      return `${"  ".repeat(depth)}${marker} ${firstText}${restText ? `\n${restText}` : ""}`;
    })
    .join("\n");
}

function blockMarkdown(node: TipTapNode, depth = 0): string {
  switch (node.type) {
    case "paragraph":
      return `${(node.content ?? []).map((child) => inlineMarkdown(child)).join("")}\n\n`;
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${(node.content ?? [])
        .map((child) => inlineMarkdown(child))
        .join("")}\n\n`;
    }
    case "bulletList":
      return `${renderList(node, false, depth)}\n\n`;
    case "orderedList":
      return `${renderList(node, true, depth)}\n\n`;
    case "taskList":
      return `${(node.content ?? [])
        .map((item) => {
          const checked = item.attrs?.checked === true ? "x" : " ";
          return `- [${checked}] ${(item.content ?? [])
            .map((child) => inlineMarkdown(child))
            .join("")
            .trim()}`;
        })
        .join("\n")}\n\n`;
    case "blockquote":
      return `${(node.content ?? [])
        .map((child) => blockMarkdown(child, depth))
        .join("")
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${language}\n${nodePlainText(node).trimEnd()}\n\`\`\`\n\n`;
    }
    case "horizontalRule":
      return "---\n\n";
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return `![${alt}](${src})\n\n`;
    }
    case "callout": {
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Note";
      const body = (node.content ?? []).map((child) => blockMarkdown(child, depth)).join("").trim();
      return `> **${title}**\n${body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n`;
    }
    case "pageEmbed": {
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Embedded page";
      return `> **Embedded:** ${title}\n\n`;
    }
    case "liveBlock":
      return `> **Live block**\n\n`;
    case "database":
      return `> **Database block** — open in Lattice to edit.\n\n`;
    case "diagram": {
      const source = typeof node.attrs?.source === "string" ? node.attrs.source : "";
      const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
      const fence = `\`\`\`mermaid\n${source.trim()}\n\`\`\``;
      return `${caption ? `${fence}\n\n*${caption}*\n\n` : `${fence}\n\n`}`;
    }
    case "request": {
      const method = typeof node.attrs?.method === "string" ? node.attrs.method : "GET";
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const headers = typeof node.attrs?.headers === "string" ? node.attrs.headers.trim() : "";
      const body = typeof node.attrs?.body === "string" ? node.attrs.body.trim() : "";
      const lines = [`${method} ${url}`.trim()];
      if (headers) lines.push("", headers);
      if (body) lines.push("", body);
      return `\`\`\`http\n${lines.join("\n")}\n\`\`\`\n\n`;
    }
    case "bookmark": {
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : url;
      return `[${title}](${url})\n\n`;
    }
    case "mathBlock": {
      const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
      return `$$\n${latex}\n$$\n\n`;
    }
    case "youtube": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      return `${src}\n\n`;
    }
    case "details": {
      const summary = node.content?.find((child) => child.type === "detailsSummary");
      const body = node.content?.find((child) => child.type === "detailsContent");
      return `<details>\n<summary>${nodePlainText(summary).trim()}</summary>\n\n${body ? blockMarkdown(body, depth) : ""}\n</details>\n\n`;
    }
    case "table": {
      const rows = node.content ?? [];
      const lines = rows.map((row) => {
        const cells = row.content ?? [];
        return `| ${cells.map((cell) => nodePlainText(cell).trim()).join(" | ")} |`;
      });
      if (lines.length) {
        const headerSeparator = `| ${(rows[0]?.content ?? []).map(() => "---").join(" | ")} |`;
        lines.splice(1, 0, headerSeparator);
      }
      return `${lines.join("\n")}\n\n`;
    }
    default:
      return `${(node.content ?? []).map((child) => blockMarkdown(child, depth)).join("")}\n`;
  }
}

export function docToMarkdown(doc: TipTapDoc | null | undefined): string {
  if (!doc?.content) return "";
  return doc.content
    .map((node) => blockMarkdown(node))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function titleFromDoc(doc: TipTapDoc | null | undefined): string {
  if (!doc?.content) return "";
  const firstHeading = doc.content.find((node) => node.type === "heading");
  if (firstHeading) return nodePlainText(firstHeading).trim();
  const firstParagraph = doc.content.find(
    (node) => node.type === "paragraph" && nodePlainText(node).trim().length > 0,
  );
  return nodePlainText(firstParagraph).trim().slice(0, 120);
}

export function safeDoc(value: unknown): TipTapDoc {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "doc" &&
    Array.isArray((value as { content?: unknown }).content)
  ) {
    return value as TipTapDoc;
  }
  return emptyDoc();
}

const SAFE_HREF = /^(https?:|mailto:|tel:)/i;

/**
 * Removes link and image targets that a browser would execute or a viewer
 * would not expect, for documents assembled from untrusted text such as
 * plugin output or imported Markdown.
 */
export function stripUnsafeHrefs(value: unknown): TipTapDoc {
  const doc = safeDoc(value);
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as {
      attrs?: Record<string, unknown>;
      marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
      content?: unknown[];
    };
    if (record.attrs) {
      for (const key of ["href", "src"]) {
        const target = record.attrs[key];
        if (typeof target === "string" && target && !SAFE_HREF.test(target)) {
          delete record.attrs[key];
        }
      }
    }
    if (Array.isArray(record.marks)) {
      record.marks = record.marks.filter((mark) => {
        if (!mark || typeof mark !== "object") return false;
        if (mark.type !== "link") return true;
        const href = mark.attrs?.href;
        return typeof href === "string" && SAFE_HREF.test(href);
      });
    }
    if (Array.isArray(record.content)) for (const child of record.content) walk(child);
  };
  walk(doc);
  return doc;
}
