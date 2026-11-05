import { randomUUID } from "node:crypto";

import { Prisma } from "@notes-learning/db";
import {
  CANVAS_TEMPLATES,
  canvasDocument,
  createId,
  createMindMap,
  extractOutline,
  safeDoc,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { appendChanges, toJsonSafe, type PendingChange } from "../services/changes";
import { pushSync } from "../services/sync";
import { getAccessiblePageIds } from "../services/sync";

export const canvasRouter = {
  list: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    return context.db.canvas.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        workspaceId: true,
        notebookId: true,
        title: true,
        icon: true,
        rev: true,
        thumbnail: true,
        createdById: true,
        updatedById: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
  }),

  get: workspaceProcedure("VIEWER")
    .input(z.object({ canvasId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const canvas = await context.db.canvas.findFirst({
        where: {
          id: input.canvasId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!canvas) throw new ORPCError("NOT_FOUND");
      return canvas;
    }),

  create: workspaceProcedure("EDITOR")
    .input(
      z.object({
        title: z.string().trim().max(200).default("Untitled canvas"),
        notebookId: z.string().nullable().optional(),
        icon: z.string().max(16).nullable().optional(),
        templateId: z.string().max(80).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const canvasId = createId();
      const template =
        CANVAS_TEMPLATES.find((entry) => entry.id === input.templateId) ??
        CANVAS_TEMPLATES[0];
      const document = canvasDocument(template?.build());
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-canvas-${canvasId}`,
            entity: "canvas",
            entityId: canvasId,
            op: "UPSERT",
            payload: {
              title: input.title,
              icon: input.icon ?? "▦",
              notebookId: input.notebookId ?? null,
              data: document,
              schemaVersion: 1,
            },
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      const canvas = await context.db.canvas.findUnique({ where: { id: canvasId } });
      if (!canvas) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return canvas;
    }),

  fromPage: workspaceProcedure("EDITOR")
    .input(
      z.object({
        pageId: z.string().min(1),
        title: z.string().trim().max(200).optional(),
        notebookId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      if (allowed && !allowed.has(input.pageId)) throw new ORPCError("FORBIDDEN");
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: { document: true },
      });
      if (!page) throw new ORPCError("NOT_FOUND");
      const canvasId = createId();
      const document = createMindMap(
        input.title ?? page.title,
        extractOutline(safeDoc(page.document?.content)),
      );
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-canvas-from-page-${canvasId}`,
            entity: "canvas",
            entityId: canvasId,
            op: "UPSERT",
            payload: {
              title: input.title ?? `${page.title} — mind map`,
              icon: "◈",
              notebookId: input.notebookId ?? page.notebookId,
              data: document,
              schemaVersion: 1,
            },
          },
        ],
      });
      const canvas = await context.db.canvas.findUnique({ where: { id: canvasId } });
      if (!canvas) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return canvas;
    }),

  save: workspaceProcedure("EDITOR")
    .input(
      z.object({
        canvasId: z.string().min(1),
        baseRev: z.number().int().nonnegative(),
        data: z.record(z.string(), z.unknown()),
        schemaVersion: z.number().int().positive().default(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-canvas-save-${randomUUID()}`,
            entity: "canvas",
            entityId: input.canvasId,
            op: "UPSERT",
            baseRev: input.baseRev,
            payload: {
              data: input.data,
              schemaVersion: input.schemaVersion,
            },
          },
        ],
      });
      if (result.conflicts.length) {
        return { conflict: result.conflicts[0] ?? null, canvas: null };
      }
      const canvas = await context.db.canvas.findUnique({ where: { id: input.canvasId } });
      return { conflict: null, canvas };
    }),

  update: workspaceProcedure("EDITOR")
    .input(
      z.object({
        canvasId: z.string().min(1),
        title: z.string().trim().max(200).optional(),
        icon: z.string().max(16).nullable().optional(),
        notebookId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await context.db.canvas.findFirst({
        where: {
          id: input.canvasId,
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
            opId: `api-canvas-update-${randomUUID()}`,
            entity: "canvas",
            entityId: input.canvasId,
            op: "UPSERT",
            payload: {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.icon !== undefined ? { icon: input.icon } : {}),
              ...(input.notebookId !== undefined ? { notebookId: input.notebookId } : {}),
            },
          },
        ],
      });
      return context.db.canvas.findUnique({ where: { id: input.canvasId } });
    }),

  remove: workspaceProcedure("EDITOR")
    .input(z.object({ canvasId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const existing = await context.db.canvas.findFirst({
        where: {
          id: input.canvasId,
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
            opId: `api-canvas-delete-${randomUUID()}`,
            entity: "canvas",
            entityId: input.canvasId,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),

  versions: workspaceProcedure("VIEWER")
    .input(z.object({ canvasId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      return context.db.canvasVersion.findMany({
        where: { canvasId: input.canvasId, workspaceId: context.workspaceId },
        orderBy: { version: "desc" },
        take: 50,
      });
    }),

  saveVersion: workspaceProcedure("EDITOR")
    .input(z.object({ canvasId: z.string().min(1), note: z.string().max(300).optional() }))
    .handler(async ({ context, input }) => {
      const canvas = await context.db.canvas.findFirst({
        where: { id: input.canvasId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!canvas) throw new ORPCError("NOT_FOUND");
      const aggregate = await context.db.canvasVersion.aggregate({
        where: { canvasId: canvas.id },
        _max: { version: true },
      });
      return context.db.canvasVersion.create({
        data: {
          id: createId(),
          canvasId: canvas.id,
          workspaceId: context.workspaceId,
          version: (aggregate._max.version ?? 0) + 1,
          title: canvas.title,
          data: canvas.data as Prisma.InputJsonValue,
          note: input.note ?? null,
          createdById: context.userId,
        },
      });
    }),

  restoreVersion: workspaceProcedure("EDITOR")
    .input(z.object({ canvasId: z.string().min(1), versionId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const version = await context.db.canvasVersion.findFirst({
        where: {
          id: input.versionId,
          canvasId: input.canvasId,
          workspaceId: context.workspaceId,
        },
      });
      if (!version) throw new ORPCError("NOT_FOUND");
      const canvas = await context.db.canvas.findFirst({
        where: { id: input.canvasId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!canvas) throw new ORPCError("NOT_FOUND");
      const changes: PendingChange[] = [];
      const updated = await context.db.$transaction(async (tx) => {
        const aggregate = await tx.canvasVersion.aggregate({
          where: { canvasId: canvas.id },
          _max: { version: true },
        });
        await tx.canvasVersion.create({
          data: {
            id: createId(),
            canvasId: canvas.id,
            workspaceId: context.workspaceId,
            version: (aggregate._max.version ?? 0) + 1,
            title: canvas.title,
            data: canvas.data as Prisma.InputJsonValue,
            note: "Snapshot before restoring an earlier version",
            createdById: context.userId,
          },
        });
        const result = await tx.canvas.update({
          where: { id: canvas.id },
          data: {
            data: version.data as Prisma.InputJsonValue,
            rev: canvas.rev + 1,
            updatedById: context.userId,
          },
        });
        changes.push({
          entity: "canvas",
          entityId: canvas.id,
          op: "UPSERT",
          data: toJsonSafe(result),
        });
        await appendChanges(tx, context.workspaceId, context.userId, changes);
        return result;
      });
      return { canvas: updated };
    }),

  templates: workspaceProcedure("VIEWER").handler(() => {
    return CANVAS_TEMPLATES.map(({ id, name, description, category }) => ({
      id,
      name,
      description,
      category,
    }));
  }),
};
