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
