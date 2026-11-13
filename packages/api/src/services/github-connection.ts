import { randomUUID } from "node:crypto";

import { decryptGithubToken, encryptGithubToken } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";
import { Prisma } from "@notes-learning/db";

import type { GithubDeviceTokens, GithubIdentity } from "../github/oauth";

/** Structural shape of a `github_connection` row. */
export interface GithubConnectionRecord {
  id: string;
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  scopes: unknown;
  tokenType: string;
  accessToken: string;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function readGithubScopes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function getUserGithubConnection(
  db: Database,
  userId: string,
): Promise<GithubConnectionRecord | null> {
  return db.githubConnection.findUnique({
    where: { userId },
  }) as Promise<GithubConnectionRecord | null>;
}

/**
 * Writes a freshly issued token. A reconnection replaces the row: the person
 * has just proven which GitHub account they want this server to use.
 */
export async function storeGithubConnection(input: {
  db: Database;
  userId: string;
  identity: GithubIdentity;
  tokens: GithubDeviceTokens;
  keyMaterial: string;
}): Promise<GithubConnectionRecord> {
  const data = {
    login: input.identity.login,
    name: input.identity.name,
    avatarUrl: input.identity.avatarUrl,
    scopes: input.tokens.scopes as Prisma.InputJsonValue,
    tokenType: input.tokens.tokenType || "bearer",
    accessToken: encryptGithubToken(input.tokens.accessToken, input.keyMaterial),
    lastError: null,
  };

  return input.db.githubConnection.upsert({
    where: { userId: input.userId },
    create: { id: randomUUID(), userId: input.userId, ...data },
    update: data,
  }) as Promise<GithubConnectionRecord>;
}

export function decryptGithubAccessToken(
  connection: GithubConnectionRecord,
  keyMaterial: string,
): string | null {
  if (!connection.accessToken) return null;
  try {
    return decryptGithubToken(connection.accessToken, keyMaterial);
  } catch {
    return null;
  }
}

export async function markGithubConnectionError(
  db: Database,
  connectionId: string,
  error: string | null,
): Promise<void> {
  await db.githubConnection
    .update({ where: { id: connectionId }, data: { lastError: error } })
    .catch(() => undefined);
}

export async function pruneGithubLoginStates(db: Database): Promise<void> {
  await db.githubLoginState.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
}
