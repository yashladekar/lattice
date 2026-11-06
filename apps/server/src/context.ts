import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Context as ApiContext } from "@notes-learning/api/context";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";

import { auth, db } from "./services";
import { isCollaborating, invalidateCollabState } from "./collaboration";
import { aiConfig, uploadRoot } from "./env.server";

interface CreateContextOptions {
  req: Request;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  mp4: "audio/mp4",
};

async function readUpload(
  url: string,
): Promise<{ bytes: Uint8Array; filename: string; mime: string } | null> {
  if (!url.startsWith("/uploads/")) return null;
  const filename = path.basename(url);
  if (!filename || filename.startsWith(".")) return null;
  const filePath = path.resolve(uploadRoot, filename);
  if (!filePath.startsWith(uploadRoot + path.sep)) return null;
  try {
    const bytes = await readFile(filePath);
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    return {
      bytes: new Uint8Array(bytes),
      filename,
      mime: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export async function createContext(opts: CreateContextOptions): Promise<ApiContext> {
  const headers = fromNodeHeaders(opts.req.headers);
  const session = await auth.api.getSession({ headers });
  return {
    db,
    session,
    ai: aiConfig,
    headers,
    uploads: { read: readUpload },
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
