import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { DEFAULT_DIAGRAM_SOURCE, normalizeDiagramSource } from "@notes-learning/domain";

import { DiagramNodeView } from "../diagram/diagram-node-view";

import {
  BookmarkView,
  DatabaseNodeView,
  LiveBlockView,
  PageEmbedView,
  PageLinkView,
} from "./node-views";

export const PageLink = Node.create({
  name: "pageLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      pageId: { default: "" },
      title: { default: "Untitled" },
      icon: { default: "◇" },
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[data-page-link]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            pageId: element.getAttribute("data-page-link") ?? "",
            title: element.getAttribute("data-page-title") ?? "Untitled",
            icon: element.getAttribute("data-page-icon") ?? "◇",
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-page-link": node.attrs.pageId,
        "data-page-title": node.attrs.title,
        "data-page-icon": node.attrs.icon,
        "data-type": "pageLink",
        href: "#",
        class: "page-link",
      }),
      `${node.attrs.icon ?? "◇"} ${node.attrs.title ?? "Untitled"}`,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageLinkView);
  },
});

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      title: { default: "Note" },
      emoji: { default: "✦" },
      color: { default: "saffron" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="callout"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return {
            title: element.getAttribute("data-title") ?? "Note",
            emoji: element.getAttribute("data-emoji") ?? "✦",
            color: element.getAttribute("data-color") ?? "saffron",
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        "data-color": node.attrs.color,
        "data-title": node.attrs.title,
        "data-emoji": node.attrs.emoji,
        class: "callout-block",
      }),
      [
        "div",
        { class: "callout-title" },
        ["span", {}, node.attrs.emoji ?? "✦"],
        node.attrs.title ?? "Note",
      ],
      ["div", { class: "callout-content" }, 0],
    ];
  },
});

export const PageEmbed = Node.create({
  name: "pageEmbed",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      pageId: { default: "" },
      title: { default: "Embedded page" },
      variant: { default: "card" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="pageEmbed"]',
        getAttrs: (element) =>
          element instanceof HTMLElement
            ? {
                pageId: element.getAttribute("data-page-id") ?? "",
                title: element.getAttribute("data-title") ?? "Embedded page",
              }
            : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "pageEmbed",
        "data-page-id": node.attrs.pageId,
        "data-title": node.attrs.title,
        class: "page-embed",
      }),
      node.attrs.title ?? "Embedded page",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageEmbedView);
  },
});

export const LiveBlock = Node.create({
  name: "liveBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      pageId: { default: "" },
      blockId: { default: "" },
      title: { default: "Live block" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="liveBlock"]',
        getAttrs: (element) =>
          element instanceof HTMLElement
            ? {
                pageId: element.getAttribute("data-page-id") ?? "",
                blockId: element.getAttribute("data-block-id") ?? "",
                title: element.getAttribute("data-title") ?? "Live block",
              }
            : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "liveBlock",
        "data-page-id": node.attrs.pageId,
        "data-block-id": node.attrs.blockId,
        "data-title": node.attrs.title,
        class: "live-block",
      }),
      node.attrs.title ?? "Live block",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(LiveBlockView);
  },
});

export const Bookmark = Node.create({
  name: "bookmark",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      url: { default: "" },
      title: { default: "" },
      description: { default: "" },
      image: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="bookmark"]',
        getAttrs: (element) =>
          element instanceof HTMLElement
            ? {
                url: element.getAttribute("data-url") ?? "",
                title: element.getAttribute("data-title") ?? "",
                description: element.getAttribute("data-description") ?? "",
                image: element.getAttribute("data-image") ?? "",
              }
            : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "bookmark",
        "data-url": node.attrs.url,
        "data-title": node.attrs.title,
        "data-description": node.attrs.description,
        "data-image": node.attrs.image,
        class: "bookmark-block",
      }),
      node.attrs.title || node.attrs.url || "Bookmark",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BookmarkView);
  },
});

export const Database = Node.create({
  name: "database",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      title: { default: "Database" },
      view: { default: "table" },
      fields: {
        default: [
          { id: "name", name: "Name", type: "text" },
          { id: "status", name: "Status", type: "select", options: ["Todo", "Doing", "Done"] },
          { id: "date", name: "Date", type: "date" },
        ],
      },
      rows: {
        default: [
          { id: "row-1", values: { name: "First item", status: "Todo", date: "" } },
        ],
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-type="database"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const parse = (value: string | null, fallback: unknown) => {
            if (!value) return fallback;
            try {
              return JSON.parse(value);
            } catch {
              return fallback;
            }
          };
          return {
            title: element.getAttribute("data-title") ?? "Database",
            view: element.getAttribute("data-view") ?? "table",
            fields: parse(element.getAttribute("data-fields"), [
              { id: "name", name: "Name", type: "text" },
              { id: "status", name: "Status", type: "select", options: ["Todo", "Doing", "Done"] },
              { id: "date", name: "Date", type: "date" },
            ]),
            rows: parse(element.getAttribute("data-rows"), []),
          };
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "database",
        "data-title": node.attrs.title,
        "data-view": node.attrs.view,
        "data-fields": JSON.stringify(node.attrs.fields ?? []),
        "data-rows": JSON.stringify(node.attrs.rows ?? []),
        class: "database-block",
      }),
      node.attrs.title ?? "Database",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DatabaseNodeView);
  },
});

export const Diagram = Node.create({
  name: "diagram",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: { default: DEFAULT_DIAGRAM_SOURCE },
      caption: { default: "" },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'pre[data-type="diagram"]',
        getAttrs: (element) =>
          element instanceof HTMLElement
            ? {
                source: element.textContent ?? DEFAULT_DIAGRAM_SOURCE,
                caption: element.getAttribute("data-caption") ?? "",
              }
            : false,
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, {
        "data-type": "diagram",
        "data-caption": node.attrs.caption ?? "",
        class: "diagram-block",
      }),
      [
        "code",
        { class: "language-mermaid" },
        normalizeDiagramSource(String(node.attrs.source ?? DEFAULT_DIAGRAM_SOURCE)),
      ],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DiagramNodeView);
  },
});

export const customEditorNodes = [
  PageLink,
  Callout,
  PageEmbed,
  LiveBlock,
  Bookmark,
  Database,
  Diagram,
];
