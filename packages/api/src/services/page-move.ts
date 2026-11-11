import { randomUUID } from "node:crypto";

import type { Database } from "@notes-learning/db";
import {
  descendantPageIds,
  hasRole,
  planPageOrder,
  type Role,
  type SyncOpInput,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

import { assertPageAccess } from "./page-access";
import { pushSync } from "./sync";

interface MovePageRecord {
  id: string;
  parentId: string | null;
  notebookId: string | null;
  sortOrder: number;
  title: string;
  createdById: string;
  visibility: string;
}

/**
 * Reading is not enough to reorder the neighbours: a SHARED page can be
 * read-only, and pushing a sortOrder for it would reject the whole batch.
 */
function canEditPage(page: MovePageRecord, userId: string, role: Role): boolean {
  if (hasRole(role, "ADMIN")) return true;
  if (page.createdById === userId) return true;
  return page.visibility === "WORKSPACE" || page.visibility === "PUBLIC";
}

export interface MovePageSubtreeInput {
  workspaceId: string;
  userId: string;
  role: Role;
  pageId: string;
  parentId: string | null;
  notebookId: string | null;
  beforeId?: string | null;
  afterId?: string | null;
}

/**
 * Reparents or reorders a page and carries its subtree into the destination
 * notebook. The web sidebar does the same work locally; this is the path for
 * the native client and other API callers.
 */
export async function movePageSubtree(db: Database, input: MovePageSubtreeInput) {
  const page = await db.page.findFirst({
    where: { id: input.pageId, workspaceId: input.workspaceId, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      notebookId: true,
      sortOrder: true,
      title: true,
      createdById: true,
      visibility: true,
      workspaceId: true,
    },
  });
  if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  await assertPageAccess(db, page, input.userId, input.role, "write");

  const pages = await db.page.findMany({
    where: { workspaceId: input.workspaceId, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      notebookId: true,
      sortOrder: true,
      title: true,
      createdById: true,
      visibility: true,
    },
  });

  if (input.parentId) {
    if (input.parentId === page.id) {
      throw new ORPCError("BAD_REQUEST", { message: "A page cannot be its own parent" });
    }
    if (!pages.some((candidate) => candidate.id === input.parentId)) {
      throw new ORPCError("BAD_REQUEST", { message: "Parent page not found" });
    }
    if (descendantPageIds(page.id, pages).includes(input.parentId)) {
      throw new ORPCError("BAD_REQUEST", { message: "Page move would create a cycle" });
    }
  }

  const siblings = pages.filter(
    (candidate) =>
      candidate.id !== page.id &&
      candidate.parentId === input.parentId &&
      (input.parentId !== null || candidate.notebookId === input.notebookId) &&
      canEditPage(candidate, input.userId, input.role),
  );
  const order = planPageOrder(siblings, {
    beforeId: input.beforeId,
    afterId: input.afterId,
  });

  const ops: SyncOpInput[] = [
    {
      opId: `api-page-move-${randomUUID()}`,
      entity: "page",
      entityId: page.id,
      op: "UPSERT",
      payload: {
        parentId: input.parentId,
        notebookId: input.notebookId,
        sortOrder: order.sortOrder,
      },
    },
    ...order.siblingUpdates.map((update) => ({
      opId: `api-page-move-${randomUUID()}`,
      entity: "page" as const,
      entityId: update.id,
      op: "UPSERT" as const,
      payload: { sortOrder: update.sortOrder },
    })),
  ];

  for (const id of descendantPageIds(page.id, pages)) {
    const child = pages.find((candidate) => candidate.id === id);
    if (!child || child.notebookId === input.notebookId) continue;
    if (!canEditPage(child, input.userId, input.role)) continue;
    ops.push({
      opId: `api-page-move-${randomUUID()}`,
      entity: "page",
      entityId: child.id,
      op: "UPSERT",
      payload: { notebookId: input.notebookId },
    });
  }

  const result = await pushSync(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    ops,
  });
  if (result.conflicts.length) {
    throw new ORPCError("CONFLICT", { message: "Could not move the page" });
  }
  return db.page.findUniqueOrThrow({ where: { id: page.id } });
}
