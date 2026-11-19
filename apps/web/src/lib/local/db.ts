import Dexie, { type Table } from "dexie";

import type {
  LocalAttachment,
  LocalCanvas,
  LocalCapture,
  LocalComment,
  LocalConflict,
  LocalDeck,
  LocalEdge,
  LocalFlashcard,
  LocalMember,
  LocalNode,
  LocalNotebook,
  LocalObjectType,
  LocalPage,
  LocalPageDocument,
  LocalPageTag,
  LocalReviewLog,
  LocalSuggestedEdit,
  LocalTag,
  LocalTemplate,
  LocalWorkspace,
  MetaRow,
  OutboxItem,
} from "./types";

export class LatticeDB extends Dexie {
  workspaces!: Table<LocalWorkspace, string>;
  members!: Table<LocalMember, string>;
  notebooks!: Table<LocalNotebook, string>;
  pages!: Table<LocalPage, string>;
  pageDocuments!: Table<LocalPageDocument, string>;
  canvases!: Table<LocalCanvas, string>;
  nodes!: Table<LocalNode, string>;
  edges!: Table<LocalEdge, string>;
  tags!: Table<LocalTag, string>;
  pageTags!: Table<LocalPageTag, string>;
  captures!: Table<LocalCapture, string>;
  templates!: Table<LocalTemplate, string>;
  decks!: Table<LocalDeck, string>;
  flashcards!: Table<LocalFlashcard, string>;
  reviewLogs!: Table<LocalReviewLog, string>;
  comments!: Table<LocalComment, string>;
  suggestedEdits!: Table<LocalSuggestedEdit, string>;
  objectTypes!: Table<LocalObjectType, string>;
  attachments!: Table<LocalAttachment, string>;
  conflicts!: Table<LocalConflict, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<MetaRow, string>;

  constructor(userId: string) {
    super(`lattice-${userId}`);
    this.version(1).stores({
      workspaces: "id, type, updatedAt",
      members: "id, workspaceId, userId, [workspaceId+userId]",
      notebooks: "id, workspaceId, parentId, [workspaceId+parentId], sortOrder",
      pages:
        "id, workspaceId, notebookId, parentId, [workspaceId+notebookId], [workspaceId+parentId], updatedAt, deletedAt",
      pageDocuments: "pageId, workspaceId",
      canvases: "id, workspaceId, notebookId, updatedAt, deletedAt",
      nodes: "id, workspaceId, pageId, canvasId, kind",
      edges: "id, workspaceId, sourceNodeId, targetNodeId, relationType, origin",
      tags: "id, workspaceId, &[workspaceId+name]",
      pageTags: "id, pageId, tagId, &[pageId+tagId]",
      captures: "id, workspaceId, status, createdAt",
      templates: "id, workspaceId, category",
      decks: "id, workspaceId",
      flashcards: "id, workspaceId, deckId, pageId, dueAt, deletedAt",
      reviewLogs: "id, workspaceId, flashcardId, reviewedAt",
      comments: "id, workspaceId, pageId, parentId, resolvedAt",
      attachments: "id, workspaceId, pageId",
      conflicts: "id, workspaceId, entityId, createdAt",
      outbox: "id, workspaceId, entity, entityId, createdAt",
      meta: "key",
    });
    this.version(2).stores({
      suggestedEdits: "id, workspaceId, pageId, status, updatedAt",
    });
    this.version(3).stores({
      objectTypes: "id, workspaceId, updatedAt",
    });
  }
}

const databases = new Map<string, LatticeDB>();

export function getLocalDb(userId: string): LatticeDB {
  const existing = databases.get(userId);
  if (existing) return existing;
  const db = new LatticeDB(userId);
  databases.set(userId, db);
  return db;
}

export async function closeLocalDb(userId: string): Promise<void> {
  const db = databases.get(userId);
  if (!db) return;
  await db.close();
  databases.delete(userId);
}

export async function deleteLocalDb(userId: string): Promise<void> {
  await closeLocalDb(userId);
  await Dexie.delete(`lattice-${userId}`);
}

/**
 * Drops everything this device holds for one workspace: its rows, any queued
 * changes and conflicts, and its sync bookkeeping. Used when the server no
 * longer lists the member in that workspace.
 */
export async function removeWorkspaceLocal(db: LatticeDB, workspaceId: string): Promise<void> {
  const scoped: Table[] = [
    db.members,
    db.notebooks,
    db.pages,
    db.pageDocuments,
    db.canvases,
    db.nodes,
    db.edges,
    db.tags,
    db.captures,
    db.templates,
    db.decks,
    db.flashcards,
    db.reviewLogs,
    db.comments,
    db.suggestedEdits,
    db.objectTypes,
    db.attachments,
    db.conflicts,
    db.outbox,
  ];
  await db.transaction("rw", [...scoped, db.pageTags, db.workspaces, db.meta], async () => {
    // Page tags carry no workspace id; they go with their pages.
    const pageIds = await db.pages.where("workspaceId").equals(workspaceId).primaryKeys();
    if (pageIds.length) await db.pageTags.where("pageId").anyOf(pageIds).delete();
    for (const table of scoped) {
      await table.where("workspaceId").equals(workspaceId).delete();
    }
    await db.workspaces.delete(workspaceId);
    await db.meta.bulkDelete([
      `cursor:${workspaceId}`,
      `snapshot:${workspaceId}`,
      `role:${workspaceId}`,
    ]);
  });
}

export async function getMeta<T>(db: LatticeDB, key: string): Promise<T | null> {
  const row = await db.meta.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function setMeta(db: LatticeDB, key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value: JSON.stringify(value) });
}

export async function removeMeta(db: LatticeDB, key: string): Promise<void> {
  await db.meta.delete(key);
}
