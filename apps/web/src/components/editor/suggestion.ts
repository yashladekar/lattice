import { Extension } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";

import type { EditorMenuKind, EditorMenuItem } from "./menu-types";

export interface EditorSuggestionCallbacks {
  onStart: (kind: EditorMenuKind, props: SuggestionProps<EditorMenuItem>) => void;
  onUpdate: (kind: EditorMenuKind, props: SuggestionProps<EditorMenuItem>) => void;
  onExit: (kind: EditorMenuKind) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export function createEditorSuggestionExtensions({
  getItems,
  callbacks,
}: {
  getItems: (kind: EditorMenuKind, query: string) => Promise<EditorMenuItem[]>;
  callbacks: EditorSuggestionCallbacks;
}) {
  const build = (
    kind: EditorMenuKind,
    char: string,
    options: { allowSpaces?: boolean; allowedPrefixes?: string[] | null; pluginName: string },
  ) =>
    Extension.create({
      name: options.pluginName,
      addProseMirrorPlugins() {
        return [
          Suggestion<EditorMenuItem>({
            editor: this.editor,
            char,
            pluginKey: new PluginKey(options.pluginName),
            allowSpaces: options.allowSpaces ?? false,
            allowedPrefixes: options.allowedPrefixes === undefined ? [" "] : options.allowedPrefixes,
            startOfLine: false,
            items: async ({ query }) => getItems(kind, query),
            command: ({ editor, range, props }) => {
              props.select(editor, range);
            },
            render: () => ({
              onStart: (props: SuggestionProps<EditorMenuItem>) => callbacks.onStart(kind, props),
              onUpdate: (props: SuggestionProps<EditorMenuItem>) => callbacks.onUpdate(kind, props),
              onKeyDown: (props: SuggestionKeyDownProps) => callbacks.onKeyDown(props.event),
              onExit: () => callbacks.onExit(kind),
            }),
          }),
        ];
      },
    });

  return [
    build("slash", "/", { pluginName: "latticeSlashSuggestion" }),
    build("page", "[[", {
      allowSpaces: true,
      allowedPrefixes: null,
      pluginName: "latticePageSuggestion",
    }),
    build("mention", "@", { pluginName: "latticeMentionSuggestion" }),
  ];
}

export function menuRect(element: Element | null): {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
} | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    right: rect.right,
    top: rect.top,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}
