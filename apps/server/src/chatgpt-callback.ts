import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  SIWC,
  exchangeChatGptCode,
  listChatGptModels,
  verifyChatGptIdToken,
} from "@notes-learning/api/ai/chatgpt";
import { storeChatGptConnection } from "@notes-learning/api/services/chatgpt-connection";
import type { Database } from "@notes-learning/db";

/**
 * The Sign in with ChatGPT callback has to land on `127.0.0.1` — OpenAI only
 * accepts a loopback redirect, and `localhost` is explicitly not a substitute.
 * That means the connection can only be completed against a Lattice server
 * running on the same machine as the browser. The listener is created lazily,
 * bound to loopback only, and serves exactly one path.
 */
const PREFERRED_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const HEALTH_PATH = "/health";

export interface ChatGptCallbackOptions {
  db: Database;
  keyMaterial: string;
  appOrigin: string;
}

type FailureReason =
  | "state_missing"
  | "state_expired"
  | "provider_error"
  | "registration_incomplete"
  | "client_mismatch"
  | "exchange_failed";

function appRedirect(appOrigin: string, returnTo: string, params: Record<string, string>): string {
  const target = new URL("/app", appOrigin);
  try {
    const parsed = new URL(returnTo, appOrigin);
    if (parsed.origin === target.origin && parsed.pathname.startsWith("/app")) {
      parsed.searchParams.forEach((value, key) => target.searchParams.set(key, value));
    }
  } catch {
    // Fall back to the plain app path.
  }
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

function respond(res: ServerResponse, location: string): void {
  // Never let a callback URL leak through a referrer header.
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Content-Length": "0",
  });
  res.end();
}

function fail(res: ServerResponse, appOrigin: string, returnTo: string, reason: FailureReason) {
  respond(res, appRedirect(appOrigin, returnTo, { view: "settings", chatgpt: "error", reason }));
}

export function createChatGptCallbackListener(options: ChatGptCallbackOptions) {
  const { db, keyMaterial, appOrigin } = options;
  let started: Promise<{ redirectUri: string }> | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      res.writeHead(400, { "Content-Length": "0" }).end();
      return;
    }

    if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      if (req.method === "GET" && url.pathname === HEALTH_PATH) {
        res.writeHead(200, { "content-type": "text/plain", "Cache-Control": "no-store" });
        res.end("ok");
        return;
      }
      res.writeHead(404, { "Content-Length": "0" }).end();
      return;
    }

    const state = url.searchParams.get("state");
    if (!state) {
      fail(res, appOrigin, "/app?view=settings&tab=ai", "state_missing");
      return;
    }

    const login = await db.chatGptLoginState.findUnique({ where: { id: state } });
    if (login) {
      await db.chatGptLoginState.delete({ where: { id: login.id } }).catch(() => undefined);
    }
    if (!login || login.expiresAt.getTime() < Date.now()) {
      fail(res, appOrigin, "/app?view=settings&tab=ai", "state_expired");
      return;
    }

    const returnTo = login.returnTo;

    // A declined consent must never reach a code exchange.
    if (url.searchParams.get("error")) {
      fail(res, appOrigin, returnTo, "provider_error");
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      fail(res, appOrigin, returnTo, "provider_error");
      return;
    }

    const callbackClientId = url.searchParams.get("client_id");
    const issuedClientId = login.clientId ?? callbackClientId;
    if (
      !issuedClientId ||
      issuedClientId === SIWC.dynamicClientId ||
      (login.clientId !== null && callbackClientId !== null && callbackClientId !== login.clientId)
    ) {
      fail(res, appOrigin, returnTo, login.clientId ? "client_mismatch" : "registration_incomplete");
      return;
    }

    try {
      const tokens = await exchangeChatGptCode({
        clientId: issuedClientId,
        code,
        verifier: login.verifier,
        redirectUri: login.redirectUri,
      });
      if (!tokens.idToken) throw new Error("OpenAI returned no identity token.");

      const identity = await verifyChatGptIdToken({
        idToken: tokens.idToken,
        clientId: issuedClientId,
        nonce: login.nonce,
      });

      const connection = await storeChatGptConnection({
        db,
        userId: login.userId,
        clientId: issuedClientId,
        hostId: login.hostId,
        tokens,
        identity,
        keyMaterial,
      });

      if (!connection.model) {
        try {
          const models = await listChatGptModels(tokens.accessToken);
          if (models[0]) {
            await db.chatGptConnection.update({
              where: { id: connection.id },
              data: { model: models[0].slug },
            });
          }
        } catch {
          // The user can pick a model from settings instead.
        }
      }

      respond(res, appRedirect(appOrigin, returnTo, { view: "settings", chatgpt: "connected" }));
    } catch {
      fail(res, appOrigin, returnTo, "exchange_failed");
    }
  };

  const listen = (server: ReturnType<typeof createServer>, port: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("The ChatGPT callback listener did not report a port."));
          return;
        }
        resolve(address.port);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });

  const start = async (): Promise<{ redirectUri: string }> => {
    const server = createServer((req, res) => {
      void handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500, { "Content-Length": "0" }).end();
      });
    });

    let port: number;
    try {
      port = await listen(server, PREFERRED_PORT);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      // Only the port may vary; scheme, host, and path stay fixed.
      port = await listen(server, 0);
    }

    server.on("error", (error) => {
      console.error("ChatGPT callback listener error", error);
    });
    server.unref();

    return { redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}` };
  };

  return {
    startListener() {
      started ??= start();
      return started;
    },
  };
}
