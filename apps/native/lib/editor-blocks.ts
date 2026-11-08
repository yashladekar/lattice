import {
  createId,
  inlineMarkdown,
  inlineMarkdownToNodes,
  type TipTapDoc,
  type TipTapNode,
} from "@notes-learning/domain";

/**
 * Editable block model for the native editor. Each block is a top-level (or
 * list-grouped) TipTap node with its text expressed in the shared inline
 * Markdown subset. Unknown nodes are preserved verbatim so a phone edit never
 * drops a block the web app understands.
 */
export type EditorBlockKind =
  | "paragraph"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "codeBlock"
  | "callout"
  | "details"
  | "horizontalRule"
  | "image"
  | "pageEmbed"
  | "liveBlock"
  | "bookmark"
  | "youtube"
  | "diagram"
  | "mathBlock"
  | "request"
  | "table"
  | "database"
  | "unknown";

export interface EditorListItem {
  id: string;
  text: string;
  checked?: boolean;
}

export interface EditorBlock {
  id: string;
  kind: EditorBlockKind;
  /** Inline Markdown for text blocks; source/URL/latex for atom blocks. */
  text: string;
  /** Secondary text for blocks with two editable regions (toggle body). */
  body?: string;
  level?: number;
  language?: string;
  items?: EditorListItem[];
  attrs?: Record<string, unknown>;
  /** Original node, kept for read-only and unknown block types. */
  raw?: TipTapNode;
}

function nodeId(node: TipTapNode): string {
  const blockId = node.attrs?.blockId ?? node.attrs?.id;
  return typeof blockId === "string" ? blockId : createId();
}

function plainText(node: TipTapNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  return (node.content ?? []).map((child) => plainText(child)).join("");
}

function paragraphs(text: string): TipTapNode[] {
  const groups = text.split(/\n{2,}/);
  return groups.map((group) => {
    const content = inlineMarkdownToNodes(group.replace(/\n+$/, ""));
    return content.length ? { type: "paragraph", content } : { type: "paragraph" };
  });
}

function listItems(node: TipTapNode): EditorListItem[] {
  return (node.content ?? []).map((item) => {
    const first = item.content?.[0];
    return {
      id: nodeId(item),
      text: inlineMarkdown((first?.content ?? []) as TipTapNode[]),
      ...(node.type === "taskList" ? { checked: item.attrs?.checked === true } : {}),
    };
  });
}

function blockFromNode(node: TipTapNode): EditorBlock {
  const id = nodeId(node);
  const attrs = node.attrs ? { ...node.attrs } : undefined;
  switch (node.type) {
    case "paragraph":
      return { id, kind: "paragraph", text: inlineMarkdown(node.content), attrs };
    case "heading":
      return {
        id,
        kind: "heading",
        level: typeof node.attrs?.level === "number" ? node.attrs.level : 2,
        text: inlineMarkdown(node.content),
        attrs,
      };
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const nested = (node.content ?? []).some((item) =>
        (item.content ?? []).some(
          (child) =>
            child.type === "bulletList" || child.type === "orderedList" || child.type === "taskList",
        ),
      );
      if (nested) {
        return { id, kind: "unknown", text: "", attrs, raw: node };
      }
      return {
        id,
        kind: node.type,
        text: "",
        items: listItems(node),
        attrs,
      };
    }
    case "blockquote":
      return {
        id,
        kind: "blockquote",
        text: (node.content ?? []).map((child) => inlineMarkdown(child.content)).join("\n\n"),
        attrs,
      };
    case "codeBlock":
      return {
        id,
        kind: "codeBlock",
        language: typeof node.attrs?.language === "string" ? node.attrs.language : "",
        text: plainText(node),
        attrs,
      };
    case "callout":
      return {
        id,
        kind: "callout",
        text: (node.content ?? []).map((child) => inlineMarkdown(child.content)).join("\n\n"),
        attrs,
      };
    case "details": {
      const summary = node.content?.find((child) => child.type === "detailsSummary");
      const content = node.content?.find((child) => child.type === "detailsContent");
      return {
        id,
        kind: "details",
        text: inlineMarkdown(summary?.content),
        body: (content?.content ?? []).map((child) => inlineMarkdown(child.content)).join("\n\n"),
        attrs,
      };
    }
    case "horizontalRule":
      return { id, kind: "horizontalRule", text: "", attrs };
    case "image":
      return {
        id,
        kind: "image",
        text: typeof node.attrs?.src === "string" ? node.attrs.src : "",
        attrs,
      };
    case "pageEmbed":
    case "liveBlock":
      return {
        id,
        kind: node.type,
        text:
          typeof node.attrs?.title === "string"
            ? node.attrs.title
            : typeof node.attrs?.pageId === "string"
              ? node.attrs.pageId
              : "",
        attrs,
      };
    case "bookmark":
      return {
        id,
        kind: "bookmark",
        text: typeof node.attrs?.url === "string" ? node.attrs.url : "",
        attrs,
      };
    case "youtube":
      return {
        id,
        kind: "youtube",
        text: typeof node.attrs?.src === "string" ? node.attrs.src : "",
        attrs,
      };
    case "diagram":
      return {
        id,
        kind: "diagram",
        text: typeof node.attrs?.source === "string" ? node.attrs.source : "",
        attrs,
      };
    case "mathBlock":
    case "blockMath":
      return {
        id,
        kind: "mathBlock",
        text: typeof node.attrs?.latex === "string" ? node.attrs.latex : "",
        attrs,
      };
    case "request":
      return {
        id,
        kind: "request",
        text: typeof node.attrs?.url === "string" ? node.attrs.url : "",
        attrs,
      };
    case "table": {
      const rows = (node.content ?? []).map((row) =>
        (row.content ?? []).map((cell) => inlineMarkdown(cell.content)).join(" | "),
      );
      return { id, kind: "table", text: rows.join("\n"), attrs };
    }
    case "database":
      return { id, kind: "database", text: "", attrs, raw: node };
    default:
      return { id, kind: "unknown", text: plainText(node), attrs, raw: node };
  }
}

export function docToBlocks(doc: TipTapDoc | null | undefined): EditorBlock[] {
  if (!doc?.content?.length) return [{ id: createId(), kind: "paragraph", text: "" }];
  return doc.content.map(blockFromNode);
}

function listNode(block: EditorBlock): TipTapNode {
  const type = block.kind as "bulletList" | "orderedList" | "taskList";
  return {
    type,
    content: (block.items ?? [{ id: createId(), text: "" }]).map((item) => {
      const content = inlineMarkdownToNodes(item.text);
      return {
        type: type === "taskList" ? "taskItem" : "listItem",
        ...(type === "taskList" ? { attrs: { checked: Boolean(item.checked) } } : {}),
        content: [content.length ? { type: "paragraph", content } : { type: "paragraph" }],
      };
    }),
  };
}

function tableNode(text: string, attrs?: Record<string, unknown>): TipTapNode {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cellType = index === 0 ? "tableHeader" : "tableCell";
      const cells = line.split("|").map((cell) => cell.trim());
      return {
        type: "tableRow",
        content: cells.map((cell) => ({
          type: cellType,
          content: [
            inlineMarkdownToNodes(cell).length
              ? { type: "paragraph", content: inlineMarkdownToNodes(cell) }
              : { type: "paragraph" },
          ],
        })),
      };
    });
  return {
    type: "table",
    ...(attrs ? { attrs } : {}),
    content:
      rows.length > 0
        ? rows
        : [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph" }] },
                { type: "tableHeader", content: [{ type: "paragraph" }] },
              ],
            },
          ],
  };
}

function blockToNode(block: EditorBlock): TipTapNode | null {
  const attrs = block.attrs ?? {};
  switch (block.kind) {
    case "paragraph": {
      const content = inlineMarkdownToNodes(block.text);
      return content.length ? { type: "paragraph", content } : { type: "paragraph" };
    }
    case "heading":
      return {
        type: "heading",
        attrs: { ...attrs, level: block.level ?? 2 },
        content: inlineMarkdownToNodes(block.text),
      };
    case "bulletList":
    case "orderedList":
    case "taskList":
      return listNode(block);
    case "blockquote":
      return { type: "blockquote", content: paragraphs(block.text) };
    case "codeBlock":
      return {
        type: "codeBlock",
        attrs: { ...attrs, language: block.language ?? "" },
        content: block.text ? [{ type: "text", text: block.text }] : [],
      };
    case "callout":
      return { type: "callout", attrs, content: paragraphs(block.text) };
    case "details":
      return {
        type: "details",
        attrs,
        content: [
          {
            type: "detailsSummary",
            content: inlineMarkdownToNodes(block.text),
          },
          {
            type: "detailsContent",
            content: paragraphs(block.body ?? ""),
          },
        ],
      };
    case "horizontalRule":
      return { type: "horizontalRule" };
    case "image":
      return {
        type: "image",
        attrs: { ...attrs, src: block.text, alt: attrs.alt ?? "", title: attrs.title ?? null },
      };
    case "pageEmbed":
    case "liveBlock":
      return { type: block.kind, attrs };
    case "bookmark":
      return { type: "bookmark", attrs: { ...attrs, url: block.text } };
    case "youtube":
      return { type: "youtube", attrs: { ...attrs, src: block.text } };
    case "diagram":
      return { type: "diagram", attrs: { ...attrs, source: block.text } };
    case "mathBlock":
      return { type: "blockMath", attrs: { ...attrs, latex: block.text } };
    case "request":
      return { type: "request", attrs: { ...attrs, url: block.text } };
    case "table":
      return tableNode(block.text, attrs);
    case "database":
    case "unknown":
      return block.raw ?? null;
    default:
      return null;
  }
}

export function blocksToDoc(blocks: EditorBlock[]): TipTapDoc {
  const content: TipTapNode[] = [];
  for (const block of blocks) {
    const node = blockToNode(block);
    if (!node) continue;
    // Merge adjacent list blocks of the same type so editing a long list does
    // not turn it into a series of one-item lists in the web editor.
    const previous = content[content.length - 1];
    if (
      previous &&
      previous.type === node.type &&
      (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList")
    ) {
      previous.content = [...(previous.content ?? []), ...(node.content ?? [])];
      continue;
    }
    content.push(node);
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function emptyBlock(kind: EditorBlockKind = "paragraph"): EditorBlock {
  return {
    id: createId(),
    kind,
    text: "",
    ...(kind === "heading" ? { level: 2 } : {}),
    ...(kind === "codeBlock" ? { language: "" } : {}),
    ...(kind === "bulletList" || kind === "orderedList" || kind === "taskList"
      ? { items: [{ id: createId(), text: "" }] }
      : {}),
    ...(kind === "callout" ? { attrs: { emoji: "✦", title: "Note", color: "saffron" } } : {}),
  };
}

/** Convenience helpers used by block actions. */
export function duplicateBlock(block: EditorBlock): EditorBlock {
  return {
    ...block,
    id: createId(),
    items: block.items?.map((item) => ({ ...item, id: createId() })),
  };
}

export function firstLine(block: EditorBlock): string {
  if (block.kind === "paragraph" || block.kind === "heading") return block.text;
  if (block.items?.length) return block.items[0]?.text ?? "";
  return block.text;
}
