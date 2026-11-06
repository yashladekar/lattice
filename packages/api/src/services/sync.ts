import { randomUUID } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { Prisma, type TransactionClient } from "@notes-learning/db";
import {
  NODE_KINDS,
  RELATION_TYPES,
  ROLES,
  VISIBILITIES,
  canShare,
  decodeCursor,
  extractPlainText,
  hasRole,
  isSuggestionStatus,
  safeDoc,
  type Role,
  type SuggestionStatus,
  type SyncConflictPayload,
  type SyncCursor,
  type SyncEntity,
  type SyncOpInput,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

import { requireMembership } from "../authz";
import { appendChanges, ensureCanvasNode, ensurePageNode, recomputePageLinkEdges, toJsonSafe, type PendingChange } from "./changes";

const CURRENT_SCHEMA_VERSION = 1;

export interface SyncPushResponse {
  accepted: Array<{
    entity: SyncEntity;
    entityId: string;
    rev?: number;
    updatedAt: string;
  }>;
  conflicts: SyncConflictPayload[];
  version: number;
}

interface ApplyContext {
  tx: TransactionClient;
  workspaceId: string;
  userId: string;
  role: Role;
  /** True when this user has the page open in a live collaborative session. */
  isCollaborating?: (pageId: string) => boolean;
  /** Records a page whose stored CRDT no longer matches the document. */
  markCollabStale?: (pageId: string) => void;
}

interface ApplyResult {
  accepted?: {
    entity: SyncEntity;
    entityId: string;
    rev?: number;
    updatedAt: Date;
  };
  conflict?: SyncConflictPayload;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function hasOwn(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function nullableField(
  payload: Record<string, unknown>,
  key: string,
  existing: string | null | undefined,
): string | null {
  if (!hasOwn(payload, key)) return existing ?? null;
  const value = payload[key];
  if (value === null) return null;
  return typeof value === "string" ? value : (existing ?? null);
}

async function assertPageWriteAccess(
  tx: TransactionClient,
  page: { id: string; workspaceId: string; createdById: string; visibility: string },
  userId: string,
  role: Role,
): Promise<void> {
  if (hasRole(role, "ADMIN")) return;
  if (page.createdById === userId) return;
  if (page.visibility === "PRIVATE") {
    throw new ORPCError("FORBIDDEN", { message: "This page is private" });
  }
  if (page.visibility === "SHARED") {
    const permission = await tx.resourcePermission.findFirst({
      where: {
        workspaceId: page.workspaceId,
        resourceType: "PAGE",
        resourceId: page.id,
        userId,
      },
      select: { role: true },
    });
    if (!permission || !hasRole(permission.role as Role, "EDITOR")) {
      throw new ORPCError("FORBIDDEN", { message: "You do not have edit access to this page" });
    }
  }
}

async function assertPageReadAccess(
  tx: TransactionClient,
  page: { id: string; workspaceId: string; createdById: string; visibility: string },
  userId: string,
  role: Role,
): Promise<void> {
  if (hasRole(role, "ADMIN")) return;
  if (page.createdById === userId) return;
  if (page.visibility === "PRIVATE") {
    throw new ORPCError("FORBIDDEN", { message: "This page is private" });
  }
  if (page.visibility === "SHARED") {
    const permission = await tx.resourcePermission.findFirst({
      where: {
        workspaceId: page.workspaceId,
        resourceType: "PAGE",
        resourceId: page.id,
        userId,
      },
      select: { id: true },
    });
    if (!permission) {
      throw new ORPCError("FORBIDDEN", { message: "You do not have access to this page" });
    }
  }
}



function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function dateValue(value: unknown): Date | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function allowedString<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

async function assertNoCrossWorkspace(
  tx: TransactionClient,
  model: "page" | "canvas" | "notebook" | "knowledgeNode" | "knowledgeEdge" | "tag" | "capture" | "template" | "deck" | "flashcard" | "comment" | "suggestedEdit" | "attachment" | "pageTag",
  id: string,
  workspaceId: string,
): Promise<void> {
  if (!id) return;
  const existing =
    model === "page"
      ? await tx.page.findUnique({ where: { id }, select: { workspaceId: true } })
      : model === "canvas"
        ? await tx.canvas.findUnique({ where: { id }, select: { workspaceId: true } })
        : model === "notebook"
          ? await tx.notebook.findUnique({ where: { id }, select: { workspaceId: true } })
          : model === "knowledgeNode"
            ? await tx.knowledgeNode.findUnique({ where: { id }, select: { workspaceId: true } })
            : model === "knowledgeEdge"
              ? await tx.knowledgeEdge.findUnique({ where: { id }, select: { workspaceId: true } })
              : model === "tag"
                ? await tx.tag.findUnique({ where: { id }, select: { workspaceId: true } })
                : model === "capture"
                  ? await tx.capture.findUnique({ where: { id }, select: { workspaceId: true } })
                  : model === "template"
                    ? await tx.template.findUnique({ where: { id }, select: { workspaceId: true } })
                    : model === "deck"
                      ? await tx.deck.findUnique({ where: { id }, select: { workspaceId: true } })
                      : model === "flashcard"
                        ? await tx.flashcard.findUnique({ where: { id }, select: { workspaceId: true } })
                        : model === "comment"
                          ? await tx.comment.findUnique({ where: { id }, select: { workspaceId: true } })
                          : model === "suggestedEdit"
                            ? await tx.suggestedEdit.findUnique({ where: { id }, select: { workspaceId: true } })
                            : model === "attachment"
                            ? await tx.attachment.findUnique({ where: { id }, select: { workspaceId: true } })
                            : await tx.pageTag.findUnique({
                                where: { id },
                                select: { page: { select: { workspaceId: true } } },
                              });
  if (existing) {
    const existingWorkspaceId =
      "workspaceId" in existing ? existing.workspaceId : existing.page.workspaceId;
    if (existingWorkspaceId !== workspaceId) {
      throw new ORPCError("CONFLICT", { message: "Entity belongs to another workspace" });
    }
  }
}

async function validatePagePlacement(
  tx: TransactionClient,
  workspaceId: string,
  pageId: string,
  notebookId: string | null,
  parentId: string | null,
): Promise<void> {
  if (notebookId) {
    const notebook = await tx.notebook.findFirst({
      where: { id: notebookId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!notebook) throw new ORPCError("BAD_REQUEST", { message: "Notebook not found" });
  }
  if (parentId) {
    if (parentId === pageId) {
      throw new ORPCError("BAD_REQUEST", { message: "A page cannot be its own parent" });
    }
    const pages = await tx.page.findMany({
      where: { workspaceId },
      select: { id: true, parentId: true },
    });
    const byId = new Map(pages.map((page) => [page.id, page]));
    if (!byId.has(parentId)) {
      throw new ORPCError("BAD_REQUEST", { message: "Parent page not found" });
    }
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === pageId) {
        throw new ORPCError("BAD_REQUEST", { message: "Page move would create a cycle" });
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
}

async function validateNotebookPlacement(
  tx: TransactionClient,
  workspaceId: string,
  notebookId: string,
  parentId: string | null,
): Promise<void> {
  if (!parentId) return;
  if (parentId === notebookId) {
    throw new ORPCError("BAD_REQUEST", { message: "A notebook cannot be its own parent" });
  }
  const notebooks = await tx.notebook.findMany({
    where: { workspaceId },
    select: { id: true, parentId: true },
  });
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  if (!byId.has(parentId)) throw new ORPCError("BAD_REQUEST", { message: "Parent notebook not found" });
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === notebookId) {
      throw new ORPCError("BAD_REQUEST", { message: "Notebook move would create a cycle" });
    }
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
}

async function nextPageVersion(tx: TransactionClient, pageId: string): Promise<number> {
  const aggregate = await tx.pageVersion.aggregate({
    where: { pageId },
    _max: { version: true },
  });
  return (aggregate._max.version ?? 0) + 1;
}

async function nextCanvasVersion(tx: TransactionClient, canvasId: string): Promise<number> {
  const aggregate = await tx.canvasVersion.aggregate({
    where: { canvasId },
    _max: { version: true },
  });
  return (aggregate._max.version ?? 0) + 1;
}

async function applyPage(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  const payload = op.payload;
  const existing = await tx.page.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "page", op.entityId, workspaceId);

  if (existing && existing.workspaceId !== workspaceId) {
    throw new ORPCError("CONFLICT", { message: "Page belongs to another workspace" });
  }

  if (existing) await assertPageWriteAccess(tx, existing, userId, role);

  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
    const deleted = await tx.page.update({
      where: { id: existing.id },
      data: { deletedAt: dateValue(payload.deletedAt) ?? new Date(), updatedById: userId },
    });
    changes.push({
      entity: "page",
      entityId: deleted.id,
      op: "DELETE",
      data: toJsonSafe(deleted),
    });
    await ensurePageNode(tx, deleted, changes);
    const edges = await tx.knowledgeEdge.findMany({
      where: {
        workspaceId,
        deletedAt: null,
        OR: [{ sourceNodeId: deleted.id }, { targetNodeId: deleted.id }],
      },
    });
    for (const edge of edges) {
      const removed = await tx.knowledgeEdge.update({
        where: { id: edge.id },
        data: { deletedAt: new Date() },
      });
      changes.push({ entity: "edge", entityId: edge.id, op: "DELETE", data: toJsonSafe(removed) });
    }
    return { accepted: { entity: "page", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }

  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const title = stringValue(payload.title)?.slice(0, 200) ?? existing?.title ?? "Untitled";
  const icon = hasOwn(payload, "icon") ? nullableField(payload, "icon", existing?.icon) : (existing?.icon ?? null);
  const coverUrl = hasOwn(payload, "coverUrl")
    ? nullableField(payload, "coverUrl", existing?.coverUrl)
    : (existing?.coverUrl ?? null);
  const notebookId = hasOwn(payload, "notebookId")
    ? nullableField(payload, "notebookId", existing?.notebookId)
    : (existing?.notebookId ?? null);
  const parentId = hasOwn(payload, "parentId")
    ? nullableField(payload, "parentId", existing?.parentId)
    : (existing?.parentId ?? null);
  const visibility = allowedString(payload.visibility, VISIBILITIES, (existing?.visibility as "WORKSPACE") ?? "WORKSPACE");
  if (visibility === "PUBLIC" && !canShare(role)) {
    throw new ORPCError("FORBIDDEN", { message: "Cannot publish a page with this role" });
  }
  const properties =
    (hasOwn(payload, "properties") ? recordValue(payload.properties) : recordValue(existing?.properties)) ?? {};
  const sortOrder = numberValue(payload.sortOrder) ?? existing?.sortOrder ?? 0;
  const type = allowedString(payload.type, ["DOCUMENT", "CANVAS", "DATABASE"] as const, (existing?.type as "DOCUMENT") ?? "DOCUMENT");

  await validatePagePlacement(tx, workspaceId, op.entityId, notebookId, parentId);

  const page = existing
    ? await tx.page.update({
        where: { id: existing.id },
        data: {
          title,
          icon,
          coverUrl,
          notebookId,
          parentId,
          visibility,
          properties: properties as Prisma.InputJsonValue,
          sortOrder,
          type,
          updatedById: userId,
          deletedAt: null,
        },
      })
    : await tx.page.create({
        data: {
          id: op.entityId,
          workspaceId,
          title,
          icon,
          coverUrl,
          notebookId,
          parentId,
          visibility,
          properties: properties as Prisma.InputJsonValue,
          sortOrder,
          type,
          createdById: userId,
          updatedById: userId,
        },
      });

  changes.push({ entity: "page", entityId: page.id, op: "UPSERT", data: toJsonSafe(page) });
  await ensurePageNode(tx, page, changes);

  const document = await tx.pageDocument.findUnique({ where: { pageId: page.id } });
  if (!document) {
    const created = await tx.pageDocument.create({
      data: {
        pageId: page.id,
        workspaceId,
        content: { type: "doc", content: [{ type: "paragraph" }] },
        plainText: "",
      },
    });
    changes.push({
      entity: "pageDocument",
      entityId: page.id,
      op: "UPSERT",
      data: toJsonSafe(created),
    });
  }

  return { accepted: { entity: "page", entityId: page.id, updatedAt: page.updatedAt } };
}

async function applyPageDocument(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const page = await tx.page.findFirst({
    where: { id: op.entityId, workspaceId, deletedAt: null },
  });
  if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  await assertPageWriteAccess(tx, page, userId, role);
  const existing = await tx.pageDocument.findUnique({ where: { pageId: page.id } });
  if (!existing) throw new ORPCError("NOT_FOUND", { message: "Page document not found" });
  const schemaVersion = numberValue(op.payload.schemaVersion) ?? existing.schemaVersion;
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This document was created by a newer version of Lattice",
    });
  }
  const baseRev = op.baseRev ?? 0;
  const content = recordValue(op.payload.content);
  if (!content) throw new ORPCError("BAD_REQUEST", { message: "Document content is required" });

  const collaborating = ctx.isCollaborating?.(page.id) ?? false;

  // Live peers converge through the CRDT, so their JSON snapshots arrive with
  // stale revisions by design. Accept them, and skip writes that change nothing.
  if (JSON.stringify(content) === JSON.stringify(existing.content)) {
    return {
      accepted: {
        entity: "pageDocument",
        entityId: page.id,
        rev: existing.rev,
        updatedAt: existing.updatedAt,
      },
    };
  }

  if (baseRev !== existing.rev && !collaborating) {
    const conflictId = randomUUID();
    const remoteData = toJsonSafe(existing);
    const localData = {
      content,
      plainText: stringValue(op.payload.plainText) ?? extractPlainText(safeDoc(content)),
      schemaVersion,
    };
    const version = await nextPageVersion(tx, page.id);
    await tx.pageVersion.create({
      data: {
        id: randomUUID(),
        pageId: page.id,
        workspaceId,
        version,
        title: page.title,
        content: existing.content as Prisma.InputJsonValue,
        note: "Remote version before a sync conflict",
        createdById: userId,
      },
    });
    await tx.syncConflict.create({
      data: {
        id: conflictId,
        workspaceId,
        entity: "pageDocument",
        entityId: page.id,
        userId,
        baseRev,
        remoteRev: existing.rev,
        localData: localData as Prisma.InputJsonValue,
        remoteData: remoteData as Prisma.InputJsonValue,
      },
    });
    return {
      conflict: {
        id: conflictId,
        entity: "pageDocument",
        entityId: page.id,
        baseRev,
        remoteRev: existing.rev,
        localData,
        remoteData,
        createdAt: new Date().toISOString(),
      },
    };
  }

  const plainText =
    stringValue(op.payload.plainText)?.slice(0, 2_000_000) ??
    extractPlainText(safeDoc(content)).slice(0, 2_000_000);

  const document = await tx.pageDocument.update({
    where: { pageId: page.id },
    data: {
      content: content as Prisma.InputJsonValue,
      plainText,
      schemaVersion,
      rev: existing.rev + 1,
    },
  });
  const updatedPage = await tx.page.update({
    where: { id: page.id },
    data: { updatedAt: new Date(), updatedById: userId },
  });
  if (!collaborating) ctx.markCollabStale?.(page.id);
  changes.push({
    entity: "pageDocument",
    entityId: page.id,
    op: "UPSERT",
    data: toJsonSafe(document),
  });
  changes.push({
    entity: "page",
    entityId: page.id,
    op: "UPSERT",
    data: toJsonSafe(updatedPage),
  });
  await recomputePageLinkEdges(tx, page, content, userId, changes);

  return {
    accepted: {
      entity: "pageDocument",
      entityId: page.id,
      rev: document.rev,
      updatedAt: document.updatedAt,
    },
  };
}

async function applyCanvas(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.canvas.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "canvas", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) {
    throw new ORPCError("CONFLICT", { message: "Canvas belongs to another workspace" });
  }

  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.canvas.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), updatedById: userId },
    });
    changes.push({ entity: "canvas", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    await ensureCanvasNode(tx, deleted, changes);
    return { accepted: { entity: "canvas", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }

  const schemaVersion = numberValue(payload.schemaVersion) ?? existing?.schemaVersion ?? 1;
  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new ORPCError("BAD_REQUEST", { message: "This canvas was created by a newer version of Lattice" });
  }
  const data = recordValue(payload.data);
  const baseRev = op.baseRev ?? 0;

  if (existing && data && baseRev !== existing.rev) {
    const conflictId = randomUUID();
    const remoteData = toJsonSafe(existing);
    const localData = { data, schemaVersion };
    const version = await nextCanvasVersion(tx, existing.id);
    await tx.canvasVersion.create({
      data: {
        id: randomUUID(),
        canvasId: existing.id,
        workspaceId,
        version,
        title: existing.title,
        data: existing.data as Prisma.InputJsonValue,
        note: "Remote version before a sync conflict",
        createdById: userId,
      },
    });
    await tx.syncConflict.create({
      data: {
        id: conflictId,
        workspaceId,
        entity: "canvas",
        entityId: existing.id,
        userId,
        baseRev,
        remoteRev: existing.rev,
        localData: localData as Prisma.InputJsonValue,
        remoteData: remoteData as Prisma.InputJsonValue,
      },
    });
    return {
      conflict: {
        id: conflictId,
        entity: "canvas",
        entityId: existing.id,
        baseRev,
        remoteRev: existing.rev,
        localData,
        remoteData,
        createdAt: new Date().toISOString(),
      },
    };
  }

  const notebookId = hasOwn(payload, "notebookId")
    ? nullableField(payload, "notebookId", existing?.notebookId)
    : (existing?.notebookId ?? null);
  if (notebookId) {
    const notebook = await tx.notebook.findFirst({
      where: { id: notebookId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!notebook) throw new ORPCError("BAD_REQUEST", { message: "Notebook not found" });
  }

  const canvas = existing
    ? await tx.canvas.update({
        where: { id: existing.id },
        data: {
          title: stringValue(payload.title)?.slice(0, 200) ?? existing.title,
          icon: hasOwn(payload, "icon")
            ? nullableField(payload, "icon", existing.icon)
            : (existing.icon ?? null),
          notebookId,
          thumbnail: hasOwn(payload, "thumbnail")
            ? nullableField(payload, "thumbnail", existing.thumbnail)
            : (existing.thumbnail ?? null),
          ...(data
            ? {
                data: data as Prisma.InputJsonValue,
                schemaVersion,
                rev: existing.rev + 1,
              }
            : {}),
          updatedById: userId,
          deletedAt: null,
        },
      })
    : await tx.canvas.create({
        data: {
          id: op.entityId,
          workspaceId,
          title: stringValue(payload.title)?.slice(0, 200) ?? "Untitled canvas",
          icon: nullableString(payload.icon) ?? null,
          notebookId,
          thumbnail: nullableString(payload.thumbnail) ?? null,
          data: (data ?? { version: 1, elements: [] }) as Prisma.InputJsonValue,
          schemaVersion,
          createdById: userId,
          updatedById: userId,
        },
      });

  changes.push({ entity: "canvas", entityId: canvas.id, op: "UPSERT", data: toJsonSafe(canvas) });
  await ensureCanvasNode(tx, canvas, changes);
  return {
    accepted: {
      entity: "canvas",
      entityId: canvas.id,
      rev: canvas.rev,
      updatedAt: canvas.updatedAt,
    },
  };
}

async function applyNotebook(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "MEMBER")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.notebook.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "notebook", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) {
    throw new ORPCError("CONFLICT", { message: "Notebook belongs to another workspace" });
  }
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.notebook.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "notebook", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "notebook", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const parentId = hasOwn(payload, "parentId")
    ? nullableField(payload, "parentId", existing?.parentId)
    : (existing?.parentId ?? null);
  await validateNotebookPlacement(tx, workspaceId, op.entityId, parentId);
  const notebook = existing
    ? await tx.notebook.update({
        where: { id: existing.id },
        data: {
          name: stringValue(payload.name)?.trim().slice(0, 100) || existing.name,
          description: hasOwn(payload, "description")
            ? nullableField(payload, "description", existing.description)
            : (existing.description ?? null),
          icon: hasOwn(payload, "icon")
            ? nullableField(payload, "icon", existing.icon)
            : (existing.icon ?? null),
          color: hasOwn(payload, "color")
            ? nullableField(payload, "color", existing.color)
            : (existing.color ?? null),
          parentId,
          visibility: allowedString(payload.visibility, VISIBILITIES, existing.visibility as "WORKSPACE"),
          sortOrder: numberValue(payload.sortOrder) ?? existing.sortOrder,
          kind: allowedString(payload.kind, ["NOTEBOOK", "FOLDER", "COLLECTION"] as const, existing.kind as "NOTEBOOK"),
          deletedAt: null,
        },
      })
    : await tx.notebook.create({
        data: {
          id: op.entityId,
          workspaceId,
          name: stringValue(payload.name)?.trim().slice(0, 100) || "New notebook",
          description: nullableString(payload.description) ?? null,
          icon: nullableString(payload.icon) ?? "◫",
          color: nullableString(payload.color) ?? null,
          parentId,
          visibility: allowedString(payload.visibility, VISIBILITIES, "WORKSPACE"),
          sortOrder: numberValue(payload.sortOrder) ?? 0,
          kind: allowedString(payload.kind, ["NOTEBOOK", "FOLDER", "COLLECTION"] as const, "NOTEBOOK"),
          createdById: userId,
        },
      });
  changes.push({ entity: "notebook", entityId: notebook.id, op: "UPSERT", data: toJsonSafe(notebook) });
  return { accepted: { entity: "notebook", entityId: notebook.id, updatedAt: notebook.updatedAt } };
}

async function applyNode(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.knowledgeNode.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "knowledgeNode", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) {
    throw new ORPCError("CONFLICT");
  }
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.knowledgeNode.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "node", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "node", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const pageId = hasOwn(payload, "pageId")
    ? nullableField(payload, "pageId", existing?.pageId)
    : (existing?.pageId ?? null);
  const canvasId = hasOwn(payload, "canvasId")
    ? nullableField(payload, "canvasId", existing?.canvasId)
    : (existing?.canvasId ?? null);
  if (pageId) {
    const page = await tx.page.findFirst({
      where: { id: pageId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!page) throw new ORPCError("BAD_REQUEST", { message: "Linked page not found" });
  }
  if (canvasId) {
    const canvas = await tx.canvas.findFirst({
      where: { id: canvasId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!canvas) throw new ORPCError("BAD_REQUEST", { message: "Linked canvas not found" });
  }
  const node = existing
    ? await tx.knowledgeNode.update({
        where: { id: existing.id },
        data: {
          kind: allowedString(payload.kind, NODE_KINDS, existing.kind as "TOPIC"),
          title: stringValue(payload.title)?.slice(0, 200) || existing.title,
          description: hasOwn(payload, "description")
            ? nullableField(payload, "description", existing.description)
            : (existing.description ?? null),
          pageId,
          canvasId,
          color: hasOwn(payload, "color")
            ? nullableField(payload, "color", existing.color)
            : (existing.color ?? null),
          x: numberValue(payload.x) ?? existing.x,
          y: numberValue(payload.y) ?? existing.y,
          metadata: (recordValue(payload.metadata) ?? existing.metadata) as Prisma.InputJsonValue,
          aiGenerated: booleanValue(payload.aiGenerated) ?? existing.aiGenerated,
          deletedAt: null,
        },
      })
    : await tx.knowledgeNode.create({
        data: {
          id: op.entityId,
          workspaceId,
          kind: allowedString(payload.kind, NODE_KINDS, "TOPIC"),
          title: stringValue(payload.title)?.slice(0, 200) || "Untitled concept",
          description: nullableString(payload.description) ?? null,
          pageId,
          canvasId,
          color: nullableString(payload.color) ?? null,
          x: numberValue(payload.x) ?? null,
          y: numberValue(payload.y) ?? null,
          metadata: (recordValue(payload.metadata) ?? {}) as Prisma.InputJsonValue,
          aiGenerated: booleanValue(payload.aiGenerated) ?? false,
          createdById: userId,
        },
      });
  changes.push({ entity: "node", entityId: node.id, op: "UPSERT", data: toJsonSafe(node) });
  return { accepted: { entity: "node", entityId: node.id, updatedAt: node.updatedAt } };
}

async function applyEdge(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.knowledgeEdge.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "knowledgeEdge", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.knowledgeEdge.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "edge", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "edge", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const sourceNodeId = stringValue(payload.sourceNodeId) ?? existing?.sourceNodeId;
  const targetNodeId = stringValue(payload.targetNodeId) ?? existing?.targetNodeId;
  if (!sourceNodeId || !targetNodeId) {
    throw new ORPCError("BAD_REQUEST", { message: "Both edge endpoints are required" });
  }
  const nodes = await tx.knowledgeNode.findMany({
    where: { id: { in: [sourceNodeId, targetNodeId] }, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (nodes.length !== 2) {
    throw new ORPCError("BAD_REQUEST", { message: "Both edge endpoints must exist in this workspace" });
  }
  const relationType = allowedString(payload.relationType, RELATION_TYPES, (existing?.relationType as "RELATED_TO") ?? "RELATED_TO");
  const origin = allowedString(payload.origin, ["MANUAL", "PAGE_LINK", "CANVAS_LINK", "AI"] as const, (existing?.origin as "MANUAL") ?? "MANUAL");
  const edge = existing
    ? await tx.knowledgeEdge.update({
        where: { id: existing.id },
        data: {
          sourceNodeId,
          targetNodeId,
          relationType,
          label: nullableString(payload.label) ?? existing.label,
          weight: numberValue(payload.weight) ?? existing.weight,
          origin,
          aiGenerated: booleanValue(payload.aiGenerated) ?? existing.aiGenerated,
          deletedAt: null,
        },
      })
    : await tx.knowledgeEdge.create({
        data: {
          id: op.entityId,
          workspaceId,
          sourceNodeId,
          targetNodeId,
          relationType,
          label: nullableString(payload.label) ?? null,
          weight: numberValue(payload.weight) ?? 1,
          origin,
          aiGenerated: booleanValue(payload.aiGenerated) ?? false,
          createdById: userId,
        },
      });
  changes.push({ entity: "edge", entityId: edge.id, op: "UPSERT", data: toJsonSafe(edge) });
  return { accepted: { entity: "edge", entityId: edge.id, updatedAt: edge.updatedAt } };
}

async function applyTag(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.tag.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "tag", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.tag.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    changes.push({ entity: "tag", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "tag", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const name = stringValue(payload.name)?.trim().toLowerCase().slice(0, 50);
  if (!name) throw new ORPCError("BAD_REQUEST", { message: "Tag name is required" });
  const duplicate = await tx.tag.findFirst({
    where: { workspaceId, name, NOT: { id: op.entityId } },
  });
  const tag = duplicate
    ? await tx.tag.update({
        where: { id: duplicate.id },
        data: { color: nullableString(payload.color) ?? duplicate.color },
      })
    : existing
      ? await tx.tag.update({
          where: { id: existing.id },
          data: {
            name,
            color: nullableString(payload.color) ?? existing.color,
            deletedAt: null,
          },
        })
      : await tx.tag.create({
          data: {
            id: op.entityId,
            workspaceId,
            name,
            color: nullableString(payload.color) ?? "#8b8b7a",
          },
        });
  changes.push({ entity: "tag", entityId: tag.id, op: "UPSERT", data: toJsonSafe(tag) });
  return { accepted: { entity: "tag", entityId: tag.id, updatedAt: tag.updatedAt } };
}

async function applyPageTag(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.pageTag.findUnique({
    where: { id: op.entityId },
    include: { page: { select: { workspaceId: true } } },
  });
  if (existing && existing.page.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE") {
    if (!existing) return {};
    await tx.pageTag.delete({ where: { id: existing.id } });
    changes.push({ entity: "pageTag", entityId: existing.id, op: "DELETE", data: toJsonSafe(existing) });
    return { accepted: { entity: "pageTag", entityId: existing.id, updatedAt: new Date() } };
  }
  const pageId = stringValue(payload.pageId);
  const tagId = stringValue(payload.tagId);
  if (!pageId || !tagId) throw new ORPCError("BAD_REQUEST");
  const [page, tag] = await Promise.all([
    tx.page.findFirst({ where: { id: pageId, workspaceId, deletedAt: null }, select: { id: true } }),
    tx.tag.findFirst({ where: { id: tagId, workspaceId, deletedAt: null }, select: { id: true } }),
  ]);
  if (!page || !tag) throw new ORPCError("BAD_REQUEST", { message: "Page or tag not found" });
  const pageTag = existing
    ? existing
    : await tx.pageTag.create({
        data: {
          id: op.entityId,
          pageId,
          tagId,
          source: allowedString(payload.source, ["USER", "AI"] as const, "USER"),
        },
      });
  changes.push({ entity: "pageTag", entityId: pageTag.id, op: "UPSERT", data: toJsonSafe(pageTag) });
  return { accepted: { entity: "pageTag", entityId: pageTag.id, updatedAt: new Date() } };
}

async function applyCapture(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.capture.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "capture", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.capture.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "capture", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "capture", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const capture = existing
    ? await tx.capture.update({
        where: { id: existing.id },
        data: {
          title: stringValue(payload.title)?.slice(0, 300) ?? existing.title,
          content: hasOwn(payload, "content")
            ? nullableField(payload, "content", existing.content)
            : (existing.content ?? null),
          url: hasOwn(payload, "url") ? nullableField(payload, "url", existing.url) : (existing.url ?? null),
          source: hasOwn(payload, "source")
            ? nullableField(payload, "source", existing.source)
            : (existing.source ?? null),
          type: allowedString(payload.type, ["NOTE", "BOOKMARK", "CLIP", "PDF", "IMAGE", "AUDIO", "VIDEO", "YOUTUBE", "TEXT", "EMAIL", "FILE"] as const, existing.type as "NOTE"),
          status: allowedString(payload.status, ["INBOX", "ORGANIZED", "ARCHIVED"] as const, existing.status as "INBOX"),
          metadata: (recordValue(payload.metadata) ?? existing.metadata) as Prisma.InputJsonValue,
          deletedAt: null,
        },
      })
    : await tx.capture.create({
        data: {
          id: op.entityId,
          workspaceId,
          title: stringValue(payload.title)?.slice(0, 300) ?? "",
          content: nullableString(payload.content) ?? null,
          url: nullableString(payload.url) ?? null,
          source: nullableString(payload.source) ?? null,
          type: allowedString(payload.type, ["NOTE", "BOOKMARK", "CLIP", "PDF", "IMAGE", "AUDIO", "VIDEO", "YOUTUBE", "TEXT", "EMAIL", "FILE"] as const, "NOTE"),
          status: allowedString(payload.status, ["INBOX", "ORGANIZED", "ARCHIVED"] as const, "INBOX"),
          metadata: (recordValue(payload.metadata) ?? {}) as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
  changes.push({ entity: "capture", entityId: capture.id, op: "UPSERT", data: toJsonSafe(capture) });
  return { accepted: { entity: "capture", entityId: capture.id, updatedAt: capture.updatedAt } };
}

async function applyTemplate(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.template.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "template", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.template.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "template", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "template", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const content = recordValue(payload.content) ?? (existing?.content as Record<string, unknown> | undefined);
  if (!content) throw new ORPCError("BAD_REQUEST", { message: "Template content is required" });
  const template = existing
    ? await tx.template.update({
        where: { id: existing.id },
        data: {
          name: stringValue(payload.name)?.slice(0, 100) || existing.name,
          description: hasOwn(payload, "description")
            ? nullableField(payload, "description", existing.description)
            : (existing.description ?? null),
          icon: hasOwn(payload, "icon")
            ? nullableField(payload, "icon", existing.icon)
            : (existing.icon ?? null),
          category: stringValue(payload.category)?.slice(0, 50) ?? existing.category,
          content: content as Prisma.InputJsonValue,
          properties: (recordValue(payload.properties) ?? existing.properties) as Prisma.InputJsonValue,
          deletedAt: null,
        },
      })
    : await tx.template.create({
        data: {
          id: op.entityId,
          workspaceId,
          name: stringValue(payload.name)?.slice(0, 100) || "Untitled template",
          description: nullableString(payload.description) ?? null,
          icon: nullableString(payload.icon) ?? "◇",
          category: stringValue(payload.category)?.slice(0, 50) ?? "Writing",
          content: content as Prisma.InputJsonValue,
          properties: (recordValue(payload.properties) ?? {}) as Prisma.InputJsonValue,
          createdById: userId,
        },
      });
  changes.push({ entity: "template", entityId: template.id, op: "UPSERT", data: toJsonSafe(template) });
  return { accepted: { entity: "template", entityId: template.id, updatedAt: template.updatedAt } };
}

async function applyDeck(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.deck.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "deck", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.deck.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    changes.push({ entity: "deck", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "deck", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const deck = existing
    ? await tx.deck.update({
        where: { id: existing.id },
        data: {
          name: stringValue(payload.name)?.slice(0, 100) || existing.name,
          description: nullableString(payload.description) ?? existing.description,
          notebookId: nullableString(payload.notebookId) ?? existing.notebookId,
          color: stringValue(payload.color)?.slice(0, 32) ?? existing.color,
        },
      })
    : await tx.deck.create({
        data: {
          id: op.entityId,
          workspaceId,
          name: stringValue(payload.name)?.slice(0, 100) || "Untitled deck",
          description: nullableString(payload.description) ?? null,
          notebookId: nullableString(payload.notebookId) ?? null,
          color: stringValue(payload.color)?.slice(0, 32) ?? "#2f6b4f",
        },
      });
  changes.push({ entity: "deck", entityId: deck.id, op: "UPSERT", data: toJsonSafe(deck) });
  return { accepted: { entity: "deck", entityId: deck.id, updatedAt: deck.updatedAt } };
}

async function applyFlashcard(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.flashcard.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "flashcard", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.flashcard.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "flashcard", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "flashcard", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const deckId = stringValue(payload.deckId) ?? existing?.deckId;
  if (!deckId) throw new ORPCError("BAD_REQUEST", { message: "A deck is required" });
  const deck = await tx.deck.findFirst({
    where: { id: deckId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!deck) throw new ORPCError("BAD_REQUEST", { message: "Deck not found" });
  const front = stringValue(payload.front)?.trim() ?? existing?.front ?? "";
  const back = stringValue(payload.back)?.trim() ?? existing?.back ?? "";
  if (!front || !back) throw new ORPCError("BAD_REQUEST", { message: "Both card sides are required" });
  const flashcard = existing
    ? await tx.flashcard.update({
        where: { id: existing.id },
        data: {
          deckId,
          pageId: hasOwn(payload, "pageId")
            ? nullableField(payload, "pageId", existing.pageId)
            : (existing.pageId ?? null),
          blockId: hasOwn(payload, "blockId")
            ? nullableField(payload, "blockId", existing.blockId)
            : (existing.blockId ?? null),
          front,
          back,
          hint: hasOwn(payload, "hint")
            ? nullableField(payload, "hint", existing.hint)
            : (existing.hint ?? null),
          source: allowedString(payload.source, ["MANUAL", "NOTE", "AI"] as const, existing.source as "MANUAL"),
          dueAt: dateValue(payload.dueAt) ?? existing.dueAt,
          interval: numberValue(payload.interval) ?? existing.interval,
          ease: numberValue(payload.ease) ?? existing.ease,
          reps: numberValue(payload.reps) ?? existing.reps,
          lapses: numberValue(payload.lapses) ?? existing.lapses,
          lastReviewedAt: dateValue(payload.lastReviewedAt) ?? existing.lastReviewedAt,
          deletedAt: null,
        },
      })
    : await tx.flashcard.create({
        data: {
          id: op.entityId,
          workspaceId,
          deckId,
          pageId: nullableString(payload.pageId) ?? null,
          blockId: nullableString(payload.blockId) ?? null,
          front,
          back,
          hint: nullableString(payload.hint) ?? null,
          source: allowedString(payload.source, ["MANUAL", "NOTE", "AI"] as const, "MANUAL"),
          dueAt: dateValue(payload.dueAt) ?? new Date(),
          interval: numberValue(payload.interval) ?? 0,
          ease: numberValue(payload.ease) ?? 2.5,
          reps: numberValue(payload.reps) ?? 0,
          lapses: numberValue(payload.lapses) ?? 0,
          lastReviewedAt: dateValue(payload.lastReviewedAt) ?? null,
        },
      });
  changes.push({ entity: "flashcard", entityId: flashcard.id, op: "UPSERT", data: toJsonSafe(flashcard) });
  return { accepted: { entity: "flashcard", entityId: flashcard.id, updatedAt: flashcard.updatedAt } };
}

async function applyComment(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "VIEWER")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.comment.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "comment", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.comment.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "comment", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "comment", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const pageId = stringValue(payload.pageId) ?? existing?.pageId;
  if (!pageId) throw new ORPCError("BAD_REQUEST");
  const page = await tx.page.findFirst({
    where: { id: pageId, workspaceId, deletedAt: null },
    select: {
      id: true,
      title: true,
      createdById: true,
      visibility: true,
      workspaceId: true,
    },
  });
  if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  await assertPageReadAccess(tx, page, userId, role);
  const body = stringValue(payload.body)?.trim().slice(0, 10_000);
  if (!body) throw new ORPCError("BAD_REQUEST", { message: "Comment body is required" });
  const parentId = nullableString(payload.parentId) ?? existing?.parentId ?? null;
  if (parentId) {
    const parent = await tx.comment.findFirst({
      where: { id: parentId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!parent) throw new ORPCError("BAD_REQUEST", { message: "Parent comment not found" });
  }
  const comment = existing
    ? await tx.comment.update({
        where: { id: existing.id },
        data: {
          body,
          blockId: hasOwn(payload, "blockId")
            ? nullableField(payload, "blockId", existing.blockId)
            : (existing.blockId ?? null),
          resolvedAt: hasOwn(payload, "resolvedAt")
            ? (dateValue(payload.resolvedAt) ?? null)
            : existing.resolvedAt,
          deletedAt: null,
        },
      })
    : await tx.comment.create({
        data: {
          id: op.entityId,
          workspaceId,
          pageId,
          blockId: nullableString(payload.blockId) ?? null,
          parentId,
          authorId: userId,
          body,
        },
      });
  changes.push({ entity: "comment", entityId: comment.id, op: "UPSERT", data: toJsonSafe(comment) });
  if (!existing) {
    const recipientIds = new Set<string>();
    if (page.createdById !== userId) recipientIds.add(page.createdById);
    const parentAuthor = parentId
      ? await tx.comment.findFirst({
          where: { id: parentId },
          select: { authorId: true },
        })
      : null;
    if (parentAuthor?.authorId && parentAuthor.authorId !== userId) {
      recipientIds.add(parentAuthor.authorId);
    }
    const members = await tx.workspaceMember.findMany({
      where: { workspaceId, status: "ACTIVE", deletedAt: null },
      select: { userId: true },
    });
    const users = await tx.user.findMany({
      where: { id: { in: members.map((member) => member.userId) } },
      select: { id: true, name: true },
    });
    for (const user of users) {
      if (user.id === userId) continue;
      if (body.toLowerCase().includes(`@${user.name.toLowerCase()}`)) {
        recipientIds.add(user.id);
      }
    }
    if (recipientIds.size) {
      const author = await tx.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      await tx.notification.createMany({
        data: [...recipientIds].map((recipientId) => ({
          id: `notif_${randomUUID()}`,
          userId: recipientId,
          workspaceId,
          type: "comment",
          title: `${author?.name ?? "Someone"} commented on “${page.title}”`,
          body: body.slice(0, 240),
          href: `/app?view=page&id=${page.id}`,
        })),
      });
    }
  }
  return { accepted: { entity: "comment", entityId: comment.id, updatedAt: comment.updatedAt } };
}

async function applySuggestedEdit(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "VIEWER")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.suggestedEdit.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "suggestedEdit", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");

  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    if (existing.authorId !== userId && !hasRole(role, "EDITOR")) {
      throw new ORPCError("FORBIDDEN", {
        message: "Only the author or an editor can withdraw a suggestion.",
      });
    }
    const deleted = await tx.suggestedEdit.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({
      entity: "suggestedEdit",
      entityId: deleted.id,
      op: "DELETE",
      data: toJsonSafe(deleted),
    });
    return {
      accepted: {
        entity: "suggestedEdit",
        entityId: deleted.id,
        updatedAt: deleted.updatedAt,
      },
    };
  }

  const pageId = stringValue(payload.pageId) ?? existing?.pageId;
  if (!pageId) throw new ORPCError("BAD_REQUEST", { message: "A suggestion needs a page." });
  const page = await tx.page.findFirst({
    where: { id: pageId, workspaceId, deletedAt: null },
    select: {
      id: true,
      title: true,
      createdById: true,
      visibility: true,
      workspaceId: true,
    },
  });
  if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  await assertPageReadAccess(tx, page, userId, role);

  const status = isSuggestionStatus(payload.status)
    ? payload.status
    : ((existing?.status as SuggestionStatus | undefined) ?? "PENDING");
  if (!existing && status !== "PENDING") {
    throw new ORPCError("BAD_REQUEST", { message: "A new suggestion starts pending." });
  }
  if (existing && status !== existing.status && !hasRole(role, "EDITOR")) {
    throw new ORPCError("FORBIDDEN", { message: "Only editors can review suggestions." });
  }

  const content = recordValue(payload.content) ?? existing?.content;
  if (!content) throw new ORPCError("BAD_REQUEST", { message: "A suggestion needs content." });
  const baseRev = numberValue(payload.baseRev) ?? existing?.baseRev ?? 0;
  const title = (stringValue(payload.title) ?? existing?.title ?? page.title).slice(0, 200);
  const note = hasOwn(payload, "note")
    ? (nullableString(payload.note) ?? null)
    : (existing?.note ?? null);
  const statusChanged = status !== (existing?.status ?? "PENDING");

  const data = {
    pageId,
    baseRev: Math.max(0, Math.round(baseRev)),
    title,
    content: content as Prisma.InputJsonValue,
    note,
    status,
    ...(statusChanged && status !== "PENDING"
      ? { reviewedById: userId, reviewedAt: new Date() }
      : {}),
    ...(status === "PENDING" ? { reviewedById: null, reviewedAt: null } : {}),
    deletedAt: null,
  };
  const suggestion = existing
    ? await tx.suggestedEdit.update({ where: { id: existing.id }, data })
    : await tx.suggestedEdit.create({
        data: { id: op.entityId, workspaceId, authorId: userId, ...data },
      });

  changes.push({
    entity: "suggestedEdit",
    entityId: suggestion.id,
    op: "UPSERT",
    data: toJsonSafe(suggestion),
  });
  return {
    accepted: {
      entity: "suggestedEdit",
      entityId: suggestion.id,
      updatedAt: suggestion.updatedAt,
    },
  };
}

async function applyAttachment(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, userId, role } = ctx;
  if (!hasRole(role, "EDITOR")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.attachment.findUnique({ where: { id: op.entityId } });
  await assertNoCrossWorkspace(tx, "attachment", op.entityId, workspaceId);
  if (existing && existing.workspaceId !== workspaceId) throw new ORPCError("CONFLICT");
  if (op.op === "DELETE" || payload.deletedAt) {
    if (!existing) return {};
    const deleted = await tx.attachment.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "attachment", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "attachment", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const attachment = existing
    ? existing
    : await tx.attachment.create({
        data: {
          id: op.entityId,
          workspaceId,
          pageId: nullableString(payload.pageId) ?? null,
          uploaderId: userId,
          name: stringValue(payload.name) ?? "Attachment",
          mime: stringValue(payload.mime) ?? "application/octet-stream",
          size: numberValue(payload.size) ?? 0,
          url: stringValue(payload.url) ?? "",
        },
      });
  changes.push({ entity: "attachment", entityId: attachment.id, op: "UPSERT", data: toJsonSafe(attachment) });
  return { accepted: { entity: "attachment", entityId: attachment.id, updatedAt: attachment.updatedAt } };
}

async function applyMember(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, role } = ctx;
  if (!hasRole(role, "ADMIN")) throw new ORPCError("FORBIDDEN");
  const payload = op.payload;
  const existing = await tx.workspaceMember.findUnique({ where: { id: op.entityId } });
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new ORPCError("NOT_FOUND", { message: "Member not found" });
  }
  if (existing.role === "OWNER" && role !== "OWNER") {
    throw new ORPCError("FORBIDDEN", { message: "Only the owner can change the owner" });
  }
  if (op.op === "DELETE") {
    const deleted = await tx.workspaceMember.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), status: "SUSPENDED" },
    });
    changes.push({ entity: "member", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "member", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const updated = await tx.workspaceMember.update({
    where: { id: existing.id },
    data: {
      role: allowedString(payload.role, ROLES, existing.role as "MEMBER"),
      status: allowedString(payload.status, ["ACTIVE", "INVITED", "SUSPENDED"] as const, existing.status as "ACTIVE"),
    },
  });
  changes.push({ entity: "member", entityId: updated.id, op: "UPSERT", data: toJsonSafe(updated) });
  return { accepted: { entity: "member", entityId: updated.id, updatedAt: updated.updatedAt } };
}

async function applyWorkspace(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  const { tx, workspaceId, role } = ctx;
  if (!hasRole(role, "ADMIN")) throw new ORPCError("FORBIDDEN");
  if (op.entityId !== workspaceId) {
    throw new ORPCError("FORBIDDEN", { message: "Cannot modify another workspace" });
  }
  const existing = await tx.workspace.findUnique({ where: { id: workspaceId } });
  if (!existing) throw new ORPCError("NOT_FOUND");
  if (op.op === "DELETE") {
    if (!hasRole(role, "OWNER")) throw new ORPCError("FORBIDDEN");
    const deleted = await tx.workspace.update({
      where: { id: workspaceId },
      data: { deletedAt: new Date() },
    });
    changes.push({ entity: "workspace", entityId: deleted.id, op: "DELETE", data: toJsonSafe(deleted) });
    return { accepted: { entity: "workspace", entityId: deleted.id, updatedAt: deleted.updatedAt } };
  }
  const retention = numberValue(op.payload.trashRetentionDays);
  const updated = await tx.workspace.update({
    where: { id: workspaceId },
    data: {
      name: stringValue(op.payload.name)?.trim().slice(0, 80) ?? existing.name,
      description: nullableString(op.payload.description) ?? existing.description,
      icon: nullableString(op.payload.icon) ?? existing.icon,
      accent: nullableString(op.payload.accent) ?? existing.accent,
      ...(retention !== undefined
        ? { trashRetentionDays: Math.max(0, Math.min(3650, Math.round(retention))) }
        : {}),
    },
  });
  changes.push({ entity: "workspace", entityId: updated.id, op: "UPSERT", data: toJsonSafe(updated) });
  return { accepted: { entity: "workspace", entityId: updated.id, updatedAt: updated.updatedAt } };
}

async function applyOp(
  ctx: ApplyContext,
  op: SyncOpInput,
  changes: PendingChange[],
): Promise<ApplyResult> {
  switch (op.entity) {
    case "page":
      return applyPage(ctx, op, changes);
    case "pageDocument":
      return applyPageDocument(ctx, op, changes);
    case "canvas":
      return applyCanvas(ctx, op, changes);
    case "notebook":
      return applyNotebook(ctx, op, changes);
    case "node":
      return applyNode(ctx, op, changes);
    case "edge":
      return applyEdge(ctx, op, changes);
    case "tag":
      return applyTag(ctx, op, changes);
    case "pageTag":
      return applyPageTag(ctx, op, changes);
    case "capture":
      return applyCapture(ctx, op, changes);
    case "template":
      return applyTemplate(ctx, op, changes);
    case "deck":
      return applyDeck(ctx, op, changes);
    case "flashcard":
      return applyFlashcard(ctx, op, changes);
    case "comment":
      return applyComment(ctx, op, changes);
    case "suggestedEdit":
      return applySuggestedEdit(ctx, op, changes);
    case "attachment":
      return applyAttachment(ctx, op, changes);
    case "member":
      return applyMember(ctx, op, changes);
    case "workspace":
      return applyWorkspace(ctx, op, changes);
    default:
      throw new ORPCError("BAD_REQUEST", { message: `Unsupported entity: ${String(op.entity)}` });
  }
}

interface StoredOpResult {
  accepted?: {
    entity: SyncEntity;
    entityId: string;
    rev?: number;
    updatedAt: string;
  };
  conflict?: SyncConflictPayload;
}

export async function getAccessiblePageIds(
  db: Database,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<Set<string> | null> {
  if (hasRole(role, "ADMIN")) return null;
  const [pages, permissions] = await Promise.all([
    db.page.findMany({
      where: { workspaceId },
      select: { id: true, createdById: true, visibility: true },
    }),
    db.resourcePermission.findMany({
      where: { workspaceId, userId, resourceType: "PAGE" },
      select: { resourceId: true },
    }),
  ]);
  const shared = new Set(permissions.map((permission) => permission.resourceId));
  const allowed = new Set<string>();
  for (const page of pages) {
    if (
      page.createdById === userId ||
      page.visibility === "WORKSPACE" ||
      page.visibility === "PUBLIC" ||
      shared.has(page.id)
    ) {
      allowed.add(page.id);
    }
  }
  return allowed;
}

function changeVisible(
  change: { entity: string; entityId: string; data: unknown },
  allowed: Set<string> | null,
  nodePageById: Map<string, string | null>,
): boolean {
  if (!allowed) return true;
  const data = recordValue(change.data) ?? {};
  switch (change.entity) {
    case "page":
    case "pageDocument":
      return allowed.has(change.entityId);
    case "node": {
      const pageId = stringValue(data.pageId);
      return !pageId || allowed.has(pageId);
    }
    case "edge": {
      const source = stringValue(data.sourceNodeId);
      const target = stringValue(data.targetNodeId);
      const sourcePage = source ? nodePageById.get(source) : null;
      const targetPage = target ? nodePageById.get(target) : null;
      return (!sourcePage || allowed.has(sourcePage)) && (!targetPage || allowed.has(targetPage));
    }
    case "comment":
    case "pageTag":
    case "attachment":
    case "flashcard": {
      const pageId = stringValue(data.pageId);
      return !pageId || allowed.has(pageId);
    }
    default:
      return true;
  }
}

async function nodePageMap(db: Database, workspaceId: string): Promise<Map<string, string | null>> {
  const nodes = await db.knowledgeNode.findMany({
    where: { workspaceId },
    select: { id: true, pageId: true },
  });
  return new Map(nodes.map((node) => [node.id, node.pageId]));
}


export async function pushSync(
  db: Database,
  input: {
    workspaceId: string;
    userId: string;
    ops: SyncOpInput[];
    isCollaborating?: (pageId: string) => boolean;
    invalidateCollab?: (pageId: string) => void;
  },
): Promise<SyncPushResponse> {
  // The gateway allows viewers through because comments and suggested edits are
  // viewer-level writes; every entity apply enforces its own required role.
  const membership = await requireMembership(db, input.userId, input.workspaceId, "VIEWER");
  const staleCollab: string[] = [];
  const response = await db.$transaction(
    async (tx) => {
      const duplicateOps = await tx.syncOp.findMany({
        where: { id: { in: input.ops.map((op) => op.opId) } },
      });
      const duplicateById = new Map(duplicateOps.map((op) => [op.id, op]));
      const accepted: SyncPushResponse["accepted"] = [];
      const conflicts: SyncConflictPayload[] = [];
      const changes: PendingChange[] = [];
      const results: Array<{ opId: string; result: StoredOpResult }> = [];

      for (const op of input.ops) {
        const duplicate = duplicateById.get(op.opId);
        if (duplicate) {
          const stored = duplicate.result as unknown as StoredOpResult;
          if (stored.accepted) accepted.push(stored.accepted);
          if (stored.conflict) conflicts.push(stored.conflict);
          continue;
        }
        const result = await applyOp(
          {
            tx,
            workspaceId: input.workspaceId,
            userId: input.userId,
            role: membership.role,
            isCollaborating: input.isCollaborating,
            markCollabStale: (pageId: string) => staleCollab.push(pageId),
          },
          op,
          changes,
        );
        const stored: StoredOpResult = result.conflict
          ? { conflict: result.conflict }
          : result.accepted
            ? {
                accepted: {
                  entity: result.accepted.entity,
                  entityId: result.accepted.entityId,
                  rev: result.accepted.rev,
                  updatedAt: result.accepted.updatedAt.toISOString(),
                },
              }
            : {};
        if (result.accepted) {
          accepted.push({
            entity: result.accepted.entity,
            entityId: result.accepted.entityId,
            rev: result.accepted.rev,
            updatedAt: result.accepted.updatedAt.toISOString(),
          });
        }
        if (result.conflict) conflicts.push(result.conflict);
        results.push({ opId: op.opId, result: stored });
      }

      const version = await appendChanges(tx, input.workspaceId, input.userId, changes);
      if (results.length) {
        await tx.syncOp.createMany({
          data: results.map((entry) => ({
            id: entry.opId,
            workspaceId: input.workspaceId,
            userId: input.userId,
            result: entry.result as unknown as Prisma.InputJsonValue,
          })),
        });
      }
      return { accepted, conflicts, version };
    },
    { timeout: 30_000 },
  );

  // Anything written outside a live session makes a stored CRDT stale, and the
  // drop has to happen after the commit so a rolled back push cannot clear it.
  for (const pageId of new Set(staleCollab)) {
    input.invalidateCollab?.(pageId);
  }
  return response;
}

export async function pullSync(
  db: Database,
  input: {
    workspaceId: string;
    userId: string;
    cursor?: string | null;
    limit: number;
  },
): Promise<{ changes: unknown[]; cursor: SyncCursor | null; hasMore: boolean }> {
  const membership = await requireMembership(db, input.userId, input.workspaceId, "VIEWER");
  const allowed = await getAccessiblePageIds(db, input.workspaceId, input.userId, membership.role);
  const nodeMap = allowed ? await nodePageMap(db, input.workspaceId) : null;
  const cursor = decodeCursor(input.cursor);
  const rows = await db.syncChange.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(cursor
        ? {
            OR: [
              { version: { gt: cursor.version } },
              { version: cursor.version, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ version: "asc" }, { id: "asc" }],
    take: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const changes = page
    .filter((change) => changeVisible(change, allowed, nodeMap ?? new Map()))
    .map((change) => ({
      id: change.id,
      workspaceId: change.workspaceId,
      version: change.version,
      entity: change.entity,
      entityId: change.entityId,
      op: change.op,
      data: change.data,
      actorId: change.actorId,
      createdAt: change.createdAt.toISOString(),
    }));
  return {
    changes,
    cursor: last ? { version: last.version, id: last.id } : cursor,
    hasMore,
  };
}

export async function syncSnapshot(
  db: Database,
  input: { workspaceId: string; userId: string },
): Promise<Record<string, unknown>> {
  const membership = await requireMembership(db, input.userId, input.workspaceId, "VIEWER");
  const workspace = await db.workspace.findFirst({
    where: { id: input.workspaceId, deletedAt: null },
  });
  if (!workspace) throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });

  const [
    members,
    notebooks,
    pages,
    pageDocuments,
    canvases,
    nodes,
    edges,
    tags,
    pageTags,
    captures,
    templates,
    decks,
    flashcards,
    comments,
    attachments,
    suggestedEdits,
  ] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId: input.workspaceId, deletedAt: null },
    }),
    db.notebook.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.page.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.pageDocument.findMany({
      where: { workspaceId: input.workspaceId, page: { deletedAt: null } },
    }),
    db.canvas.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.knowledgeNode.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.knowledgeEdge.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.tag.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.pageTag.findMany({
      where: { page: { workspaceId: input.workspaceId, deletedAt: null } },
    }),
    db.capture.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.template.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.deck.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.flashcard.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.comment.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.attachment.findMany({ where: { workspaceId: input.workspaceId, deletedAt: null } }),
    db.suggestedEdit.findMany({
      where: { workspaceId: input.workspaceId, deletedAt: null },
    }),
  ]);

  const allowed = await getAccessiblePageIds(db, input.workspaceId, input.userId, membership.role);
  const visiblePages = allowed ? pages.filter((page) => allowed.has(page.id)) : pages;
  const visiblePageIds = new Set(visiblePages.map((page) => page.id));
  const visiblePageDocuments = allowed
    ? pageDocuments.filter((document) => visiblePageIds.has(document.pageId))
    : pageDocuments;
  const visibleNodes = allowed
    ? nodes.filter((node) => !node.pageId || allowed.has(node.pageId))
    : nodes;
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = allowed
    ? edges.filter(
        (edge) =>
          visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId),
      )
    : edges;
  const visibleComments = allowed
    ? comments.filter((comment) => visiblePageIds.has(comment.pageId))
    : comments;
  const visiblePageTags = allowed
    ? pageTags.filter((pageTag) => visiblePageIds.has(pageTag.pageId))
    : pageTags;
  const visibleAttachments = allowed
    ? attachments.filter(
        (attachment) => !attachment.pageId || visiblePageIds.has(attachment.pageId),
      )
    : attachments;
  const visibleFlashcards = allowed
    ? flashcards.filter((flashcard) => !flashcard.pageId || visiblePageIds.has(flashcard.pageId))
    : flashcards;
  const visibleSuggestedEdits = allowed
    ? suggestedEdits.filter((edit) => visiblePageIds.has(edit.pageId))
    : suggestedEdits;

  return toJsonSafe({
    version: workspace.syncVersion,
    role: membership.role,
    workspace,
    members,
    notebooks,
    pages: visiblePages,
    pageDocuments: visiblePageDocuments,
    canvases,
    nodes: visibleNodes,
    edges: visibleEdges,
    tags,
    pageTags: visiblePageTags,
    captures,
    templates,
    decks,
    flashcards: visibleFlashcards,
    comments: visibleComments,
    attachments: visibleAttachments,
    suggestedEdits: visibleSuggestedEdits,
  });
}

export async function resolveSyncConflict(
  db: Database,
  input: {
    workspaceId: string;
    userId: string;
    conflictId: string;
    resolution: "KEEP_LOCAL" | "KEEP_REMOTE";
    content?: Record<string, unknown>;
  },
): Promise<{ ok: true }> {
  await requireMembership(db, input.userId, input.workspaceId, "EDITOR");
  return db.$transaction(async (tx) => {
    const conflict = await tx.syncConflict.findFirst({
      where: {
        id: input.conflictId,
        workspaceId: input.workspaceId,
        resolvedAt: null,
      },
    });
    if (!conflict) throw new ORPCError("NOT_FOUND", { message: "Conflict not found" });
    const pageId = conflict.entityId;
    if (input.resolution === "KEEP_LOCAL" && conflict.entity === "pageDocument") {
      const page = await tx.page.findFirst({
        where: { id: pageId, workspaceId: input.workspaceId, deletedAt: null },
      });
      const document = await tx.pageDocument.findUnique({ where: { pageId } });
      if (!page || !document) throw new ORPCError("NOT_FOUND");
      const localData = conflict.localData as Record<string, unknown>;
      const content = input.content ?? (localData.content as Record<string, unknown> | undefined);
      if (!content) throw new ORPCError("BAD_REQUEST", { message: "No local content to keep" });
      const version = await nextPageVersion(tx, page.id);
      await tx.pageVersion.create({
        data: {
          id: randomUUID(),
          pageId: page.id,
          workspaceId: input.workspaceId,
          version,
          title: page.title,
          content: document.content as Prisma.InputJsonValue,
          note: "Remote version replaced during conflict resolution",
          createdById: input.userId,
        },
      });
      const updated = await tx.pageDocument.update({
        where: { pageId: page.id },
        data: {
          content: content as Prisma.InputJsonValue,
          plainText: typeof localData.plainText === "string" ? localData.plainText : extractPlainText(safeDoc(content)),
          rev: document.rev + 1,
        },
      });
      const updatedPage = await tx.page.update({
        where: { id: page.id },
        data: { updatedAt: new Date(), updatedById: input.userId },
      });
      const changes: PendingChange[] = [
        { entity: "pageDocument", entityId: page.id, op: "UPSERT", data: toJsonSafe(updated) },
        { entity: "page", entityId: page.id, op: "UPSERT", data: toJsonSafe(updatedPage) },
      ];
      await recomputePageLinkEdges(tx, page, content, input.userId, changes);
      const versionNumber = await appendChanges(tx, input.workspaceId, input.userId, changes);
      await tx.syncConflict.update({
        where: { id: conflict.id },
        data: { resolution: "KEEP_LOCAL", resolvedAt: new Date() },
      });
      return { ok: true, version: versionNumber } as { ok: true };
    }

    if (input.resolution === "KEEP_LOCAL" && conflict.entity === "canvas") {
      const canvas = await tx.canvas.findFirst({
        where: { id: pageId, workspaceId: input.workspaceId, deletedAt: null },
      });
      if (!canvas) throw new ORPCError("NOT_FOUND");
      const localData = conflict.localData as Record<string, unknown>;
      const data = input.content ?? (localData.data as Record<string, unknown> | undefined);
      if (!data) throw new ORPCError("BAD_REQUEST", { message: "No local canvas to keep" });
      const version = await nextCanvasVersion(tx, canvas.id);
      await tx.canvasVersion.create({
        data: {
          id: randomUUID(),
          canvasId: canvas.id,
          workspaceId: input.workspaceId,
          version,
          title: canvas.title,
          data: canvas.data as Prisma.InputJsonValue,
          note: "Remote version replaced during conflict resolution",
          createdById: input.userId,
        },
      });
      const updated = await tx.canvas.update({
        where: { id: canvas.id },
        data: { data: data as Prisma.InputJsonValue, rev: canvas.rev + 1, updatedById: input.userId },
      });
      const changes: PendingChange[] = [
        { entity: "canvas", entityId: canvas.id, op: "UPSERT", data: toJsonSafe(updated) },
      ];
      await appendChanges(tx, input.workspaceId, input.userId, changes);
      await tx.syncConflict.update({
        where: { id: conflict.id },
        data: { resolution: "KEEP_LOCAL", resolvedAt: new Date() },
      });
      return { ok: true } as { ok: true };
    }

    await tx.syncConflict.update({
      where: { id: conflict.id },
      data: { resolution: "KEEP_REMOTE", resolvedAt: new Date() },
    });
    return { ok: true } as { ok: true };
  });
}
