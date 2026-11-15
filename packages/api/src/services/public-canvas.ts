/**
 * The canvas data a public share link exposes. Linked notes and nested
 * whiteboards are private to the workspace, so those elements are dropped, and
 * so is every connector attached to one: left in, a connector whose target is
 * gone has no position to resolve and is drawn from the board's origin as a
 * stray arrow and label.
 */
export interface PublicCanvasData {
  version: number;
  elements: Array<Record<string, unknown>>;
  background?: string;
}

export function publicCanvasData(value: unknown): PublicCanvasData {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { elements?: unknown }).elements)
  ) {
    return { version: 1, elements: [] };
  }
  const data = value as {
    version: 1;
    elements: Array<Record<string, unknown>>;
    background?: string;
  };
  const hidden = new Set<unknown>();
  for (const element of data.elements) {
    if (element.type === "page" || element.type === "canvas") hidden.add(element.id);
  }
  const endpointHidden = (endpoint: unknown) =>
    typeof endpoint === "object" &&
    endpoint !== null &&
    hidden.has((endpoint as { elementId?: unknown }).elementId);
  return {
    ...data,
    elements: data.elements.filter(
      (element) =>
        !hidden.has(element.id) &&
        !(element.type === "connector" && (endpointHidden(element.from) || endpointHidden(element.to))),
    ),
  };
}
