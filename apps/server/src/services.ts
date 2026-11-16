import { createAuth } from "@notes-learning/auth";
import { createPrismaClient } from "@notes-learning/db";
import { createUploadStore } from "@notes-learning/api/upload-store";

import { createChatGptCallbackListener } from "./chatgpt-callback";
import { ENV, desktopOrigins, uploadConfig, uploadRoot } from "./env.server";

export const db = createPrismaClient({
  DATABASE_URL: ENV.DATABASE_URL,
  // A serverless instance is its own pool. One connection keeps a burst of
  // cold starts from exhausting the database's connection limit.
  poolMax: ENV.DATABASE_POOL_MAX ?? (process.env.VERCEL ? 1 : undefined),
});

export const auth = createAuth(ENV, db, desktopOrigins);

export const uploadStore = createUploadStore({
  driver: uploadConfig.driver,
  localRoot: uploadRoot,
  s3: uploadConfig.s3,
});

/**
 * One listener for the whole process: the redirect URI includes its port, so a
 * second instance would produce a URI we never registered in the flow. A
 * serverless host cannot receive that loopback callback, so it omits the whole
 * surface instead of offering a flow that cannot finish.
 */
export const chatgptCallback = process.env.VERCEL
  ? null
  : createChatGptCallbackListener({
      db,
      keyMaterial: ENV.BETTER_AUTH_SECRET,
      appOrigin: ENV.CORS_ORIGIN,
    });
