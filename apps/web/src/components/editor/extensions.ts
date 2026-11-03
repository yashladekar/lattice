import { createId } from "@notes-learning/domain";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import UniqueID from "@tiptap/extension-unique-id";
import Youtube from "@tiptap/extension-youtube";
import { Mathematics } from "@tiptap/extension-mathematics";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

import { customEditorNodes } from "./custom-nodes";
import type { EditorMenuKind, EditorMenuItem } from "./menu-types";
import {
  createEditorSuggestionExtensions,
  type EditorSuggestionCallbacks,
} from "./suggestion";

const lowlight = createLowlight(common);

export function createEditorExtensions({
  getItems,
  callbacks,
  collaboration,
}: {
  getItems: (kind: EditorMenuKind, query: string) => Promise<EditorMenuItem[]>;
  callbacks: EditorSuggestionCallbacks;
  collaboration?: {
    doc: import("yjs").Doc;
    provider: { awareness: unknown };
    user: { name: string; color: string };
  } | null;
}) {
  return [
    StarterKit.configure({
      codeBlock: false,
      // Yjs owns history while a live session is active.
      undoRedo: collaboration ? false : undefined,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      },
    }),
    Placeholder.configure({
      placeholder: ({ node }) =>
        node.type.name === "heading"
          ? "Heading"
          : "Type / for blocks, [[ to link a page, @ to mention…",
      includeChildren: true,
    }),
    CharacterCount,
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true, lastColumnResizable: false },
    }),
    Image.configure({ inline: false, allowBase64: true }),
    CodeBlockLowlight.configure({ lowlight }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Youtube.configure({ width: 640, height: 360, nocookie: true }),
    Details,
    DetailsSummary,
    DetailsContent,
    Mathematics,
    UniqueID.configure({
      attributeName: "blockId",
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "codeBlock",
        "bulletList",
        "orderedList",
        "taskList",
        "callout",
        "pageEmbed",
        "liveBlock",
        "database",
        "bookmark",
        "diagram",
        "request",
        "details",
        "table",
      ],
      generateID: () => createId(),
      updateDocument: true,
    }),
    ...customEditorNodes,
    ...createEditorSuggestionExtensions({ getItems, callbacks }),
    ...(collaboration
      ? [
          Collaboration.configure({
            document: collaboration.doc,
            field: "default",
            provider: collaboration.provider,
          }),
          CollaborationCaret.configure({
            provider: collaboration.provider,
            user: collaboration.user,
          }),
        ]
      : []),
  ];
}
