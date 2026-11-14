import type { Database, Prisma } from "@notes-learning/db";
import { hasRole, type Role } from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

/**
 * The one copy of the page permission rule.
 *
 * Reading a page: admins, its author, workspace/public pages, and a SHARED page
 * you were granted. Writing additionally requires an editing grant on a SHARED
 * page. The same rule has two surfaces: `assertPageAccess` for one page, and
 * `readablePageWhere` for queries that must not load invisible rows. Bulk
 * callers that need a set (snapshot, search) use `getAccessiblePageIds`;
 * change-log filtering uses `filterAccessiblePageIds` so a pull only checks the
 * pages it is about to return.
 */
export interface PageAccessRecord {
  id: string;
  workspaceId: string;
  createdById: string;
  visibility: string;
}

export interface PageAccessScope {
  workspaceId: string;
  userId: string;
  role: Role;
}

type PageReader = Pick<Database, "page" | "resourcePermission">;
type PermissionReader = Pick<Database, "resourcePermission">;

const READABLE_VISIBILITIES = ["WORKSPACE", "PUBLIC"] as const;

const DENIED = {
  read: "You do not have access to this page",
  write: "You do not have edit access to this page",
} as const;

/**
 * Prisma filter for pages the scope may read. Always includes the workspace id,
 * so a caller can spread it into a page query without opening a cross-workspace
 * hole. Admins get the workspace-only filter; everyone else gets author,
 * workspace/public visibility, or an explicit PAGE grant.
 */
export async function readablePageWhere(
  db: PageReader,
  scope: PageAccessScope,
): Promise<Prisma.PageWhereInput> {
  const { workspaceId, userId, role } = scope;
  if (hasRole(role, "ADMIN")) return { workspaceId };
  const grants = await db.resourcePermission.findMany({
    where: { workspaceId, userId, resourceType: "PAGE" },
    select: { resourceId: true },
  });
  return {
    workspaceId,
    OR: [
      { createdById: userId },
      { visibility: { in: [...READABLE_VISIBILITIES] } },
      ...(grants.length ? [{ id: { in: grants.map((grant) => grant.resourceId) } }] : []),
    ],
  };
}

/**
 * Every readable page id in the workspace, or null when the role needs no
 * filter. Deleted pages stay in the set so trash and tombstones remain visible.
 */
export async function getAccessiblePageIds(
  db: PageReader,
  workspaceId: string,
  userId: string,
  role: Role,
): Promise<Set<string> | null> {
  if (hasRole(role, "ADMIN")) return null;
  const where = await readablePageWhere(db, { workspaceId, userId, role });
  const pages = await db.page.findMany({ where, select: { id: true } });
  return new Set(pages.map((page) => page.id));
}

/**
 * Which of the given page ids the scope may read. Used by the sync pull so the
 * cost tracks the change batch, not the size of the workspace. Null means the
 * role needs no filtering at all.
 */
export async function filterAccessiblePageIds(
  db: PageReader,
  scope: PageAccessScope,
  pageIds: Iterable<string>,
): Promise<Set<string> | null> {
  if (hasRole(scope.role, "ADMIN")) return null;
  const ids = [...new Set(pageIds)];
  if (!ids.length) return new Set();
  const where = await readablePageWhere(db, scope);
  const pages = await db.page.findMany({
    where: { AND: [where, { id: { in: ids } }] },
    select: { id: true },
  });
  return new Set(pages.map((page) => page.id));
}

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
