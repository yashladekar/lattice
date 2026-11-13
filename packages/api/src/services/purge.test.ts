import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { purgeWorkspaceTrash } from "./purge";

const STALE = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

describeWithDatabase("purge and legal holds", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const n1 = "itest_n1";
  const n2 = "itest_n2";
  const p1 = "itest_p1";
  const p2 = "itest_p2";
  const p3 = "itest_p3";
  const d1 = "itest_d1";
  const d2 = "itest_d2";

  const seed = async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db, { retentionDays: 30 });
    await db.notebook.createMany({
      data: [
        { id: `${n1}_${workspace.id}`, workspaceId: workspace.id, name: "Held", createdById: workspace.ownerId, deletedAt: STALE },
        { id: `${n2}_${workspace.id}`, workspaceId: workspace.id, name: "Scratch", createdById: workspace.ownerId, deletedAt: STALE },
      ],
    });
    await db.page.createMany({
      data: [
        { id: `${p1}_${workspace.id}`, workspaceId: workspace.id, notebookId: `${n1}_${workspace.id}`, title: "Held page", createdById: workspace.ownerId, deletedAt: STALE },
        { id: `${p2}_${workspace.id}`, workspaceId: workspace.id, notebookId: `${n2}_${workspace.id}`, title: "Scratch A", createdById: workspace.ownerId, deletedAt: STALE },
        { id: `${p3}_${workspace.id}`, workspaceId: workspace.id, notebookId: `${n2}_${workspace.id}`, title: "Scratch B", createdById: workspace.ownerId, deletedAt: STALE },
      ],
    });
    await db.deck.createMany({
      data: [
        { id: `${d1}_${workspace.id}`, workspaceId: workspace.id, notebookId: `${n1}_${workspace.id}`, name: "Held deck", deletedAt: STALE },
        { id: `${d2}_${workspace.id}`, workspaceId: workspace.id, notebookId: `${n2}_${workspace.id}`, name: "Scratch deck", deletedAt: STALE },
      ],
    });
    await db.flashcard.createMany({
      data: [
        { id: `itest_c1_${workspace.id}`, workspaceId: workspace.id, deckId: `${d1}_${workspace.id}`, pageId: `${p1}_${workspace.id}`, front: "q", back: "a", dueAt: new Date(), deletedAt: STALE },
        { id: `itest_c2_${workspace.id}`, workspaceId: workspace.id, deckId: `${d2}_${workspace.id}`, pageId: `${p2}_${workspace.id}`, front: "q", back: "a", dueAt: new Date(), deletedAt: STALE },
      ],
    });
  };

  const survivingPages = async () => {
    const rows = await db.page.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true },
    });
    return rows.map((row) => row.id).sort();
  };

  const hold = async (scope: "WORKSPACE" | "NOTEBOOK" | "PAGE", targetId: string | null) => {
    await db.legalHold.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        scope,
        targetId,
        reason: "integration test",
        createdById: workspace.ownerId,
      },
    });
  };

  afterEach(async () => {
    if (!workspace) return;
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("preserves only the page under a page hold", async () => {
    await seed();
    await hold("PAGE", `${p1}_${workspace.id}`);
    const result = await purgeWorkspaceTrash(db, workspace.id, 30);
    expect(result.purged).toBeGreaterThan(0);
    expect(await survivingPages()).toEqual([`${p1}_${workspace.id}`]);
  });

  it("preserves a held notebook, its pages, deck, and cards", async () => {
    await seed();
    await hold("NOTEBOOK", `${n1}_${workspace.id}`);
    await purgeWorkspaceTrash(db, workspace.id, 30);
    expect(await survivingPages()).toEqual([`${p1}_${workspace.id}`]);
    expect(await db.deck.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await db.flashcard.count({ where: { workspaceId: workspace.id } })).toBe(1);
    expect(await db.notebook.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it("records a tombstone for live cards removed with a stale deck", async () => {
    await seed();
    const cardId = `itest_livecard_${workspace.id}`;
    await db.flashcard.create({
      data: {
        id: cardId,
        workspaceId: workspace.id,
        deckId: `${d2}_${workspace.id}`,
        pageId: `${p2}_${workspace.id}`,
        front: "live question",
        back: "live answer",
        dueAt: new Date(),
      },
    });
    await purgeWorkspaceTrash(db, workspace.id, 30);
    expect(await db.flashcard.findUnique({ where: { id: cardId } })).toBeNull();
    expect(
      await db.syncChange.findFirst({
        where: {
          workspaceId: workspace.id,
          entity: "flashcard",
          entityId: cardId,
          op: "DELETE",
        },
      }),
    ).not.toBeNull();
  });

  it("unfiles live pages when their stale notebook is purged", async () => {
    await seed();
    const pageId = `itest_livepage_${workspace.id}`;
    await db.page.create({
      data: {
        id: pageId,
        workspaceId: workspace.id,
        notebookId: `${n2}_${workspace.id}`,
        title: "Live page",
        createdById: workspace.ownerId,
      },
    });
    await purgeWorkspaceTrash(db, workspace.id, 30);
    const page = await db.page.findUnique({ where: { id: pageId } });
    expect(page?.notebookId).toBeNull();
    expect(
      await db.syncChange.findFirst({
        where: {
          workspaceId: workspace.id,
          entity: "page",
          entityId: pageId,
          op: "UPSERT",
        },
      }),
    ).not.toBeNull();
    expect(await db.notebook.findUnique({ where: { id: `${n2}_${workspace.id}` } })).toBeNull();
  });

  it("purges nothing under a workspace hold", async () => {
    await seed();
    await hold("WORKSPACE", null);
    const result = await purgeWorkspaceTrash(db, workspace.id, 30);
    expect(result.purged).toBe(0);
    expect(await survivingPages()).toHaveLength(3);
  });

  it("stops protecting content once the hold is released", async () => {
    await seed();
    await hold("WORKSPACE", null);
    await db.legalHold.updateMany({
      where: { workspaceId: workspace.id },
      data: { releasedAt: new Date() },
    });
    const result = await purgeWorkspaceTrash(db, workspace.id, 30);
    expect(result.purged).toBeGreaterThan(0);
    expect(await survivingPages()).toEqual([]);
  });
});
