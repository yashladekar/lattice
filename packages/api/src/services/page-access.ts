import type { Database } from "@notes-learning/db";
import { hasRole, type Role } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

/**
 * The one copy of the page permission rule.
 *
 * Reading a page: admins, its author, workspace/public pages, and a SHARED page
 * you were granted. Writing additionally requires an editing grant on a SHARED
 * page. Callers that must check many pages at once (snapshot, search) still use
 * `getAccessiblePageIds`; this is for the single-page paths, so a viewer opening
 * a note does not load the whole workspace.
 */
export interface PageAccessRecord {
  id: string;
  workspaceId: string;
  createdById: string;
  visibility: string;
}

type PermissionReader = Pick<Database, "resourcePermission">;

const DENIED = {
  read: "You do not have access to this page",
  write: "You do not have edit access to this page",
} as const;

export async function assertPageAccess(
  db: PermissionReader,
  page: PageAccessRecord,
  userId: string,
  role: Role,
  mode: "read" | "write",
): Promise<void> {
  if (hasRole(role, "ADMIN")) return;
  if (page.createdById === userId) return;
  if (page.visibility === "PRIVATE") {
    throw new ORPCError("FORBIDDEN", { message: "This page is private" });
  }
  if (page.visibility !== "SHARED") return;

  const permission = await db.resourcePermission.findFirst({
    where: {
      workspaceId: page.workspaceId,
      resourceType: "PAGE",
      resourceId: page.id,
      userId,
    },
    select: { role: true },
  });
  if (!permission) throw new ORPCError("FORBIDDEN", { message: DENIED[mode] });
  if (mode === "write" && !hasRole(permission.role as Role, "EDITOR")) {
    throw new ORPCError("FORBIDDEN", { message: DENIED.write });
  }
}

/** Loads only the page being checked, then applies the shared rule. */
export async function assertPageReadable(
  db: Database,
  workspaceId: string,
  pageId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await assertPageAccessFor(db, workspaceId, pageId, userId, role, "read");
}

/** Loads only the page being checked, then requires write access. */
export async function assertPageWriteAccess(
  db: Database,
  workspaceId: string,
  pageId: string,
  userId: string,
  role: Role,
): Promise<void> {
  await assertPageAccessFor(db, workspaceId, pageId, userId, role, "write");
}

async function assertPageAccessFor(
  db: Database,
  workspaceId: string,
  pageId: string,
  userId: string,
  role: Role,
  mode: "read" | "write",
): Promise<void> {
  const page = await db.page.findFirst({
    where: { id: pageId, workspaceId, deletedAt: null },
    select: { id: true, workspaceId: true, createdById: true, visibility: true },
  });
  if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  await assertPageAccess(db, page, userId, role, mode);
}
