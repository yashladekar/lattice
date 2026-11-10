import type { Session } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";

export type AiConfig = {
  baseUrl: string;
  /** An API key, or a short-lived OAuth access token when `auth` is "chatgpt". */
  apiKey: string;
  model: string;
  auth?: "apiKey" | "chatgpt";
  embeddingModel?: string;
  transcribeModel?: string;
};

export type Context = {
  session: Session | null;
  db: Database;
  /** Provider used for chat. May be backed by the user's ChatGPT plan. */
  ai: AiConfig | null;
  /**
   * Provider used for embeddings and audio transcription. Always API-key
   * backed: ChatGPT plan usage covers the Responses API only.
   */
  aiAux?: AiConfig | null;
  aiSource?: "chatgpt" | "workspace" | "deployment" | "none";
  aiChatGpt?: {
    connected: boolean;
    email: string | null;
    name: string | null;
    planEnabled: boolean;
    lastError: string | null;
  } | null;
  aiDegradedReason?: string | null;
  /** Experimental plan-mode agent. Absent or disabled hides the whole surface. */
  aiAgent?: { enabled: boolean };
  headers: Headers;
  /** Present when the API is hosted by a server that runs live sessions. */
  collab?: {
    isActive(workspaceId: string, pageId: string, userId: string): boolean;
    invalidate(workspaceId: string, pageId: string): void;
    /** Drops the stored CRDT and any live room for a page, forcing a re-seed. */
    reset(workspaceId: string, pageId: string): Promise<void>;
  };
  /** Present when the API is hosted by a server that owns the upload directory. */
  uploads?: {
    read(url: string): Promise<{ bytes: Uint8Array; filename: string; mime: string } | null>;
  };
  /** Present when the host can encrypt workspace secrets (SSO client secrets, AI keys). */
  secrets?: {
    keyMaterial: string;
  };
  /**
   * Present when the host can open a loopback listener for the Sign in with
   * ChatGPT callback. `redirect_uri` must stay on 127.0.0.1.
   */
  chatgpt?: {
    startListener(): Promise<{ redirectUri: string }>;
  };
};
