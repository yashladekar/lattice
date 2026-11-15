import type { Context as ApiContext } from "@notes-learning/api/context";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

import { auth, chatgptCallback, db, uploadStore } from "./services";
import { isCollaborating, invalidateCollabState, resetCollabState } from "./collaboration";
import { ENV, aiAgentEnabled, aiConfig, githubConfig } from "./env.server";

interface CreateContextOptions {
  req: Request;
}

async function readUpload(
  url: string,
  access: { userId: string; workspaceId: string },
): Promise<{ bytes: Uint8Array; filename: string; mime: string } | null> {
  const uploaderId = await uploadStore.ownerOf(url);
  if (!uploaderId) return null;
  if (uploaderId !== access.userId) {
    const shared = await db.workspaceMember.findFirst({
      where: {
        workspaceId: access.workspaceId,
        userId: uploaderId,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!shared) return null;
  }
  return uploadStore.get(url);
}

export async function createContext(opts: CreateContextOptions): Promise<ApiContext> {
  const headers = fromNodeHeaders(opts.req.headers);
  const session = await auth.api.getSession({ headers });
  return {
    db,
    session,
    ai: aiConfig,
    aiAux: aiConfig,
    headers,
    uploads: { read: readUpload },
    secrets: { keyMaterial: ENV.BETTER_AUTH_SECRET },
    ...(chatgptCallback ? { chatgpt: chatgptCallback } : {}),
    ...(githubConfig ? { github: githubConfig } : {}),
    aiAgent: { enabled: aiAgentEnabled },
    collab: {
      isActive: (_workspaceId: string, resourceType, resourceId, userId) =>
        isCollaborating(resourceType, resourceId, userId),
      invalidate: (_workspaceId: string, resourceType, resourceId) => {
        void invalidateCollabState(resourceType, resourceId);
      },
      reset: async (_workspaceId: string, resourceType, resourceId) => {
        await resetCollabState(resourceType, resourceId);
      },
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
