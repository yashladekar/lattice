import "varlock/auto-load";

import type { AiConfig } from "@notes-learning/api/context";

export { ENV } from "./env";

/** Packaged desktop builds serve the frontend from their own origin, not CORS_ORIGIN. */
export const desktopOrigins = ["tauri://localhost", "http://tauri.localhost"];

export const aiConfig: AiConfig | null = process.env.AI_API_KEY
  ? {
      baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.AI_API_KEY,
      model: process.env.AI_MODEL ?? "gpt-4.1-mini",
      embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    }
  : null;

export const uploadDirectory = process.env.UPLOAD_DIR ?? "./storage/uploads";
