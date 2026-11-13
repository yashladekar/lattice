import { z } from "zod";

import { workspaceProcedure } from "../index";
import { describeConsoleViews, runConsoleQuery, type ConsoleResult } from "../services/console";

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return "Query failed.";
  const message = error.message
    .replace(/^Raw query failed\. Error code: \w+\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("at ") && !line.includes("Invalid `"))
    .join(" ")
    .trim();
  return message || "Query failed.";
}

export const consoleRouter = {
  schema: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    return { views: await describeConsoleViews(context.db) };
  }),

  run: workspaceProcedure("ADMIN")
    .input(z.object({ sql: z.string().min(1).max(20_000) }))
    .handler(
      async ({
        context,
        input,
      }): Promise<{ ok: true; result: ConsoleResult } | { ok: false; error: string }> => {
        try {
          const result = await runConsoleQuery(context.db, {
            workspaceId: context.workspaceId,
            sql: input.sql,
          });
          return { ok: true, result };
        } catch (error) {
          return { ok: false, error: describeError(error) };
        }
      },
    ),
};
