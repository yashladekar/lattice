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
import { movePageSubtree } from "./page-move";

describeWithDatabase("page move", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const notebookA = randomUUID();
  const notebookB = randomUUID();
  const notebookC = randomUUID();
  const parentId = randomUUID();
  const childId = randomUUID();
  const grandchildId = randomUUID();
  const alphaId = randomUUID();
  const betaId = randomUUID();
  const gammaId = randomUUID();
  const targetId = randomUUID();
  const targetChildId = randomUUID();
  const firstId = randomUUID();
  const secondId = randomUUID();
  const thirdId = randomUUID();

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.notebook.createMany({
      data: [
        { id: notebookA, workspaceId: workspace.id, name: "A", createdById: workspace.ownerId },
        { id: notebookB, workspaceId: workspace.id, name: "B", createdById: workspace.ownerId },
        { id: notebookC, workspaceId: workspace.id, name: "C", createdById: workspace.ownerId },
      ],
    });

    const page = (
      id: string,
      title: string,
      notebookId: string,
      parent: string | null = null,
      sortOrder = 1000,
    ) => ({
      id,
      workspaceId: workspace.id,
      notebookId,
      parentId: parent,
      title,
      sortOrder,
      createdById: workspace.ownerId,
    });

    for (const entry of [
      page(parentId, "Parent", notebookA),
      page(childId, "Child", notebookA, parentId),
      page(grandchildId, "Grandchild", notebookA, childId),
      page(alphaId, "Alpha", notebookA, null, 1000),
      page(betaId, "Beta", notebookA, null, 2000),
      page(gammaId, "Gamma", notebookA, null, 3000),
      page(targetId, "Target", notebookB),
      page(targetChildId, "Target child", notebookB, targetId, 1000),
      page(firstId, "First", notebookC, null, 1),
      page(secondId, "Second", notebookC, null, 50),
      page(thirdId, "Third", notebookC, null, 2),
    ]) {
      await db.page.create({ data: entry });
    }
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("reorders a sibling before another one", async () => {
    const moved = await movePageSubtree(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "OWNER",
      pageId: gammaId,
      parentId: null,
      notebookId: notebookA,
      beforeId: alphaId,
    });
    expect(moved.parentId).toBeNull();
    expect(moved.notebookId).toBe(notebookA);
    const alpha = await db.page.findUniqueOrThrow({ where: { id: alphaId } });
    expect(moved.sortOrder).toBeLessThan(alpha.sortOrder);
  });

  it("renumbers adjacent siblings instead of colliding", async () => {
    const moved = await movePageSubtree(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "OWNER",
      pageId: secondId,
      parentId: null,
      notebookId: notebookC,
      beforeId: thirdId,
    });
    expect(moved.sortOrder).toBe(2000);
    const first = await db.page.findUniqueOrThrow({ where: { id: firstId } });
    const third = await db.page.findUniqueOrThrow({ where: { id: thirdId } });
    expect(first.sortOrder).toBe(1000);
    expect(third.sortOrder).toBe(3000);
  });

  it("carries the subtree into the destination notebook", async () => {
    const moved = await movePageSubtree(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "OWNER",
      pageId: parentId,
      parentId: targetId,
      notebookId: notebookB,
    });
    expect(moved.parentId).toBe(targetId);
    expect(moved.notebookId).toBe(notebookB);
    expect(moved.sortOrder).toBeGreaterThan(1000);

    const child = await db.page.findUniqueOrThrow({ where: { id: childId } });
    const grandchild = await db.page.findUniqueOrThrow({ where: { id: grandchildId } });
    expect(child.notebookId).toBe(notebookB);
    expect(grandchild.notebookId).toBe(notebookB);
    expect(child.parentId).toBe(parentId);
    expect(grandchild.parentId).toBe(childId);
  });

  it("refuses a move into its own descendant", async () => {
    await expect(
      movePageSubtree(db, {
        workspaceId: workspace.id,
        userId: workspace.ownerId,
        role: "OWNER",
        pageId: parentId,
        parentId: grandchildId,
        notebookId: notebookB,
      }),
    ).rejects.toThrow(/cycle/);
  });
});
