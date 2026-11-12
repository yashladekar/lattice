import type { CanvasElement } from "@notes-learning/domain";

/**
 * A mounted whiteboard view. Appending through it is what makes the change
 * visible immediately: the view owns the document in React state, mirrors it
 * into the Yjs room, and its debounced save persists it — writing the store
 * behind its back would be overwritten by that save.
 */
export interface CanvasApplier {
  canvasId: string;
  /** Returns false when the view cannot take the elements right now. */
  append(elements: CanvasElement[]): boolean;
}

const appliers = new Map<string, CanvasApplier>();

export function registerCanvasApplier(applier: CanvasApplier): () => void {
  appliers.set(applier.canvasId, applier);
  return () => {
    if (appliers.get(applier.canvasId) === applier) appliers.delete(applier.canvasId);
  };
}

export function getCanvasApplier(canvasId: string): CanvasApplier | null {
  return appliers.get(canvasId) ?? null;
}
