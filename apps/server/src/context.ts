import type { Context as ApiContext } from "@notes-learning/api/context";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

import { auth, db } from "./services";
import { isCollaborating, invalidateCollabState } from "./collaboration";
import { aiConfig } from "./env.server";

interface CreateContextOptions {
  req: Request;
}

export async function createContext(opts: CreateContextOptions): Promise<ApiContext> {
  const headers = fromNodeHeaders(opts.req.headers);
  const session = await auth.api.getSession({ headers });
  return {
    db,
    session,
    ai: aiConfig,
    headers,
    collab: {
      isActive: (_workspaceId: string, pageId: string, userId: string) =>
        isCollaborating(pageId, userId),
      invalidate: (_workspaceId: string, pageId: string) => {
        void invalidateCollabState(pageId);
      },
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
