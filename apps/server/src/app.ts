import { timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { RateLimiter } from "@notes-learning/api/rate-limit";
import { appRouter } from "@notes-learning/api/routers/index";
import { createScimRouter } from "@notes-learning/api/scim-router";
import { ingestEmail } from "@notes-learning/api/services/ingest-email";
import { purgeExpiredTrash } from "@notes-learning/api/services/purge";
import { deliverWebhookBatch } from "@notes-learning/api/services/webhooks";
import { isInlineUpload, isUploadFilename } from "@notes-learning/api/upload-store";
import { createPresignHandler, createUploadHandler } from "@notes-learning/api/uploads";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";

import { createContext } from "./context";
import { ENV, desktopOrigins, githubConfig, uploadConfig, vercelOrigins } from "./env.server";
import { createGithubCallbackHandler } from "./github-callback";
import { auth, db, uploadStore } from "./services";

export const rateLimiter = new RateLimiter();

export const app = express();

/**
 * Forwarding headers are only trusted when an operator says how many proxies
 * sit in front. Vercel always proxies one hop, and trusting its header is what
 * makes the rate limiter key on the visitor instead of the edge.
 */
app.set(
  "trust proxy",
  process.env.TRUST_PROXY
    ? Number(process.env.TRUST_PROXY)
    : process.env.VERCEL
      ? 1
      : false,
);

// Do not announce the framework, and send the baseline headers a JSON/file API
// should: no MIME sniffing of uploads, never framed, no referrer leakage.
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

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

/**
 * The split-port dev flow and Expo dev server are convenient origins to
 * trust locally, never in production. A deployment declares its own origin in
 * CORS_ORIGIN; the desktop shell keeps its two fixed origins.
 */
const corsOrigins = [
  ENV.CORS_ORIGIN,
  ...desktopOrigins,
  ...vercelOrigins,
  ...(ENV.NODE_ENV === "production" ? [] : ["http://localhost:3001", "http://localhost:8081"]),
];
app.use(
  cors({
    origin: corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-file-name", "x-workspace-id"],
    exposedHeaders: ["x-file-name"],
    credentials: true,
  }),
);

/**
 * Serverless hosts mount the same app, but their filesystem is ephemeral. Say
 * so once at boot instead of failing every upload with a 500 later.
 */
if (process.env.VERCEL && uploadStore.localRoot) {
  console.error(
    "[lattice] UPLOAD_DRIVER=local on Vercel: uploads will not persist. Set UPLOAD_DRIVER=s3.",
  );
}

if (uploadStore.localRoot) {
  await mkdir(uploadStore.localRoot, { recursive: true });
}

if (uploadStore.localRoot) {
  app.use(
    "/uploads",
    express.static(uploadStore.localRoot, {
      setHeaders: (res, filePath) => {
        // Never let a browser guess a type, so an uploaded .html cannot execute.
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (isInlineUpload(filePath)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
          res.setHeader("Access-Control-Allow-Origin", "*");
          return;
        }
        // Documents are downloaded, not embedded: no script execution on the API
        // origin, no cross-origin read, and no year-long cache of a private file.
        res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Content-Disposition", "attachment");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      },
    }),
  );
} else {
  // Rows written before the bucket existed still point at /uploads/<name>.
  // Redirect instead of streaming, so large files never meet the response cap.
  app.get("/uploads/:filename", (req, res) => {
    if (!isUploadFilename(req.params.filename)) {
      res.status(404).end();
      return;
    }
    res.redirect(302, uploadStore.urlFor(req.params.filename));
  });
}

const authenticate = async (
  headers: Record<string, string | string[] | undefined>,
) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  return session?.user ? { userId: session.user.id } : null;
};

app.post(
  "/uploads",
  express.raw({
    type: "*/*",
    limit: `${Math.max(1, Math.ceil(uploadConfig.maxBytes / (1024 * 1024)))}mb`,
  }),
  createUploadHandler({ store: uploadStore, authenticate }),
);

app.post(
  "/uploads/presign",
  express.json({ limit: "16kb" }),
  createPresignHandler({
    store: uploadStore,
    authenticate,
    maxBytes: uploadConfig.maxBytes,
  }),
);

app.all("/api/auth{/*path}", toNodeHandler(auth));

if (githubConfig?.clientId && githubConfig.clientSecret) {
  app.get(
    "/api/github/callback",
    createGithubCallbackHandler({
      db,
      keyMaterial: ENV.BETTER_AUTH_SECRET,
      appOrigin: ENV.CORS_ORIGIN,
      clientId: githubConfig.clientId,
      clientSecret: githubConfig.clientSecret,
      redirectUri: githubConfig.redirectUri,
    }),
  );
}

app.use("/scim/v2", createScimRouter(db, { baseUrl: ENV.BETTER_AUTH_URL }));

app.post("/ingest/email", express.json({ limit: "1mb" }), async (req, res) => {
  const token = String(req.headers["x-lattice-ingest-token"] ?? "").trim();
  const result = await ingestEmail(db, { token, body: req.body });
  if (result.status === 202) {
    res.status(202).json({ ok: true, captureId: result.captureId });
    return;
  }
  res.status(result.status).json({ error: result.error });
});

const nativeAppUrl = "notes-learning://";
// Both app shells are allowed. Expo Go's `exp:` scheme can load a remote bundle,
// so it is a development convenience only.
const allowedNativeProtocols = new Set([
  "notes-learning:",
  "lattice:",
  ...(process.env.NODE_ENV === "production" ? [] : ["exp:"]),
]);

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
  if (error instanceof ORPCError) {
    if (error.status >= 400 && error.status < 500) return;
    // An upstream provider refusing a call is worth one line, not a stack.
    if (error.status === 502) {
      console.warn(`${error.code}: ${error.message}`);
      return;
    }
  }
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
  const isRpc = req.path === "/rpc" || req.path.startsWith("/rpc/");
  const isApiReference =
    req.path === "/api-reference" || req.path.startsWith("/api-reference/");
  if (!isRpc && !isApiReference) {
    next();
    return;
  }

  // One context per request: the session lookup and any membership lookup are
  // shared by the handler, and health checks no longer resolve a session.
  const context = await createContext({ req });
  if (isRpc) {
    const result = await rpcHandler.handle(req, res, { prefix: "/rpc", context });
    if (result.matched) return;
  } else {
    const result = await apiHandler.handle(req, res, { prefix: "/api-reference", context });
    if (result.matched) return;
  }
  next();
});

app.use(express.json({ limit: "4mb" }));

app.get("/", (_req, res) => {
  res.status(200).send("OK");
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, uploads: uploadConfig.driver });
});

/**
 * Self-hosted deployments tick the same work from `startBackgroundJobs`. A
 * serverless host has no timers, so it calls this from an external scheduler.
 * The header is checked in constant time; without a secret the endpoint stays
 * closed rather than open to the internet.
 */
app.get("/cron", async (req, res) => {
  const secret = ENV.CRON_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Scheduling is not configured" });
    return;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(String(req.headers.authorization ?? ""));
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const job = String(req.query.job ?? "all");
  if (job !== "webhooks" && job !== "retention" && job !== "all") {
    res.status(400).json({ error: "Unknown job" });
    return;
  }

  try {
    const result: Record<string, unknown> = {};
    if (job === "webhooks" || job === "all") {
      result.webhooks = await deliverWebhookBatch(db);
    }
    if (job === "retention" || job === "all") {
      result.retention = await purgeExpiredTrash(db);
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Scheduled job failed", error);
    res.status(500).json({ ok: false, error: "Scheduled job failed" });
  }
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

export default app;
