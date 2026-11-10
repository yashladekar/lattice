import { mkdir } from "node:fs/promises";
import path from "node:path";

import { appRouter } from "@notes-learning/api/routers/index";
import { purgeExpiredTrash } from "@notes-learning/api/services/purge";
import { createUploadHandler } from "@notes-learning/api/uploads";
import { ingestEmail } from "@notes-learning/api/services/ingest-email";
import { deliverWebhookBatch } from "@notes-learning/api/services/webhooks";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import cors from "cors";
import express from "express";

import { createContext } from "./context";
import { attachCollaboration } from "./collaboration";
import { createScimRouter } from "@notes-learning/api/scim-router";
import { RateLimiter } from "@notes-learning/api/rate-limit";
import { desktopOrigins, ENV, uploadRoot } from "./env.server";
import { auth, db } from "./services";

const app = express();

app.set("trust proxy", 1);

/**
 * One line per client error, with the path handler interceptors cannot see. A
 * 401 from a poll that ran before the session resolved is expected traffic, not
 * a crash, and it should not read like one.
 */
app.use((req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      console.warn(`${req.method} ${req.path} → ${res.statusCode}`);
    }
  });
  next();
});

const rateLimiter = new RateLimiter();
setInterval(() => rateLimiter.sweep(), 60_000).unref();
app.use((req, res, next) => {
  const now = Date.now();
  const ingestRequest = req.path.startsWith("/ingest");
  const scimRequest = req.path.startsWith("/scim");
  const shareRequest =
    req.path.startsWith("/rpc/share/public") || req.path.startsWith("/rpc/share/preview");
  const scope = req.path.startsWith("/api/auth")
    ? "auth"
    : ingestRequest
      ? "ingest"
      : scimRequest
        ? "scim"
        : shareRequest
          ? "share"
          : "api";
  const limit =
    scope === "auth"
      ? 60
      : scope === "ingest"
        ? 30
        : scope === "scim"
          ? 240
          : scope === "share"
            ? 90
            : 600;
  const key = `${req.ip ?? "unknown"}:${scope}`;
  if (!rateLimiter.hit(key, limit, now)) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
});

app.use(
  cors({
    origin: [ENV.CORS_ORIGIN, ...desktopOrigins, "http://localhost:3001", "http://localhost:8081"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-file-name", "x-workspace-id"],
    exposedHeaders: ["x-file-name"],
    credentials: true,
  }),
);

await mkdir(uploadRoot, { recursive: true });
const INLINE_UPLOAD_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".mp4",
  ".webm",
]);
app.use(
  "/uploads",
  express.static(uploadRoot, {
    maxAge: "1y",
    immutable: true,
    setHeaders: (res, filePath) => {
      const extension = path.extname(filePath).toLowerCase();
      // Never let a browser guess a type, so an uploaded .html cannot execute.
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      if (INLINE_UPLOAD_EXTENSIONS.has(extension)) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        return;
      }
      // Anything else is a download: no script execution on the API origin and
      // no cross-origin read of potentially private documents.
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    },
  }),
);

app.post(
  "/uploads",
  express.raw({ type: "*/*", limit: "25mb" }),
  createUploadHandler({
    uploadRoot,
    authenticate: async (headers) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
      return session?.user ? { userId: session.user.id } : null;
    },
  }),
);

app.all("/api/auth{/*path}", toNodeHandler(auth));

app.use("/scim/v2", createScimRouter(db));

app.post("/ingest/email", express.json({ limit: "1mb" }), async (req, res) => {
  const token = String(req.headers["x-lattice-ingest-token"] ?? req.query.token ?? "").trim();
  const result = await ingestEmail(db, { token, body: req.body });
  if (result.status === 202) {
    res.status(202).json({ ok: true, captureId: result.captureId });
    return;
  }
  res.status(result.status).json({ error: result.error });
});

const nativeAppUrl = "notes-learning://";
const allowedNativeProtocols = new Set(["exp:", new URL(nativeAppUrl).protocol]);

app.get("/polar/success", (req, res) => {
  const requestUrl = new URL(req.url, ENV.BETTER_AUTH_URL);
  const returnUrl = requestUrl.searchParams.get("returnUrl") || nativeAppUrl;

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(returnUrl);
  } catch {
    res.status(400).send("Invalid return URL");
    return;
  }

  if (!allowedNativeProtocols.has(redirectUrl.protocol)) {
    res.status(400).send("Invalid return URL");
    return;
  }

  res.redirect(302, redirectUrl.toString());
});

/**
 * Expected client errors — an unauthenticated poll before the session resolves,
 * a page deleted in another tab, a rejected input — are not worth a stack. They
 * get one line with the request path, added below; everything else keeps its
 * stack, which is the category worth reading.
 */
type HandlerInterceptor = NonNullable<
  NonNullable<ConstructorParameters<typeof RPCHandler>[1]>["interceptors"]
>[number];

const logProcedureError: HandlerInterceptor = onError((error) => {
  if (error instanceof ORPCError && error.status >= 400 && error.status < 500) return;
  console.error(error);
});

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [logProcedureError],
});
const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [logProcedureError],
});

app.use(async (req, res, next) => {
  const rpcResult = await rpcHandler.handle(req, res, {
    prefix: "/rpc",
    context: await createContext({ req }),
  });
  if (rpcResult.matched) return;

  const apiResult = await apiHandler.handle(req, res, {
    prefix: "/api-reference",
    context: await createContext({ req }),
  });
  if (apiResult.matched) return;

  next();
});

app.use(express.json({ limit: "4mb" }));

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(error);
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({
      error: "Internal Server Error",
      detail:
        process.env.NODE_ENV === "development" && error instanceof Error
          ? error.message
          : undefined,
    });
  },
);

const server = app.listen(Number(process.env.PORT ?? 3100), () => {
  console.log(`Server is running on http://localhost:${process.env.PORT ?? 3100}`);
});

attachCollaboration(server);

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
const runRetentionPurge = async () => {
  try {
    const result = await purgeExpiredTrash(db);
    if (result.purged) {
      console.log(
        `Retention purge removed ${result.purged} rows across ${result.workspaces} workspace${result.workspaces === 1 ? "" : "s"}`,
      );
    }
  } catch (error) {
    console.error("Retention purge failed", error);
  }
};
setTimeout(() => void runRetentionPurge(), 60_000).unref();
setInterval(() => void runRetentionPurge(), PURGE_INTERVAL_MS).unref();

let webhookRunning = false;
const runWebhookDeliveries = async () => {
  if (webhookRunning) return;
  webhookRunning = true;
  try {
    const result = await deliverWebhookBatch(db);
    if (result.delivered || result.failed || result.skipped) {
      console.log(
        `Webhooks: ${result.delivered} delivered, ${result.failed} failed, ${result.skipped} skipped`,
      );
    }
  } catch (error) {
    console.error("Webhook delivery failed", error);
  } finally {
    webhookRunning = false;
  }
};
setTimeout(() => void runWebhookDeliveries(), 10_000).unref();
setInterval(() => void runWebhookDeliveries(), 15_000).unref();
