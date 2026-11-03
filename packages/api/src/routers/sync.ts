import {
  syncPullInput,
  syncPushInput,
  type SyncOpInput,
} from "@notes-learning/domain";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { pullSync, pushSync, resolveSyncConflict, syncSnapshot } from "../services/sync";

export const syncRouter = {
  snapshot: workspaceProcedure("VIEWER")
    .input(z.object({ workspaceId: z.string().min(1) }))
    .handler(async ({ context }) => {
      return syncSnapshot(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
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
          ? (pageId: string) => context.collab!.invalidate(context.workspaceId, pageId)
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
