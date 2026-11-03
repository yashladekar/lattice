import { randomUUID } from "node:crypto";

import { createId } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { pushSync } from "../services/sync";

export const notebookRouter = {
  list: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const notebooks = await context.db.notebook.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    const pages = await context.db.page.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      select: { id: true, notebookId: true },
    });
    const counts = new Map<string, number>();
    for (const page of pages) {
      if (!page.notebookId) continue;
      counts.set(page.notebookId, (counts.get(page.notebookId) ?? 0) + 1);
    }
    return notebooks.map((notebook) => ({
      ...notebook,
      pageCount: counts.get(notebook.id) ?? 0,
    }));
  }),

  create: workspaceProcedure("MEMBER")
    .input(
      z.object({
        name: z.string().trim().min(1).max(100),
        parentId: z.string().nullable().optional(),
        kind: z.enum(["NOTEBOOK", "FOLDER", "COLLECTION"]).default("NOTEBOOK"),
        icon: z.string().max(16).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        visibility: z.enum(["PRIVATE", "SHARED", "WORKSPACE", "PUBLIC"]).default("WORKSPACE"),
        color: z.string().max(32).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const notebookId = createId();
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-notebook-${notebookId}`,
            entity: "notebook",
            entityId: notebookId,
            op: "UPSERT",
            payload: {
              name: input.name,
              parentId: input.parentId ?? null,
              kind: input.kind,
              icon: input.icon ?? "◫",
              description: input.description ?? null,
              visibility: input.visibility,
              color: input.color ?? null,
              sortOrder: Date.now() % 100000,
            },
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      const notebook = await context.db.notebook.findUnique({ where: { id: notebookId } });
      if (!notebook) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return notebook;
    }),

  update: workspaceProcedure("MEMBER")
    .input(
      z.object({
        notebookId: z.string().min(1),
        name: z.string().trim().min(1).max(100).optional(),
        parentId: z.string().nullable().optional(),
        icon: z.string().max(16).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        visibility: z.enum(["PRIVATE", "SHARED", "WORKSPACE", "PUBLIC"]).optional(),
        color: z.string().max(32).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await context.db.notebook.findFirst({
        where: {
          id: input.notebookId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!existing) throw new ORPCError("NOT_FOUND");
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-notebook-update-${randomUUID()}`,
            entity: "notebook",
            entityId: input.notebookId,
            op: "UPSERT",
            payload: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
              ...(input.icon !== undefined ? { icon: input.icon } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
              ...(input.color !== undefined ? { color: input.color } : {}),
              ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            },
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      return context.db.notebook.findUnique({ where: { id: input.notebookId } });
    }),

  remove: workspaceProcedure("MEMBER")
    .input(z.object({ notebookId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const existing = await context.db.notebook.findFirst({
        where: {
          id: input.notebookId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!existing) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-notebook-delete-${randomUUID()}`,
            entity: "notebook",
            entityId: input.notebookId,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),
};
