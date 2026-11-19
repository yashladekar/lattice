import type { SyncEntity } from "@notes-learning/domain";

import type { LatticeDB } from "./db";
import type { OutboxItem } from "./types";

const listeners = new Set<() => void>();

export function requestSync(): void {
  for (const listener of listeners) listener();
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface EnqueueInput {
  workspaceId: string;
  entity: SyncEntity;
  entityId: string;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown>;
  baseRev?: number;
}

/**
 * Workspaces where this member is below editor. The server refuses every push
 * from them, so a change queued there could only ever be dropped later.
 */
const readOnlyWorkspaces = new Set<string>();

export function setWorkspaceReadOnly(workspaceId: string, readOnly: boolean): void {
  if (readOnly) readOnlyWorkspaces.add(workspaceId);
  else readOnlyWorkspaces.delete(workspaceId);
}

export class ReadOnlyWorkspaceError extends Error {
  constructor() {
    super("You have view-only access to this workspace.");
    this.name = "ReadOnlyWorkspaceError";
  }
}

const readOnlyListeners = new Set<() => void>();

/** Called whenever a write is refused, so the UI can explain it once. */
export function onReadOnlyWrite(listener: () => void): () => void {
  readOnlyListeners.add(listener);
  return () => readOnlyListeners.delete(listener);
}

export async function enqueueOutbox(db: LatticeDB, input: EnqueueInput): Promise<void> {
  if (readOnlyWorkspaces.has(input.workspaceId)) {
    // Repository writes queue inside the same transaction as their local
    // change, so throwing here rolls that change back as well.
    for (const listener of readOnlyListeners) listener();
    throw new ReadOnlyWorkspaceError();
  }
  const id = `${input.entity}:${input.entityId}`;
  await db.transaction("rw", db.outbox, async () => {
    const existing = await db.outbox.get(id);
    const revision = (existing?.revision ?? 0) + 1;
    const row: OutboxItem = {
      id,
      workspaceId: input.workspaceId,
      entity: input.entity,
      entityId: input.entityId,
      op: input.op,
      payload: input.payload,
      baseRev: input.baseRev,
      revision,
      opId: null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    await db.outbox.put(row);
  });
  requestSync();
}

export async function pendingFor(
  db: LatticeDB,
  entity: SyncEntity,
  entityId: string,
): Promise<OutboxItem | undefined> {
  return db.outbox.get(`${entity}:${entityId}`);
}

export async function countPending(db: LatticeDB): Promise<number> {
  return db.outbox.count();
}
