import { z } from "zod";

import { workspaceProcedure } from "../index";
import { getAccessiblePageIds } from "../services/page-access";
import { searchWorkspace } from "../services/search";

export const searchRouter = {
  query: workspaceProcedure("VIEWER")
    .input(
      z.object({
        query: z.string().trim().max(300),
        limit: z.number().int().min(1).max(100).default(40),
        types: z
          .array(z.enum(["page", "canvas", "capture", "flashcard"]))
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!input.query) return [];
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      return searchWorkspace(context.db, {
        workspaceId: context.workspaceId,
        query: input.query,
        limit: input.limit,
        types: input.types,
        allowedPageIds: allowed,
      });
    }),
};
