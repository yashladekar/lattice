import { parseSsoDomains, ssoDomainMatches } from "@notes-learning/domain";
import { z } from "zod";

import { publicProcedure } from "../index";

/**
 * Domain discovery for the login page. Given an email, say which workspace
 * claims its domain so the browser can start the SSO flow. Only the workspace
 * slug is returned — no issuer, no client id, no membership information — and
 * an unknown domain looks identical to a workspace that has no SSO.
 */
export const ssoRouter = {
  discover: publicProcedure
    .input(z.object({ email: z.string().trim().min(3).max(200) }))
    .handler(async ({ context, input }) => {
      const email = input.email.toLowerCase();
      const at = email.lastIndexOf("@");
      if (at < 0) return { workspaceSlug: null as string | null };
      const domain = email.slice(at + 1).trim();
      if (!domain) return { workspaceSlug: null as string | null };

      const connections = await context.db.ssoConnection.findMany({
        where: { enabled: true },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: { workspaceId: true, domains: true },
      });
      const match = connections.find((connection) =>
        ssoDomainMatches(parseSsoDomains(connection.domains), email),
      );
      if (!match) return { workspaceSlug: null as string | null };
      const workspace = await context.db.workspace.findUnique({
        where: { id: match.workspaceId },
        select: { slug: true, deletedAt: true },
      });
      if (!workspace || workspace.deletedAt) return { workspaceSlug: null as string | null };
      return { workspaceSlug: workspace.slug };
    }),
};
