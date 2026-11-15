import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StoredUpload = {
  bytes: Uint8Array;
  filename: string;
  mime: string;
};

export type PresignedUpload = {
  uploadUrl: string;
  headers: Record<string, string>;
};

/**
 * Uploads live either on the host's disk (self-hosting) or in an
 * S3-compatible bucket (serverless). Both keep an uploader id beside the file
 * so a read can tell whether the caller may have the bytes.
 */
export interface UploadStore {
  /** True when the browser can upload straight to the bucket. */
  readonly presignable: boolean;
  /** Set when the host serves the files itself. */
  readonly localRoot?: string;
  urlFor(filename: string): string;
  put(filename: string, bytes: Uint8Array, mime: string, userId: string): Promise<void>;
  presign(
    filename: string,
    mime: string,
    userId: string,
  ): Promise<PresignedUpload | null>;
  ownerOf(url: string): Promise<string | null>;
  get(url: string): Promise<StoredUpload | null>;
}

export type S3UploadOptions = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
};

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

/** Formats the browser may render inline; everything else downloads. */
const INLINE_UPLOAD_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".mp4",
  ".webm",
]);

export function isInlineUpload(filename: string): boolean {
  return INLINE_UPLOAD_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

export function uploadDisposition(filename: string): "inline" | "attachment" {
  return isInlineUpload(filename) ? "inline" : "attachment";
}

function mimeFor(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * The client may only influence the extension, never the path. A generated
 * name keeps directory traversal and hosting of executable names impossible.
 */
export function uploadFilename(rawName: string): string {
  const extension = path
    .extname(rawName)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "")
    .slice(0, 10);
  return `${randomUUID()}${extension}`;
}

export function isUploadFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    !filename.startsWith(".") &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !filename.includes("..")
  );
}

function filenameFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/uploads/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname.slice("/uploads/".length));
  } catch {
    return null;
  }
  return isUploadFilename(decoded) ? decoded : null;
}

/** Accepts both legacy relative URLs and absolute public bucket URLs. */
function filenameFromUrl(url: string, publicBase: string | null): string | null {
  if (url.startsWith("/uploads/")) return filenameFromPath(url);
  if (!publicBase) return null;
  const base = publicBase.replace(/\/$/, "");
  if (!url.startsWith(`${base}/uploads/`)) return null;
  return filenameFromPath(url.slice(base.length));
}

export function createLocalUploadStore(root: string): UploadStore {
  const metaDirectory = path.join(root, ".meta");

  return {
    presignable: false,
    localRoot: root,
    urlFor: (filename) => `/uploads/${encodeURIComponent(filename)}`,

    async put(filename, bytes, mime, userId) {
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, filename), bytes);
      await mkdir(metaDirectory, { recursive: true });
      await writeFile(
        path.join(metaDirectory, `${filename}.json`),
        JSON.stringify({ userId, mime }),
      );
    },

    async presign() {
      return null;
    },

    async ownerOf(url) {
      const filename = filenameFromUrl(url, null);
      if (!filename) return null;
      try {
        const meta = JSON.parse(
          await readFile(path.join(metaDirectory, `${filename}.json`), "utf8"),
        ) as { userId?: unknown };
        return typeof meta.userId === "string" ? meta.userId : null;
      } catch {
        // No ownership record (or an unreadable one): the API cannot hand it out.
        return null;
      }
    },

    async get(url) {
      const filename = filenameFromUrl(url, null);
      if (!filename) return null;
      try {
        const bytes = await readFile(path.join(root, filename));
        return { bytes: new Uint8Array(bytes), filename, mime: mimeFor(filename) };
      } catch {
        return null;
      }
    },
  };
}

export function createS3UploadStore(options: S3UploadOptions): UploadStore {
  const client = new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    forcePathStyle: options.forcePathStyle,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    // A presigned PUT carries no body while it is being signed. The default
    // flexible-checksum middleware would sign a checksum of an empty body and
    // every real upload would then fail with a mismatch.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const publicBase = options.publicUrl.replace(/\/$/, "");
  const keyFor = (filename: string) => `uploads/${filename}`;

  return {
    presignable: true,
    urlFor: (filename) => `${publicBase}/uploads/${encodeURIComponent(filename)}`,

    async put(filename, bytes, mime, userId) {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: keyFor(filename),
          Body: bytes,
          ContentType: mime,
          ContentDisposition: uploadDisposition(filename),
          Metadata: { userid: userId },
        }),
      );
    },

    async presign(filename, mime, userId) {
      const disposition = uploadDisposition(filename);
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: keyFor(filename),
        ContentType: mime,
        ...(disposition === "attachment" ? { ContentDisposition: "attachment" } : {}),
        Metadata: { userid: userId },
      });
      const unhoistableHeaders = new Set(["x-amz-meta-userid"]);
      if (disposition === "attachment") unhoistableHeaders.add("content-disposition");
      const uploadUrl = await getSignedUrl(client, command, {
        expiresIn: 10 * 60,
        // Keep ownership in SignedHeaders: a browser sends it back, and the
        // signature refuses a value the presign did not issue.
        unhoistableHeaders,
      });
      return {
        uploadUrl,
        headers: {
          "content-type": mime,
          "x-amz-meta-userid": userId,
          ...(disposition === "attachment"
            ? { "content-disposition": "attachment" }
            : {}),
        },
      };
    },

    async ownerOf(url) {
      const filename = filenameFromUrl(url, publicBase);
      if (!filename) return null;
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: options.bucket, Key: keyFor(filename) }),
        );
        return head.Metadata?.userid ?? null;
      } catch {
        return null;
      }
    },

    async get(url) {
      const filename = filenameFromUrl(url, publicBase);
      if (!filename) return null;
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: keyFor(filename) }),
        );
        if (!response.Body) return null;
        const bytes = await response.Body.transformToByteArray();
        return {
          bytes,
          filename,
          mime: response.ContentType ?? mimeFor(filename),
        };
      } catch {
        return null;
      }
    },
  };
}

export function createUploadStore(options: {
  driver: "local" | "s3";
  localRoot: string;
  s3: S3UploadOptions | null;
}): UploadStore {
  if (options.driver === "s3") {
    if (!options.s3) throw new Error("S3 uploads selected without configuration");
    return createS3UploadStore(options.s3);
  }
  return createLocalUploadStore(options.localRoot);
}
