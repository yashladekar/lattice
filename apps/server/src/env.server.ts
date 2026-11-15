/**
 * Server configuration. Varlock resolves `.env` and validates it in development
 * and in the Docker image. On Vercel it must not run: auto-load spawns the CLI
 * on every cold start and calls `process.exit()` on a validation error, which
 * turns a bad variable into a dead function instead of a readable response.
 */
if (!process.env.VERCEL) {
  await import("varlock/auto-load");
}

import path from "node:path";

import type { AiConfig } from "@notes-learning/api/context";
import { z } from "zod";

/** Varlock writes optional keys as empty strings; treat those as absent. */
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(emptyToUndefined, schema.optional());

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  CORS_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  UPLOAD_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: optional(z.string().min(1)),
  UPLOAD_MAX_BYTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(25 * 1024 * 1024),
  ),
  S3_ENDPOINT: optional(z.string().url()),
  S3_REGION: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("auto"),
  ),
  S3_BUCKET: optional(z.string().min(1)),
  S3_ACCESS_KEY_ID: optional(z.string().min(1)),
  S3_SECRET_ACCESS_KEY: optional(z.string().min(1)),
  S3_PUBLIC_URL: optional(z.string().url()),
  S3_FORCE_PATH_STYLE: z.preprocess(emptyToUndefined, booleanString.optional()),
  CRON_SECRET: optional(z.string().min(16)),
  POLAR_ACCESS_TOKEN: optional(z.string().min(1)),
  POLAR_SUCCESS_URL: optional(z.string().url()),
  AI_BASE_URL: optional(z.string().url()),
  AI_API_KEY: optional(z.string().min(1)),
  AI_MODEL: optional(z.string().min(1)),
  AI_EMBEDDING_MODEL: optional(z.string().min(1)),
  AI_TRANSCRIBE_MODEL: optional(z.string().min(1)),
  AI_AGENT_ENABLED: z.preprocess(emptyToUndefined, booleanString.optional()),
  GITHUB_CONNECT_ENABLED: z.preprocess(emptyToUndefined, booleanString.optional()),
  GITHUB_CLIENT_ID: optional(z.string().min(1)),
  GITHUB_CLIENT_SECRET: optional(z.string().min(1)),
  GITHUB_REDIRECT_URI: optional(z.string().url()),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid server environment", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid server environment");
}

export const ENV = parsed.data;

/** Packaged desktop builds serve the frontend from their own origin, not CORS_ORIGIN. */
export const desktopOrigins = ["tauri://localhost", "http://tauri.localhost"];

export const aiConfig: AiConfig | null = ENV.AI_API_KEY
  ? {
      baseUrl: ENV.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: ENV.AI_API_KEY,
      model: ENV.AI_MODEL ?? "gpt-4.1-mini",
      embeddingModel: ENV.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      transcribeModel: ENV.AI_TRANSCRIBE_MODEL ?? "whisper-1",
    }
  : null;

export const uploadDirectory = ENV.UPLOAD_DIR ?? "./storage/uploads";
export const uploadRoot = path.resolve(process.cwd(), uploadDirectory);

/**
 * Experimental: lets Ask read pages and propose changes. Off unless explicitly
 * enabled, so the whole agent surface can be switched off without a deploy.
 */
export const aiAgentEnabled = ENV.AI_AGENT_ENABLED === true;

/**
 * Experimental: the GitHub connection. Off unless both the flag and a client id
 * are present, so a deployment without an OAuth App keeps the existing
 * manual-token import untouched. A client secret opts into the callback flow;
 * without one the server offers the device flow instead.
 */
export const githubConfig = ENV.GITHUB_CONNECT_ENABLED
  ? {
      // Present but null when the flag is on and the OAuth App is not set up
      // yet, so the UI can show what to configure instead of hiding silently.
      clientId: ENV.GITHUB_CLIENT_ID || null,
      clientSecret: ENV.GITHUB_CLIENT_SECRET || null,
      redirectUri:
        ENV.GITHUB_REDIRECT_URI ??
        new URL("/api/github/callback", ENV.BETTER_AUTH_URL).toString(),
    }
  : null;

export type S3UploadConfig = {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  forcePathStyle: boolean;
};

function readS3Config(): S3UploadConfig | null {
  if (ENV.UPLOAD_DRIVER !== "s3") return null;
  const missing = (
    ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const
  ).filter((key) => !ENV[key]);
  if (missing.length) {
    throw new Error(`UPLOAD_DRIVER=s3 requires ${missing.join(", ")}`);
  }
  return {
    endpoint: ENV.S3_ENDPOINT,
    region: ENV.S3_REGION,
    bucket: ENV.S3_BUCKET as string,
    accessKeyId: ENV.S3_ACCESS_KEY_ID as string,
    secretAccessKey: ENV.S3_SECRET_ACCESS_KEY as string,
    publicUrl: ENV.S3_PUBLIC_URL as string,
    forcePathStyle: ENV.S3_FORCE_PATH_STYLE ?? false,
  };
}

export const uploadConfig = {
  driver: ENV.UPLOAD_DRIVER,
  maxBytes: ENV.UPLOAD_MAX_BYTES,
  s3: readS3Config(),
};
