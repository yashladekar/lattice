import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { appRouter } from "@notes-learning/api/routers/index";
import { OpenAPIHandler } from "@orpc/openapi/node";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import cors from "cors";
import express from "express";

import { createContext } from "./context";
import { attachCollaboration } from "./collaboration";
import { desktopOrigins, ENV, uploadDirectory } from "./env.server";
import { auth } from "./services";

const app = express();

app.set("trust proxy", 1);

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
app.use((req, res, next) => {
  const now = Date.now();
  const key = `${req.ip ?? "unknown"}:${req.path.startsWith("/api/auth") ? "auth" : "api"}`;
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
  } else {
    bucket.count += 1;
    if (bucket.count > (req.path.startsWith("/api/auth") ? 60 : 600)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }
  }
  next();
});

app.use(
  cors({
    origin: [ENV.CORS_ORIGIN, ...desktopOrigins, "http://localhost:3001", "http://localhost:8081"],
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-file-name", "x-workspace-id"],
    exposedHeaders: ["x-file-name"],
    credentials: true,
  }),
);

const uploadRoot = path.resolve(process.cwd(), uploadDirectory);
await mkdir(uploadRoot, { recursive: true });
app.use(
  "/uploads",
  express.static(uploadRoot, {
    maxAge: "1y",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  }),
);

app.post(
  "/uploads",
  express.raw({ type: "*/*", limit: "25mb" }),
  async (req, res) => {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }
    const rawName = (() => {
      const header = String(req.headers["x-file-name"] ?? "upload");
      try {
        return decodeURIComponent(header);
      } catch {
        return header;
      }
    })();
    const extension = path
      .extname(rawName)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, "")
      .slice(0, 10);
    const filename = `${randomUUID()}${extension}`;
    await writeFile(path.join(uploadRoot, filename), req.body);
    const url = `/uploads/${filename}`;
    res.json({
      id: randomUUID(),
      url,
      name: path.basename(rawName).slice(0, 200),
      size: req.body.length,
      mime: String(req.headers["content-type"] ?? "application/octet-stream"),
    });
  },
);

app.all("/api/auth{/*path}", toNodeHandler(auth));

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

const rpcHandler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});
const apiHandler = new OpenAPIHandler(appRouter, {
  plugins: [
    new OpenAPIReferencePlugin({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    }),
  ],
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
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
