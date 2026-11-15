import path from "node:path";

import type { RequestHandler } from "express";

import { uploadFilename, type UploadStore } from "./upload-store";

/**
 * Authenticated file upload. The body is a raw file; the name comes from the
 * `x-file-name` header and only its extension is kept, so a client cannot pick
 * a path. Files are stored under a generated name and served by the static
 * handler (local) or the bucket's public URL (S3).
 */
export interface UploadHandlerOptions {
  store: UploadStore;
  /** Resolves the signed-in user, or null when the request is anonymous. */
  authenticate: (headers: Record<string, string | string[] | undefined>) => Promise<{
    userId: string;
  } | null>;
}

export interface PresignHandlerOptions extends UploadHandlerOptions {
  maxBytes?: number;
}

function rawNameFromHeader(value: string | string[] | undefined): string {
  const header = String(value ?? "upload");
  try {
    return decodeURIComponent(header);
  } catch {
    return header;
  }
}

function displayName(rawName: string): string {
  return path.basename(rawName).slice(0, 200);
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
    const rawName = rawNameFromHeader(req.headers["x-file-name"]);
    const filename = uploadFilename(rawName);
    const mime = String(req.headers["content-type"] ?? "application/octet-stream");
    await options.store.put(filename, req.body, mime, session.userId);
    res.json({
      id: filename,
      url: options.store.urlFor(filename),
      name: displayName(rawName),
      size: req.body.length,
      mime,
    });
  };
}

/**
 * Hands the browser a signed PUT so files larger than a serverless request
 * body limit go straight to the bucket. Returns 501 when the host writes to
 * its own disk, and the client falls back to the raw POST above.
 */
export function createPresignHandler(options: PresignHandlerOptions): RequestHandler {
  return async (req, res) => {
    const session = await options.authenticate(req.headers);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!options.store.presignable) {
      res.status(501).json({ error: "Direct uploads are not enabled" });
      return;
    }

    const body = req.body as
      | { name?: unknown; mime?: unknown; size?: unknown }
      | undefined;
    const rawName = typeof body?.name === "string" && body.name ? body.name : "upload";
    const mime =
      typeof body?.mime === "string" && body.mime ? body.mime : "application/octet-stream";
    const size = typeof body?.size === "number" && body.size > 0 ? body.size : 0;
    if (options.maxBytes && size > options.maxBytes) {
      res.status(413).json({ error: "File is too large" });
      return;
    }

    const filename = uploadFilename(rawName);
    const signed = await options.store.presign(filename, mime, session.userId);
    if (!signed) {
      res.status(501).json({ error: "Direct uploads are not enabled" });
      return;
    }

    res.json({
      id: filename,
      url: options.store.urlFor(filename),
      name: displayName(rawName),
      size,
      mime,
      uploadUrl: signed.uploadUrl,
      headers: signed.headers,
    });
  };
}
