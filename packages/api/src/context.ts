import type { Session } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";

export type AiConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  embeddingModel?: string;
};

export type Context = {
  session: Session | null;
  db: Database;
  ai: AiConfig | null;
  headers: Headers;
  /** Present when the API is hosted by a server that runs live sessions. */
  collab?: {
    isActive(workspaceId: string, pageId: string, userId: string): boolean;
    invalidate(workspaceId: string, pageId: string): void;
  };
};
