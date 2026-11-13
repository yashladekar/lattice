import { randomBytes } from "node:crypto";

import type { Database } from "@notes-learning/db";
import {
  SSO_STATE_TTL_MS,
  parseSsoDomains,
  resolveSsoRedirect,
  ssoDomainMatches,
  ssoErrorRedirect,
} from "@notes-learning/domain";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

import {
  buildAuthorizeUrl,
  createPkcePair,
  decryptSsoSecret,
  discoverOidc,
  exchangeCodeForIdentity,
} from "./sso";

/**
 * Workspace single sign-on as two auth endpoints:
 *
 *   GET /api/auth/sso/start?workspace=<id|slug>&redirect=/app
 *   GET /api/auth/sso/callback?code=…&state=…
 *
 * Sign-in requires an existing, active membership — provisioning is SCIM's
 * job — and the session is created through better-auth's own adapter, so the
 * cookie, expiry, and revocation behave exactly like a password sign-in.
 */
export function createSsoPlugin(options: {
  database: Database;
  secret: string;
  appOrigin: string;
  trustedOrigins: readonly string[];
}) {
  const { database, secret } = options;
  const appBase = options.appOrigin.replace(/\/+$/, "");
  const fail = (code: string) => ssoErrorRedirect(appBase, code);

  return {
    id: "lattice-sso",
    endpoints: {
      ssoStart: createAuthEndpoint("/sso/start", { method: "GET" }, async (ctx) => {
        const query = (ctx.query ?? {}) as { workspace?: unknown; redirect?: unknown };
        const workspaceKey =
          typeof query.workspace === "string" ? query.workspace.trim().slice(0, 120) : "";
        if (!workspaceKey) throw ctx.redirect(fail("not_configured"));

        const workspace = await database.workspace.findFirst({
          where: {
            deletedAt: null,
            OR: [{ id: workspaceKey }, { slug: workspaceKey }],
          },
          select: { id: true },
        });
        if (!workspace) throw ctx.redirect(fail("not_configured"));

        const connection = await database.ssoConnection.findFirst({
          where: { workspaceId: workspace.id, enabled: true },
          select: { workspaceId: true, issuer: true, clientId: true },
        });
        if (!connection) throw ctx.redirect(fail("not_configured"));

        let discovery;
        try {
          discovery = await discoverOidc(connection.issuer);
        } catch {
          throw ctx.redirect(fail("provider_error"));
        }

        const { verifier, challenge } = createPkcePair();
        const state = randomBytes(24).toString("base64url");
        const nonce = randomBytes(16).toString("base64url");
        const redirect =
          typeof query.redirect === "string" ? query.redirect.slice(0, 500) : "/app";

        await database.ssoLoginState.create({
          data: {
            id: state,
            workspaceId: connection.workspaceId,
            verifier,
            nonce,
            redirect,
            expiresAt: new Date(Date.now() + SSO_STATE_TTL_MS),
          },
        });
        // Opportunistic cleanup; a failure here must not block sign-in.
        void database.ssoLoginState
          .deleteMany({ where: { expiresAt: { lt: new Date() } } })
          .catch(() => undefined);

        throw ctx.redirect(
          buildAuthorizeUrl({
            discovery,
            clientId: connection.clientId,
            redirectUri: `${ctx.context.baseURL}/sso/callback`,
            state,
            nonce,
            challenge,
          }),
        );
      }),

      ssoCallback: createAuthEndpoint("/sso/callback", { method: "GET" }, async (ctx) => {
        const query = (ctx.query ?? {}) as {
          code?: unknown;
          state?: unknown;
          error?: unknown;
        };
        if (
          typeof query.error === "string" ||
          typeof query.code !== "string" ||
          typeof query.state !== "string"
        ) {
          throw ctx.redirect(fail("provider_error"));
        }

        const login = await database.ssoLoginState.findUnique({
          where: { id: query.state },
        });
        if (login) {
          await database.ssoLoginState.delete({ where: { id: login.id } }).catch(() => undefined);
        }
        if (!login || login.expiresAt.getTime() < Date.now()) {
          throw ctx.redirect(fail("state_expired"));
        }

        const connection = await database.ssoConnection.findUnique({
          where: { workspaceId: login.workspaceId },
        });
        if (!connection || !connection.enabled) {
          throw ctx.redirect(fail("not_configured"));
        }

        let identity;
        try {
          const discovery = await discoverOidc(connection.issuer);
          identity = await exchangeCodeForIdentity({
            discovery,
            clientId: connection.clientId,
            clientSecret: decryptSsoSecret(connection.clientSecret, secret),
            code: query.code,
            redirectUri: `${ctx.context.baseURL}/sso/callback`,
            verifier: login.verifier,
            nonce: login.nonce,
          });
        } catch {
          throw ctx.redirect(fail("provider_error"));
        }
        if (!identity.emailVerified) throw ctx.redirect(fail("email_unverified"));

        // The identity provider is chosen by this workspace, so an email outside
        // its declared domains must never link to an existing account.
        if (!ssoDomainMatches(parseSsoDomains(connection.domains), identity.email)) {
          throw ctx.redirect(fail("domain_not_allowed"));
        }

        const found = await ctx.context.internalAdapter.findUserByEmail(identity.email);
        const user = found?.user ?? null;
        const member = user
          ? await database.workspaceMember.findFirst({
              where: {
                workspaceId: connection.workspaceId,
                userId: user.id,
                status: "ACTIVE",
                deletedAt: null,
              },
              select: { id: true },
            })
          : null;
        if (!user || !member) throw ctx.redirect(fail("not_provisioned"));

        const session = await ctx.context.internalAdapter.createSession(user.id);
        if (!session) throw ctx.redirect(fail("provider_error"));
        await setSessionCookie(ctx, { session, user });

        const target = resolveSsoRedirect(login.redirect, options.trustedOrigins, "/app");
        const absolute = target.startsWith("http") ? target : `${appBase}${target}`;
        throw ctx.redirect(absolute);
      }),
    },
  } as const;
}
