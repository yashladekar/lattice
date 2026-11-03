import { randomUUID } from "node:crypto";

import { createId, safeDoc } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { getAccessiblePageIds, pushSync } from "../services/sync";

export const templateRouter = {
  list: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    return context.db.template.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
  }),

  createFromPage: workspaceProcedure("EDITOR")
    .input(
      z.object({
        pageId: z.string().min(1),
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500).nullable().optional(),
        icon: z.string().max(16).nullable().optional(),
        category: z.string().max(50).default("Writing"),
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
      if (!page?.document) throw new ORPCError("NOT_FOUND");
      const templateId = createId();
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-template-${templateId}`,
            entity: "template",
            entityId: templateId,
            op: "UPSERT",
            payload: {
              name: input.name,
              description: input.description ?? null,
              icon: input.icon ?? page.icon ?? "◇",
              category: input.category,
              content: safeDoc(page.document.content),
              properties: page.properties,
            },
          },
        ],
      });
      return context.db.template.findUnique({ where: { id: templateId } });
    }),

  remove: workspaceProcedure("EDITOR")
    .input(z.object({ templateId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const template = await context.db.template.findFirst({
        where: {
          id: input.templateId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!template) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-template-delete-${randomUUID()}`,
            entity: "template",
            entityId: template.id,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),

  update: workspaceProcedure("EDITOR")
    .input(
      z.object({
        templateId: z.string().min(1),
        name: z.string().trim().min(1).max(100).optional(),
        description: z.string().max(500).nullable().optional(),
        category: z.string().max(50).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const template = await context.db.template.findFirst({
        where: {
          id: input.templateId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!template) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-template-update-${randomUUID()}`,
            entity: "template",
            entityId: template.id,
            op: "UPSERT",
            payload: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.description !== undefined ? { description: input.description } : {}),
              ...(input.category !== undefined ? { category: input.category } : {}),
            },
          },
        ],
      });
      return context.db.template.findUnique({ where: { id: template.id } });
    }),
};

export const attachmentRouter = {
  list: workspaceProcedure("VIEWER")
    .input(z.object({ pageId: z.string().optional() }).optional())
    .handler(async ({ context, input }) => {
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      const attachments = await context.db.attachment.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          ...(input?.pageId ? { pageId: input.pageId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      return attachments.filter(
        (attachment) =>
          !allowed || !attachment.pageId || allowed.has(attachment.pageId),
      );
    }),

  remove: workspaceProcedure("EDITOR")
    .input(z.object({ attachmentId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const attachment = await context.db.attachment.findFirst({
        where: {
          id: input.attachmentId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!attachment) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-attachment-delete-${randomUUID()}`,
            entity: "attachment",
            entityId: attachment.id,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),
};
