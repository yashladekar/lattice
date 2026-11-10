import type { BlockEdit } from "@notes-learning/domain";

export interface BlockApplyResult {
  applied: number;
  skipped: string[];
}

/**
 * A mounted page editor that can apply block edits to its own document.
 *
 * Applying through the editor is what makes a live collaborative session work:
 * the change becomes a ProseMirror transaction, which the Collaboration plugin
 * mirrors into Yjs. Writing the store instead would race the shared document.
 */
export interface EditorBlockApplier {
  pageId: string;
  apply(edits: readonly BlockEdit[]): BlockApplyResult;
}

const appliers = new Map<string, EditorBlockApplier>();

/** Returns an unregister function; it never removes a newer applier. */
export function registerEditorBlockApplier(applier: EditorBlockApplier): () => void {
  appliers.set(applier.pageId, applier);
  return () => {
    if (appliers.get(applier.pageId) === applier) appliers.delete(applier.pageId);
  };
}

export function getEditorBlockApplier(pageId: string): EditorBlockApplier | null {
  return appliers.get(pageId) ?? null;
}
