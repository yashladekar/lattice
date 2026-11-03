import type { Editor, Range } from "@tiptap/core";
import type { ReactNode } from "react";

export type EditorMenuKind = "slash" | "page" | "mention";

export interface EditorMenuItem {
  id: string;
  label: string;
  description?: string;
  group: string;
  icon: ReactNode;
  keywords?: string;
  select: (editor: Editor, range: Range) => void;
}

export interface EditorMenuRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export interface EditorMenuState {
  kind: EditorMenuKind;
  query: string;
  items: EditorMenuItem[];
  rect: EditorMenuRect | null;
  editor: Editor;
  range: Range;
}
