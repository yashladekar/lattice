import type { SyncCursor, SyncEntity, SyncOpInput } from "./types";
import { SYNC_ENTITIES } from "./types";

export function encodeCursor(cursor: SyncCursor | null): string | null {
  if (!cursor) return null;
  return `${cursor.version}:${cursor.id}`;
}

export function decodeCursor(value: string | null | undefined): SyncCursor | null {
  if (!value) return null;
  const separator = value.indexOf(":");
  if (separator === -1) {
    const version = Number(value);
    return Number.isFinite(version) ? { version, id: "" } : null;
  }
  const version = Number(value.slice(0, separator));
  if (!Number.isFinite(version)) return null;
  return { version, id: value.slice(separator + 1) };
}

export function isAfterCursor(
  cursor: SyncCursor | null,
  version: number,
  id: string,
): boolean {
  if (!cursor) return true;
  if (version !== cursor.version) return version > cursor.version;
  return id > cursor.id;
}

export function isSyncEntity(value: string): value is SyncEntity {
  return (SYNC_ENTITIES as readonly string[]).includes(value);
}

export function normalizedSyncOps(ops: SyncOpInput[]): SyncOpInput[] {
  const seen = new Map<string, SyncOpInput>();
  for (const op of ops) {
    seen.set(op.opId, op);
  }
  return [...seen.values()];
}

const SYNC_ENTITY_LAYER: Record<SyncEntity, number> = {
  workspace: 0,
  member: 0,
  notebook: 0,
  tag: 0,
  template: 0,
  deck: 0,
  objectType: 0,
  capture: 0,
  page: 1,
  canvas: 1,
  pageDocument: 2,
  node: 2,
  pageTag: 2,
  flashcard: 2,
  comment: 2,
  attachment: 2,
  suggestedEdit: 2,
  edge: 3,
};

export interface SyncOpShape {
  entity: SyncEntity;
  entityId: string;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown>;
}

/**
 * Puts a sync batch in dependency order. The server applies ops one by one
 * inside one transaction, so a node, document, or edge that arrives before the
 * row it points at rejects the whole batch. Callers preserve their own order
 * inside each layer (for the client, oldest write first), and pages inside one
 * batch are ordered parent-first.
 */
export function orderSyncOps<T extends SyncOpShape>(ops: T[]): T[] {
  const roots: T[] = [];
  const pageOps: T[] = [];
  const records: T[] = [];
  const edges: T[] = [];
  for (const op of ops) {
    const layer = SYNC_ENTITY_LAYER[op.entity];
    if (layer === 0) roots.push(op);
    else if (layer === 1) pageOps.push(op);
    else if (layer === 2) records.push(op);
    else edges.push(op);
  }

  const pageIds = new Set(
    pageOps
      .filter((op) => op.entity === "page" && op.op === "UPSERT")
      .map((op) => op.entityId),
  );
  const emitted = new Set<string>();
  const orderedPages: T[] = [];
  const pending = [...pageOps];
  while (pending.length) {
    const index = pending.findIndex((op) => {
      if (op.entity !== "page" || op.op !== "UPSERT") return true;
      const parentId = typeof op.payload.parentId === "string" ? op.payload.parentId : null;
      return !parentId || !pageIds.has(parentId) || emitted.has(parentId);
    });
    if (index === -1) {
      // A corrupt cycle: send the rest in their existing order and let the
      // server's cycle guard reject them with a useful message.
      orderedPages.push(...pending);
      break;
    }
    const op = pending[index];
    if (!op) {
      orderedPages.push(...pending);
      break;
    }
    pending.splice(index, 1);
    orderedPages.push(op);
    if (op.entity === "page") emitted.add(op.entityId);
  }

  return [...roots, ...orderedPages, ...records, ...edges];
}

export interface PendingSyncChange {
  entity: string;
  entityId: string;
  op: "UPSERT" | "DELETE";
}

/**
 * Collapses repeated writes to one entity inside a single sync batch. The
 * change log stores state, not events, so only the final write should be
 * recorded — otherwise two rows share a version and the stale one can be
 * applied last on pull.
 */
export function dedupeChanges<T extends PendingSyncChange>(changes: T[]): T[] {
  const latest = new Map<string, T>();
  for (const change of changes) {
    latest.set(`${change.entity}:${change.entityId}`, change);
  }
  return [...latest.values()];
}

export function isEntityPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
