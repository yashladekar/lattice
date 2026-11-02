import { createAuth } from "@notes-learning/auth";
import { createPrismaClient } from "@notes-learning/db";

import { ENV, desktopOrigins } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db, desktopOrigins);
