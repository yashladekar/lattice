import { decryptAiKey } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";

import { SIWC } from "../ai/chatgpt";
import type { AiConfig } from "../context";
import {
  chatGptAccessToken,
  getUserChatGptConnection,
  type ChatGptConnectionRecord,
} from "./chatgpt-connection";

export type AiBackend = "chatgpt" | "workspace" | "deployment";
export type AiSource = AiBackend | "none";
export type AiChatSource = "auto" | AiBackend;

export interface AiConfigResolution {
  /** Config used for chat. May be ChatGPT-plan backed. */
  chat: AiConfig | null;
  /** Embeddings and transcription only. Never ChatGPT-plan backed. */
  aux: AiConfig | null;
  source: AiSource;
  chatgpt: {
    connected: boolean;
    email: string | null;
    name: string | null;
    planEnabled: boolean;
    lastError: string | null;
  } | null;
  /** Set when the user picked a backend that is not available. */
  degradedReason: string | null;
}

export interface ResolveAiConfigInput {
  workspaceId: string;
  userId: string;
  deployment: AiConfig | null;
  keyMaterial?: string;
}

function chatConfigFromRow(
  row: { baseUrl: string; apiKey: string; model: string; embeddingModel: string | null; transcribeModel: string | null },
  keyMaterial: string,
): AiConfig {
  return {
    baseUrl: row.baseUrl,
    apiKey: decryptAiKey(row.apiKey, keyMaterial),
    model: row.model,
    ...(row.embeddingModel ? { embeddingModel: row.embeddingModel } : {}),
    ...(row.transcribeModel ? { transcribeModel: row.transcribeModel } : {}),
  };
}

async function chatGptChatConfig(
  db: Database,
  connection: ChatGptConnectionRecord,
  keyMaterial: string,
): Promise<AiConfig | null> {
  if (!connection.planEnabled || !connection.model) return null;
  const accessToken = await chatGptAccessToken(db, connection, keyMaterial);
  if (!accessToken) return null;
  return {
    baseUrl: SIWC.apiBaseUrl,
    apiKey: accessToken,
    model: connection.model,
    auth: "chatgpt",
  };
}

const SOURCE_ORDER: AiBackend[] = ["chatgpt", "workspace", "deployment"];

function degradedReasonFor(source: AiBackend, chatgpt: AiConfigResolution["chatgpt"]): string | null {
  if (source === "chatgpt") {
    if (!chatgpt?.connected) return "ChatGPT plan isn't connected for this account.";
    if (!chatgpt.planEnabled) return "ChatGPT plan usage was not granted for this connection.";
    return "ChatGPT plan usage isn't available right now.";
  }
  if (source === "workspace") return "This workspace has no AI credentials.";
  return "The deployment has no AI provider configured.";
}

/**
 * Which provider a request should use.
 *
 * Chat and auxiliary work resolve separately: ChatGPT plan usage only covers the
 * Responses API, so embeddings and transcription keep using an API-key backed
 * provider. A user can pin a backend per workspace; `auto` prefers their
 * ChatGPT plan, then the workspace key, then the deployment configuration.
 * Nothing here throws — every failure degrades to the next candidate so a
 * rotated secret or an offline provider never takes AI down.
 */
export async function resolveAiConfig(
  db: Database,
  input: ResolveAiConfigInput,
): Promise<AiConfigResolution> {
  const [workspaceRow, connection, preference] = await Promise.all([
    db.workspaceAiConfig.findUnique({ where: { workspaceId: input.workspaceId } }),
    getUserChatGptConnection(db, input.userId),
    db.userAiPreference.findUnique({
      where: {
        userId_workspaceId: { userId: input.userId, workspaceId: input.workspaceId },
      },
    }),
  ]);

  let workspaceConfig: AiConfig | null = null;
  if (workspaceRow && input.keyMaterial) {
    try {
      workspaceConfig = chatConfigFromRow(workspaceRow, input.keyMaterial);
    } catch {
      workspaceConfig = null;
    }
  }
  const deploymentConfig = input.deployment?.apiKey ? input.deployment : null;

  const chatgptSummary = connection
    ? {
        connected: true,
        email: connection.email,
        name: connection.name,
        planEnabled: connection.planEnabled,
        lastError: connection.lastError,
      }
    : null;

  let chatgptConfig: AiConfig | null = null;
  if (connection && input.keyMaterial) {
    chatgptConfig = await chatGptChatConfig(db, connection, input.keyMaterial);
  }

  const preferred = (preference?.chatSource ?? "auto") as AiChatSource;
  const order =
    preferred === "auto"
      ? SOURCE_ORDER
      : [preferred, ...SOURCE_ORDER.filter((source) => source !== preferred)];

  const candidates: Record<AiBackend, AiConfig | null> = {
    chatgpt: chatgptConfig,
    workspace: workspaceConfig,
    deployment: deploymentConfig,
  };

  const picked = order.find((source) => candidates[source]) ?? null;
  const degradedReason =
    preferred !== "auto" && !candidates[preferred]
      ? degradedReasonFor(preferred, chatgptSummary)
      : null;

  return {
    chat: picked ? candidates[picked] : null,
    aux: workspaceConfig ?? deploymentConfig,
    source: picked ?? "none",
    chatgpt: chatgptSummary,
    degradedReason,
  };
}

export async function readAiPreference(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<AiChatSource> {
  const row = await db.userAiPreference.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { chatSource: true },
  });
  const value = row?.chatSource ?? "auto";
  return value === "chatgpt" || value === "workspace" || value === "deployment" || value === "auto"
    ? value
    : "auto";
}
