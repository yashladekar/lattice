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
import { snapshotPage, type SnapshotPage } from "./snapshot";

const collect = async (
  db: Database,
  input: { workspaceId: string; userId: string; role: string; pageSize: number },
): Promise<SnapshotPage[]> => {
  const pages: SnapshotPage[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await snapshotPage(db, { ...input, cursor });
    pages.push(page);
    if (page.done) return pages;
    expect(page.cursor).toBeTruthy();
    cursor = page.cursor;
  }
  throw new Error("snapshot did not finish");
};

const merge = (pages: SnapshotPage[]) => {
  const merged: Record<string, unknown[]> = {};
  for (const page of pages) {
    for (const [key, rows] of Object.entries(page.payload)) {
      if (!Array.isArray(rows)) continue;
      merged[key] = [...(merged[key] ?? []), ...rows];
    }
  }
  return merged;
};

describeWithDatabase("paged snapshot", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const viewerId = `itest_snapshot_viewer_${randomUUID()}`;
  const publicPage = `itest_snap_public_${randomUUID()}`;
  const privatePage = `itest_snap_private_${randomUUID()}`;
  const targetPage = `itest_snap_target_${randomUUID()}`;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: viewerId,
        role: "VIEWER",
        status: "ACTIVE",
      },
    });
    const notebook = await db.notebook.create({
      data: { id: randomUUID(), workspaceId: workspace.id, name: "Notebook", createdById: workspace.ownerId },
    });
    await db.page.createMany({
      data: [
        {
          id: publicPage,
          workspaceId: workspace.id,
          notebookId: notebook.id,
          title: "Public",
          createdById: workspace.ownerId,
          visibility: "WORKSPACE",
        },
        {
          id: privatePage,
          workspaceId: workspace.id,
          title: "Private",
          createdById: workspace.ownerId,
          visibility: "PRIVATE",
        },
        {
          id: targetPage,
          workspaceId: workspace.id,
          title: "Target",
          createdById: workspace.ownerId,
        },
      ],
    });
    await db.pageDocument.createMany({
      data: [
        { pageId: publicPage, workspaceId: workspace.id, content: { type: "doc", content: [] }, plainText: "public" },
        { pageId: privatePage, workspaceId: workspace.id, content: { type: "doc", content: [] }, plainText: "private" },
        { pageId: targetPage, workspaceId: workspace.id, content: { type: "doc", content: [] }, plainText: "target" },
      ],
    });
    const nodePublic = await db.knowledgeNode.create({
      data: { id: randomUUID(), workspaceId: workspace.id, pageId: publicPage, title: "Public", kind: "PAGE" },
    });
    const nodePrivate = await db.knowledgeNode.create({
      data: { id: randomUUID(), workspaceId: workspace.id, pageId: privatePage, title: "Private", kind: "PAGE" },
    });
    await db.knowledgeEdge.createMany({
      data: [
        {
          id: randomUUID(),
          workspaceId: workspace.id,
          sourceNodeId: nodePublic.id,
          targetNodeId: nodePublic.id,
          relationType: "RELATED_TO",
        },
        {
          id: randomUUID(),
          workspaceId: workspace.id,
          sourceNodeId: nodePublic.id,
          targetNodeId: nodePrivate.id,
          relationType: "RELATED_TO",
        },
      ],
    });
    await db.comment.createMany({
      data: [
        { id: randomUUID(), workspaceId: workspace.id, pageId: publicPage, authorId: workspace.ownerId, body: "public" },
        { id: randomUUID(), workspaceId: workspace.id, pageId: privatePage, authorId: workspace.ownerId, body: "private" },
      ],
    });
    const tag = await db.tag.create({ data: { id: randomUUID(), workspaceId: workspace.id, name: "tag" } });
    await db.pageTag.createMany({
      data: [
        { id: randomUUID(), pageId: publicPage, tagId: tag.id },
        { id: randomUUID(), pageId: privatePage, tagId: tag.id },
      ],
    });
    await db.capture.create({
      data: { id: randomUUID(), workspaceId: workspace.id, type: "NOTE", title: "Snap", content: "x", createdById: workspace.ownerId },
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("pages every collection and reports one version", async () => {
    const pages = await collect(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "ADMIN",
      pageSize: 2,
    });
    const workspaceRow = await db.workspace.findUnique({ where: { id: workspace.id } });
    for (const page of pages) expect(page.version).toBe(workspaceRow!.syncVersion);
    expect(pages.at(-1)?.done).toBe(true);

    const merged = merge(pages);
    expect(merged.pages).toHaveLength(3);
    expect(merged.pageDocuments).toHaveLength(3);
    expect(merged.comments).toHaveLength(2);
    expect(merged.pageTags).toHaveLength(2);
    expect(merged.nodes).toHaveLength(2);
    expect(merged.edges).toHaveLength(2);
    expect(merged.captures).toHaveLength(1);
    expect(pages.length).toBeGreaterThan(5);

    const pageIds = (merged.pages ?? []).map((row) => (row as { id: string }).id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
  });

  it("filters what a viewer may not read, including edges to private pages", async () => {
    const pages = await collect(db, {
      workspaceId: workspace.id,
      userId: viewerId,
      role: "VIEWER",
      pageSize: 2,
    });
    const merged = merge(pages);
    expect(merged.pages).toHaveLength(2);
    expect(merged.pageDocuments).toHaveLength(2);
    expect(merged.comments).toHaveLength(1);
    expect(merged.pageTags).toHaveLength(1);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.edges).toHaveLength(1);
    const pageIds = (merged.pages ?? []).map((row) => (row as { id: string }).id);
    expect(pageIds).not.toContain(privatePage);
  });

  it("refuses an invalid cursor", async () => {
    await expect(
      snapshotPage(db, {
        workspaceId: workspace.id,
        userId: workspace.ownerId,
        role: "ADMIN",
        cursor: "not-a-cursor",
      }),
    ).rejects.toThrow(/cursor/i);
  });
});
