import type { Context as ApiContext } from "@notes-learning/api/context";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

import { db } from "./services";
import { auth } from "./services";

interface CreateContextOptions {
  req: Request;
}

export async function createContext(opts: CreateContextOptions): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(opts.req.headers),
  });
  return {
    db,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
