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
import { resolvePublicPage } from "./share-page";

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describeWithDatabase("public page share", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const rootId = randomUUID();
  const childId = randomUUID();
  const grandchildId = randomUUID();
  const publicChildId = randomUUID();
  const privateChildId = randomUUID();
  const sharedChildId = randomUUID();
  const hiddenGrandchildId = randomUUID();

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);

    const page = (
      id: string,
      title: string,
      parentId: string | null,
      visibility: string,
      sortOrder: number,
    ) => ({
      id,
      workspaceId: workspace.id,
      title,
      parentId,
      visibility,
      sortOrder,
      createdById: workspace.ownerId,
    });

    for (const entry of [
      page(rootId, "Root", null, "WORKSPACE", 1000),
      page(childId, "Child", rootId, "WORKSPACE", 1000),
      page(grandchildId, "Grandchild", childId, "WORKSPACE", 1000),
      page(privateChildId, "Private child", rootId, "PRIVATE", 2000),
      page(sharedChildId, "Shared child", rootId, "SHARED", 3000),
      page(publicChildId, "Public child", rootId, "PUBLIC", 4000),
      page(hiddenGrandchildId, "Hidden grandchild", privateChildId, "WORKSPACE", 1000),
    ]) {
      await db.page.create({ data: entry });
    }

    for (const [id, text] of [
      [rootId, "Root body"],
      [childId, "Child body"],
      [grandchildId, "Grandchild body"],
      [publicChildId, "Public body"],
      [privateChildId, "Private body"],
      [sharedChildId, "Shared body"],
      [hiddenGrandchildId, "Hidden body"],
    ] as const) {
      await db.pageDocument.create({
        data: {
          pageId: id,
          workspaceId: workspace.id,
          content: body(text),
          plainText: text,
        },
      });
    }
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("lists only workspace and public descendants in tree order", async () => {
    const resolved = await resolvePublicPage(db, {
      workspaceId: workspace.id,
      rootPageId: rootId,
      includeSubPages: true,
    });

    expect(resolved.page.id).toBe(rootId);
    expect(resolved.page.plainText).toBe("Root body");
    expect(resolved.trail.map((entry) => entry.id)).toEqual([rootId]);
    expect(resolved.subPages.map((entry) => entry.id)).toEqual([
      childId,
      grandchildId,
      publicChildId,
    ]);
  });

  it("opens a descendant and builds its shared trail", async () => {
    const resolved = await resolvePublicPage(db, {
      workspaceId: workspace.id,
      rootPageId: rootId,
      includeSubPages: true,
      pageId: grandchildId,
    });

    expect(resolved.page.id).toBe(grandchildId);
    expect(resolved.page.plainText).toBe("Grandchild body");
    expect(resolved.trail.map((entry) => entry.id)).toEqual([rootId, childId, grandchildId]);
    expect(resolved.subPages).toHaveLength(3);
  });

  it("hides private, shared, and descendants beneath a hidden page", async () => {
    for (const pageId of [privateChildId, sharedChildId, hiddenGrandchildId]) {
      await expect(
        resolvePublicPage(db, {
          workspaceId: workspace.id,
          rootPageId: rootId,
          includeSubPages: true,
          pageId,
        }),
      ).rejects.toThrow(/not shared/);
    }
  });

  it("does not expose a child when the link only shared the root", async () => {
    await expect(
      resolvePublicPage(db, {
        workspaceId: workspace.id,
        rootPageId: rootId,
        includeSubPages: false,
        pageId: childId,
      }),
    ).rejects.toThrow(/not shared/);
  });
});
