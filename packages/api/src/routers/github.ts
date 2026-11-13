import { randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { z } from "zod";

import {
  GithubError,
  buildGithubAuthorizeUrl,
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

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const DEVICE_STATE_TTL_MS = 15 * 60 * 1000;
const RETURN_TO = "/app?view=settings&tab=sync";

function keyMaterialOf(context: { secrets?: { keyMaterial: string } }): string {
  const keyMaterial = context.secrets?.keyMaterial;
  if (!keyMaterial) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "This server cannot store GitHub credentials.",
    });
  }
  return keyMaterial;
}

function githubConfigOf(context: {
  github?: { clientId: string | null; clientSecret: string | null; redirectUri: string } | null;
}) {
  const config = context.github;
  if (!config?.clientId) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "This server has no GitHub OAuth App client id. Set GITHUB_CLIENT_ID.",
    });
  }
  return { ...config, clientId: config.clientId };
}

/**
 * GitHub is a third party. Its outages, rejected credentials, and rate limits
 * are gateway failures with a readable message, never an uncaught 500 with a
 * stack. Keeping them as ORPCError also keeps the server log to one line.
 */
async function githubOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    throw new ORPCError("BAD_GATEWAY", {
      message:
        error instanceof GithubError
          ? error.message
          : "GitHub could not be reached. Try again.",
    });
  }
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
 * `request`, which forwards only the paths the import and sync engines use.
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
      enabled: Boolean(context.github),
      canConnect: Boolean(context.github?.clientId && context.secrets),
      configured: Boolean(context.github?.clientId),
      /** `oauth` is the Vercel-style callback flow; `device` needs no callback. */
      mode: context.github?.clientId
        ? context.github.clientSecret
          ? "oauth"
          : "device"
        : null,
      callbackUrl: context.github?.redirectUri ?? null,
    };
  }),

  start: protectedProcedure.handler(async ({ context }) => {
    const config = githubConfigOf(context);
    const userId = context.session.user.id;

    if (config.clientSecret) {
      const state = randomBytes(32).toString("base64url");
      await context.db.githubLoginState.create({
        data: {
          id: state,
          userId,
          mode: "oauth",
          returnTo: RETURN_TO,
          expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        },
      });
      void pruneGithubLoginStates(context.db);

      return {
        mode: "oauth" as const,
        authorizeUrl: buildGithubAuthorizeUrl({
          clientId: config.clientId,
          redirectUri: config.redirectUri,
          state,
        }),
        expiresIn: Math.floor(OAUTH_STATE_TTL_MS / 1000),
      };
    }

    const flow = await githubOperation(() => startGithubDeviceFlow(config.clientId));
    const id = randomUUID();
    await context.db.githubLoginState.create({
      data: {
        id,
        userId,
        mode: "device",
        deviceCode: flow.deviceCode,
        userCode: flow.userCode,
        intervalSeconds: flow.interval,
        returnTo: RETURN_TO,
        expiresAt: new Date(Date.now() + Math.min(flow.expiresIn * 1000, DEVICE_STATE_TTL_MS)),
      },
    });
    void pruneGithubLoginStates(context.db);

    return {
      mode: "device" as const,
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
      const config = githubConfigOf(context);
      const keyMaterial = keyMaterialOf(context);
      const userId = context.session.user.id;

      const state = await context.db.githubLoginState.findFirst({
        where: { id: input.id, userId, mode: "device" },
      });
      if (!state?.deviceCode) return { status: "expired" as const };

      if (state.expiresAt.getTime() < Date.now()) {
        await context.db.githubLoginState.delete({ where: { id: state.id } }).catch(() => undefined);
        return { status: "expired" as const };
      }

      const result = await githubOperation(() =>
        pollGithubDeviceFlow({
          clientId: config.clientId,
          deviceCode: state.deviceCode!,
        }),
      );

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

      const connection = await githubOperation(async () => {
        const identity = await fetchGithubIdentity(result.accessToken);
        return storeGithubConnection({
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
    const result = await githubOperation(() =>
      githubApiRequest({
        accessToken,
        method: "GET",
        path:
          "/user/repos?per_page=100&sort=pushed&affiliation=" +
          encodeURIComponent("owner,collaborator,organization_member"),
      }),
    );
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
      const result = await githubOperation(() =>
        githubApiRequest({
          accessToken,
          method: input.method,
          path,
          ...(input.body === undefined ? {} : { body: input.body }),
        }),
      );
      if (result.status === 401) {
        await markGithubConnectionError(context.db, connection.id, "unauthorized");
      }
      return result;
    }),
};
