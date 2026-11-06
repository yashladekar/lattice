import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { versionTimeline } from "./version-timeline";

const docWithLink = (targetId: string) => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "pageLink", attrs: { pageId: targetId, title: "Target" } }],
    },
  ],
});
const docWithoutLink = { type: "doc", content: [{ type: "paragraph" }] };

describeWithDatabase("version timeline", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const publicPage = "itest_vt_public";
  const privatePage = "itest_vt_private";
  const targetPage = "itest_vt_target";

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.page.createMany({
      data: [
        { id: publicPage, workspaceId: workspace.id, title: "Public", createdById: workspace.ownerId, visibility: "WORKSPACE" },
        { id: privatePage, workspaceId: workspace.id, title: "Private", createdById: workspace.ownerId, visibility: "PRIVATE" },
        { id: targetPage, workspaceId: workspace.id, title: "Target", createdById: workspace.ownerId },
      ],
    });
    await db.pageVersion.createMany({
      data: [
        { id: `v1_${workspace.id}`, workspaceId: workspace.id, pageId: publicPage, version: 1, title: "Public", content: docWithLink(targetPage), createdById: workspace.ownerId, createdAt: new Date(Date.now() - 3_000) },
        { id: `v2_${workspace.id}`, workspaceId: workspace.id, pageId: publicPage, version: 2, title: "Public", content: docWithoutLink, createdById: workspace.ownerId, createdAt: new Date(Date.now() - 2_000) },
        { id: `v3_${workspace.id}`, workspaceId: workspace.id, pageId: privatePage, version: 1, title: "Private", content: docWithLink(targetPage), createdById: workspace.ownerId, createdAt: new Date(Date.now() - 1_000) },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("derives the links each version contained", async () => {
    const entries = await versionTimeline(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "VIEWER",
      limit: 50,
    });
    const v1 = entries.find((entry) => entry.version === 1 && entry.pageId === publicPage);
    const v2 = entries.find((entry) => entry.version === 2 && entry.pageId === publicPage);
    expect(v1?.links).toEqual([targetPage]);
    expect(v2?.links).toEqual([]);
  });

  it("keeps private pages out of another member's timeline", async () => {
    const entries = await versionTimeline(db, {
      workspaceId: workspace.id,
      userId: "itest_someone_else",
      role: "VIEWER",
      limit: 50,
    });
    expect(entries.some((entry) => entry.pageId === privatePage)).toBe(false);
    expect(entries.some((entry) => entry.pageId === publicPage)).toBe(true);
  });

  it("never returns version bodies", async () => {
    const entries = await versionTimeline(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "VIEWER",
      limit: 50,
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("content");
    }
  });
});
