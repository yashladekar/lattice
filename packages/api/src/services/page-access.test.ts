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
import { assertPageAccess, assertPageReadable } from "./page-access";

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
  const pageId = `itest_access_${randomUUID()}`;
  const otherUserId = "itest_access_other";

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.page.create({
      data: {
        id: pageId,
        workspaceId: workspace.id,
        title: "Shared page",
        createdById: workspace.ownerId,
        visibility: "SHARED",
      },
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
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
});
