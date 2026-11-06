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
import { pushSync } from "./sync";

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describeWithDatabase("document write origins", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const pageId = "itest_page_writes";
  const live = () => true;

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
          entityId: pageId,
          op: "UPSERT",
          payload: { title: "Write origins" },
        },
        {
          opId: `d-${randomUUID()}`,
          entity: "pageDocument",
          entityId: pageId,
          op: "UPSERT",
          baseRev: 0,
          payload: { content: body("seed"), plainText: "seed" },
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("accepts a session snapshot with a stale revision while collaborating", async () => {
    const result = await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      isCollaborating: live,
      ops: [
        {
          opId: `s-${randomUUID()}`,
          entity: "pageDocument",
          entityId: pageId,
          op: "UPSERT",
          baseRev: 0,
          payload: { content: body("typed live"), plainText: "typed live", source: "session" },
        },
      ],
    });
    expect(result.conflicts).toHaveLength(0);
    const document = await db.pageDocument.findUnique({ where: { pageId } });
    expect(document?.plainText).toBe("typed live");
    const change = await db.syncChange.findFirst({
      where: { workspaceId: workspace.id, entity: "pageDocument" },
      orderBy: { version: "desc" },
    });
    expect((change?.data as { source?: string } | null)?.source).toBe("session");
  });

  it("turns an out-of-band write with a stale revision into a conflict", async () => {
    const before = await db.pageDocument.findUnique({ where: { pageId } });
    const result = await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      isCollaborating: live,
      ops: [
        {
          opId: `w-${randomUUID()}`,
          entity: "pageDocument",
          entityId: pageId,
          op: "UPSERT",
          baseRev: 0,
          payload: { content: body("accepted suggestion"), plainText: "accepted suggestion", source: "write" },
        },
      ],
    });
    expect(result.conflicts).toHaveLength(1);
    const after = await db.pageDocument.findUnique({ where: { pageId } });
    expect(after?.rev).toBe(before?.rev);
    expect(after?.plainText).toBe("typed live");
  });

  it("applies an out-of-band write at the current revision", async () => {
    const current = await db.pageDocument.findUnique({ where: { pageId } });
    const result = await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      isCollaborating: live,
      ops: [
        {
          opId: `w2-${randomUUID()}`,
          entity: "pageDocument",
          entityId: pageId,
          op: "UPSERT",
          baseRev: current?.rev ?? 0,
          payload: { content: body("accepted suggestion"), plainText: "accepted suggestion", source: "write" },
        },
      ],
    });
    expect(result.conflicts).toHaveLength(0);
    const document = await db.pageDocument.findUnique({ where: { pageId } });
    expect(document?.plainText).toBe("accepted suggestion");
  });
});
