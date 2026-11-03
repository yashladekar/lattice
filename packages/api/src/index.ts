import { hasRole, type Role } from "@notes-learning/domain";
import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

export const requireAuth = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      session: context.session,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);

export const workspaceProcedure = (minimumRole: Role = "VIEWER") =>
  protectedProcedure.use(async ({ context, next }, input) => {
    if (!context.session?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }
    const workspaceId =
      context.headers.get("x-workspace-id") ??
      (typeof input === "object" && input !== null && "workspaceId" in input
        ? (input as { workspaceId?: unknown }).workspaceId
        : undefined);
    if (typeof workspaceId !== "string" || !workspaceId) {
      throw new ORPCError("BAD_REQUEST", { message: "workspaceId is required" });
    }
    const membership = await context.db.workspaceMember.findFirst({
      where: {
        workspaceId,
        userId: context.session.user.id,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true, role: true },
    });
    if (!membership) {
      throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    }
    const role = membership.role as Role;
    if (!hasRole(role, minimumRole)) {
      throw new ORPCError("FORBIDDEN", {
        message: `Requires ${minimumRole.toLowerCase()} access`,
      });
    }
    return next({
      context: {
        session: context.session,
        workspaceId,
        role,
        userId: context.session.user.id,
        membershipId: membership.id,
      },
    });
  });
