import { randomBytes, randomUUID } from "node:crypto";

import {
  createPkcePair,
  decryptChatGptToken,
} from "@notes-learning/auth";
import { normalizeModelName } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  SIWC,
  buildChatGptAuthorizeUrl,
  listChatGptModels,
  revokeChatGptSession,
} from "../ai/chatgpt";
import { protectedProcedure, workspaceProcedure } from "../index";
import { readAiPreference } from "../services/ai-config";
import {
  chatGptAccessToken,
  ensureChatGptHost,
  getUserChatGptConnection,
  pruneChatGptLoginStates,
  storeChatGptConnection,
} from "../services/chatgpt-connection";

const LOGIN_TTL_MS = 10 * 60 * 1000;
const AI_SOURCES = ["auto", "chatgpt", "workspace", "deployment"] as const;

function keyMaterialOf(context: { secrets?: { keyMaterial: string } }): string {
  const keyMaterial = context.secrets?.keyMaterial;
  if (!keyMaterial) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "This server cannot store ChatGPT credentials.",
    });
  }
  return keyMaterial;
}

/**
 * Sign in with ChatGPT. The connection belongs to the person, not the
 * workspace: plan usage is attributed to their own ChatGPT account and its
 * limits. The callback runs on the loopback listener the server owns, so these
 * procedures only ever exchange an authorization URL and account metadata —
 * tokens never leave the server.
 */
export const chatGptRouter = {
  status: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const userId = context.userId;
    const [connection, preference] = await Promise.all([
      getUserChatGptConnection(context.db, userId),
      readAiPreference(context.db, userId, context.workspaceId),
    ]);
    return {
      connected: Boolean(connection),
      email: connection?.email ?? null,
      name: connection?.name ?? null,
      model: connection?.model ?? null,
      planEnabled: connection?.planEnabled ?? false,
      lastError: connection?.lastError ?? null,
      preference,
      canConnect: Boolean(context.chatgpt && context.secrets),
    };
  }),

  start: protectedProcedure
    .input(z.object({ consent: z.boolean().optional() }).optional())
    .handler(async ({ context, input }) => {
      if (!context.chatgpt) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "This server cannot complete the ChatGPT sign-in callback.",
        });
      }
      const keyMaterial = keyMaterialOf(context);
      const userId = context.session.user.id;
      const [{ redirectUri }, hostId, connection] = await Promise.all([
        context.chatgpt.startListener(),
        ensureChatGptHost(context.db),
        getUserChatGptConnection(context.db, userId),
      ]);

      const { verifier, challenge } = createPkcePair();
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(16).toString("base64url");

      await context.db.chatGptLoginState.create({
        data: {
          id: state,
          userId,
          verifier,
          nonce,
          redirectUri,
          hostId,
          clientId: connection?.clientId ?? null,
          returnTo: "/app?view=settings&tab=ai",
          expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
        },
      });
      void pruneChatGptLoginStates(context.db);

      let idTokenHint: string | undefined;
      if (connection?.idToken) {
        try {
          idTokenHint = decryptChatGptToken(connection.idToken, keyMaterial);
        } catch {
          idTokenHint = undefined;
        }
      }

      // Never log this URL: it carries the retained ID token as a hint.
      const authorizeUrl = buildChatGptAuthorizeUrl({
        clientId: connection?.clientId ?? SIWC.dynamicClientId,
        hostId,
        redirectUri,
        state,
        nonce,
        codeChallenge: challenge,
        ...(connection ? {} : { agentNameHint: SIWC.agentName }),
        ...(idTokenHint ? { idTokenHint } : {}),
        ...(connection?.email ? { loginHint: connection.email } : {}),
        ...(input?.consent ? { prompt: "consent" as const } : {}),
      });
      return { authorizeUrl };
    }),

  disconnect: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const connection = await getUserChatGptConnection(context.db, userId);
    if (!connection) return { ok: true as const, revoked: false };

    let revoked = false;
    const keyMaterial = context.secrets?.keyMaterial;
    if (keyMaterial && connection.refreshToken) {
      try {
        revoked = await revokeChatGptSession({
          refreshToken: decryptChatGptToken(connection.refreshToken, keyMaterial),
          clientId: connection.clientId,
        });
      } catch {
        revoked = false;
      }
    }
    await context.db.chatGptConnection.delete({ where: { id: connection.id } });
    return { ok: true as const, revoked };
  }),

  models: protectedProcedure.handler(async ({ context }) => {
    const keyMaterial = keyMaterialOf(context);
    const connection = await getUserChatGptConnection(context.db, context.session.user.id);
    if (!connection) return { models: [], error: null };
    const accessToken = await chatGptAccessToken(context.db, connection, keyMaterial);
    if (!accessToken) {
      return { models: [], error: "The ChatGPT session needs to be refreshed. Sign in again." };
    }
    try {
      return { models: await listChatGptModels(accessToken), error: null };
    } catch (error) {
      return {
        models: [],
        error: error instanceof Error ? error.message : "Could not list models.",
      };
    }
  }),

  setModel: protectedProcedure
    .input(z.object({ model: z.string().trim().min(1).max(120) }))
    .handler(async ({ context, input }) => {
      const model = normalizeModelName(input.model);
      if (!model) throw new ORPCError("BAD_REQUEST", { message: "A model name is required." });
      const connection = await getUserChatGptConnection(context.db, context.session.user.id);
      if (!connection) {
        throw new ORPCError("NOT_FOUND", { message: "No ChatGPT connection." });
      }
      await context.db.chatGptConnection.update({
        where: { id: connection.id },
        data: { model },
      });
      return { model };
    }),

  setPreference: workspaceProcedure("VIEWER")
    .input(z.object({ source: z.enum(AI_SOURCES) }))
    .handler(async ({ context, input }) => {
      await context.db.userAiPreference.upsert({
        where: {
          userId_workspaceId: { userId: context.userId, workspaceId: context.workspaceId },
        },
        create: {
          id: randomUUID(),
          userId: context.userId,
          workspaceId: context.workspaceId,
          chatSource: input.source,
        },
        update: { chatSource: input.source },
      });
      return { source: input.source };
    }),

  exportCredential: protectedProcedure.handler(async ({ context }) => {
    const keyMaterial = keyMaterialOf(context);
    const connection = await getUserChatGptConnection(context.db, context.session.user.id);
    if (!connection) {
      throw new ORPCError("NOT_FOUND", { message: "No ChatGPT connection." });
    }
    const reveal = (value: string) => (value ? decryptChatGptToken(value, keyMaterial) : "");
    return {
      format: "lattice-chatgpt-credential" as const,
      version: 1 as const,
      email: connection.email,
      issuer: SIWC.issuer,
      subject: connection.subject,
      client_id: connection.clientId,
      ext_agent_host_id: connection.hostId,
      id_token: reveal(connection.idToken),
      access_token: reveal(connection.accessToken),
      refresh_token: reveal(connection.refreshToken),
      token_type: "Bearer",
      expires_in: Math.max(
        0,
        Math.round((connection.accessExpiresAt.getTime() - Date.now()) / 1000),
      ),
      scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
      saved_at: new Date().toISOString(),
    };
  }),

  importCredential: protectedProcedure
    .input(
      z.object({
        email: z.string().nullable().optional(),
        issuer: z.string().optional(),
        subject: z.string().min(1),
        client_id: z.string().min(1),
        ext_agent_host_id: z.string().optional(),
        id_token: z.string().min(1),
        access_token: z.string().min(1),
        refresh_token: z.string().min(1),
        token_type: z.string().optional(),
        expires_in: z.number().optional(),
        scopes: z.array(z.string()).optional(),
        saved_at: z.string().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const keyMaterial = keyMaterialOf(context);
      if (input.issuer && input.issuer !== SIWC.issuer) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This credential file was not issued by OpenAI.",
        });
      }
      // Keep this runtime's host id; a copied laptop id must not overwrite it.
      const hostId = await ensureChatGptHost(context.db);
      const connection = await storeChatGptConnection({
        db: context.db,
        userId: context.session.user.id,
        clientId: input.client_id,
        hostId,
        tokens: {
          accessToken: input.access_token,
          refreshToken: input.refresh_token,
          idToken: input.id_token,
          tokenType: input.token_type ?? "Bearer",
          expiresIn: input.expires_in && input.expires_in > 0 ? input.expires_in : 3_600,
          scopes: input.scopes ?? [],
          earliestRefreshAt: null,
        },
        identity: {
          subject: input.subject,
          email: input.email ?? null,
          emailVerified: Boolean(input.email),
          name: null,
        },
        keyMaterial,
      });
      return { ok: true as const, email: connection.email, clientId: connection.clientId };
    }),
};
