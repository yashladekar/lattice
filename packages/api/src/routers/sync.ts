import {
  syncPullInput,
  syncPushInput,
  type SyncOpInput,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { snapshotPage } from "../services/snapshot";
import { pullSync, pushSync, resolveSyncConflict } from "../services/sync";

export const syncRouter = {
  resetCollab: workspaceProcedure("EDITOR")
    .input(z.object({ pageId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
      await context.collab?.reset(context.workspaceId, "page", input.pageId);
      return { ok: true };
    }),

  snapshot: workspaceProcedure("VIEWER")
    .input(
      z.object({
        workspaceId: z.string().min(1),
        cursor: z.string().max(4_000).nullish(),
        pageSize: z.number().int().min(1).max(2_000).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return snapshotPage(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        role: context.role,
        cursor: input.cursor ?? null,
        pageSize: input.pageSize,
      });
    }),

  pull: workspaceProcedure("VIEWER")
    .input(syncPullInput.omit({ workspaceId: true }))
    .handler(async ({ context, input }) => {
      return pullSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        cursor: input.cursor ?? null,
        limit: input.limit,
      });
    }),

  push: workspaceProcedure("EDITOR")
    .input(syncPushInput.omit({ workspaceId: true }))
    .handler(async ({ context, input }) => {
      return pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: input.ops as SyncOpInput[],
        isCollaborating: context.collab
          ? (pageId: string) =>
              context.collab!.isActive(context.workspaceId, pageId, context.userId)
          : undefined,
        invalidateCollab: context.collab
          ? (resourceType, resourceId) =>
              context.collab!.invalidate(context.workspaceId, resourceType, resourceId)
          : undefined,
      });
    }),

  resolveConflict: workspaceProcedure("EDITOR")
    .input(
      z.object({
        conflictId: z.string().min(1),
        resolution: z.enum(["KEEP_LOCAL", "KEEP_REMOTE"]),
        content: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      return resolveSyncConflict(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        conflictId: input.conflictId,
        resolution: input.resolution,
        content: input.content,
      });
    }),

  conflicts: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    return context.db.syncConflict.findMany({
      where: {
        workspaceId: context.workspaceId,
        userId: context.userId,
        resolvedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
  }),
};
