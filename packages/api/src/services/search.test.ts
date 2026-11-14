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
import { getAccessiblePageIds } from "./page-access";
import { retrievePages } from "./retrieval";
import { searchWorkspace } from "./search";

describeWithDatabase("workspace search", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const viewerId = `itest_search_viewer_${randomUUID()}`;
  const notebookId = `itest_search_notebook_${randomUUID()}`;
  const workspacePageId = `itest_search_page_${randomUUID()}`;
  const privatePageId = `itest_search_private_${randomUUID()}`;
  const sharedPageId = `itest_search_shared_${randomUUID()}`;
  const taggedPageId = `itest_search_tagged_${randomUUID()}`;
  const canvasId = `itest_search_canvas_${randomUUID()}`;
  const captureId = `itest_search_capture_${randomUUID()}`;
  const privateCaptureId = `itest_search_capture_private_${randomUUID()}`;
  const cardId = `itest_search_card_${randomUUID()}`;
  const privateCardId = `itest_search_card_private_${randomUUID()}`;

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
    await db.notebook.create({
      data: {
        id: notebookId,
        workspaceId: workspace.id,
        name: "Search notebook",
        createdById: workspace.ownerId,
      },
    });
    await db.page.createMany({
      data: [
        {
          id: workspacePageId,
          workspaceId: workspace.id,
          notebookId,
          title: "Roadmap planning",
          createdById: workspace.ownerId,
          visibility: "WORKSPACE",
        },
        {
          id: privatePageId,
          workspaceId: workspace.id,
          title: "Secret roadmap",
          createdById: workspace.ownerId,
          visibility: "PRIVATE",
        },
        {
          id: sharedPageId,
          workspaceId: workspace.id,
          title: "Shared roadmap",
          createdById: workspace.ownerId,
          visibility: "SHARED",
        },
        {
          id: taggedPageId,
          workspaceId: workspace.id,
          title: "Tagged note",
          createdById: workspace.ownerId,
          visibility: "WORKSPACE",
        },
      ],
    });
    await db.pageDocument.createMany({
      data: [
        {
          pageId: workspacePageId,
          workspaceId: workspace.id,
          content: {},
          plainText: "The quarterly roadmap covers pricing and launch.",
        },
        {
          pageId: privatePageId,
          workspaceId: workspace.id,
          content: {},
          plainText: "Private roadmap details.",
        },
        {
          pageId: sharedPageId,
          workspaceId: workspace.id,
          content: {},
          plainText: "Shared launch notes.",
        },
        {
          pageId: taggedPageId,
          workspaceId: workspace.id,
          content: {},
          plainText: "Unrelated body.",
        },
      ],
    });
    await db.resourcePermission.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        resourceType: "PAGE",
        resourceId: sharedPageId,
        userId: viewerId,
        role: "VIEWER",
      },
    });
    const tagId = `itest_search_tag_${randomUUID()}`;
    await db.tag.create({
      data: { id: tagId, workspaceId: workspace.id, name: "roadmap" },
    });
    await db.pageTag.create({
      data: { id: randomUUID(), pageId: taggedPageId, tagId },
    });

    await db.canvas.create({
      data: {
        id: canvasId,
        workspaceId: workspace.id,
        title: "Roadmap sketch",
        createdById: workspace.ownerId,
        data: {
          version: 1,
          elements: [
            {
              id: "n1",
              type: "note",
              x: 0,
              y: 0,
              width: 180,
              height: 100,
              text: "roadmap canvas note",
              color: "saffron",
            },
          ],
        },
      },
    });

    await db.capture.createMany({
      data: [
        {
          id: captureId,
          workspaceId: workspace.id,
          type: "BOOKMARK",
          title: "Roadmap bookmark",
          content: "roadmap link",
          createdById: workspace.ownerId,
        },
        {
          id: privateCaptureId,
          workspaceId: workspace.id,
          type: "BOOKMARK",
          title: "Private roadmap capture",
          content: "roadmap",
          metadata: { pageId: privatePageId },
          createdById: workspace.ownerId,
        },
      ],
    });

    const deckId = `itest_search_deck_${randomUUID()}`;
    await db.deck.create({
      data: { id: deckId, workspaceId: workspace.id, name: "Search deck" },
    });
    await db.flashcard.createMany({
      data: [
        {
          id: cardId,
          workspaceId: workspace.id,
          deckId,
          front: "Roadmap card",
          back: "roadmap answer",
        },
        {
          id: privateCardId,
          workspaceId: workspace.id,
          deckId,
          pageId: privatePageId,
          front: "Private roadmap card",
          back: "roadmap",
        },
      ],
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("returns matching rows and hides pages the viewer cannot read", async () => {
    const allowed = await getAccessiblePageIds(
      db,
      workspace.id,
      viewerId,
      "VIEWER",
    );
    const results = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap",
      limit: 20,
      allowedPageIds: allowed,
    });
    const ids = new Set(results.map((result) => result.id));
    expect(ids.has(workspacePageId)).toBe(true);
    expect(ids.has(sharedPageId)).toBe(true);
    expect(ids.has(taggedPageId)).toBe(true);
    expect(ids.has(canvasId)).toBe(true);
    expect(ids.has(captureId)).toBe(true);
    expect(ids.has(cardId)).toBe(true);
    expect(ids.has(privatePageId)).toBe(false);
    expect(ids.has(privateCaptureId)).toBe(false);
    expect(ids.has(privateCardId)).toBe(false);

    const page = results.find((result) => result.id === workspacePageId);
    expect(page?.title).toBe("Roadmap planning");
    expect(page?.snippet).toContain("roadmap");
  });

  it("includes private material when the role sees every page", async () => {
    const results = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap",
      limit: 20,
      allowedPageIds: null,
    });
    const ids = new Set(results.map((result) => result.id));
    expect(ids.has(privatePageId)).toBe(true);
    expect(ids.has(privateCaptureId)).toBe(true);
    expect(ids.has(privateCardId)).toBe(true);
  });

  it("scopes page results to a notebook or a page list", async () => {
    const byNotebook = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap",
      limit: 20,
      types: ["page"],
      notebookId,
      allowedPageIds: null,
    });
    expect(byNotebook.map((result) => result.id)).toEqual([workspacePageId]);

    const byIds = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap",
      limit: 20,
      types: ["page"],
      pageIds: [sharedPageId],
      allowedPageIds: null,
    });
    expect(byIds.map((result) => result.id)).toEqual([sharedPageId]);
  });

  it("requires every term in web-search mode and matches any term in retrieval mode", async () => {
    const all = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap pricing",
      limit: 20,
      types: ["page"],
      allowedPageIds: null,
    });
    expect(all.map((result) => result.id)).toEqual([workspacePageId]);

    const any = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap pricing",
      limit: 20,
      types: ["page"],
      match: "any",
      allowedPageIds: null,
    });
    const ids = new Set(any.map((result) => result.id));
    expect(ids.has(workspacePageId)).toBe(true);
    expect(ids.has(privatePageId)).toBe(true);
    expect(ids.has(sharedPageId)).toBe(true);
  });

  it("feeds retrieval through the same index and scope", async () => {
    const retrieved = await retrievePages(
      db,
      workspace.id,
      viewerId,
      "VIEWER",
      "roadmap pricing",
      { pageIds: [workspacePageId] },
      5,
    );
    expect(retrieved.map((page) => page.pageId)).toEqual([workspacePageId]);
    expect(retrieved[0]?.body).toContain("pricing");
    expect(retrieved[0]?.excerpt).toContain("roadmap");
  });

  it("honours the entity filter", async () => {
    const results = await searchWorkspace(db, {
      workspaceId: workspace.id,
      query: "roadmap",
      limit: 20,
      types: ["page"],
      allowedPageIds: null,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.type === "page")).toBe(true);

    await expect(
      searchWorkspace(db, {
        workspaceId: workspace.id,
        query: "roadmap",
        limit: 20,
        types: [],
        allowedPageIds: null,
      }),
    ).resolves.toEqual([]);
  });
});
