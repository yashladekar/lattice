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
import { restorePageSubtree } from "./page-tree";
import { pushSync } from "./sync";

describeWithDatabase("page subtree delete and restore", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const parentId = randomUUID();
  const childId = randomUUID();
  const grandchildId = randomUUID();
  const edgeId = randomUUID();

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `p-${randomUUID()}`,
          entity: "page",
          entityId: parentId,
          op: "UPSERT",
          payload: { title: "Parent" },
        },
        {
          opId: `c-${randomUUID()}`,
          entity: "page",
          entityId: childId,
          op: "UPSERT",
          payload: { title: "Child", parentId },
        },
        {
          opId: `g-${randomUUID()}`,
          entity: "page",
          entityId: grandchildId,
          op: "UPSERT",
          payload: { title: "Grandchild", parentId: childId },
        },
        {
          opId: `e-${randomUUID()}`,
          entity: "edge",
          entityId: edgeId,
          op: "UPSERT",
          payload: {
            sourceNodeId: parentId,
            targetNodeId: childId,
            relationType: "PART_OF",
          },
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("trashes the whole subtree and detaches its edges", async () => {
    await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `d-${randomUUID()}`,
          entity: "page",
          entityId: parentId,
          op: "DELETE",
          payload: {},
        },
      ],
    });

    const pages = await db.page.findMany({
      where: { id: { in: [parentId, childId, grandchildId] } },
    });
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => page.deletedAt instanceof Date)).toBe(true);

    const edge = await db.knowledgeEdge.findUnique({ where: { id: edgeId } });
    expect(edge?.deletedAt).toBeInstanceOf(Date);

    const changes = await db.syncChange.findMany({
      where: { workspaceId: workspace.id, entity: "page", op: "DELETE" },
    });
    expect(new Set(changes.map((change) => change.entityId))).toEqual(
      new Set([parentId, childId, grandchildId]),
    );
  });

  it("restores the subtree and the edges inside it", async () => {
    const before = await db.syncChange.count({
      where: { workspaceId: workspace.id, entity: "page", op: "UPSERT" },
    });

    const restored = await restorePageSubtree(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      pageId: parentId,
    });

    expect(restored.id).toBe(parentId);
    const pages = await db.page.findMany({
      where: { id: { in: [parentId, childId, grandchildId] } },
    });
    expect(pages.every((page) => page.deletedAt === null)).toBe(true);

    const edge = await db.knowledgeEdge.findUnique({ where: { id: edgeId } });
    expect(edge?.deletedAt).toBeNull();

    const after = await db.syncChange.count({
      where: { workspaceId: workspace.id, entity: "page", op: "UPSERT" },
    });
    expect(after - before).toBeGreaterThanOrEqual(3);
  });
});
