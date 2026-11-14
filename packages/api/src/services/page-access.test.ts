import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import {
  assertPageAccess,
  assertPageReadable,
  filterAccessiblePageIds,
  getAccessiblePageIds,
  readablePageWhere,
} from "./page-access";

const page = (overrides: Partial<Parameters<typeof assertPageAccess>[1]> = {}) => ({
  id: "itest_access_page",
  workspaceId: "itest_access_ws",
  createdById: "author",
  visibility: "WORKSPACE",
  ...overrides,
});

const mode = async (promise: Promise<void>) => {
  try {
    await promise;
    return "allowed";
  } catch (error) {
    return error instanceof Error ? error.message : "denied";
  }
};

describeWithDatabase("page access rule", () => {
  let db: Database;
  let workspace: TestWorkspace;
  let otherWorkspace: TestWorkspace;
  const pageId = `itest_access_${randomUUID()}`;
  const workspacePageId = `itest_access_workspace_${randomUUID()}`;
  const privatePageId = `itest_access_private_${randomUUID()}`;
  const grantedPageId = `itest_access_granted_${randomUUID()}`;
  const sharedNoGrantPageId = `itest_access_shared_${randomUUID()}`;
  const deletedPageId = `itest_access_deleted_${randomUUID()}`;
  const otherWorkspacePageId = `itest_access_other_ws_${randomUUID()}`;
  const otherUserId = "itest_access_other";

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    otherWorkspace = await createTestWorkspace(db);
    await db.page.createMany({
      data: [
        {
          id: pageId,
          workspaceId: workspace.id,
          title: "Shared page",
          createdById: workspace.ownerId,
          visibility: "SHARED",
        },
        {
          id: workspacePageId,
          workspaceId: workspace.id,
          title: "Workspace page",
          createdById: "itest_access_author",
          visibility: "WORKSPACE",
        },
        {
          id: privatePageId,
          workspaceId: workspace.id,
          title: "Private page",
          createdById: "itest_access_author",
          visibility: "PRIVATE",
        },
        {
          id: grantedPageId,
          workspaceId: workspace.id,
          title: "Granted page",
          createdById: "itest_access_author",
          visibility: "SHARED",
        },
        {
          id: sharedNoGrantPageId,
          workspaceId: workspace.id,
          title: "Ungranted shared page",
          createdById: "itest_access_author",
          visibility: "SHARED",
        },
        {
          id: deletedPageId,
          workspaceId: workspace.id,
          title: "Deleted workspace page",
          createdById: "itest_access_author",
          visibility: "WORKSPACE",
          deletedAt: new Date(),
        },
        {
          id: otherWorkspacePageId,
          workspaceId: otherWorkspace.id,
          title: "Other workspace page",
          createdById: "itest_access_author",
          visibility: "WORKSPACE",
        },
      ],
    });
    await db.resourcePermission.create({
      data: {
        id: `itest_perm_bulk_${randomUUID()}`,
        workspaceId: workspace.id,
        resourceType: "PAGE",
        resourceId: grantedPageId,
        userId: otherUserId,
        role: "VIEWER",
      },
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await cleanupTestWorkspace(db, otherWorkspace.id);
    await db.$disconnect();
  });

  it("lets admins and the author through", async () => {
    expect(await mode(assertPageAccess(db, page(), "someone", "ADMIN", "read"))).toBe("allowed");
    expect(await mode(assertPageAccess(db, page(), "author", "VIEWER", "write"))).toBe("allowed");
  });

  it("allows workspace and public pages, refuses private ones", async () => {
    expect(await mode(assertPageAccess(db, page(), otherUserId, "VIEWER", "read"))).toBe("allowed");
    expect(
      await mode(assertPageAccess(db, page({ visibility: "PUBLIC" }), otherUserId, "VIEWER", "read")),
    ).toBe("allowed");
    expect(
      await mode(assertPageAccess(db, page({ visibility: "PRIVATE" }), otherUserId, "VIEWER", "read")),
    ).toBe("This page is private");
  });

  it("requires a grant on SHARED pages and an editing grant to write", async () => {
    const shared = page({ id: pageId, workspaceId: workspace.id, visibility: "SHARED" });
    expect(await mode(assertPageAccess(db, shared, otherUserId, "VIEWER", "read"))).toBe(
      "You do not have access to this page",
    );

    await db.resourcePermission.create({
      data: {
        id: `itest_perm_read_${randomUUID()}`,
        workspaceId: workspace.id,
        resourceType: "PAGE",
        resourceId: pageId,
        userId: otherUserId,
        role: "VIEWER",
      },
    });
    expect(await mode(assertPageAccess(db, shared, otherUserId, "VIEWER", "read"))).toBe("allowed");
    expect(await mode(assertPageAccess(db, shared, otherUserId, "VIEWER", "write"))).toBe(
      "You do not have edit access to this page",
    );

    await db.resourcePermission.updateMany({
      where: { workspaceId: workspace.id, resourceId: pageId, userId: otherUserId },
      data: { role: "EDITOR" },
    });
    expect(await mode(assertPageAccess(db, shared, otherUserId, "VIEWER", "write"))).toBe(
      "allowed",
    );
  });

  it("loads only the page it is checking", async () => {
    await expect(
      assertPageReadable(db, workspace.id, pageId, otherUserId, "VIEWER"),
    ).resolves.toBeUndefined();
    await expect(
      assertPageReadable(db, workspace.id, "itest_missing_page", otherUserId, "VIEWER"),
    ).rejects.toThrow(/not found/i);
  });

  it("builds a workspace-scoped filter, and admins are never narrowed", async () => {
    const scope = {
      workspaceId: workspace.id,
      userId: otherUserId,
      role: "VIEWER" as const,
    };
    const where = await readablePageWhere(db, scope);
    expect(where.workspaceId).toBe(workspace.id);

    const visible = await db.page.findMany({
      where: { ...where, deletedAt: null },
      select: { id: true },
    });
    const ids = new Set(visible.map((row) => row.id));
    expect(ids.has(workspacePageId)).toBe(true);
    expect(ids.has(grantedPageId)).toBe(true);
    expect(ids.has(privatePageId)).toBe(false);
    expect(ids.has(sharedNoGrantPageId)).toBe(false);
    expect(ids.has(otherWorkspacePageId)).toBe(false);

    await expect(readablePageWhere(db, { ...scope, role: "ADMIN" })).resolves.toEqual({
      workspaceId: workspace.id,
    });
  });

  it("computes the bulk set with the same rule as the single-page check", async () => {
    const allowed = await getAccessiblePageIds(db, workspace.id, otherUserId, "VIEWER");
    expect(allowed).not.toBeNull();
    expect(allowed!.has(workspacePageId)).toBe(true);
    expect(allowed!.has(grantedPageId)).toBe(true);
    expect(allowed!.has(privatePageId)).toBe(false);
    expect(allowed!.has(sharedNoGrantPageId)).toBe(false);
    expect(allowed!.has(otherWorkspacePageId)).toBe(false);
    // Trash still needs deleted pages in the set.
    expect(allowed!.has(deletedPageId)).toBe(true);
    await expect(getAccessiblePageIds(db, workspace.id, otherUserId, "ADMIN")).resolves.toBeNull();
  });

  it("filters only the page ids a change batch mentions", async () => {
    const scope = {
      workspaceId: workspace.id,
      userId: otherUserId,
      role: "VIEWER" as const,
    };
    const allowed = await filterAccessiblePageIds(db, scope, [
      workspacePageId,
      privatePageId,
      grantedPageId,
      otherWorkspacePageId,
    ]);
    expect(allowed).not.toBeNull();
    expect([...allowed!].sort()).toEqual([grantedPageId, workspacePageId].sort());
    await expect(filterAccessiblePageIds(db, scope, [])).resolves.toEqual(new Set());
    await expect(
      filterAccessiblePageIds(db, { ...scope, role: "ADMIN" }, [privatePageId]),
    ).resolves.toBeNull();
  });
});
