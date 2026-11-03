import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { hasRole, type Role } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

export async function getMembership(
  db: Database,
  userId: string,
  workspaceId: string,
): Promise<{ id: string; role: Role } | null> {
  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId, userId, status: "ACTIVE", deletedAt: null },
    select: { id: true, role: true },
  });
  if (!membership) return null;
  return { id: membership.id, role: membership.role as Role };
}

export async function requireMembership(
  db: Database,
  userId: string,
  workspaceId: string,
  minimumRole: Role = "VIEWER",
): Promise<{ id: string; role: Role }> {
  const membership = await getMembership(db, userId, workspaceId);
  if (!membership) throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
  if (!hasRole(membership.role, minimumRole)) {
    throw new ORPCError("FORBIDDEN", { message: `Requires ${minimumRole.toLowerCase()} access` });
  }
  return membership;
}

export async function assertResourceInWorkspace(
  db: Database,
  resource: "page" | "canvas" | "notebook",
  resourceId: string,
  workspaceId: string,
): Promise<void> {
  if (resource === "page") {
    const page = await db.page.findFirst({
      where: { id: resourceId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
    return;
  }
  if (resource === "canvas") {
    const canvas = await db.canvas.findFirst({
      where: { id: resourceId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!canvas) throw new ORPCError("NOT_FOUND", { message: "Canvas not found" });
    return;
  }
  const notebook = await db.notebook.findFirst({
    where: { id: resourceId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!notebook) throw new ORPCError("NOT_FOUND", { message: "Notebook not found" });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createToken(bytes = 32): { token: string; tokenHash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function isShareActive(link: {
  revokedAt: Date | null;
  expiresAt: Date | null;
}): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return false;
  return true;
}

export async function writeAudit(
  db: Database,
  input: {
    workspaceId: string;
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      id: `audit_${randomBytes(8).toString("hex")}`,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      metadata: (input.metadata ?? {}) as never,
    },
  });
}
