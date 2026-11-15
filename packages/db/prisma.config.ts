import path from "node:path";

import { defineConfig, env } from "prisma/config";
import "varlock/auto-load";

export default defineConfig({
  schema: path.join("prisma", "schema"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    // A pooled URL is what the application should use at runtime. Migrations
    // need a direct connection, which providers such as Neon and Supabase
    // expose separately (Neon names it DATABASE_URL_UNPOOLED).
    url:
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL_UNPOOLED ||
      env("DATABASE_URL"),
  },
});
