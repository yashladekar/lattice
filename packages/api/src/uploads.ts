import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RequestHandler } from "express";

/**
 * Authenticated file upload. The body is a raw file; the name comes from the
 * `x-file-name` header and only its extension is kept, so a client cannot pick
 * a path. Files are stored under a generated name and served by the static
 * handler, which decides what may run inline.
 */
export interface UploadHandlerOptions {
  uploadRoot: string;
  /** Resolves the signed-in user, or null when the request is anonymous. */
  authenticate: (headers: Record<string, string | string[] | undefined>) => Promise<{
    userId: string;
  } | null>;
}

export function createUploadHandler(options: UploadHandlerOptions): RequestHandler {
  return async (req, res) => {
    const session = await options.authenticate(req.headers);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }
    const rawName = (() => {
      const header = String(req.headers["x-file-name"] ?? "upload");
      try {
        return decodeURIComponent(header);
      } catch {
        return header;
      }
    })();
    const extension = path
      .extname(rawName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "")
      .slice(0, 10);
    const filename = `${randomUUID()}${extension}`;
    await mkdir(options.uploadRoot, { recursive: true });
    await writeFile(path.join(options.uploadRoot, filename), req.body);
    res.json({
      id: randomUUID(),
      url: `/uploads/${filename}`,
      name: path.basename(rawName).slice(0, 200),
      size: req.body.length,
      mime: String(req.headers["content-type"] ?? "application/octet-stream"),
    });
  };
}
