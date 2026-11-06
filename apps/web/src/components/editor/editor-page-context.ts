"use client";

import { createContext, useContext } from "react";

export interface EditorPageInfo {
  pageId: string;
  title: string;
}

/**
 * The page a TipTap NodeView is rendered inside. Nodes such as plugin blocks
 * need the host page's context, which the editor knows and the node does not.
 */
export const EditorPageContext = createContext<EditorPageInfo | null>(null);

export function useEditorPageInfo(): EditorPageInfo | null {
  return useContext(EditorPageContext);
}
