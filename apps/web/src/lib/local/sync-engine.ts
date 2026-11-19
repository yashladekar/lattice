import {
  canEditContent,
  createId,
  encodeCursor,
  orderSyncOps,
  type Role,
  type SyncChange,
  type SyncCursor,
  type SyncEntity,
} from "@notes-learning/domain";
import type { Table } from "dexie";

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
  /** Local changes dropped because the member cannot write to that workspace. */
  onDiscarded?: (event: { workspaceId: string; count: number }) => void;
  /** One change the server refused on its own; the rest of the queue went on. */
  onRejected?: (event: {
    workspaceId: string;
    entity: SyncEntity;
    entityId: string;
    message: string;
  }) => void;
}

/** The local table that holds a synced entity, keyed by the outbox entityId. */
function localTable(db: LatticeDB, entity: SyncEntity): Table | null {
  const tables: Partial<Record<SyncEntity, Table>> = {
    notebook: db.notebooks,
    page: db.pages,
    pageDocument: db.pageDocuments,
    canvas: db.canvases,
    node: db.nodes,
    edge: db.edges,
    tag: db.tags,
    pageTag: db.pageTags,
    capture: db.captures,
    template: db.templates,
    deck: db.decks,
    flashcard: db.flashcards,
    comment: db.comments,
    suggestedEdit: db.suggestedEdits,
    objectType: db.objectTypes,
    attachment: db.attachments,
  };
  return tables[entity] ?? null;
}

/** How long a change the server refused waits before it is offered again. */
const PARKED_RETRY_MS = 5 * 60 * 1000;

type PushResponse =Awaited<ReturnType<ReturnType<typeof workspaceClient>["sync"]["push"]>>;

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

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null ? (error as { code?: unknown }).code : null;
}

/** A signed-out session fails every workspace the same way; stop at the first. */
function isUnauthorized(error: unknown): boolean {
  return errorCode(error) === "UNAUTHORIZED";
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
  private onDiscarded?: SyncEngineOptions["onDiscarded"];
  private onRejected?: SyncEngineOptions["onRejected"];
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
    this.onDiscarded = options.onDiscarded;
    this.onRejected = options.onRejected;
  }

  private async counts(): Promise<{ pending: number; conflicts: number }> {
    const [pending, conflicts] = await Promise.all([
      // Parked changes are reported when they are refused; they are not
      // waiting to go out, so they do not count as queued.
      this.db.outbox.filter((row) => !row.rejected).count(),
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
    // Each workspace syncs on its own. A push the server refuses in one
    // workspace used to abort the whole run, so every other workspace stopped
    // pulling too; now the first failure is reported after the rest have run.
    let failure: unknown = null;
    for (const workspaceId of workspaceIds) {
      try {
        await this.bootstrapWorkspace(workspaceId);
        await this.pushWorkspace(workspaceId);
      } catch (error) {
        if (isUnauthorized(error)) throw error;
        if (await this.discardUnwritableChanges(workspaceId, error)) continue;
        failure ??= error;
      }
    }
    for (const workspaceId of workspaceIds) {
      try {
        await this.pullWorkspace(workspaceId);
      } catch (error) {
        if (isUnauthorized(error)) throw error;
        failure ??= error;
      }
    }
    if (failure) throw failure;
    this.lastSyncedAt = new Date().toISOString();
    await this.emit("idle");
  }

  /**
   * Pushing needs editor access. When the server refuses a push for that
   * reason and this device also knows the member is below editor, nothing in
   * the queue can ever be accepted: retrying would fail every cycle and keep
   * the workspace's pull stuck behind it. Drop those changes, remove rows that
   * only ever existed locally, and reload the workspace from the server.
   */
  private async discardUnwritableChanges(workspaceId: string, error: unknown): Promise<boolean> {
    if (errorCode(error) !== "FORBIDDEN") return false;
    const role = await getMeta<Role>(this.db, `role:${workspaceId}`);
    if (!role || canEditContent(role)) return false;

    const rows = await this.db.outbox.where("workspaceId").equals(workspaceId).toArray();
    if (!rows.length) return false;
    const tables = new Set<Table>();
    for (const row of rows) {
      const table = localTable(this.db, row.entity);
      if (table) tables.add(table);
    }
    await this.db.transaction(
      "rw",
      [this.db.outbox, this.db.meta, ...tables],
      async () => {
        for (const row of rows) {
          await localTable(this.db, row.entity)?.delete(row.entityId);
          await this.db.outbox.delete(row.id);
        }
        await setMeta(this.db, `snapshot:${workspaceId}`, false);
      },
    );
    this.onDiscarded?.({ workspaceId, count: rows.length });
    await this.bootstrapWorkspace(workspaceId);
    return true;
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
    const all = await this.db.outbox
      .where("workspaceId")
      .equals(workspaceId)
      .toArray();
    // A parked change waits until it is edited (which queues a fresh row) or
    // until enough time has passed that whatever blocked it may be fixed.
    const now = Date.now();
    const rows = all.filter(
      (row) => !row.rejected || now - Date.parse(row.rejected.at) >= PARKED_RETRY_MS,
    );
    if (!rows.length) return;
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const batch = orderSyncOps(rows).slice(0, 40);
    // Preparing the batch is one transaction: an edit that lands mid-loop must
    // not be overwritten with the stale row we read a moment ago.
    const prepared = await this.db.transaction("rw", this.db.outbox, async () => {
      const entries: Array<{ row: OutboxItem; opId: string }> = [];
      for (const row of batch) {
        const current = await this.db.outbox.get(row.id);
        if (!current || current.revision !== row.revision) continue;
        let opId = current.opId;
        if (!opId) {
          opId = createId();
          await this.db.outbox.put({ ...current, opId });
        }
        entries.push({ row: { ...current, opId }, opId });
      }
      return entries;
    });
    if (!prepared.length) return;
    await this.sendOps(workspaceId, api, prepared);
  }

  /**
   * The server applies a push in one transaction, so a single change it
   * refuses (its notebook was deleted elsewhere, its parent is gone) fails the
   * whole batch, and every later edit in the workspace queued up behind it
   * forever. When that happens the batch is sent one change at a time: the
   * rest go through, and the refused change is parked with the reason.
   */
  private async sendOps(
    workspaceId: string,
    api: ReturnType<typeof workspaceClient>,
    prepared: Array<{ row: OutboxItem; opId: string }>,
  ): Promise<boolean> {
    let response: PushResponse;
    try {
      response = await api.sync.push({
        ops: prepared.map(({ row, opId }) => ({
          opId,
          entity: row.entity,
          entityId: row.entityId,
          op: row.op,
          ...(row.baseRev !== undefined ? { baseRev: row.baseRev } : {}),
          payload: row.payload,
        })),
      });
    } catch (error) {
      if (!(await this.isRefusedChange(workspaceId, error))) throw error;
      if (prepared.length === 1) {
        await this.park(workspaceId, prepared[0]!, error);
        return false;
      }
      let progressed = false;
      for (const entry of prepared) {
        if (await this.sendOps(workspaceId, api, [entry])) progressed = true;
      }
      return progressed;
    }
    await this.applyPushResponse(workspaceId, prepared, response);
    return response.accepted.length > 0 || response.conflicts.length > 0;
  }

  /**
   * A refusal about the change itself, as opposed to the connection, the
   * session, or (for a viewer) the whole workspace, which is handled before
   * a push is ever split.
   */
  private async isRefusedChange(workspaceId: string, error: unknown): Promise<boolean> {
    const code = errorCode(error);
    if (code === "BAD_REQUEST" || code === "NOT_FOUND" || code === "CONFLICT") return true;
    if (code !== "FORBIDDEN") return false;
    const role = await getMeta<Role>(this.db, `role:${workspaceId}`);
    return Boolean(role && canEditContent(role));
  }

  private async park(
    workspaceId: string,
    entry: { row: OutboxItem; opId: string },
    error: unknown,
  ): Promise<void> {
    const message = errorMessage(error);
    const parked = await this.db.transaction("rw", this.db.outbox, async () => {
      const current = await this.db.outbox.get(entry.row.id);
      // Edited since it was sent: the new version gets its own attempt.
      if (!current || current.revision !== entry.row.revision) return false;
      await this.db.outbox.put({
        ...current,
        opId: null,
        rejected: { message, at: new Date().toISOString() },
      });
      return true;
    });
    if (parked) {
      this.onRejected?.({
        workspaceId,
        entity: entry.row.entity,
        entityId: entry.row.entityId,
        message,
      });
    }
  }

  private async applyPushResponse(
    workspaceId: string,
    prepared: Array<{ row: OutboxItem; opId: string }>,
    response: PushResponse,
  ): Promise<void> {
    for (const accepted of response.accepted) {
      await applyAccepted(this.db, accepted);
    }

    for (const accepted of response.accepted) {
      const key = `${accepted.entity}:${accepted.entityId}`;
      const sent = prepared.find(
        (entry) =>
          entry.row.entity === accepted.entity && entry.row.entityId === accepted.entityId,
      );
      await this.db.transaction("rw", this.db.outbox, async () => {
        const current = await this.db.outbox.get(key);
        if (!current) return;
        if (!sent || current.revision === sent.row.revision) {
          await this.db.outbox.delete(key);
        } else {
          await this.db.outbox.put({
            ...current,
            baseRev: accepted.rev !== undefined ? accepted.rev : current.baseRev,
            opId: null,
          });
        }
      });
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
      await this.db.transaction("rw", this.db.outbox, async () => {
        const current = await this.db.outbox.get(key);
        if (current && (!sent || current.revision === sent.row.revision)) {
          await this.db.outbox.delete(key);
        }
      });
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
        pendingItems
          .filter((item) => !item.rejected)
          .map((item) => `${item.entity}:${item.entityId}`),
      );
      const parked = new Map<string, OutboxItem>(
        pendingItems
          .filter((item) => item.rejected)
          .map((item) => [`${item.entity}:${item.entityId}`, item]),
      );
      let lastApplied: SyncCursor | null = null;
      let skipped = false;
      for (const change of changes) {
        const key = `${change.entity}:${change.entityId}`;
        const refused = parked.get(key);
        if (refused) {
          // The server refused this local change and now has a newer version
          // of the same item. Its version wins; holding the pull back for a
          // change that cannot be saved would stall the whole workspace.
          await this.db.transaction("rw", this.db.outbox, async () => {
            const current = await this.db.outbox.get(refused.id);
            if (current?.rejected && current.revision === refused.revision) {
              await this.db.outbox.delete(refused.id);
            }
          });
        }
        if (pending.has(key)) {
          // Do not consume a delta we could not apply: stop before it and let
          // the next pull start from the last change we did apply.
          skipped = true;
          break;
        }
        await applyChange(this.db, change);
        lastApplied = { version: change.version, id: change.id };
      }
      cursor = skipped
        ? (lastApplied ?? cursor)
        : ((response.cursor as SyncCursor | null) ?? cursor);
      await setMeta(this.db, `cursor:${workspaceId}`, encodeCursor(cursor));
      if (skipped || !response.hasMore) break;
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
