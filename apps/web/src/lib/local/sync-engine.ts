import {
  createId,
  encodeCursor,
  type SyncChange,
  type SyncCursor,
  type SyncEntity,
} from "@notes-learning/domain";

import { workspaceClient } from "@/utils/orpc";

import { applyAccepted, applyChange, applySnapshot, cursorFor } from "./apply";
import { getMeta, setMeta, type LatticeDB } from "./db";
import { subscribeSync } from "./outbox";
import type { LocalConflict, LocalSnapshotPayload, OutboxItem } from "./types";

export type SyncStatus = "idle" | "syncing" | "offline" | "error" | "auth";

export interface SyncState {
  status: SyncStatus;
  pending: number;
  conflicts: number;
  lastSyncedAt: string | null;
  message?: string;
}

export interface SyncEngineOptions {
  db: LatticeDB;
  userId: string;
  getWorkspaceIds: () => Promise<string[]>;
  onState: (state: SyncState) => void;
  onConflict?: (conflict: LocalConflict) => void;
  onError?: (message: string) => void;
}

interface LockManagerLike {
  request: (
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<void>,
  ) => Promise<void>;
}

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Sync failed";
}

export class SyncEngine {
  private db: LatticeDB;
  private userId: string;
  private getWorkspaceIds: () => Promise<string[]>;
  private onState: (state: SyncState) => void;
  private onConflict?: (conflict: LocalConflict) => void;
  private onError?: (message: string) => void;
  private started = false;
  private running = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastSyncedAt: string | null = null;
  private onlineHandler = () => {
    this.schedule(50);
  };
  private offlineHandler = () => {
    void this.emit("offline");
  };
  private visibilityHandler = () => {
    if (document.visibilityState === "visible") this.schedule(100);
  };

  constructor(options: SyncEngineOptions) {
    this.db = options.db;
    this.userId = options.userId;
    this.getWorkspaceIds = options.getWorkspaceIds;
    this.onState = options.onState;
    this.onConflict = options.onConflict;
    this.onError = options.onError;
  }

  private async counts(): Promise<{ pending: number; conflicts: number }> {
    const [pending, conflicts] = await Promise.all([
      this.db.outbox.count(),
      this.db.conflicts.filter((conflict) => !conflict.resolvedAt).count(),
    ]);
    return { pending, conflicts };
  }

  private async emit(status: SyncStatus, message?: string): Promise<void> {
    const counts = await this.counts();
    this.onState({
      status,
      pending: counts.pending,
      conflicts: counts.conflicts,
      lastSyncedAt: this.lastSyncedAt,
      message,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = subscribeSync(() => this.schedule(900));
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onlineHandler);
      window.addEventListener("offline", this.offlineHandler);
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
    this.interval = setInterval(() => this.schedule(0), 25_000);
    this.schedule(50);
  }

  stop(): void {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
    this.interval = null;
    this.debounce = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onlineHandler);
      window.removeEventListener("offline", this.offlineHandler);
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  schedule(delay = 700): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      void this.sync();
    }, delay);
  }

  async sync(): Promise<void> {
    if (this.running) return;
    if (!isOnline()) {
      await this.emit("offline");
      return;
    }
    this.running = true;
    try {
      const locks = (navigator as unknown as { locks?: LockManagerLike }).locks;
      if (locks) {
        await locks.request(`lattice-sync-${this.userId}`, { mode: "exclusive" }, async () => {
          await this.runOnce();
        });
      } else {
        await this.runOnce();
      }
    } catch (error) {
      const message = errorMessage(error);
      if (message.toLowerCase().includes("unauthorized")) {
        await this.emit("auth", message);
      } else {
        await this.emit("error", message);
        this.onError?.(message);
      }
    } finally {
      this.running = false;
    }
  }

  private async runOnce(): Promise<void> {
    if (!isOnline()) {
      await this.emit("offline");
      return;
    }
    await this.emit("syncing");
    const workspaceIds = await this.getWorkspaceIds();
    for (const workspaceId of workspaceIds) {
      await this.bootstrapWorkspace(workspaceId);
      await this.pushWorkspace(workspaceId);
    }
    for (const workspaceId of workspaceIds) {
      await this.pullWorkspace(workspaceId);
    }
    this.lastSyncedAt = new Date().toISOString();
    await this.emit("idle");
  }

  async bootstrapWorkspace(workspaceId: string): Promise<void> {
    const done = await getMeta<boolean>(this.db, `snapshot:${workspaceId}`);
    if (done) return;
    const api = workspaceClient(workspaceId);
    // The snapshot arrives in pages; store nothing until the last one, so a
    // half-downloaded workspace never looks complete.
    const snapshot: LocalSnapshotPayload = {
      version: 0,
      role: "VIEWER",
      workspace: null as unknown as LocalSnapshotPayload["workspace"],
      members: [],
      notebooks: [],
      pages: [],
      pageDocuments: [],
      canvases: [],
      nodes: [],
      edges: [],
      tags: [],
      pageTags: [],
      captures: [],
      templates: [],
      decks: [],
      flashcards: [],
      comments: [],
      attachments: [],
      suggestedEdits: [],
      objectTypes: [],
    };
    const arrays = snapshot as unknown as Record<string, unknown[]>;
    const parts = [
      "members",
      "notebooks",
      "pages",
      "pageDocuments",
      "canvases",
      "nodes",
      "edges",
      "tags",
      "pageTags",
      "captures",
      "templates",
      "decks",
      "flashcards",
      "comments",
      "attachments",
      "suggestedEdits",
      "objectTypes",
    ] as const;

    let cursor: string | null = null;
    let complete = false;
    for (let guard = 0; guard < 10_000; guard += 1) {
      const page = (await api.sync.snapshot({
        workspaceId,
        ...(cursor ? { cursor } : {}),
      })) as unknown as {
        version: number;
        role: string;
        done: boolean;
        cursor: string | null;
        payload: Record<string, unknown>;
      };
      if (typeof page.version === "number") snapshot.version = page.version;
      if (typeof page.role === "string") snapshot.role = page.role;
      if (page.payload?.workspace && typeof page.payload.workspace === "object") {
        snapshot.workspace = page.payload.workspace as LocalSnapshotPayload["workspace"];
      }
      for (const part of parts) {
        const rows = page.payload?.[part];
        if (Array.isArray(rows)) arrays[part]!.push(...rows);
      }
      if (page.done || !page.cursor) {
        complete = true;
        break;
      }
      cursor = page.cursor;
    }

    if (!complete) throw new Error("Snapshot did not finish");
    if (!snapshot.workspace) throw new Error("Invalid workspace snapshot");
    await applySnapshot(this.db, snapshot);
  }

  private async pushWorkspace(workspaceId: string): Promise<void> {
    const api = workspaceClient(workspaceId);
    const rows = await this.db.outbox
      .where("workspaceId")
      .equals(workspaceId)
      .toArray();
    if (!rows.length) return;
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const batch = rows.slice(0, 40);
    const prepared: Array<{ row: OutboxItem; opId: string }> = [];
    for (const row of batch) {
      let opId = row.opId;
      if (!opId) {
        opId = createId();
        await this.db.outbox.put({ ...row, opId });
      }
      prepared.push({ row: { ...row, opId }, opId });
    }
    const response = await api.sync.push({
      ops: prepared.map(({ row, opId }) => ({
        opId,
        entity: row.entity,
        entityId: row.entityId,
        op: row.op,
        ...(row.baseRev !== undefined ? { baseRev: row.baseRev } : {}),
        payload: row.payload,
      })),
    });

    for (const accepted of response.accepted) {
      await applyAccepted(this.db, accepted);
    }

    for (const accepted of response.accepted) {
      const key = `${accepted.entity}:${accepted.entityId}`;
      const sent = prepared.find(
        (entry) =>
          entry.row.entity === accepted.entity && entry.row.entityId === accepted.entityId,
      );
      const current = await this.db.outbox.get(key);
      if (!current) continue;
      if (!sent || current.revision === sent.row.revision) {
        await this.db.outbox.delete(key);
      } else {
        await this.db.outbox.put({
          ...current,
          baseRev:
            accepted.rev !== undefined ? accepted.rev : current.baseRev,
          opId: null,
        });
      }
    }

    for (const conflict of response.conflicts) {
      const key = `${conflict.entity}:${conflict.entityId}`;
      const sent = prepared.find(
        (entry) =>
          entry.row.entity === conflict.entity && entry.row.entityId === conflict.entityId,
      );
      const local = {
        id: conflict.id,
        workspaceId,
        entity: conflict.entity,
        entityId: conflict.entityId,
        baseRev: conflict.baseRev,
        remoteRev: conflict.remoteRev,
        localData: conflict.localData,
        remoteData: conflict.remoteData,
        createdAt: conflict.createdAt,
        resolvedAt: null,
      } satisfies LocalConflict;
      await this.db.conflicts.put(local);
      this.onConflict?.(local);
      const current = await this.db.outbox.get(key);
      if (current && (!sent || current.revision === sent.row.revision)) {
        await this.db.outbox.delete(key);
      }
    }
  }

  private async pullWorkspace(workspaceId: string): Promise<void> {
    const api = workspaceClient(workspaceId);
    let cursor = await cursorFor(this.db, workspaceId);
    if (!cursor) {
      await this.bootstrapWorkspace(workspaceId);
      cursor = await cursorFor(this.db, workspaceId);
    }
    for (let page = 0; page < 20; page += 1) {
      const response = await api.sync.pull({
        cursor: encodeCursor(cursor),
        limit: 300,
      });
      const changes = response.changes as unknown as SyncChange[];
      if (!changes.length) {
        if (response.cursor) {
          await setMeta(this.db, `cursor:${workspaceId}`, encodeCursor(response.cursor as SyncCursor));
        }
        break;
      }
      const pendingItems = await this.db.outbox
        .where("workspaceId")
        .equals(workspaceId)
        .toArray();
      const pending = new Set(
        pendingItems.map((item) => `${item.entity}:${item.entityId}`),
      );
      for (const change of changes) {
        const key = `${change.entity}:${change.entityId}`;
        if (pending.has(key)) continue;
        await applyChange(this.db, change);
      }
      cursor = (response.cursor as SyncCursor | null) ?? cursor;
      await setMeta(this.db, `cursor:${workspaceId}`, encodeCursor(cursor));
      if (!response.hasMore) break;
    }
  }

  async resolveConflict(
    conflict: LocalConflict,
    resolution: "KEEP_LOCAL" | "KEEP_REMOTE",
    content?: Record<string, unknown>,
  ): Promise<void> {
    await workspaceClient(conflict.workspaceId).sync.resolveConflict({
      conflictId: conflict.id,
      resolution,
      ...(content ? { content } : {}),
    });
    if (resolution === "KEEP_REMOTE") {
      if (conflict.entity === "pageDocument") {
        const document = await this.db.pageDocuments.get(conflict.entityId);
        const remote = conflict.remoteData;
        if (document && typeof remote.content === "object" && remote.content !== null) {
          await this.db.pageDocuments.put({
            ...document,
            content: remote.content as never,
            plainText: typeof remote.plainText === "string" ? remote.plainText : "",
            rev:
              typeof remote.rev === "number" ? remote.rev : conflict.remoteRev,
            updatedAt:
              typeof remote.updatedAt === "string"
                ? remote.updatedAt
                : new Date().toISOString(),
          });
        }
      }
      if (conflict.entity === "canvas") {
        const canvas = await this.db.canvases.get(conflict.entityId);
        const remote = conflict.remoteData;
        if (canvas && typeof remote.data === "object" && remote.data !== null) {
          await this.db.canvases.put({
            ...canvas,
            data: remote.data as never,
            rev:
              typeof remote.rev === "number" ? remote.rev : conflict.remoteRev,
            updatedAt:
              typeof remote.updatedAt === "string"
                ? remote.updatedAt
                : new Date().toISOString(),
          });
        }
      }
    }
    await this.db.conflicts.delete(conflict.id);
    await this.emit("syncing");
    await this.sync();
  }

  async retry(): Promise<void> {
    await this.sync();
  }
}

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  return new SyncEngine(options);
}

export function pendingEntityKeys(items: OutboxItem[]): Set<string> {
  return new Set(items.map((item) => `${item.entity}:${item.entityId}`));
}

export function entityKey(entity: SyncEntity, entityId: string): string {
  return `${entity}:${entityId}`;
}
