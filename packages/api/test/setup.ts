import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Integration tests run against the same Postgres as the app. When the shell
 * has no DATABASE_URL, read the dev server's env file directly so `pnpm test`
 * works from a fresh checkout with `pnpm dev:server` configured.
 */
const here = dirname(fileURLToPath(import.meta.url));
const envFiles = [
  join(here, "../../../apps/server/.env"),
  join(here, "../../../.env"),
];

if (!process.env.DATABASE_URL) {
  for (const file of envFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = (raw ?? "").replace(/^["']|["']$/g, "");
    }
    if (process.env.DATABASE_URL) break;
  }
}

export const hasDatabase = Boolean(process.env.DATABASE_URL);
