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

export async function enqueueOutbox(db: LatticeDB, input: EnqueueInput): Promise<void> {
  const id = `${input.entity}:${input.entityId}`;
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
