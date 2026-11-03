import {
  createId,
  docFromText,
  emptyDoc,
  extractPageLinks,
  extractPlainText,
  generateFlashcardsFromDoc,
  safeDoc,
  scheduleReview,
  templateById,
  type CanvasDocument,
  type NotebookKind,
  type PageType,
  type RelationType,
  type ReviewRating,
  type TipTapDoc,
  type Visibility,
} from "@notes-learning/domain";

import type { LatticeDB } from "./db";
import { enqueueOutbox, requestSync } from "./outbox";
import type {
  LocalAttachment,
  LocalCanvas,
  LocalCapture,
  LocalComment,
  LocalDeck,
  LocalEdge,
  LocalFlashcard,
  LocalNode,
  LocalNotebook,
  LocalPage,
  LocalPageDocument,
  LocalReviewLog,
  LocalTag,
  LocalTemplate,
  LocalWorkspace,
  OutboxItem,
} from "./types";

const now = () => new Date().toISOString();
const nextOrder = (): number => Math.floor(Date.now() / 1000) % 2_000_000_000;

function pagePayload(page: LocalPage): Record<string, unknown> {
  return {
    title: page.title,
    icon: page.icon,
    coverUrl: page.coverUrl,
    notebookId: page.notebookId,
    parentId: page.parentId,
    type: page.type,
    properties: page.properties,
    visibility: page.visibility,
    sortOrder: page.sortOrder,
    publishedAt: page.publishedAt,
  };
}

function documentPayload(document: LocalPageDocument): Record<string, unknown> {
  return {
    content: document.content,
    plainText: document.plainText,
    schemaVersion: document.schemaVersion,
  };
}

function canvasPayload(canvas: LocalCanvas): Record<string, unknown> {
  return {
    title: canvas.title,
    icon: canvas.icon,
    notebookId: canvas.notebookId,
    data: canvas.data,
    schemaVersion: canvas.schemaVersion,
    thumbnail: canvas.thumbnail,
  };
}

function nodePayload(node: LocalNode): Record<string, unknown> {
  return {
    kind: node.kind,
    title: node.title,
    description: node.description,
    pageId: node.pageId,
    canvasId: node.canvasId,
    color: node.color,
    x: node.x,
    y: node.y,
    metadata: node.metadata,
    aiGenerated: node.aiGenerated,
  };
}

function edgePayload(edge: LocalEdge): Record<string, unknown> {
  return {
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    relationType: edge.relationType,
    label: edge.label,
    weight: edge.weight,
    origin: edge.origin,
    aiGenerated: edge.aiGenerated,
  };
}

function notebookPayload(notebook: LocalNotebook): Record<string, unknown> {
  return {
    name: notebook.name,
    description: notebook.description,
    icon: notebook.icon,
    color: notebook.color,
    parentId: notebook.parentId,
    visibility: notebook.visibility,
    sortOrder: notebook.sortOrder,
    kind: notebook.kind,
  };
}

function capturePayload(capture: LocalCapture): Record<string, unknown> {
  return {
    type: capture.type,
    title: capture.title,
    content: capture.content,
    url: capture.url,
    source: capture.source,
    status: capture.status,
    metadata: capture.metadata,
  };
}

function templatePayload(template: LocalTemplate): Record<string, unknown> {
  return {
    name: template.name,
    description: template.description,
    icon: template.icon,
    category: template.category,
    content: template.content,
    properties: template.properties,
  };
}

function deckPayload(deck: LocalDeck): Record<string, unknown> {
  return {
    name: deck.name,
    description: deck.description,
    notebookId: deck.notebookId,
    color: deck.color,
  };
}

function flashcardPayload(card: LocalFlashcard): Record<string, unknown> {
  return {
    deckId: card.deckId,
    pageId: card.pageId,
    blockId: card.blockId,
    front: card.front,
    back: card.back,
    hint: card.hint,
    source: card.source,
    dueAt: card.dueAt,
    interval: card.interval,
    ease: card.ease,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewedAt: card.lastReviewedAt,
  };
}

function commentPayload(comment: LocalComment): Record<string, unknown> {
  return {
    pageId: comment.pageId,
    blockId: comment.blockId,
    parentId: comment.parentId,
    body: comment.body,
    resolvedAt: comment.resolvedAt,
  };
}

function attachmentPayload(attachment: LocalAttachment): Record<string, unknown> {
  return {
    pageId: attachment.pageId,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    url: attachment.url,
  };
}

async function queuePage(db: LatticeDB, page: LocalPage): Promise<void> {
  await enqueueOutbox(db, {
    workspaceId: page.workspaceId,
    entity: "page",
    entityId: page.id,
    op: page.deletedAt ? "DELETE" : "UPSERT",
    payload: pagePayload(page),
  });
}

async function queueNode(db: LatticeDB, node: LocalNode): Promise<void> {
  await enqueueOutbox(db, {
    workspaceId: node.workspaceId,
    entity: "node",
    entityId: node.id,
    op: node.deletedAt ? "DELETE" : "UPSERT",
    payload: nodePayload(node),
  });
}

async function queueEdge(db: LatticeDB, edge: LocalEdge): Promise<void> {
  await enqueueOutbox(db, {
    workspaceId: edge.workspaceId,
    entity: "edge",
    entityId: edge.id,
    op: edge.deletedAt ? "DELETE" : "UPSERT",
    payload: edgePayload(edge),
  });
}

async function ensurePageNode(
  db: LatticeDB,
  page: LocalPage,
  userId: string,
): Promise<LocalNode> {
  const existing = await db.nodes.where("pageId").equals(page.id).first();
  if (existing) {
    if (existing.deletedAt && !page.deletedAt) {
      const restored = { ...existing, deletedAt: null, title: page.title, updatedAt: now() };
      await db.nodes.put(restored);
      await queueNode(db, restored);
      return restored;
    }
    return existing;
  }
  const node: LocalNode = {
    id: page.id,
    workspaceId: page.workspaceId,
    kind: "PAGE",
    title: page.title,
    description: null,
    pageId: page.id,
    canvasId: null,
    color: null,
    x: null,
    y: null,
    aiGenerated: false,
    metadata: {},
    createdById: userId,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    deletedAt: null,
  };
  await db.nodes.put(node);
  await queueNode(db, node);
  return node;
}

async function syncPageLinks(
  db: LatticeDB,
  page: LocalPage,
  document: LocalPageDocument,
  userId: string,
): Promise<void> {
  const links = extractPageLinks(document.content).filter((link) => link.pageId !== page.id);
  const targetIds = new Set(links.map((link) => link.pageId));
  const pages = await db.pages.where("workspaceId").equals(page.workspaceId).toArray();
  const pageById = new Map(pages.map((entry) => [entry.id, entry]));
  const existingEdges = await db.edges
    .where("workspaceId")
    .equals(page.workspaceId)
    .filter((edge) => edge.sourceNodeId === page.id && edge.origin === "PAGE_LINK")
    .toArray();
  const existingByTarget = new Map(existingEdges.map((edge) => [edge.targetNodeId, edge]));

  const sourceNode = await ensurePageNode(db, page, userId);
  void sourceNode;

  for (const targetId of targetIds) {
    const target = pageById.get(targetId);
    if (!target || target.deletedAt) continue;
    const targetNode = await ensurePageNode(db, target, userId);
    const existing = existingByTarget.get(targetNode.id);
    if (existing) {
      if (existing.deletedAt) {
        const restored = { ...existing, deletedAt: null, updatedAt: now() };
        await db.edges.put(restored);
        await queueEdge(db, restored);
      }
      continue;
    }
    const edge: LocalEdge = {
      id: `link:${page.id}:${target.id}`,
      workspaceId: page.workspaceId,
      sourceNodeId: page.id,
      targetNodeId: targetNode.id,
      relationType: "REFERENCES",
      label: null,
      weight: 1,
      origin: "PAGE_LINK",
      aiGenerated: false,
      createdById: userId,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    };
    await db.edges.put(edge);
    await queueEdge(db, edge);
  }

  for (const edge of existingEdges) {
    if (targetIds.has(edge.targetNodeId) || edge.deletedAt) continue;
    const deleted = { ...edge, deletedAt: now(), updatedAt: now() };
    await db.edges.put(deleted);
    await queueEdge(db, deleted);
  }
}

export interface CreatePageLocalInput {
  workspaceId: string;
  userId: string;
  notebookId: string | null;
  parentId?: string | null;
  title?: string;
  icon?: string | null;
  type?: PageType;
  visibility?: Visibility;
  content?: TipTapDoc;
  templateId?: string | null;
  sortOrder?: number;
}

export async function createPageLocal(
  db: LatticeDB,
  input: CreatePageLocalInput,
): Promise<{ page: LocalPage; document: LocalPageDocument }> {
  const timestamp = now();
  const pageId = createId();
  const content =
    input.content ??
    (input.templateId ? templateById(input.templateId).content : emptyDoc());
  const page: LocalPage = {
    id: pageId,
    workspaceId: input.workspaceId,
    notebookId: input.notebookId,
    parentId: input.parentId ?? null,
    type: input.type ?? "DOCUMENT",
    title: input.title?.trim() || "Untitled",
    icon: input.icon ?? "◇",
    coverUrl: null,
    properties: {},
    visibility: input.visibility ?? "WORKSPACE",
    sortOrder: input.sortOrder ?? nextOrder(),
    createdById: input.userId,
    updatedById: input.userId,
    publishedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  const document: LocalPageDocument = {
    pageId,
    workspaceId: input.workspaceId,
    content: safeDoc(content),
    plainText: extractPlainText(content),
    schemaVersion: 1,
    rev: 0,
    updatedAt: timestamp,
    localUpdatedAt: timestamp,
  };
  const node: LocalNode = {
    id: pageId,
    workspaceId: input.workspaceId,
    kind: "PAGE",
    title: page.title,
    description: null,
    pageId,
    canvasId: null,
    color: null,
    x: null,
    y: null,
    aiGenerated: false,
    metadata: {},
    createdById: input.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction(
    "rw",
    [db.pages, db.pageDocuments, db.nodes, db.edges, db.outbox],
    async () => {
      await db.pages.put(page);
      await db.pageDocuments.put(document);
      await db.nodes.put(node);
      await queuePage(db, page);
      await enqueueOutbox(db, {
        workspaceId: input.workspaceId,
        entity: "pageDocument",
        entityId: pageId,
        op: "UPSERT",
        baseRev: 0,
        payload: documentPayload(document),
      });
      await syncPageLinks(db, page, document, input.userId);
    },
  );
  return { page, document };
}

export async function updatePageLocal(
  db: LatticeDB,
  input: {
    pageId: string;
    title?: string;
    icon?: string | null;
    coverUrl?: string | null;
    notebookId?: string | null;
    parentId?: string | null;
    visibility?: Visibility;
    properties?: Record<string, unknown>;
    sortOrder?: number;
  },
): Promise<LocalPage | null> {
  const existing = await db.pages.get(input.pageId);
  if (!existing) return null;
  if (input.parentId !== undefined) {
    const pages = await db.pages.where("workspaceId").equals(existing.workspaceId).toArray();
    if (input.parentId === existing.id) throw new Error("A page cannot be its own parent");
    let cursor = input.parentId;
    const seen = new Set<string>();
    const byId = new Map(pages.map((page) => [page.id, page]));
    while (cursor) {
      if (cursor === existing.id) throw new Error("Page move would create a cycle");
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  const page: LocalPage = {
    ...existing,
    ...(input.title !== undefined ? { title: input.title.trim() || "Untitled" } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
    ...(input.notebookId !== undefined ? { notebookId: input.notebookId } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
    ...(input.properties !== undefined
      ? { properties: { ...existing.properties, ...input.properties } }
      : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    updatedAt: now(),
    updatedById: existing.updatedById,
  };
  await db.transaction("rw", [db.pages, db.nodes, db.outbox], async () => {
    await db.pages.put(page);
    await queuePage(db, page);
    const node = await db.nodes.where("pageId").equals(page.id).first();
    if (node && (input.title !== undefined || input.icon !== undefined)) {
      const updatedNode = { ...node, title: page.title, updatedAt: now() };
      await db.nodes.put(updatedNode);
      await queueNode(db, updatedNode);
    }
  });
  return page;
}

export async function deletePageLocal(
  db: LatticeDB,
  pageId: string,
): Promise<void> {
  const page = await db.pages.get(pageId);
  if (!page) return;
  const all = await db.pages.where("workspaceId").equals(page.workspaceId).toArray();
  const ids = new Set<string>([pageId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of all) {
      if (candidate.parentId && ids.has(candidate.parentId) && !ids.has(candidate.id)) {
        ids.add(candidate.id);
        changed = true;
      }
    }
  }
  await db.transaction(
    "rw",
    [db.pages, db.nodes, db.edges, db.outbox],
    async () => {
      for (const id of ids) {
        const target = all.find((entry) => entry.id === id);
        if (!target || target.deletedAt) continue;
        const deleted = { ...target, deletedAt: now(), updatedAt: now() };
        await db.pages.put(deleted);
        await queuePage(db, deleted);
        const nodes = await db.nodes.where("pageId").equals(id).toArray();
        for (const node of nodes) {
          const deletedNode = { ...node, deletedAt: now(), updatedAt: now() };
          await db.nodes.put(deletedNode);
          await queueNode(db, deletedNode);
        }
        const edges = await db.edges
          .where("workspaceId")
          .equals(page.workspaceId)
          .filter((edge) => edge.sourceNodeId === id || edge.targetNodeId === id)
          .toArray();
        for (const edge of edges) {
          if (edge.deletedAt) continue;
          const deletedEdge = { ...edge, deletedAt: now(), updatedAt: now() };
          await db.edges.put(deletedEdge);
          await queueEdge(db, deletedEdge);
        }
      }
    },
  );
}

export async function savePageContentLocal(
  db: LatticeDB,
  input: {
    pageId: string;
    content: TipTapDoc;
    userId: string;
  },
): Promise<LocalPageDocument | null> {
  const page = await db.pages.get(input.pageId);
  const existing = await db.pageDocuments.get(input.pageId);
  if (!page || !existing || page.deletedAt) return null;
  const content = safeDoc(input.content);
  const timestamp = now();
  const document: LocalPageDocument = {
    ...existing,
    content,
    plainText: extractPlainText(content),
    updatedAt: timestamp,
    localUpdatedAt: timestamp,
  };
  const updatedPage = { ...page, updatedAt: timestamp };
  await db.transaction(
    "rw",
    [db.pages, db.pageDocuments, db.nodes, db.edges, db.outbox],
    async () => {
      await db.pages.put(updatedPage);
      await db.pageDocuments.put(document);
      await enqueueOutbox(db, {
        workspaceId: page.workspaceId,
        entity: "pageDocument",
        entityId: page.id,
        op: "UPSERT",
        baseRev: existing.rev,
        payload: documentPayload(document),
      });
      await queuePage(db, updatedPage);
      await syncPageLinks(db, updatedPage, document, input.userId);
    },
  );
  return document;
}

export async function duplicatePageLocal(
  db: LatticeDB,
  pageId: string,
  userId: string,
): Promise<LocalPage | null> {
  const page = await db.pages.get(pageId);
  const document = await db.pageDocuments.get(pageId);
  if (!page || !document) return null;
  const created = await createPageLocal(db, {
    workspaceId: page.workspaceId,
    userId,
    notebookId: page.notebookId,
    parentId: page.parentId,
    title: `${page.title} copy`,
    icon: page.icon,
    type: page.type,
    visibility: page.visibility,
    content: document.content,
    sortOrder: page.sortOrder + 1,
  });
  return created.page;
}

export async function updatePagePropertiesLocal(
  db: LatticeDB,
  pageId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await updatePageLocal(db, { pageId, properties });
}

export async function restorePageLocal(db: LatticeDB, pageId: string): Promise<void> {
  const page = await db.pages.get(pageId);
  if (!page) return;
  const restored = { ...page, deletedAt: null, updatedAt: now() };
  await db.transaction("rw", [db.pages, db.nodes, db.outbox], async () => {
    await db.pages.put(restored);
    await queuePage(db, restored);
    const nodes = await db.nodes.where("pageId").equals(pageId).toArray();
    for (const node of nodes) {
      const restoredNode = { ...node, deletedAt: null, updatedAt: now() };
      await db.nodes.put(restoredNode);
      await queueNode(db, restoredNode);
    }
  });
}

export async function createNotebookLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    name: string;
    parentId?: string | null;
    kind?: NotebookKind;
    icon?: string | null;
    description?: string | null;
    visibility?: Visibility;
    color?: string | null;
  },
): Promise<LocalNotebook> {
  const timestamp = now();
  const notebook: LocalNotebook = {
    id: createId(),
    workspaceId: input.workspaceId,
    parentId: input.parentId ?? null,
    kind: input.kind ?? "NOTEBOOK",
    name: input.name.trim() || "New notebook",
    description: input.description ?? null,
    icon: input.icon ?? "◫",
    color: input.color ?? "#2f6b4f",
    visibility: input.visibility ?? "WORKSPACE",
    sortOrder: nextOrder(),
    createdById: input.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.notebooks, db.outbox], async () => {
    await db.notebooks.put(notebook);
    await enqueueOutbox(db, {
      workspaceId: notebook.workspaceId,
      entity: "notebook",
      entityId: notebook.id,
      op: "UPSERT",
      payload: notebookPayload(notebook),
    });
  });
  return notebook;
}

export async function updateNotebookLocal(
  db: LatticeDB,
  notebookId: string,
  input: Partial<
    Pick<
      LocalNotebook,
      "name" | "description" | "icon" | "color" | "parentId" | "visibility" | "sortOrder"
    >
  >,
): Promise<LocalNotebook | null> {
  const existing = await db.notebooks.get(notebookId);
  if (!existing) return null;
  const notebook: LocalNotebook = { ...existing, ...input, updatedAt: now() };
  await db.transaction("rw", [db.notebooks, db.outbox], async () => {
    await db.notebooks.put(notebook);
    await enqueueOutbox(db, {
      workspaceId: notebook.workspaceId,
      entity: "notebook",
      entityId: notebook.id,
      op: "UPSERT",
      payload: notebookPayload(notebook),
    });
  });
  return notebook;
}

export async function deleteNotebookLocal(
  db: LatticeDB,
  notebookId: string,
): Promise<void> {
  const existing = await db.notebooks.get(notebookId);
  if (!existing) return;
  const deleted = { ...existing, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.notebooks, db.outbox], async () => {
    await db.notebooks.put(deleted);
    await enqueueOutbox(db, {
      workspaceId: deleted.workspaceId,
      entity: "notebook",
      entityId: deleted.id,
      op: "DELETE",
      payload: notebookPayload(deleted),
    });
  });
}

export async function createCanvasLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    title?: string;
    notebookId?: string | null;
    data: CanvasDocument;
    icon?: string | null;
  },
): Promise<LocalCanvas> {
  const timestamp = now();
  const canvas: LocalCanvas = {
    id: createId(),
    workspaceId: input.workspaceId,
    notebookId: input.notebookId ?? null,
    title: input.title?.trim() || "Untitled canvas",
    icon: input.icon ?? "▦",
    data: input.data,
    schemaVersion: 1,
    rev: 0,
    thumbnail: null,
    createdById: input.userId,
    updatedById: input.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  const node: LocalNode = {
    id: canvas.id,
    workspaceId: input.workspaceId,
    kind: "CANVAS",
    title: canvas.title,
    description: null,
    pageId: null,
    canvasId: canvas.id,
    color: null,
    x: null,
    y: null,
    aiGenerated: false,
    metadata: {},
    createdById: input.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.canvases, db.nodes, db.outbox], async () => {
    await db.canvases.put(canvas);
    await db.nodes.put(node);
    await enqueueOutbox(db, {
      workspaceId: canvas.workspaceId,
      entity: "canvas",
      entityId: canvas.id,
      op: "UPSERT",
      baseRev: 0,
      payload: canvasPayload(canvas),
    });
    await queueNode(db, node);
  });
  return canvas;
}

export async function saveCanvasLocal(
  db: LatticeDB,
  canvasId: string,
  data: CanvasDocument,
): Promise<LocalCanvas | null> {
  const existing = await db.canvases.get(canvasId);
  if (!existing) return null;
  const canvas: LocalCanvas = {
    ...existing,
    data,
    updatedAt: now(),
  };
  await db.transaction("rw", [db.canvases, db.outbox], async () => {
    await db.canvases.put(canvas);
    await enqueueOutbox(db, {
      workspaceId: canvas.workspaceId,
      entity: "canvas",
      entityId: canvas.id,
      op: "UPSERT",
      baseRev: existing.rev,
      payload: canvasPayload(canvas),
    });
  });
  return canvas;
}

export async function updateCanvasLocal(
  db: LatticeDB,
  canvasId: string,
  input: Partial<Pick<LocalCanvas, "title" | "icon" | "notebookId" | "thumbnail">>,
): Promise<LocalCanvas | null> {
  const existing = await db.canvases.get(canvasId);
  if (!existing) return null;
  const canvas: LocalCanvas = { ...existing, ...input, updatedAt: now() };
  await db.transaction("rw", [db.canvases, db.nodes, db.outbox], async () => {
    await db.canvases.put(canvas);
    await enqueueOutbox(db, {
      workspaceId: canvas.workspaceId,
      entity: "canvas",
      entityId: canvas.id,
      op: "UPSERT",
      baseRev: existing.rev,
      payload: canvasPayload(canvas),
    });
    if (input.title !== undefined) {
      const node = await db.nodes.where("canvasId").equals(canvas.id).first();
      if (node) {
        const updated = { ...node, title: canvas.title, updatedAt: now() };
        await db.nodes.put(updated);
        await queueNode(db, updated);
      }
    }
  });
  return canvas;
}

export async function deleteCanvasLocal(db: LatticeDB, canvasId: string): Promise<void> {
  const existing = await db.canvases.get(canvasId);
  if (!existing) return;
  const timestamp = now();
  const deleted = { ...existing, deletedAt: timestamp, updatedAt: timestamp };
  await db.transaction("rw", [db.canvases, db.nodes, db.edges, db.outbox], async () => {
    await db.canvases.put(deleted);
    await enqueueOutbox(db, {
      workspaceId: deleted.workspaceId,
      entity: "canvas",
      entityId: deleted.id,
      op: "DELETE",
      payload: canvasPayload(deleted),
    });
    const nodes = await db.nodes.where("canvasId").equals(canvasId).toArray();
    for (const node of nodes) {
      const updated = { ...node, deletedAt: timestamp, updatedAt: timestamp };
      await db.nodes.put(updated);
      await queueNode(db, updated);
    }
    const edges = await db.edges
      .where("workspaceId")
      .equals(existing.workspaceId)
      .filter((edge) => edge.sourceNodeId === canvasId || edge.targetNodeId === canvasId)
      .toArray();
    for (const edge of edges) {
      if (edge.deletedAt) continue;
      const updated = { ...edge, deletedAt: timestamp, updatedAt: timestamp };
      await db.edges.put(updated);
      await queueEdge(db, updated);
    }
  });
}

export async function createTagLocal(
  db: LatticeDB,
  workspaceId: string,
  name: string,
  color = "#8b8b7a",
): Promise<LocalTag> {
  const normalized = name.trim().toLowerCase();
  const existing = await db.tags
    .where("[workspaceId+name]")
    .equals([workspaceId, normalized])
    .first();
  if (existing) return existing;
  const tag: LocalTag = {
    id: createId(),
    workspaceId,
    name: normalized,
    color,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await db.transaction("rw", [db.tags, db.outbox], async () => {
    await db.tags.put(tag);
    await enqueueOutbox(db, {
      workspaceId,
      entity: "tag",
      entityId: tag.id,
      op: "UPSERT",
      payload: { name: tag.name, color: tag.color },
    });
  });
  return tag;
}

export async function setPageTagsLocal(
  db: LatticeDB,
  pageId: string,
  tagIds: string[],
): Promise<void> {
  const page = await db.pages.get(pageId);
  if (!page) return;
  const existing = await db.pageTags.where("pageId").equals(pageId).toArray();
  const desired = new Set(tagIds);
  await db.transaction("rw", [db.pageTags, db.outbox], async () => {
    for (const pageTag of existing) {
      if (desired.has(pageTag.tagId)) continue;
      await db.pageTags.delete(pageTag.id);
      await enqueueOutbox(db, {
        workspaceId: page.workspaceId,
        entity: "pageTag",
        entityId: pageTag.id,
        op: "DELETE",
        payload: { pageId, tagId: pageTag.tagId },
      });
    }
    const existingTagIds = new Set(existing.map((entry) => entry.tagId));
    for (const tagId of desired) {
      if (existingTagIds.has(tagId)) continue;
      const id = createId();
      const pageTag = {
        id,
        pageId,
        tagId,
        source: "USER" as const,
        createdAt: now(),
      };
      await db.pageTags.put(pageTag);
      await enqueueOutbox(db, {
        workspaceId: page.workspaceId,
        entity: "pageTag",
        entityId: id,
        op: "UPSERT",
        payload: { pageId, tagId, source: "USER" },
      });
    }
  });
}

export async function upsertNodeLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    id?: string;
    kind: LocalNode["kind"];
    title: string;
    description?: string | null;
    pageId?: string | null;
    canvasId?: string | null;
    color?: string | null;
    x?: number | null;
    y?: number | null;
    metadata?: Record<string, unknown>;
  },
): Promise<LocalNode> {
  const id = input.id ?? createId();
  const existing = await db.nodes.get(id);
  const timestamp = now();
  const node: LocalNode = existing
    ? {
        ...existing,
        kind: input.kind,
        title: input.title,
        description: input.description ?? existing.description,
        pageId: input.pageId ?? existing.pageId,
        canvasId: input.canvasId ?? existing.canvasId,
        color: input.color ?? existing.color,
        x: input.x ?? existing.x,
        y: input.y ?? existing.y,
        metadata: input.metadata ?? existing.metadata,
        updatedAt: timestamp,
        deletedAt: null,
      }
    : {
        id,
        workspaceId: input.workspaceId,
        kind: input.kind,
        title: input.title,
        description: input.description ?? null,
        pageId: input.pageId ?? null,
        canvasId: input.canvasId ?? null,
        color: input.color ?? null,
        x: input.x ?? null,
        y: input.y ?? null,
        aiGenerated: false,
        metadata: input.metadata ?? {},
        createdById: input.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
  await db.transaction("rw", [db.nodes, db.outbox], async () => {
    await db.nodes.put(node);
    await queueNode(db, node);
  });
  return node;
}

export async function updateNodePositionLocal(
  db: LatticeDB,
  nodeId: string,
  x: number,
  y: number,
): Promise<void> {
  const node = await db.nodes.get(nodeId);
  if (!node) return;
  const updated = { ...node, x, y, updatedAt: now() };
  await db.transaction("rw", [db.nodes, db.outbox], async () => {
    await db.nodes.put(updated);
    await queueNode(db, updated);
  });
}

export async function deleteNodeLocal(db: LatticeDB, nodeId: string): Promise<void> {
  const node = await db.nodes.get(nodeId);
  if (!node) return;
  const updated = { ...node, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.nodes, db.outbox], async () => {
    await db.nodes.put(updated);
    await queueNode(db, updated);
  });
}

export async function upsertEdgeLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    id?: string;
    sourceNodeId: string;
    targetNodeId: string;
    relationType: RelationType;
    label?: string | null;
    weight?: number;
    origin?: LocalEdge["origin"];
    aiGenerated?: boolean;
  },
): Promise<LocalEdge> {
  const existing = await db.edges
    .where("workspaceId")
    .equals(input.workspaceId)
    .filter(
      (edge) =>
        edge.sourceNodeId === input.sourceNodeId &&
        edge.targetNodeId === input.targetNodeId &&
        edge.relationType === input.relationType &&
        edge.origin === (input.origin ?? "MANUAL"),
    )
    .first();
  const timestamp = now();
  const edge: LocalEdge = existing
    ? {
        ...existing,
        label: input.label ?? existing.label,
        weight: input.weight ?? existing.weight,
        aiGenerated: input.aiGenerated ?? existing.aiGenerated,
        updatedAt: timestamp,
        deletedAt: null,
      }
    : {
        id: input.id ?? createId(),
        workspaceId: input.workspaceId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        relationType: input.relationType,
        label: input.label ?? null,
        weight: input.weight ?? 1,
        origin: input.origin ?? "MANUAL",
        aiGenerated: input.aiGenerated ?? false,
        createdById: input.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      };
  await db.transaction("rw", [db.edges, db.outbox], async () => {
    await db.edges.put(edge);
    await queueEdge(db, edge);
  });
  return edge;
}

export async function deleteEdgeLocal(db: LatticeDB, edgeId: string): Promise<void> {
  const edge = await db.edges.get(edgeId);
  if (!edge) return;
  const updated = { ...edge, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.edges, db.outbox], async () => {
    await db.edges.put(updated);
    await queueEdge(db, updated);
  });
}

export async function createCaptureLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    type: LocalCapture["type"];
    title: string;
    content?: string | null;
    url?: string | null;
    source?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<LocalCapture> {
  const timestamp = now();
  const capture: LocalCapture = {
    id: createId(),
    workspaceId: input.workspaceId,
    type: input.type,
    title: input.title.trim() || input.url || "Quick capture",
    content: input.content ?? null,
    url: input.url ?? null,
    source: input.source ?? null,
    status: "INBOX",
    metadata: input.metadata ?? {},
    createdById: input.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.captures, db.outbox], async () => {
    await db.captures.put(capture);
    await enqueueOutbox(db, {
      workspaceId: capture.workspaceId,
      entity: "capture",
      entityId: capture.id,
      op: "UPSERT",
      payload: capturePayload(capture),
    });
  });
  return capture;
}

export async function updateCaptureLocal(
  db: LatticeDB,
  captureId: string,
  input: Partial<Pick<LocalCapture, "title" | "content" | "status" | "metadata" | "url">>,
): Promise<LocalCapture | null> {
  const existing = await db.captures.get(captureId);
  if (!existing) return null;
  const capture: LocalCapture = { ...existing, ...input, updatedAt: now() };
  await db.transaction("rw", [db.captures, db.outbox], async () => {
    await db.captures.put(capture);
    await enqueueOutbox(db, {
      workspaceId: capture.workspaceId,
      entity: "capture",
      entityId: capture.id,
      op: "UPSERT",
      payload: capturePayload(capture),
    });
  });
  return capture;
}

export async function deleteCaptureLocal(db: LatticeDB, captureId: string): Promise<void> {
  const existing = await db.captures.get(captureId);
  if (!existing) return;
  const deleted = { ...existing, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.captures, db.outbox], async () => {
    await db.captures.put(deleted);
    await enqueueOutbox(db, {
      workspaceId: deleted.workspaceId,
      entity: "capture",
      entityId: deleted.id,
      op: "DELETE",
      payload: capturePayload(deleted),
    });
  });
}

export async function organizeCaptureLocal(
  db: LatticeDB,
  input: {
    captureId: string;
    notebookId: string | null;
    userId: string;
  },
): Promise<LocalPage | null> {
  const capture = await db.captures.get(input.captureId);
  if (!capture) return null;
  const body = [capture.content, capture.url].filter(Boolean).join("\n\n");
  const doc = docFromText(body || capture.title);
  const created = await createPageLocal(db, {
    workspaceId: capture.workspaceId,
    userId: input.userId,
    notebookId: input.notebookId,
    title: capture.title || "Captured note",
    icon: capture.type === "BOOKMARK" ? "⌘" : "◇",
    content: doc,
  });
  await updateCaptureLocal(db, capture.id, {
    status: "ORGANIZED",
    metadata: { ...capture.metadata, pageId: created.page.id },
  });
  return created.page;
}

export async function ensureDeckLocal(
  db: LatticeDB,
  workspaceId: string,
  name = "Daily review",
): Promise<LocalDeck> {
  const existing = await db.decks
    .where("workspaceId")
    .equals(workspaceId)
    .filter((deck) => deck.name === name && !deck.deletedAt)
    .first();
  if (existing) return existing;
  const deck: LocalDeck = {
    id: createId(),
    workspaceId,
    notebookId: null,
    name,
    description: "Cards generated from your notes",
    color: "#2f6b4f",
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  await db.transaction("rw", [db.decks, db.outbox], async () => {
    await db.decks.put(deck);
    await enqueueOutbox(db, {
      workspaceId,
      entity: "deck",
      entityId: deck.id,
      op: "UPSERT",
      payload: deckPayload(deck),
    });
  });
  return deck;
}

export async function createDeckLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    name: string;
    description?: string | null;
    notebookId?: string | null;
    color?: string;
  },
): Promise<LocalDeck> {
  const timestamp = now();
  const deck: LocalDeck = {
    id: createId(),
    workspaceId: input.workspaceId,
    notebookId: input.notebookId ?? null,
    name: input.name.trim() || "Untitled deck",
    description: input.description ?? null,
    color: input.color ?? "#2f6b4f",
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.decks, db.outbox], async () => {
    await db.decks.put(deck);
    await enqueueOutbox(db, {
      workspaceId: deck.workspaceId,
      entity: "deck",
      entityId: deck.id,
      op: "UPSERT",
      payload: deckPayload(deck),
    });
  });
  return deck;
}

export async function createFlashcardLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    deckId: string;
    front: string;
    back: string;
    pageId?: string | null;
    blockId?: string | null;
    hint?: string | null;
    source?: LocalFlashcard["source"];
  },
): Promise<LocalFlashcard> {
  const timestamp = now();
  const card: LocalFlashcard = {
    id: createId(),
    workspaceId: input.workspaceId,
    deckId: input.deckId,
    pageId: input.pageId ?? null,
    blockId: input.blockId ?? null,
    front: input.front.trim(),
    back: input.back.trim(),
    hint: input.hint ?? null,
    source: input.source ?? "MANUAL",
    dueAt: timestamp,
    interval: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    lastReviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.flashcards, db.outbox], async () => {
    await db.flashcards.put(card);
    await enqueueOutbox(db, {
      workspaceId: card.workspaceId,
      entity: "flashcard",
      entityId: card.id,
      op: "UPSERT",
      payload: flashcardPayload(card),
    });
  });
  return card;
}

export async function reviewFlashcardLocal(
  db: LatticeDB,
  flashcardId: string,
  rating: ReviewRating,
  userId: string,
): Promise<LocalFlashcard | null> {
  const card = await db.flashcards.get(flashcardId);
  if (!card) return null;
  const schedule = scheduleReview(card, rating);
  const timestamp = now();
  const updated = {
    ...card,
    dueAt: schedule.dueAt,
    interval: schedule.interval,
    ease: schedule.ease,
    reps: schedule.reps,
    lapses: schedule.lapses,
    lastReviewedAt: timestamp,
    updatedAt: timestamp,
  };
  const log: LocalReviewLog = {
    id: createId(),
    workspaceId: card.workspaceId,
    flashcardId: card.id,
    userId,
    rating,
    reviewedAt: timestamp,
    previousDueAt: card.dueAt,
    nextDueAt: schedule.dueAt,
    interval: schedule.interval,
  };
  await db.transaction(
    "rw",
    [db.flashcards, db.reviewLogs, db.outbox],
    async () => {
      await db.flashcards.put(updated);
      await db.reviewLogs.put(log);
      await enqueueOutbox(db, {
        workspaceId: card.workspaceId,
        entity: "flashcard",
        entityId: card.id,
        op: "UPSERT",
        payload: flashcardPayload(updated),
      });
    },
  );
  return updated;
}

export async function generateCardsFromPageLocal(
  db: LatticeDB,
  input: { workspaceId: string; pageId: string; deckId?: string | null },
): Promise<LocalFlashcard[]> {
  const page = await db.pages.get(input.pageId);
  const document = await db.pageDocuments.get(input.pageId);
  if (!page || !document) return [];
  const generated = generateFlashcardsFromDoc(document.content);
  if (!generated.length) return [];
  const deck = input.deckId
    ? await db.decks.get(input.deckId)
    : await ensureDeckLocal(db, input.workspaceId);
  if (!deck) return [];
  const existing = await db.flashcards.where("pageId").equals(input.pageId).toArray();
  const fronts = new Set(existing.map((card) => card.front.toLowerCase()));
  const cards: LocalFlashcard[] = [];
  for (const item of generated) {
    if (fronts.has(item.front.toLowerCase())) continue;
    const card = await createFlashcardLocal(db, {
      workspaceId: input.workspaceId,
      deckId: deck.id,
      front: item.front,
      back: item.back,
      pageId: page.id,
      blockId: item.blockId ?? null,
      source: "NOTE",
    });
    cards.push(card);
  }
  return cards;
}

export async function updateFlashcardLocal(
  db: LatticeDB,
  flashcardId: string,
  input: Partial<Pick<LocalFlashcard, "front" | "back" | "hint" | "deckId">>,
): Promise<LocalFlashcard | null> {
  const card = await db.flashcards.get(flashcardId);
  if (!card) return null;
  const updated = { ...card, ...input, updatedAt: now() };
  await db.transaction("rw", [db.flashcards, db.outbox], async () => {
    await db.flashcards.put(updated);
    await enqueueOutbox(db, {
      workspaceId: updated.workspaceId,
      entity: "flashcard",
      entityId: updated.id,
      op: "UPSERT",
      payload: flashcardPayload(updated),
    });
  });
  return updated;
}

export async function deleteFlashcardLocal(
  db: LatticeDB,
  flashcardId: string,
): Promise<void> {
  const card = await db.flashcards.get(flashcardId);
  if (!card) return;
  const deleted = { ...card, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.flashcards, db.outbox], async () => {
    await db.flashcards.put(deleted);
    await enqueueOutbox(db, {
      workspaceId: deleted.workspaceId,
      entity: "flashcard",
      entityId: deleted.id,
      op: "DELETE",
      payload: flashcardPayload(deleted),
    });
  });
}

export async function createCommentLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    pageId: string;
    body: string;
    blockId?: string | null;
    parentId?: string | null;
  },
): Promise<LocalComment> {
  const timestamp = now();
  const comment: LocalComment = {
    id: createId(),
    workspaceId: input.workspaceId,
    pageId: input.pageId,
    blockId: input.blockId ?? null,
    parentId: input.parentId ?? null,
    authorId: input.userId,
    body: input.body.trim(),
    resolvedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.comments, db.outbox], async () => {
    await db.comments.put(comment);
    await enqueueOutbox(db, {
      workspaceId: comment.workspaceId,
      entity: "comment",
      entityId: comment.id,
      op: "UPSERT",
      payload: commentPayload(comment),
    });
  });
  return comment;
}

export async function resolveCommentLocal(
  db: LatticeDB,
  commentId: string,
  resolved: boolean,
): Promise<void> {
  const comment = await db.comments.get(commentId);
  if (!comment) return;
  const updated = {
    ...comment,
    resolvedAt: resolved ? now() : null,
    updatedAt: now(),
  };
  await db.transaction("rw", [db.comments, db.outbox], async () => {
    await db.comments.put(updated);
    await enqueueOutbox(db, {
      workspaceId: updated.workspaceId,
      entity: "comment",
      entityId: updated.id,
      op: "UPSERT",
      payload: commentPayload(updated),
    });
  });
}

export async function deleteCommentLocal(db: LatticeDB, commentId: string): Promise<void> {
  const comment = await db.comments.get(commentId);
  if (!comment) return;
  const updated = { ...comment, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.comments, db.outbox], async () => {
    await db.comments.put(updated);
    await enqueueOutbox(db, {
      workspaceId: updated.workspaceId,
      entity: "comment",
      entityId: updated.id,
      op: "DELETE",
      payload: commentPayload(updated),
    });
  });
}

export async function createTemplateFromPageLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    pageId: string;
    name: string;
    description?: string | null;
    category?: string;
    icon?: string | null;
  },
): Promise<LocalTemplate | null> {
  const page = await db.pages.get(input.pageId);
  const document = await db.pageDocuments.get(input.pageId);
  if (!page || !document) return null;
  const timestamp = now();
  const template: LocalTemplate = {
    id: createId(),
    workspaceId: input.workspaceId,
    name: input.name.trim() || page.title,
    description: input.description ?? null,
    icon: input.icon ?? page.icon ?? "◇",
    category: input.category ?? "Writing",
    content: document.content,
    properties: page.properties,
    createdById: input.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.templates, db.outbox], async () => {
    await db.templates.put(template);
    await enqueueOutbox(db, {
      workspaceId: template.workspaceId,
      entity: "template",
      entityId: template.id,
      op: "UPSERT",
      payload: templatePayload(template),
    });
  });
  return template;
}

export async function deleteTemplateLocal(
  db: LatticeDB,
  templateId: string,
): Promise<void> {
  const template = await db.templates.get(templateId);
  if (!template) return;
  const deleted = { ...template, deletedAt: now(), updatedAt: now() };
  await db.transaction("rw", [db.templates, db.outbox], async () => {
    await db.templates.put(deleted);
    await enqueueOutbox(db, {
      workspaceId: deleted.workspaceId,
      entity: "template",
      entityId: deleted.id,
      op: "DELETE",
      payload: templatePayload(deleted),
    });
  });
}

export async function addAttachmentLocal(
  db: LatticeDB,
  input: {
    workspaceId: string;
    userId: string;
    pageId?: string | null;
    name: string;
    mime: string;
    size: number;
    url: string;
  },
): Promise<LocalAttachment> {
  const timestamp = now();
  const attachment: LocalAttachment = {
    id: createId(),
    workspaceId: input.workspaceId,
    pageId: input.pageId ?? null,
    uploaderId: input.userId,
    name: input.name,
    mime: input.mime,
    size: input.size,
    url: input.url,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
  await db.transaction("rw", [db.attachments, db.outbox], async () => {
    await db.attachments.put(attachment);
    await enqueueOutbox(db, {
      workspaceId: attachment.workspaceId,
      entity: "attachment",
      entityId: attachment.id,
      op: "UPSERT",
      payload: attachmentPayload(attachment),
    });
  });
  return attachment;
}

export async function updateWorkspaceLocal(
  db: LatticeDB,
  workspaceId: string,
  input: Partial<Pick<LocalWorkspace, "name" | "description" | "icon" | "accent">>,
): Promise<LocalWorkspace | null> {
  const existing = await db.workspaces.get(workspaceId);
  if (!existing) return null;
  const workspace: LocalWorkspace = { ...existing, ...input, updatedAt: now() };
  await db.transaction("rw", [db.workspaces, db.outbox], async () => {
    await db.workspaces.put(workspace);
    await enqueueOutbox(db, {
      workspaceId,
      entity: "workspace",
      entityId: workspaceId,
      op: "UPSERT",
      payload: {
        name: workspace.name,
        description: workspace.description,
        icon: workspace.icon,
        accent: workspace.accent,
      },
    });
  });
  return workspace;
}

export interface LocalExport {
  version: 1;
  exportedAt: string;
  workspaceId: string;
  data: {
    workspace: LocalWorkspace | null;
    notebooks: LocalNotebook[];
    pages: LocalPage[];
    pageDocuments: LocalPageDocument[];
    canvases: LocalCanvas[];
    nodes: LocalNode[];
    edges: LocalEdge[];
    tags: LocalTag[];
    pageTags: Array<{ id: string; pageId: string; tagId: string; source: string; createdAt: string }>;
    captures: LocalCapture[];
    templates: LocalTemplate[];
    decks: LocalDeck[];
    flashcards: LocalFlashcard[];
    comments: LocalComment[];
    attachments: LocalAttachment[];
  };
}

export async function exportWorkspaceLocal(
  db: LatticeDB,
  workspaceId: string,
): Promise<LocalExport> {
  const [
    workspace,
    notebooks,
    pages,
    pageDocuments,
    canvases,
    nodes,
    edges,
    tags,
    pageTags,
    captures,
    templates,
    decks,
    flashcards,
    comments,
    attachments,
  ] = await Promise.all([
    db.workspaces.get(workspaceId),
    db.notebooks.where("workspaceId").equals(workspaceId).toArray(),
    db.pages.where("workspaceId").equals(workspaceId).toArray(),
    db.pageDocuments.where("workspaceId").equals(workspaceId).toArray(),
    db.canvases.where("workspaceId").equals(workspaceId).toArray(),
    db.nodes.where("workspaceId").equals(workspaceId).toArray(),
    db.edges.where("workspaceId").equals(workspaceId).toArray(),
    db.tags.where("workspaceId").equals(workspaceId).toArray(),
    db.pageTags.toArray(),
    db.captures.where("workspaceId").equals(workspaceId).toArray(),
    db.templates.where("workspaceId").equals(workspaceId).toArray(),
    db.decks.where("workspaceId").equals(workspaceId).toArray(),
    db.flashcards.where("workspaceId").equals(workspaceId).toArray(),
    db.comments.where("workspaceId").equals(workspaceId).toArray(),
    db.attachments.where("workspaceId").equals(workspaceId).toArray(),
  ]);
  return {
    version: 1,
    exportedAt: now(),
    workspaceId,
    data: {
      workspace: workspace ?? null,
      notebooks,
      pages,
      pageDocuments,
      canvases,
      nodes,
      edges,
      tags,
      pageTags: pageTags.filter((pageTag) =>
        pages.some((page) => page.id === pageTag.pageId),
      ),
      captures,
      templates,
      decks,
      flashcards,
      comments,
      attachments,
    },
  };
}

export async function importWorkspaceLocal(
  db: LatticeDB,
  exported: LocalExport,
): Promise<void> {
  if (exported.version !== 1) throw new Error("Unsupported export version");
  const data = exported.data;
  await db.transaction(
    "rw",
    [
      db.workspaces,
      db.notebooks,
      db.pages,
      db.pageDocuments,
      db.canvases,
      db.nodes,
      db.edges,
      db.tags,
      db.pageTags,
      db.captures,
      db.templates,
      db.decks,
      db.flashcards,
      db.comments,
      db.attachments,
      db.outbox,
    ],
    async () => {
      if (data.workspace) await db.workspaces.put(data.workspace);
      if (data.notebooks.length) await db.notebooks.bulkPut(data.notebooks);
      if (data.pages.length) await db.pages.bulkPut(data.pages);
      if (data.pageDocuments.length) {
        await db.pageDocuments.bulkPut(
          data.pageDocuments.map((document) => ({
            ...document,
            localUpdatedAt: document.updatedAt,
          })),
        );
      }
      if (data.canvases.length) await db.canvases.bulkPut(data.canvases);
      if (data.nodes.length) await db.nodes.bulkPut(data.nodes);
      if (data.edges.length) await db.edges.bulkPut(data.edges);
      if (data.tags.length) await db.tags.bulkPut(data.tags);
      if (data.pageTags.length) await db.pageTags.bulkPut(data.pageTags as never);
      if (data.captures.length) await db.captures.bulkPut(data.captures);
      if (data.templates.length) await db.templates.bulkPut(data.templates);
      if (data.decks.length) await db.decks.bulkPut(data.decks);
      if (data.flashcards.length) await db.flashcards.bulkPut(data.flashcards);
      if (data.comments.length) await db.comments.bulkPut(data.comments);
      if (data.attachments.length) await db.attachments.bulkPut(data.attachments);

      for (const notebook of data.notebooks) {
        await enqueueOutbox(db, {
          workspaceId: notebook.workspaceId,
          entity: "notebook",
          entityId: notebook.id,
          op: "UPSERT",
          payload: notebookPayload(notebook),
        });
      }
      for (const page of data.pages) {
        await enqueueOutbox(db, {
          workspaceId: page.workspaceId,
          entity: "page",
          entityId: page.id,
          op: "UPSERT",
          payload: pagePayload(page),
        });
      }
      for (const document of data.pageDocuments) {
        await enqueueOutbox(db, {
          workspaceId: document.workspaceId,
          entity: "pageDocument",
          entityId: document.pageId,
          op: "UPSERT",
          baseRev: document.rev,
          payload: documentPayload(document),
        });
      }
      for (const canvas of data.canvases) {
        await enqueueOutbox(db, {
          workspaceId: canvas.workspaceId,
          entity: "canvas",
          entityId: canvas.id,
          op: "UPSERT",
          baseRev: canvas.rev,
          payload: canvasPayload(canvas),
        });
      }
      for (const node of data.nodes) {
        await enqueueOutbox(db, {
          workspaceId: node.workspaceId,
          entity: "node",
          entityId: node.id,
          op: "UPSERT",
          payload: nodePayload(node),
        });
      }
      for (const edge of data.edges) {
        await enqueueOutbox(db, {
          workspaceId: edge.workspaceId,
          entity: "edge",
          entityId: edge.id,
          op: "UPSERT",
          payload: edgePayload(edge),
        });
      }
      for (const tag of data.tags) {
        await enqueueOutbox(db, {
          workspaceId: tag.workspaceId,
          entity: "tag",
          entityId: tag.id,
          op: "UPSERT",
          payload: { name: tag.name, color: tag.color },
        });
      }
      for (const pageTag of data.pageTags) {
        const page = data.pages.find((entry) => entry.id === pageTag.pageId);
        if (!page) continue;
        await enqueueOutbox(db, {
          workspaceId: page.workspaceId,
          entity: "pageTag",
          entityId: pageTag.id,
          op: "UPSERT",
          payload: {
            pageId: pageTag.pageId,
            tagId: pageTag.tagId,
            source: pageTag.source,
          },
        });
      }
      for (const capture of data.captures) {
        await enqueueOutbox(db, {
          workspaceId: capture.workspaceId,
          entity: "capture",
          entityId: capture.id,
          op: "UPSERT",
          payload: capturePayload(capture),
        });
      }
      for (const template of data.templates) {
        await enqueueOutbox(db, {
          workspaceId: template.workspaceId,
          entity: "template",
          entityId: template.id,
          op: "UPSERT",
          payload: templatePayload(template),
        });
      }
      for (const deck of data.decks) {
        await enqueueOutbox(db, {
          workspaceId: deck.workspaceId,
          entity: "deck",
          entityId: deck.id,
          op: "UPSERT",
          payload: deckPayload(deck),
        });
      }
      for (const card of data.flashcards) {
        await enqueueOutbox(db, {
          workspaceId: card.workspaceId,
          entity: "flashcard",
          entityId: card.id,
          op: "UPSERT",
          payload: flashcardPayload(card),
        });
      }
      for (const comment of data.comments) {
        await enqueueOutbox(db, {
          workspaceId: comment.workspaceId,
          entity: "comment",
          entityId: comment.id,
          op: "UPSERT",
          payload: commentPayload(comment),
        });
      }
      for (const attachment of data.attachments) {
        await enqueueOutbox(db, {
          workspaceId: attachment.workspaceId,
          entity: "attachment",
          entityId: attachment.id,
          op: "UPSERT",
          payload: attachmentPayload(attachment),
        });
      }
    },
  );
}

export async function pendingCountForWorkspace(
  db: LatticeDB,
  workspaceId: string,
): Promise<number> {
  const items: OutboxItem[] = await db.outbox.where("workspaceId").equals(workspaceId).toArray();
  return items.length;
}

export function notifyLocalWrite(): void {
  requestSync();
}
