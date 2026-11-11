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
import { duplicatePageSubtree } from "./page-duplicate";

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describeWithDatabase("page duplicate", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const memberId = `itest_duplicate_member_${randomUUID()}`;
  const parentId = randomUUID();
  const childId = randomUUID();
  const grandchildId = randomUUID();
  const memberRootId = randomUUID();
  const privateChildId = randomUUID();

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: memberId,
        role: "MEMBER",
        status: "ACTIVE",
      },
    });

    const page = (
      id: string,
      title: string,
      parentId: string | null,
      createdById: string,
      visibility: string,
      sortOrder: number,
    ) => ({
      id,
      workspaceId: workspace.id,
      parentId,
      title,
      createdById,
      visibility,
      sortOrder,
    });
    for (const entry of [
      page(parentId, "Parent", null, workspace.ownerId, "WORKSPACE", 1000),
      page(childId, "Child", parentId, workspace.ownerId, "WORKSPACE", 1000),
      page(grandchildId, "Grandchild", childId, workspace.ownerId, "WORKSPACE", 1000),
      page(memberRootId, "Member note", null, memberId, "WORKSPACE", 2000),
      page(privateChildId, "Private child", memberRootId, workspace.ownerId, "PRIVATE", 1000),
    ]) {
      await db.page.create({ data: entry });
    }

    for (const [id, text] of [
      [parentId, "Parent body"],
      [childId, "Child body"],
      [grandchildId, "Grandchild body"],
      [memberRootId, "Member body"],
      [privateChildId, "Private body"],
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

    await db.page.update({
      where: { id: parentId },
      data: {
        coverUrl: "https://example.com/cover.png",
        properties: { favorite: true, status: "seed" },
      },
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("copies the page and its readable subtree with documents", async () => {
    const copy = await duplicatePageSubtree(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      role: "OWNER",
      pageId: parentId,
    });

    expect(copy.title).toBe("Parent copy");
    expect(copy.parentId).toBeNull();
    expect(copy.sortOrder).toBe(1001);
    expect(copy.coverUrl).toBe("https://example.com/cover.png");
    expect(copy.properties).toEqual({ favorite: true, status: "seed" });
    expect(copy.document?.plainText).toBe("Parent body");

    const children = await db.page.findMany({
      where: { workspaceId: workspace.id, title: "Child" },
    });
    expect(children).toHaveLength(2);
    const childCopy = children.find((entry) => entry.parentId === copy.id);
    expect(childCopy).toBeDefined();
    const childDocument = await db.pageDocument.findUnique({
      where: { pageId: childCopy!.id },
    });
    expect(childDocument?.plainText).toBe("Child body");

    const grandchildren = await db.page.findMany({
      where: { workspaceId: workspace.id, title: "Grandchild" },
    });
    expect(grandchildren).toHaveLength(2);
    const grandchildCopy = grandchildren.find((entry) => entry.parentId === childCopy!.id);
    expect(grandchildCopy).toBeDefined();
    const grandchildDocument = await db.pageDocument.findUnique({
      where: { pageId: grandchildCopy!.id },
    });
    expect(grandchildDocument?.plainText).toBe("Grandchild body");
  });

  it("leaves unreadable descendants out of the copy", async () => {
    const copy = await duplicatePageSubtree(db, {
      workspaceId: workspace.id,
      userId: memberId,
      role: "MEMBER",
      pageId: memberRootId,
    });

    expect(copy.title).toBe("Member note copy");
    expect(copy.document?.plainText).toBe("Member body");
    expect(
      await db.page.count({
        where: { workspaceId: workspace.id, title: "Private child" },
      }),
    ).toBe(1);
  });
});
