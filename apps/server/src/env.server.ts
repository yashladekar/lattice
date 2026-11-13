import "varlock/auto-load";

import path from "node:path";

import type { AiConfig } from "@notes-learning/api/context";

import { ENV } from "./env";

export { ENV };

/** Packaged desktop builds serve the frontend from their own origin, not CORS_ORIGIN. */
export const desktopOrigins = ["tauri://localhost", "http://tauri.localhost"];

export const aiConfig: AiConfig | null = process.env.AI_API_KEY
  ? {
      baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL ?? "gpt-4.1-mini",
      embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
      transcribeModel: process.env.AI_TRANSCRIBE_MODEL ?? "whisper-1",
    }
  : null;

export const uploadDirectory = process.env.UPLOAD_DIR ?? "./storage/uploads";
export const uploadRoot = path.resolve(process.cwd(), uploadDirectory);

/**
 * Experimental: lets Ask read pages and propose changes. Off unless explicitly
 * enabled, so the whole agent surface can be switched off without a deploy.
 */
export const aiAgentEnabled =
  process.env.AI_AGENT_ENABLED === "true" || ENV.AI_AGENT_ENABLED === true;

/**
 * Experimental: the GitHub device-flow connection. Off unless both the flag and
 * a client id are present, so a deployment without an OAuth App keeps the
 * existing manual-token import untouched.
 */
const githubClientId = process.env.GITHUB_CLIENT_ID ?? ENV.GITHUB_CLIENT_ID;
export const githubConfig =
  (process.env.GITHUB_CONNECT_ENABLED === "true" || ENV.GITHUB_CONNECT_ENABLED === true) &&
  githubClientId
    ? { clientId: githubClientId }
    : null;
