import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  fetchGithubIdentity,
  githubApiRequest,
  parseGithubApiPath,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
} from "../github/oauth";
import { protectedProcedure } from "../index";
import {
  decryptGithubAccessToken,
  getUserGithubConnection,
  markGithubConnectionError,
  pruneGithubLoginStates,
  readGithubScopes,
  storeGithubConnection,
} from "../services/github-connection";

const LOGIN_TTL_MS = 15 * 60 * 1000;

function keyMaterialOf(context: { secrets?: { keyMaterial: string } }): string {
  const keyMaterial = context.secrets?.keyMaterial;
  if (!keyMaterial) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "This server cannot store GitHub credentials.",
    });
  }
  return keyMaterial;
}

function clientIdOf(context: { github?: { clientId: string } | null }): string {
  const clientId = context.github?.clientId;
  if (!clientId) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "GitHub sign-in is not configured on this server.",
    });
  }
  return clientId;
}

async function requireToken(context: {
  db: Parameters<typeof getUserGithubConnection>[0];
  session: { user: { id: string } };
  secrets?: { keyMaterial: string };
}) {
  const keyMaterial = keyMaterialOf(context);
  const connection = await getUserGithubConnection(context.db, context.session.user.id);
  if (!connection) {
    throw new ORPCError("NOT_FOUND", { message: "Connect GitHub first." });
  }
  const accessToken = decryptGithubAccessToken(connection, keyMaterial);
  if (!accessToken) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "The stored GitHub credential is unreadable. Connect again.",
    });
  }
  return { connection, accessToken };
}

/**
 * A stored GitHub account. The connection belongs to the person, not the
 * workspace, exactly like the ChatGPT plan: the token is theirs and its scopes
 * are theirs. The browser never receives the token; import and sync call
 * `request`, which forwards only the paths below.
 */
export const githubRouter = {
  status: protectedProcedure.handler(async ({ context }) => {
    const connection = await getUserGithubConnection(context.db, context.session.user.id);
    return {
      connected: Boolean(connection),
      login: connection?.login ?? null,
      name: connection?.name ?? null,
      avatarUrl: connection?.avatarUrl ?? null,
      scopes: connection ? readGithubScopes(connection.scopes) : [],
      lastError: connection?.lastError ?? null,
      canConnect: Boolean(context.github?.clientId && context.secrets),
      configured: Boolean(context.github?.clientId),
    };
  }),

  start: protectedProcedure.handler(async ({ context }) => {
    const clientId = clientIdOf(context);
    const userId = context.session.user.id;
    const flow = await startGithubDeviceFlow(clientId);
    const id = randomUUID();

    await context.db.githubLoginState.create({
      data: {
        id,
        userId,
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        intervalSeconds: flow.interval,
        expiresAt: new Date(Date.now() + Math.min(flow.expiresIn * 1000, LOGIN_TTL_MS)),
      },
    });
    void pruneGithubLoginStates(context.db);

    return {
      id,
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      expiresIn: flow.expiresIn,
      interval: flow.interval,
    };
  }),

  poll: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(200) }))
    .handler(async ({ context, input }) => {
      const clientId = clientIdOf(context);
      const keyMaterial = keyMaterialOf(context);
      const userId = context.session.user.id;

      const state = await context.db.githubLoginState.findFirst({
        where: { id: input.id, userId },
      });
      if (!state) return { status: "expired" as const };

      if (state.expiresAt.getTime() < Date.now()) {
        await context.db.githubLoginState.delete({ where: { id: state.id } }).catch(() => undefined);
        return { status: "expired" as const };
      }

      const result = await pollGithubDeviceFlow({
        clientId,
        deviceCode: state.deviceCode,
      });

      if (result.status === "pending") {
        await context.db.githubLoginState
          .update({ where: { id: state.id }, data: { intervalSeconds: result.interval } })
          .catch(() => undefined);
        return { status: "pending" as const, interval: result.interval };
      }
      if (result.status === "expired" || result.status === "denied") {
        await context.db.githubLoginState.delete({ where: { id: state.id } }).catch(() => undefined);
        return { status: result.status };
      }
      if (result.status === "error") {
        return { status: "error" as const, message: result.message };
      }

      const identity = await fetchGithubIdentity(result.accessToken);
      const connection = await storeGithubConnection({
        db: context.db,
        userId,
        identity,
        tokens: {
          accessToken: result.accessToken,
          tokenType: result.tokenType,
          scopes: result.scopes,
        },
        keyMaterial,
      });
      await context.db.githubLoginState.delete({ where: { id: state.id } }).catch(() => undefined);

      return {
        status: "connected" as const,
        login: connection.login,
        name: connection.name,
        avatarUrl: connection.avatarUrl,
      };
    }),

  disconnect: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    await context.db.githubConnection.deleteMany({ where: { userId } });
    await context.db.githubLoginState.deleteMany({ where: { userId } });
    return { ok: true as const };
  }),

  repos: protectedProcedure.handler(async ({ context }) => {
    const { connection, accessToken } = await requireToken(context);
    const result = await githubApiRequest({
      accessToken,
      method: "GET",
      path:
        "/user/repos?per_page=100&sort=pushed&affiliation=" +
        encodeURIComponent("owner,collaborator,organization_member"),
    });
    if (result.status !== 200 || !Array.isArray(result.body)) {
      if (result.status === 401) {
        await markGithubConnectionError(context.db, connection.id, "unauthorized");
      }
      throw new ORPCError("BAD_GATEWAY", {
        message:
          result.status === 401
            ? "GitHub rejected the stored token. Connect again."
            : `GitHub could not list repositories (${result.status}).`,
      });
    }
    const repos = result.body
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => ({
        fullName: String(entry.full_name ?? ""),
        private: Boolean(entry.private),
        defaultBranch:
          typeof entry.default_branch === "string" ? entry.default_branch : "main",
        description: typeof entry.description === "string" ? entry.description : null,
        pushedAt: typeof entry.pushed_at === "string" ? entry.pushed_at : null,
      }))
      .filter((repo) => repo.fullName.includes("/"));
    return { repos, truncated: result.body.length >= 100 };
  }),

  /**
   * The token never leaves the server. These are the same reads and writes the
   * import and sync engines already perform in the browser, forwarded so the
   * stored credential is what authorises them.
   */
  request: protectedProcedure
    .input(
      z.object({
        method: z.enum(["GET", "PUT"]),
        path: z.string().min(1).max(2_048),
        body: z.unknown().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const path = parseGithubApiPath(input.method, input.path);
      if (!path) {
        throw new ORPCError("BAD_REQUEST", { message: "That GitHub API path is not allowed." });
      }
      const { connection, accessToken } = await requireToken(context);
      const result = await githubApiRequest({
        accessToken,
        method: input.method,
        path,
        ...(input.body === undefined ? {} : { body: input.body }),
      });
      if (result.status === 401) {
        await markGithubConnectionError(context.db, connection.id, "unauthorized");
      }
      return result;
    }),
};
