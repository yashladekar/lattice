import { afterEach, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { purgeExpiredTrash } from "./purge";

const STALE = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

describeWithDatabase("retention scheduler", () => {
  let db: Database;
  const workspaces: TestWorkspace[] = [];

  const withExpiredPage = async (retentionDays: number) => {
    const workspace = await createTestWorkspace(db, { retentionDays });
    workspaces.push(workspace);
    await db.page.create({
      data: {
        id: `itest_retention_${workspace.id}`,
        workspaceId: workspace.id,
        title: "Expired",
        createdById: workspace.ownerId,
        deletedAt: STALE,
      },
    });
    return workspace;
  };

  afterEach(async () => {
    for (const workspace of workspaces.splice(0)) {
      await cleanupTestWorkspace(db, workspace.id);
    }
    await db.$disconnect();
  });

  it("purges expired rows only in workspaces with a retention window", async () => {
    db = createTestDatabase();
    const expiring = await withExpiredPage(30);
    const keeping = await withExpiredPage(0);

    await purgeExpiredTrash(db);

    expect(await db.page.count({ where: { workspaceId: expiring.id } })).toBe(0);
    expect(await db.page.count({ where: { workspaceId: keeping.id } })).toBe(1);
  });

  it("leaves fresh trash alone", async () => {
    db = createTestDatabase();
    const workspace = await createTestWorkspace(db, { retentionDays: 30 });
    workspaces.push(workspace);
    await db.page.create({
      data: {
        id: `itest_recent_${workspace.id}`,
        workspaceId: workspace.id,
        title: "Recently deleted",
        createdById: workspace.ownerId,
        deletedAt: new Date(),
      },
    });

    await purgeExpiredTrash(db);

    expect(await db.page.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it("respects a legal hold when sweeping", async () => {
    db = createTestDatabase();
    const workspace = await withExpiredPage(30);
    await db.legalHold.create({
      data: {
        id: `hold_${workspace.id}`,
        workspaceId: workspace.id,
        scope: "WORKSPACE",
        targetId: null,
        reason: "integration test",
        createdById: workspace.ownerId,
      },
    });

    await purgeExpiredTrash(db);

    expect(await db.page.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });
});
