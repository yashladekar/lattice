import { createId } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { createToken, hashToken, isShareActive, writeAudit } from "../authz";
import { publicProcedure, workspaceProcedure } from "../index";
import { appendChanges, toJsonSafe } from "../services/changes";
import { publicDocument, resolvePublicPage } from "../services/share-page";
import { assertPageAccess } from "../services/page-access";
import { getAccessiblePageIds } from "../services/sync";

function publicCanvasData(value: unknown) {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { elements?: unknown }).elements)
  ) {
    return { version: 1, elements: [] };
  }
  const data = value as { version: 1; elements: Array<Record<string, unknown>>; background?: string };
  return {
    ...data,
    elements: data.elements.filter(
      (element) => element.type !== "page" && element.type !== "canvas",
    ),
  };
}

export const shareRouter = {
  create: workspaceProcedure("MEMBER")
    .input(
      z.object({
        resourceType: z.enum(["PAGE", "CANVAS", "NOTEBOOK", "GRAPH"]),
        resourceId: z.string().min(1),
        permission: z.enum(["VIEW", "COMMENT", "EDIT"]).default("VIEW"),
        includeSubPages: z.boolean().default(false),
        expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (input.resourceType === "PAGE") {
        const allowed = await getAccessiblePageIds(
          context.db,
          context.workspaceId,
          context.userId,
          context.role,
        );
        if (allowed && !allowed.has(input.resourceId)) throw new ORPCError("FORBIDDEN");
        const page = await context.db.page.findFirst({
          where: {
            id: input.resourceId,
            workspaceId: context.workspaceId,
            deletedAt: null,
          },
        });
        if (!page) throw new ORPCError("NOT_FOUND");
        await assertPageAccess(context.db, page, context.userId, context.role, "write");
      } else if (input.resourceType === "CANVAS") {
        const canvas = await context.db.canvas.findFirst({
          where: {
            id: input.resourceId,
            workspaceId: context.workspaceId,
            deletedAt: null,
          },
        });
        if (!canvas) throw new ORPCError("NOT_FOUND");
      } else if (input.resourceType === "NOTEBOOK") {
        const notebook = await context.db.notebook.findFirst({
          where: {
            id: input.resourceId,
            workspaceId: context.workspaceId,
            deletedAt: null,
          },
        });
        if (!notebook) throw new ORPCError("NOT_FOUND");
      } else if (input.resourceId !== context.workspaceId) {
        throw new ORPCError("BAD_REQUEST", { message: "Graph shares are workspace-wide" });
      }

      const { token, tokenHash } = createToken();
      const expiresAt =
        input.expiresInDays && input.expiresInDays > 0
          ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
          : null;
      const share = await context.db.shareLink.create({
        data: {
          id: createId(),
          workspaceId: context.workspaceId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          tokenHash,
          permission: input.permission,
          includeSubPages: input.resourceType === "PAGE" ? input.includeSubPages : false,
          expiresAt,
          createdById: context.userId,
        },
      });
      if (input.resourceType === "PAGE") {
        const page = await context.db.page.findFirst({
          where: { id: input.resourceId, workspaceId: context.workspaceId },
        });
        if (page && !page.publishedAt) {
          const updated = await context.db.$transaction(async (tx) => {
            const result = await tx.page.update({
              where: { id: page.id },
              data: { publishedAt: new Date() },
            });
            await appendChanges(tx, context.workspaceId, context.userId, [
              { entity: "page", entityId: result.id, op: "UPSERT", data: toJsonSafe(result) },
            ]);
            return result;
          });
          void updated;
        }
      }
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "share.created",
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      });
      return {
        id: share.id,
        token,
        permission: share.permission,
        includeSubPages: share.includeSubPages,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        resourceType: share.resourceType,
        resourceId: share.resourceId,
      };
    }),

  list: workspaceProcedure("VIEWER")
    .input(
      z
        .object({
          resourceType: z.enum(["PAGE", "CANVAS", "NOTEBOOK", "GRAPH"]).optional(),
          resourceId: z.string().optional(),
        })
        .optional(),
    )
    .handler(async ({ context, input }) => {
      const shares = await context.db.shareLink.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(input?.resourceType ? { resourceType: input.resourceType } : {}),
          ...(input?.resourceId ? { resourceId: input.resourceId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      return shares.map(({ tokenHash: _tokenHash, ...share }) => share);
    }),

  update: workspaceProcedure("MEMBER")
    .input(
      z.object({
        shareId: z.string().min(1),
        includeSubPages: z.boolean(),
      }),
    )
    .handler(async ({ context, input }) => {
      const share = await context.db.shareLink.findFirst({
        where: { id: input.shareId, workspaceId: context.workspaceId },
      });
      if (!share) throw new ORPCError("NOT_FOUND");
      if (share.resourceType !== "PAGE") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Only page links can include sub-pages",
        });
      }
      if (
        share.createdById !== context.userId &&
        context.role !== "OWNER" &&
        context.role !== "ADMIN"
      ) {
        throw new ORPCError("FORBIDDEN");
      }
      const updated = await context.db.shareLink.update({
        where: { id: share.id },
        data: { includeSubPages: input.includeSubPages },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "share.updated",
        resourceType: "PAGE",
        resourceId: share.resourceId,
      });
      return { id: updated.id, includeSubPages: updated.includeSubPages };
    }),

  revoke: workspaceProcedure("MEMBER")
    .input(z.object({ shareId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const share = await context.db.shareLink.findFirst({
        where: { id: input.shareId, workspaceId: context.workspaceId },
      });
      if (!share) throw new ORPCError("NOT_FOUND");
      if (share.createdById !== context.userId && context.role !== "OWNER" && context.role !== "ADMIN") {
        throw new ORPCError("FORBIDDEN");
      }
      await context.db.shareLink.update({
        where: { id: share.id },
        data: { revokedAt: new Date() },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "share.revoked",
        resourceType: share.resourceType,
        resourceId: share.resourceId,
      });
      return { ok: true };
    }),

  public: publicProcedure
    .input(
      z.object({
        token: z.string().min(8).max(256),
        type: z.enum(["PAGE", "CANVAS", "NOTEBOOK", "GRAPH"]).optional(),
        pageId: z.string().min(1).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const share = await context.db.shareLink.findUnique({
        where: { tokenHash: hashToken(input.token) },
      });
      if (!share) throw new ORPCError("NOT_FOUND", { message: "This link is not available" });
      if (!isShareActive(share)) {
        throw new ORPCError("GONE", { message: "This link has expired or was revoked" });
      }
      if (input.type && share.resourceType !== input.type) {
        throw new ORPCError("BAD_REQUEST", { message: "This link points to a different resource" });
      }
      const workspace = await context.db.workspace.findFirst({
        where: { id: share.workspaceId, deletedAt: null },
        select: { id: true, name: true, icon: true, accent: true },
      });
      if (!workspace) throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });

      if (share.resourceType === "PAGE") {
        const resolved = await resolvePublicPage(context.db, {
          workspaceId: share.workspaceId,
          rootPageId: share.resourceId,
          includeSubPages: share.includeSubPages,
          pageId: input.pageId ?? null,
        });
        return {
          type: "PAGE" as const,
          workspace,
          ...resolved,
          permission: share.permission,
        };
      }

      if (share.resourceType === "CANVAS") {
        const canvas = await context.db.canvas.findFirst({
          where: { id: share.resourceId, workspaceId: share.workspaceId, deletedAt: null },
        });
        if (!canvas) throw new ORPCError("NOT_FOUND", { message: "Canvas not found" });
        return {
          type: "CANVAS" as const,
          workspace,
          canvas: {
            id: canvas.id,
            title: canvas.title,
            icon: canvas.icon,
            data: publicCanvasData(canvas.data),
            updatedAt: canvas.updatedAt.toISOString(),
          },
          permission: share.permission,
        };
      }

      if (share.resourceType === "NOTEBOOK") {
        const notebook = await context.db.notebook.findFirst({
          where: { id: share.resourceId, workspaceId: share.workspaceId, deletedAt: null },
        });
        if (!notebook) throw new ORPCError("NOT_FOUND", { message: "Notebook not found" });
        const pages = await context.db.page.findMany({
          where: {
            notebookId: notebook.id,
            workspaceId: share.workspaceId,
            deletedAt: null,
            visibility: { not: "PRIVATE" },
          },
          include: { document: true },
          orderBy: { sortOrder: "asc" },
        });
        return {
          type: "NOTEBOOK" as const,
          workspace,
          notebook,
          pages: pages.map((page) => ({
            id: page.id,
            title: page.title,
            icon: page.icon,
            updatedAt: page.updatedAt.toISOString(),
            document: publicDocument(page.document?.content, new Set(pages.map((entry) => entry.id))),
          })),
          permission: share.permission,
        };
      }

      const pages = await context.db.page.findMany({
        where: {
          workspaceId: share.workspaceId,
          deletedAt: null,
          visibility: { not: "PRIVATE" },
        },
        select: { id: true },
      });
      const pageIds = new Set(pages.map((page) => page.id));
      const [nodes, edges] = await Promise.all([
        context.db.knowledgeNode.findMany({
          where: { workspaceId: share.workspaceId, deletedAt: null },
        }),
        context.db.knowledgeEdge.findMany({
          where: { workspaceId: share.workspaceId, deletedAt: null },
        }),
      ]);
      const visibleNodes = nodes.filter(
        (node) => !node.pageId || pageIds.has(node.pageId),
      );
      const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
      return {
        type: "GRAPH" as const,
        workspace,
        nodes: visibleNodes,
        edges: edges.filter(
          (edge) =>
            visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId),
        ),
        permission: share.permission,
      };
    }),

  preview: publicProcedure
    .input(z.object({ token: z.string().min(8).max(256) }))
    .handler(async ({ context, input }) => {
      const share = await context.db.shareLink.findUnique({
        where: { tokenHash: hashToken(input.token) },
        select: {
          id: true,
          resourceType: true,
          resourceId: true,
          permission: true,
          expiresAt: true,
          revokedAt: true,
          workspaceId: true,
        },
      });
      if (!share || !isShareActive(share)) {
        throw new ORPCError("NOT_FOUND", { message: "This link is not available" });
      }
      return share;
    }),

  revokeAllForResource: workspaceProcedure("MEMBER")
    .input(
      z.object({
        resourceType: z.enum(["PAGE", "CANVAS", "NOTEBOOK", "GRAPH"]),
        resourceId: z.string().min(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await context.db.shareLink.updateMany({
        where: {
          workspaceId: context.workspaceId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      return { revoked: result.count };
    }),
};
