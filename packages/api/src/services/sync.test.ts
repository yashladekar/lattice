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

describeWithDatabase("member role changes through sync", () => {
  let db: Database;
  const workspaces: TestWorkspace[] = [];

  beforeAll(() => {
    db = createTestDatabase();
  });

  afterAll(async () => {
    for (const workspace of workspaces) {
      await cleanupTestWorkspace(db, workspace.id);
    }
    await db.$disconnect();
  });

  const setup = async () => {
    const workspace = await createTestWorkspace(db);
    workspaces.push(workspace);
    const adminId = `itest_admin_${randomUUID()}`;
    await db.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: adminId,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    const memberId = async (userId: string) =>
      (await db.workspaceMember.findFirst({ where: { workspaceId: workspace.id, userId } }))!.id;
    const pushMember = (actorId: string, id: string, payload: Record<string, unknown>) =>
      pushSync(db, {
        workspaceId: workspace.id,
        userId: actorId,
        ops: [
          {
            opId: `m-${randomUUID()}`,
            entity: "member",
            entityId: id,
            op: "UPSERT",
            payload,
          },
        ],
      });
    return { workspace, adminId, memberId, pushMember };
  };

  it("refuses an admin promoting themselves to owner", async () => {
    const { adminId, memberId, pushMember } = await setup();
    const id = await memberId(adminId);
    await expect(pushMember(adminId, id, { role: "OWNER" })).rejects.toThrow(/owner/i);
    expect((await db.workspaceMember.findUnique({ where: { id } }))?.role).toBe("ADMIN");
  });

  it("refuses an admin promoting someone else to owner", async () => {
    const { adminId, workspace, memberId, pushMember } = await setup();
    const ownerMemberId = await memberId(workspace.ownerId);
    await expect(pushMember(adminId, ownerMemberId, { role: "OWNER" })).rejects.toThrow();
    expect((await db.workspaceMember.findUnique({ where: { id: ownerMemberId } }))?.role).toBe(
      "OWNER",
    );
  });

  it("lets the owner promote and demote a co-owner", async () => {
    const { workspace, adminId, memberId, pushMember } = await setup();
    const id = await memberId(adminId);
    await pushMember(workspace.ownerId, id, { role: "OWNER" });
    expect((await db.workspaceMember.findUnique({ where: { id } }))?.role).toBe("OWNER");
    await pushMember(workspace.ownerId, id, { role: "ADMIN" });
    expect((await db.workspaceMember.findUnique({ where: { id } }))?.role).toBe("ADMIN");
  });

  it("refuses removing an owner through sync", async () => {
    const { workspace, memberId } = await setup();
    const id = await memberId(workspace.ownerId);
    await expect(
      pushSync(db, {
        workspaceId: workspace.id,
        userId: workspace.ownerId,
        ops: [{ opId: `d-${randomUUID()}`, entity: "member", entityId: id, op: "DELETE", payload: {} }],
      }),
    ).rejects.toThrow(/transferred/i);
    expect((await db.workspaceMember.findUnique({ where: { id } }))?.deletedAt).toBeNull();
  });
});

describeWithDatabase("page creation", () => {
  let db: Database;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("does not broadcast a placeholder document", async () => {
    const pageId = randomUUID();
    await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `p-${randomUUID()}`,
          entity: "page",
          entityId: pageId,
          op: "UPSERT",
          payload: { title: "New page" },
        },
      ],
    });

    // The row has to exist so the client's document write can land, but it is
    // not a change: sending it would race that write and blank the page.
    const document = await db.pageDocument.findUnique({ where: { pageId } });
    expect(document?.plainText).toBe("");
    expect(
      await db.syncChange.count({
        where: { workspaceId: workspace.id, entity: "pageDocument", entityId: pageId },
      }),
    ).toBe(0);
  });
});

describeWithDatabase("sync batch ordering", () => {
  let db: Database;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("applies nodes and edges sent before the pages they depend on", async () => {
    const parentId = randomUUID();
    const childId = randomUUID();

    const result = await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `e-${randomUUID()}`,
          entity: "edge",
          entityId: randomUUID(),
          op: "UPSERT",
          payload: {
            sourceNodeId: parentId,
            targetNodeId: childId,
            relationType: "PART_OF",
          },
        },
        {
          opId: `n-${randomUUID()}`,
          entity: "node",
          entityId: childId,
          op: "UPSERT",
          payload: { kind: "PAGE", title: "Child", pageId: childId },
        },
        {
          opId: `pc-${randomUUID()}`,
          entity: "page",
          entityId: childId,
          op: "UPSERT",
          payload: { title: "Child", parentId },
        },
        {
          opId: `n2-${randomUUID()}`,
          entity: "node",
          entityId: parentId,
          op: "UPSERT",
          payload: { kind: "PAGE", title: "Parent", pageId: parentId },
        },
        {
          opId: `pp-${randomUUID()}`,
          entity: "page",
          entityId: parentId,
          op: "UPSERT",
          payload: { title: "Parent" },
        },
      ],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.accepted).toHaveLength(5);
    expect(
      await db.page.count({ where: { id: { in: [parentId, childId] }, workspaceId: workspace.id } }),
    ).toBe(2);
    const edge = await db.knowledgeEdge.findFirst({
      where: { workspaceId: workspace.id, sourceNodeId: parentId, targetNodeId: childId },
    });
    expect(edge?.deletedAt).toBeNull();
  });
});

describeWithDatabase("edge endpoints", () => {
  let db: Database;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  const makePage = (title: string) => {
    const id = randomUUID();
    return db.page
      .create({
        data: {
          id,
          workspaceId: workspace.id,
          title,
          createdById: workspace.ownerId,
          visibility: "WORKSPACE",
        },
      })
      .then(() => id);
  };

  it("creates the graph node for a page that has not synced yet", async () => {
    const first = await makePage("One");
    const second = await makePage("Two");

    // This is the shape a plan produces: an edge queued in the same batch as the
    // pages it connects, so neither node exists on the server yet.
    const result = await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `e-${randomUUID()}`,
          entity: "edge",
          entityId: randomUUID(),
          op: "UPSERT",
          payload: {
            sourceNodeId: first,
            targetNodeId: second,
            relationType: "PART_OF",
            origin: "AI",
            aiGenerated: true,
          },
        },
      ],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(
      await db.knowledgeNode.count({
        where: { id: { in: [first, second] }, workspaceId: workspace.id },
      }),
    ).toBe(2);
    const edge = await db.knowledgeEdge.findFirst({
      where: { workspaceId: workspace.id, sourceNodeId: first, targetNodeId: second },
    });
    expect(edge?.origin).toBe("AI");
    expect(edge?.aiGenerated).toBe(true);
  });

  it("still rejects an edge whose endpoint is not a page or canvas", async () => {
    await expect(
      pushSync(db, {
        workspaceId: workspace.id,
        userId: workspace.ownerId,
        ops: [
          {
            opId: `e-${randomUUID()}`,
            entity: "edge",
            entityId: randomUUID(),
            op: "UPSERT",
            payload: {
              sourceNodeId: randomUUID(),
              targetNodeId: randomUUID(),
              relationType: "RELATED_TO",
            },
          },
        ],
      }),
    ).rejects.toThrow(/must exist/i);
  });
});
