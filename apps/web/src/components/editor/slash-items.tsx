import type { Editor, Range } from "@tiptap/core";
import {
  Bookmark,
  ChevronRight,
  Code2,
  Database,
  Frame,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  ImagePlus,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Megaphone,
  Minus,
  Quote,
  Sigma,
  Sparkles,
  Table2,
  Terminal,
  Type,
  Video,
} from "lucide-react";

import { DEFAULT_DIAGRAM_SOURCE } from "@notes-learning/domain";

import type { EditorMenuItem } from "./menu-types";

export interface SlashActions {
  requestPage: (mode: "link" | "embed" | "live", editor: Editor, range: Range) => void;
  uploadImage: () => void;
}

function chain(editor: Editor, range: Range) {
  return editor.chain().focus().deleteRange(range);
}

export function createSlashItems(actions: SlashActions): EditorMenuItem[] {
  return [
    {
      id: "text",
      label: "Text",
      description: "Plain paragraph",
      group: "Basic blocks",
      keywords: "paragraph body",
      icon: <Type className="size-3.5" />,
      select: (editor, range) => chain(editor, range).setParagraph().run(),
    },
    {
      id: "h1",
      label: "Heading 1",
      description: "Large section heading",
      group: "Basic blocks",
      keywords: "title h1",
      icon: <Heading1 className="size-3.5" />,
      select: (editor, range) => chain(editor, range).setHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      label: "Heading 2",
      description: "Medium section heading",
      group: "Basic blocks",
      keywords: "subtitle h2",
      icon: <Heading2 className="size-3.5" />,
      select: (editor, range) => chain(editor, range).setHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      label: "Heading 3",
      description: "Small section heading",
      group: "Basic blocks",
      keywords: "subtle h3",
      icon: <Heading3 className="size-3.5" />,
      select: (editor, range) => chain(editor, range).setHeading({ level: 3 }).run(),
    },
    {
      id: "bullet",
      label: "Bulleted list",
      description: "A simple list",
      group: "Basic blocks",
      keywords: "unordered list",
      icon: <List className="size-3.5" />,
      select: (editor, range) => chain(editor, range).toggleBulletList().run(),
    },
    {
      id: "numbered",
      label: "Numbered list",
      description: "An ordered list",
      group: "Basic blocks",
      keywords: "ordered list",
      icon: <ListOrdered className="size-3.5" />,
      select: (editor, range) => chain(editor, range).toggleOrderedList().run(),
    },
    {
      id: "task",
      label: "Checklist",
      description: "Track small commitments",
      group: "Basic blocks",
      keywords: "todo task checkbox",
      icon: <ListChecks className="size-3.5" />,
      select: (editor, range) => chain(editor, range).toggleTaskList().run(),
    },
    {
      id: "toggle",
      label: "Toggle",
      description: "Collapsible content",
      group: "Basic blocks",
      keywords: "details collapse",
      icon: <ChevronRight className="size-3.5" />,
      select: (editor, range) =>
        chain(editor, range)
          .insertContent({
            type: "details",
            content: [
              {
                type: "detailsSummary",
                content: [{ type: "text", text: "Toggle" }],
              },
              {
                type: "detailsContent",
                content: [{ type: "paragraph" }],
              },
            ],
          })
          .run(),
    },
    {
      id: "quote",
      label: "Quote",
      description: "Set text apart",
      group: "Basic blocks",
      icon: <Quote className="size-3.5" />,
      select: (editor, range) => chain(editor, range).toggleBlockquote().run(),
    },
    {
      id: "divider",
      label: "Divider",
      description: "A horizontal separator",
      group: "Basic blocks",
      icon: <Minus className="size-3.5" />,
      select: (editor, range) => chain(editor, range).setHorizontalRule().run(),
    },
    {
      id: "callout",
      label: "Callout",
      description: "Highlight an idea or warning",
      group: "Rich blocks",
      keywords: "note info warning",
      icon: <Megaphone className="size-3.5" />,
      select: (editor, range) =>
        chain(editor, range)
          .insertContent({
            type: "callout",
            attrs: { title: "Note", emoji: "✦", color: "saffron" },
            content: [{ type: "paragraph" }],
          })
          .run(),
    },
    {
      id: "code",
      label: "Code block",
      description: "Syntax-highlighted code",
      group: "Rich blocks",
      keywords: "snippet pre",
      icon: <Code2 className="size-3.5" />,
      select: (editor, range) => chain(editor, range).setCodeBlock().run(),
    },
    {
      id: "diagram",
      label: "Diagram",
      description: "Mermaid flowchart, sequence, or state diagram",
      group: "Rich blocks",
      keywords: "mermaid graph chart flowchart sequence uml architecture",
      icon: <GitBranch className="size-3.5" />,
      select: (editor, range) =>
        chain(editor, range)
          .insertContent({
            type: "diagram",
            attrs: { source: DEFAULT_DIAGRAM_SOURCE, caption: "" },
          })
          .run(),
    },
    {
      id: "request",
      label: "API request",
      description: "Document an endpoint and run it live",
      group: "Rich blocks",
      keywords: "api http rest endpoint request playground curl",
      icon: <Terminal className="size-3.5" />,
      select: (editor, range) =>
        chain(editor, range)
          .insertContent({
            type: "request",
            attrs: { method: "GET", url: "", headers: "", body: "", label: "" },
          })
          .run(),
    },
    {
      id: "table",
      label: "Table",
      description: "Rows and columns",
      group: "Rich blocks",
      icon: <Table2 className="size-3.5" />,
      select: (editor, range) =>
        chain(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: "equation",
      label: "Equation",
      description: "LaTeX math block",
      group: "Rich blocks",
      keywords: "math latex formula",
      icon: <Sigma className="size-3.5" />,
      select: (editor, range) => {
        const latex = window.prompt("LaTeX equation", "E = mc^2");
        if (!latex) return;
        chain(editor, range)
          .insertContent({ type: "blockMath", attrs: { latex } })
          .run();
      },
    },
    {
      id: "image",
      label: "Image",
      description: "Embed an image from a URL",
      group: "Media",
      icon: <ImageIcon className="size-3.5" />,
      select: (editor, range) => {
        const src = window.prompt("Image URL");
        if (!src) return;
        chain(editor, range).setImage({ src }).run();
      },
    },
    {
      id: "image-upload",
      label: "Upload image",
      description: "Pick a file, or paste and drop one into the page",
      group: "Media",
      keywords: "attach file photo screenshot paste drop",
      icon: <ImagePlus className="size-3.5" />,
      select: (editor, range) => {
        chain(editor, range).run();
        actions.uploadImage();
      },
    },
    {
      id: "bookmark",
      label: "Bookmark",
      description: "A rich link card",
      group: "Media",
      keywords: "link url web",
      icon: <Bookmark className="size-3.5" />,
      select: (editor, range) => {
        const url = window.prompt("Bookmark URL");
        if (!url) return;
        let title = url;
        try {
          title = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          // Keep the raw URL.
        }
        chain(editor, range)
          .insertContent({
            type: "bookmark",
            attrs: { url, title, description: "" },
          })
          .run();
      },
    },
    {
      id: "youtube",
      label: "YouTube",
      description: "Embed a video",
      group: "Media",
      icon: <Video className="size-3.5" />,
      select: (editor, range) => {
        const src = window.prompt("YouTube URL");
        if (!src) return;
        chain(editor, range)
          .insertContent({ type: "youtube", attrs: { src } })
          .run();
      },
    },
    {
      id: "page-link",
      label: "Link to page",
      description: "Reference another note",
      group: "Knowledge",
      keywords: "internal link backlink",
      icon: <Link2 className="size-3.5" />,
      select: (editor, range) => actions.requestPage("link", editor, range),
    },
    {
      id: "page-embed",
      label: "Embed page",
      description: "Transclude a live note",
      group: "Knowledge",
      keywords: "transclusion include",
      icon: <Frame className="size-3.5" />,
      select: (editor, range) => actions.requestPage("embed", editor, range),
    },
    {
      id: "live-block",
      label: "Synced block",
      description: "Mirror a block from another note",
      group: "Knowledge",
      keywords: "live transclusion sync",
      icon: <Sparkles className="size-3.5" />,
      select: (editor, range) => actions.requestPage("live", editor, range),
    },
    {
      id: "database",
      label: "Database",
      description: "Structured rows and views",
      group: "Knowledge",
      keywords: "table board gallery calendar collection",
      icon: <Database className="size-3.5" />,
      select: (editor, range) =>
        chain(editor, range)
          .insertContent({
            type: "database",
            attrs: {
              title: "Database",
              view: "table",
              fields: [
                { id: "name", name: "Name", type: "text" },
                {
                  id: "status",
                  name: "Status",
                  type: "select",
                  options: ["Todo", "Doing", "Done"],
                },
                { id: "date", name: "Date", type: "date" },
              ],
              rows: [
                {
                  id: `row_${Date.now().toString(36)}`,
                  values: { name: "First item", status: "Todo", date: "" },
                },
              ],
            },
          })
          .run(),
    },
  ];
}
