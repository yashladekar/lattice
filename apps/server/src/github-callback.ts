import type { Request, Response } from "express";

import { GithubError, exchangeGithubCode, fetchGithubIdentity } from "@notes-learning/api/github/oauth";
import { storeGithubConnection } from "@notes-learning/api/services/github-connection";
import type { Database } from "@notes-learning/db";

/**
 * The OAuth return leg. GitHub redirects here after the person approves the
 * OAuth App; the state row tells us who started the flow, so no session cookie
 * is needed on this request. The authorization code is exchanged server-side
 * and never shown to the browser. After a success or a failure the person is
 * sent back to Settings → Sync & backup with a short reason.
 */

const CALLBACK_PATH = "/api/github/callback";

export interface GithubCallbackOptions {
  db: Database;
  keyMaterial: string;
  appOrigin: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type FailureReason =
  | "state_missing"
  | "state_expired"
  | "provider_error"
  | "exchange_failed";

export { CALLBACK_PATH };

function redirectTo(
  res: Response,
  appOrigin: string,
  returnTo: string,
  params: Record<string, string>,
): void {
  const target = new URL("/app", appOrigin);
  try {
    const parsed = new URL(returnTo, appOrigin);
    if (parsed.origin === target.origin && parsed.pathname.startsWith("/app")) {
      parsed.searchParams.forEach((value, key) => target.searchParams.set(key, value));
    }
  } catch {
    target.searchParams.set("view", "settings");
    target.searchParams.set("tab", "sync");
  }
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  res.writeHead(302, {
    Location: target.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Length": "0",
  });
  res.end();
}

export function createGithubCallbackHandler(options: GithubCallbackOptions) {
  const { db, keyMaterial, appOrigin, clientId, clientSecret, redirectUri } = options;

  return async (req: Request, res: Response) => {
    const fail = (reason: FailureReason): void => {
      redirectTo(res, appOrigin, "/app?view=settings&tab=sync", {
        github: "error",
        reason,
      });
    };

    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!state) {
      fail("state_missing");
      return;
    }

    const login = await db.githubLoginState.findUnique({ where: { id: state } }).catch(() => null);
    if (login) {
      await db.githubLoginState.delete({ where: { id: login.id } }).catch(() => undefined);
    }
    if (!login || login.mode !== "oauth" || login.expiresAt.getTime() < Date.now()) {
      fail("state_expired");
      return;
    }

    // A declined consent must never reach a code exchange.
    if (typeof req.query.error === "string" && req.query.error) {
      fail("provider_error");
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      fail("provider_error");
      return;
    }

    try {
      const tokens = await exchangeGithubCode({ clientId, clientSecret, code, redirectUri });
      const identity = await fetchGithubIdentity(tokens.accessToken);
      await storeGithubConnection({
        db,
        userId: login.userId,
        identity,
        tokens,
        keyMaterial,
      });
      redirectTo(res, appOrigin, login.returnTo, { github: "connected" });
    } catch (error) {
      if (!(error instanceof GithubError)) {
        console.error("GitHub callback failed", error);
      }
      fail("exchange_failed");
    }
  };
}
