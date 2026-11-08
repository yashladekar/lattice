import type { SyncConflictPayload } from "@notes-learning/domain";
import { File, Paths } from "expo-file-system";

import { client } from "@/utils/orpc";

const QUEUE_FILE = "lattice-outbox.json";

export type OutboxOp =
  | {
      id: string;
      kind: "pageDocument";
      pageId: string;
      baseRev: number;
      content: Record<string, unknown>;
      plainText: string;
      createdAt: string;
    }
  | {
      id: string;
      kind: "canvas";
      canvasId: string;
      baseRev: number;
      data: Record<string, unknown>;
      createdAt: string;
    }
  | {
      id: string;
      kind: "pageUpdate";
      pageId: string;
      patch: Record<string, unknown>;
      createdAt: string;
    }
  | {
      id: string;
      kind: "captureCreate";
      input: Record<string, unknown>;
      createdAt: string;
    };

export interface FlushResult {
  sent: number;
  failed: number;
  conflicts: SyncConflictPayload[];
}

let flushing: Promise<FlushResult> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function queueFile(): File {
  return new File(Paths.document, QUEUE_FILE);
}

async function readQueue(): Promise<OutboxOp[]> {
  try {
    const file = queueFile();
    if (!file.exists) return [];
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxOp[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: OutboxOp[]): Promise<void> {
  try {
    const file = queueFile();
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    await file.write(JSON.stringify(queue));
  } catch {
    // A failed queue write must never break editing; the next enqueue retries.
  }
  notify();
}

export function isTransient(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && code.length > 0) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /network|fetch|timeout|offline|ECONN|ENOTFOUND|socket|connection/i.test(message);
}

function replaceable(op: OutboxOp, next: OutboxOp): boolean {
  if (op.kind === "pageDocument" && next.kind === "pageDocument") {
    return op.pageId === next.pageId;
  }
  if (op.kind === "canvas" && next.kind === "canvas") {
    return op.canvasId === next.canvasId;
  }
  if (op.kind === "pageUpdate" && next.kind === "pageUpdate") {
    return op.pageId === next.pageId;
  }
  return false;
}

export async function enqueue(op: OutboxOp): Promise<void> {
  const queue = await readQueue();
  const existingIndex = queue.findIndex((entry) => replaceable(entry, op));
  if (existingIndex >= 0) {
    const current = queue[existingIndex]!;
    // Keep the newest content but retain the oldest base revision so a conflict
    // is reported against the version the user actually started editing.
    if (op.kind === "pageDocument" && current.kind === "pageDocument") {
      queue[existingIndex] = { ...op, baseRev: current.baseRev };
    } else if (op.kind === "canvas" && current.kind === "canvas") {
      queue[existingIndex] = { ...op, baseRev: current.baseRev };
    } else {
      queue[existingIndex] = op;
    }
  } else {
    queue.push(op);
  }
  await writeQueue(queue);
}

export async function pendingCount(): Promise<number> {
  return (await readQueue()).length;
}

export async function clearOutbox(): Promise<void> {
  await writeQueue([]);
}

async function send(op: OutboxOp, conflicts: SyncConflictPayload[]): Promise<void> {
  switch (op.kind) {
    case "pageDocument": {
      const result = await client.page.saveDocument({
        pageId: op.pageId,
        baseRev: op.baseRev,
        content: op.content,
        plainText: op.plainText,
      });
      if (result.conflict) conflicts.push(result.conflict as SyncConflictPayload);
      return;
    }
    case "canvas": {
      const result = await client.canvas.save({
        canvasId: op.canvasId,
        baseRev: op.baseRev,
        data: op.data,
      });
      if (result.conflict) conflicts.push(result.conflict as SyncConflictPayload);
      return;
    }
    case "pageUpdate": {
      await client.page.update({ pageId: op.pageId, ...op.patch } as never);
      return;
    }
    case "captureCreate": {
      await client.capture.create(op.input as never);
      return;
    }
  }
}

async function runFlush(): Promise<FlushResult> {
  const queue = await readQueue();
  const conflicts: SyncConflictPayload[] = [];
  const remaining: OutboxOp[] = [];
  let sent = 0;
  let failed = 0;
  let blocked = false;
  for (const op of queue) {
    if (blocked) {
      remaining.push(op);
      continue;
    }
    try {
      await send(op, conflicts);
      sent += 1;
    } catch (error) {
      if (isTransient(error)) {
        failed += 1;
        blocked = true;
        remaining.push(op);
      } else {
        // A rejected op (validation, permission, missing page) will never
        // succeed. Drop it so one bad edit does not freeze the queue.
        failed += 1;
      }
    }
  }
  await writeQueue(remaining);
  return { sent, failed, conflicts };
}

export function flushOutbox(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

export async function savePageDocument(input: {
  pageId: string;
  baseRev: number;
  content: Record<string, unknown>;
  plainText: string;
}): Promise<{ conflict: SyncConflictPayload | null; queued: boolean; rev: number }> {
  try {
    const result = await client.page.saveDocument(input as never);
    return {
      conflict: (result.conflict as SyncConflictPayload | null) ?? null,
      queued: false,
      rev: (result.document as { rev?: number } | null)?.rev ?? input.baseRev + 1,
    };
  } catch (error) {
    if (!isTransient(error)) throw error;
    await enqueue({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: "pageDocument",
      pageId: input.pageId,
      baseRev: input.baseRev,
      content: input.content,
      plainText: input.plainText,
      createdAt: new Date().toISOString(),
    });
    return { conflict: null, queued: true, rev: input.baseRev };
  }
}

export async function saveCanvas(input: {
  canvasId: string;
  baseRev: number;
  data: Record<string, unknown>;
}): Promise<{ conflict: SyncConflictPayload | null; queued: boolean; rev: number }> {
  try {
    const result = await client.canvas.save(input as never);
    return {
      conflict: (result.conflict as SyncConflictPayload | null) ?? null,
      queued: false,
      rev: (result.canvas as { rev?: number } | null)?.rev ?? input.baseRev + 1,
    };
  } catch (error) {
    if (!isTransient(error)) throw error;
    await enqueue({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: "canvas",
      canvasId: input.canvasId,
      baseRev: input.baseRev,
      data: input.data,
      createdAt: new Date().toISOString(),
    });
    return { conflict: null, queued: true, rev: input.baseRev };
  }
}
