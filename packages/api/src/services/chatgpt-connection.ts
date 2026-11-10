import { randomUUID } from "node:crypto";

import { decryptChatGptToken, encryptChatGptToken } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";
import { Prisma } from "@notes-learning/db";

import {
  CHATGPT_PLAN_SCOPE,
  SIWC_TERMINAL_REFRESH_CODES,
  refreshChatGptTokens,
  type ChatGptIdentity,
  type ChatGptTokenSet,
} from "../ai/chatgpt";

/** Structural shape of a `chatgpt_connection` row. */
export interface ChatGptConnectionRecord {
  id: string;
  userId: string;
  clientId: string;
  hostId: string;
  subject: string;
  email: string | null;
  name: string | null;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  scopes: unknown;
  accessExpiresAt: Date;
  model: string | null;
  planEnabled: boolean;
  lastError: string | null;
  lastRequestId: string | null;
  lastRefreshedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const HOST_ROW_ID = "default";
const REFRESH_WINDOW_MS = 60_000;

export function readChatGptScopes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/**
 * The agent host identifier is opaque, stable, and created once per runtime.
 * OpenAI only accepts a JWK-thumbprint URI, `urn:uuid:`, or `did:key:` here.
 */
export async function ensureChatGptHost(db: Database): Promise<string> {
  const existing = await db.chatGptHost.findUnique({ where: { id: HOST_ROW_ID } });
  if (existing) return existing.hostId;
  const hostId = `urn:uuid:${randomUUID()}`;
  try {
    const created = await db.chatGptHost.create({ data: { id: HOST_ROW_ID, hostId } });
    return created.hostId;
  } catch {
    const raced = await db.chatGptHost.findUnique({ where: { id: HOST_ROW_ID } });
    if (raced) return raced.hostId;
    throw new Error("Could not create the ChatGPT agent host identifier.");
  }
}

export function getUserChatGptConnection(
  db: Database,
  userId: string,
): Promise<ChatGptConnectionRecord | null> {
  return db.chatGptConnection.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  }) as Promise<ChatGptConnectionRecord | null>;
}

/**
 * Writes a freshly issued token set. Refuses to replace a different ChatGPT
 * account that happens to share the same client id.
 */
export async function storeChatGptConnection(input: {
  db: Database;
  userId: string;
  clientId: string;
  hostId: string;
  tokens: ChatGptTokenSet;
  identity: ChatGptIdentity;
  keyMaterial: string;
  model?: string | null;
}): Promise<ChatGptConnectionRecord> {
  const existing = await input.db.chatGptConnection.findUnique({
    where: { userId_clientId: { userId: input.userId, clientId: input.clientId } },
  });
  if (existing && existing.subject !== input.identity.subject) {
    throw new Error("This ChatGPT registration belongs to a different account.");
  }

  const scopes = input.tokens.scopes;
  const data = {
    userId: input.userId,
    clientId: input.clientId,
    hostId: input.hostId,
    subject: input.identity.subject,
    email: input.identity.email,
    name: input.identity.name,
    idToken: input.tokens.idToken
      ? encryptChatGptToken(input.tokens.idToken, input.keyMaterial)
      : "",
    accessToken: encryptChatGptToken(input.tokens.accessToken, input.keyMaterial),
    refreshToken: input.tokens.refreshToken
      ? encryptChatGptToken(input.tokens.refreshToken, input.keyMaterial)
      : "",
    scopes: scopes as Prisma.InputJsonValue,
    accessExpiresAt: new Date(Date.now() + input.tokens.expiresIn * 1000),
    planEnabled: scopes.includes(CHATGPT_PLAN_SCOPE),
    lastError: null,
    lastRequestId: null,
    lastRefreshedAt: new Date(),
  };
  const model = input.model === undefined ? {} : { model: input.model };

  return input.db.chatGptConnection.upsert({
    where: { userId_clientId: { userId: input.userId, clientId: input.clientId } },
    create: { id: randomUUID(), ...data, ...model },
    update: { ...data, ...model },
  }) as Promise<ChatGptConnectionRecord>;
}

/**
 * Returns a usable access token, refreshing inside the last minute of its hour.
 * Refresh tokens rotate, so the write is guarded by the ciphertext we read: a
 * concurrent request that already rotated simply re-reads the new value.
 */
export async function chatGptAccessToken(
  db: Database,
  connection: ChatGptConnectionRecord,
  keyMaterial: string,
): Promise<string | null> {
  if (!connection.accessToken || !connection.refreshToken) return null;

  if (connection.accessExpiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS) {
    try {
      return decryptChatGptToken(connection.accessToken, keyMaterial);
    } catch {
      return null;
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptChatGptToken(connection.refreshToken, keyMaterial);
  } catch {
    return null;
  }

  try {
    const tokens = await refreshChatGptTokens({
      clientId: connection.clientId,
      refreshToken,
    });
    const nextRefreshToken = tokens.refreshToken ?? refreshToken;
    const rotated = await db.chatGptConnection.updateMany({
      where: { id: connection.id, refreshToken: connection.refreshToken },
      data: {
        accessToken: encryptChatGptToken(tokens.accessToken, keyMaterial),
        refreshToken: encryptChatGptToken(nextRefreshToken, keyMaterial),
        accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        ...(tokens.scopes.length ? { scopes: tokens.scopes as Prisma.InputJsonValue } : {}),
        lastRefreshedAt: new Date(),
        lastError: null,
        lastRequestId: null,
      },
    });
    if (rotated.count > 0) return tokens.accessToken;

    const fresh = await db.chatGptConnection.findUnique({
      where: { id: connection.id },
      select: { accessToken: true },
    });
    if (!fresh?.accessToken) return tokens.accessToken;
    return decryptChatGptToken(fresh.accessToken, keyMaterial);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "refresh_failed";
    const terminal = SIWC_TERMINAL_REFRESH_CODES.has(code);
    await db.chatGptConnection
      .updateMany({
        where: { id: connection.id, refreshToken: connection.refreshToken },
        data: terminal
          ? { accessToken: "", refreshToken: "", lastError: code }
          : { lastError: code },
      })
      .catch(() => undefined);
    return null;
  }
}

export async function pruneChatGptLoginStates(db: Database): Promise<void> {
  await db.chatGptLoginState
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => undefined);
}
