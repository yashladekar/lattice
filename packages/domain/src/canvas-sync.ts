import type { CanvasDocument, CanvasElement } from "./types";

/**
 * Canvas collaboration merges per field rather than per element. Two people
 * moving different shapes, or one moving a shape while another retypes its
 * note, then both survive. Only two edits to the *same* field on the *same*
 * element resolve last-writer-wins, which is the right answer for a drag.
 */
export interface CanvasFieldChange {
  id: string;
  fields: Record<string, unknown>;
}

export interface CanvasElementDiff {
  added: CanvasElement[];
  changed: CanvasFieldChange[];
  removed: string[];
}

const IGNORED_FIELDS = new Set(["id", "type"]);

function fieldNames(element: CanvasElement): string[] {
  return Object.keys(element as unknown as Record<string, unknown>).filter(
    (field) => !IGNORED_FIELDS.has(field),
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

/** What a local edit needs to publish, so only touched fields travel. */
export function diffCanvasElements(
  previous: CanvasElement[],
  next: CanvasElement[],
): CanvasElementDiff {
  const before = new Map(previous.map((element) => [element.id, element]));
  const afterIds = new Set(next.map((element) => element.id));
  const added: CanvasElement[] = [];
  const changed: CanvasFieldChange[] = [];

  for (const element of next) {
    const prior = before.get(element.id);
    if (!prior) {
      added.push(element);
      continue;
    }
    const fields: Record<string, unknown> = {};
    for (const field of fieldNames(element)) {
      const nextValue = (element as unknown as Record<string, unknown>)[field];
      const priorValue = (prior as unknown as Record<string, unknown>)[field];
      if (!sameValue(priorValue, nextValue)) fields[field] = nextValue;
    }
    if (Object.keys(fields).length) changed.push({ id: element.id, fields });
  }

  const removed = previous
    .filter((element) => !afterIds.has(element.id))
    .map((element) => element.id);

  return { added, changed, removed };
}

export function isEmptyDiff(diff: CanvasElementDiff): boolean {
  return !diff.added.length && !diff.changed.length && !diff.removed.length;
}

export type CanvasElementMap = Record<string, CanvasElement>;

/**
 * Remote elements are authoritative for content; the local array is
 * authoritative for order.
 *
 * Absence is ambiguous on its own: an element missing from the remote map is
 * either mid-flight locally or deleted elsewhere. `knownRemoteIds` — the ids the
 * previous remote snapshot held — resolves it. Only ids that were published
 * before and are gone now count as deletions.
 */
export function mergeCanvasElements(
  local: CanvasElement[],
  remote: CanvasElementMap,
  knownRemoteIds: Iterable<string> = [],
): CanvasElement[] {
  const published = new Set(knownRemoteIds);
  const merged: CanvasElement[] = [];
  const seen = new Set<string>();

  for (const element of local) {
    const incoming = remote[element.id];
    if (incoming) {
      merged.push(incoming);
      seen.add(element.id);
      continue;
    }
    if (!published.has(element.id)) {
      merged.push(element);
      seen.add(element.id);
    }
  }

  for (const [id, element] of Object.entries(remote)) {
    if (seen.has(id)) continue;
    merged.push(element);
  }

  return merged;
}

/** Applies a remote element map onto a document without disturbing the rest. */
export function mergeCanvasDocument(
  local: CanvasDocument,
  remote: CanvasElementMap,
  knownRemoteIds: Iterable<string> = [],
): CanvasDocument {
  return {
    ...local,
    elements: mergeCanvasElements(local.elements, remote, knownRemoteIds),
  };
}

/** Stable, order-independent fingerprint of a document's content. */
export function canvasFingerprint(document: CanvasDocument): string {
  const elements = [...document.elements]
    .map((element) => JSON.stringify(element))
    .sort()
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < elements.length; index += 1) {
    hash ^= elements.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${document.elements.length}:${hash.toString(16)}`;
}
