import { createAuth } from "@notes-learning/auth";
import { createPrismaClient } from "@notes-learning/db";

import { createChatGptCallbackListener } from "./chatgpt-callback";
import { ENV, desktopOrigins } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);

/**
 * One listener for the whole process: the redirect URI includes its port, so a
 * second instance would produce a URI we never registered in the flow.
 */
export const chatgptCallback = createChatGptCallbackListener({
  db,
  keyMaterial: ENV.BETTER_AUTH_SECRET,
  appOrigin: ENV.CORS_ORIGIN,
});
