import { randomUUID } from "node:crypto";

import { createId } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { getAccessiblePageIds, pushSync } from "../services/sync";

async function ensurePageAccess(
  context: {
    db: import("@notes-learning/db").Database;
    workspaceId: string;
    userId: string;
    role: import("@notes-learning/domain").Role;
  },
  pageId: string,
): Promise<void> {
  const allowed = await getAccessiblePageIds(
    context.db,
    context.workspaceId,
    context.userId,
    context.role,
  );
  if (allowed && !allowed.has(pageId)) {
    throw new ORPCError("FORBIDDEN", { message: "You do not have access to this page" });
  }
  const page = await context.db.page.findFirst({
    where: { id: pageId, workspaceId: context.workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
}

async function notifyMentions(
  context: {
    db: import("@notes-learning/db").Database;
    workspaceId: string;
    userId: string;
  },
  input: {
    pageId: string;
    body: string;
    mentions: string[];
    authorName: string;
  },
): Promise<void> {
  const targets = new Set(input.mentions.filter((id) => id !== context.userId));
  const page = await context.db.page.findFirst({
    where: { id: input.pageId, workspaceId: context.workspaceId },
    select: { title: true, createdById: true },
  });
  if (page?.createdById && page.createdById !== context.userId) {
    targets.add(page.createdById);
  }
  if (!targets.size) return;
  const members = await context.db.workspaceMember.findMany({
    where: {
      workspaceId: context.workspaceId,
      userId: { in: [...targets] },
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { userId: true },
  });
  if (!members.length) return;
  await context.db.notification.createMany({
    data: members.map((member) => ({
      id: `notif_${randomUUID()}`,
      userId: member.userId,
      workspaceId: context.workspaceId,
      type: "comment",
      title: `${input.authorName} commented on “${page?.title ?? "a page"}”`,
      body: input.body.slice(0, 240),
      href: `/app?view=page&id=${input.pageId}`,
    })),
  });
}

export const commentRouter = {
  list: workspaceProcedure("VIEWER")
    .input(z.object({ pageId: z.string().min(1), includeResolved: z.boolean().default(false) }))
    .handler(async ({ context, input }) => {
      await ensurePageAccess(context, input.pageId);
      const comments = await context.db.comment.findMany({
        where: {
          workspaceId: context.workspaceId,
          pageId: input.pageId,
          deletedAt: null,
          ...(input.includeResolved ? {} : { resolvedAt: null }),
        },
        orderBy: { createdAt: "asc" },
      });
      const users = await context.db.user.findMany({
        where: { id: { in: comments.map((comment) => comment.authorId) } },
        select: { id: true, name: true, image: true },
      });
      const userById = new Map(users.map((user) => [user.id, user]));
      const nodes = comments.map((comment) => ({
        ...comment,
        author: userById.get(comment.authorId) ?? {
          id: comment.authorId,
          name: "Unknown",
          image: null,
        },
        replies: [] as Array<unknown>,
      }));
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      const roots: typeof nodes = [];
      for (const node of nodes) {
        if (node.parentId) {
          const parent = nodeById.get(node.parentId);
          if (parent) {
            parent.replies.push(node);
            continue;
          }
        }
        roots.push(node);
      }
      return roots;
    }),

  create: workspaceProcedure("VIEWER")
    .input(
      z.object({
        pageId: z.string().min(1),
        blockId: z.string().max(128).nullable().optional(),
        parentId: z.string().max(128).nullable().optional(),
        body: z.string().trim().min(1).max(10_000),
        mentions: z.array(z.string().min(1)).max(20).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await ensurePageAccess(context, input.pageId);
      const commentId = createId();
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-comment-${commentId}`,
            entity: "comment",
            entityId: commentId,
            op: "UPSERT",
            payload: {
              pageId: input.pageId,
              blockId: input.blockId ?? null,
              parentId: input.parentId ?? null,
              body: input.body,
            },
          },
        ],
      });
      await notifyMentions(
        context,
        {
          pageId: input.pageId,
          body: input.body,
          mentions: input.mentions ?? [],
          authorName: context.session.user.name,
        },
      );
      return context.db.comment.findUnique({ where: { id: commentId } });
    }),

  resolve: workspaceProcedure("VIEWER")
    .input(z.object({ commentId: z.string().min(1), resolved: z.boolean().default(true) }))
    .handler(async ({ context, input }) => {
      const comment = await context.db.comment.findFirst({
        where: {
          id: input.commentId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!comment) throw new ORPCError("NOT_FOUND");
      await ensurePageAccess(context, comment.pageId);
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-comment-resolve-${randomUUID()}`,
            entity: "comment",
            entityId: comment.id,
            op: "UPSERT",
            payload: {
              resolvedAt: input.resolved ? new Date().toISOString() : null,
            },
          },
        ],
      });
      return context.db.comment.findUnique({ where: { id: comment.id } });
    }),

  remove: workspaceProcedure("VIEWER")
    .input(z.object({ commentId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const comment = await context.db.comment.findFirst({
        where: {
          id: input.commentId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!comment) throw new ORPCError("NOT_FOUND");
      await ensurePageAccess(context, comment.pageId);
      if (comment.authorId !== context.userId && context.role !== "OWNER" && context.role !== "ADMIN") {
        throw new ORPCError("FORBIDDEN", { message: "You can only delete your own comments" });
      }
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-comment-delete-${randomUUID()}`,
            entity: "comment",
            entityId: comment.id,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),
};
