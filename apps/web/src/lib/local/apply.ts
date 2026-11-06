import {
  encodeCursor,
  decodeCursor,
  type SyncChange,
  type SyncCursor,
  type SyncEntity,
} from "@notes-learning/domain";

import { setMeta, type LatticeDB } from "./db";
import type { LocalSnapshotPayload } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function putWorkspace(db: LatticeDB, snapshot: LocalSnapshotPayload): Promise<void> {
  await db.workspaces.put(snapshot.workspace);
  if (snapshot.members.length) await db.members.bulkPut(snapshot.members);
  if (snapshot.notebooks.length) await db.notebooks.bulkPut(snapshot.notebooks);
  if (snapshot.pages.length) await db.pages.bulkPut(snapshot.pages);
  if (snapshot.pageDocuments.length) {
    await db.pageDocuments.bulkPut(
      snapshot.pageDocuments.map((document) => ({
        ...document,
        localUpdatedAt: document.updatedAt,
      })),
    );
  }
  if (snapshot.canvases.length) await db.canvases.bulkPut(snapshot.canvases);
  if (snapshot.nodes.length) await db.nodes.bulkPut(snapshot.nodes);
  if (snapshot.edges.length) await db.edges.bulkPut(snapshot.edges);
  if (snapshot.tags.length) await db.tags.bulkPut(snapshot.tags);
  if (snapshot.pageTags.length) await db.pageTags.bulkPut(snapshot.pageTags);
  if (snapshot.captures.length) await db.captures.bulkPut(snapshot.captures);
  if (snapshot.templates.length) await db.templates.bulkPut(snapshot.templates);
  if (snapshot.decks.length) await db.decks.bulkPut(snapshot.decks);
  if (snapshot.flashcards.length) await db.flashcards.bulkPut(snapshot.flashcards);
  if (snapshot.comments.length) await db.comments.bulkPut(snapshot.comments);
  if (snapshot.suggestedEdits?.length) await db.suggestedEdits.bulkPut(snapshot.suggestedEdits);
  if (snapshot.objectTypes?.length) await db.objectTypes.bulkPut(snapshot.objectTypes);
  if (snapshot.attachments.length) await db.attachments.bulkPut(snapshot.attachments);
}

export async function applySnapshot(
  db: LatticeDB,
  snapshot: LocalSnapshotPayload,
): Promise<SyncCursor> {
  const cursor: SyncCursor = { version: snapshot.version, id: "\uffffsnapshot" };
  await db.transaction(
    "rw",
    [
      db.workspaces,
      db.members,
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
      db.suggestedEdits,
      db.objectTypes,
      db.attachments,
      db.meta,
    ],
    async () => {
      await putWorkspace(db, snapshot);
      await setMeta(db, `cursor:${snapshot.workspace.id}`, encodeCursor(cursor));
      await setMeta(db, `snapshot:${snapshot.workspace.id}`, true);
    },
  );
  return cursor;
}

export async function cursorFor(db: LatticeDB, workspaceId: string): Promise<SyncCursor | null> {
  const row = await db.meta.get(`cursor:${workspaceId}`);
  if (!row) return null;
  try {
    return decodeCursor(JSON.parse(row.value) as string);
  } catch {
    return null;
  }
}

async function markDeleted(
  db: LatticeDB,
  entity: SyncEntity,
  data: Record<string, unknown>,
): Promise<void> {
  const id = typeof data.id === "string" ? data.id : null;
  const deletedAt = typeof data.deletedAt === "string" ? data.deletedAt : new Date().toISOString();
  if (!id) return;
  switch (entity) {
    case "workspace": {
      const row = await db.workspaces.get(id);
      if (row) await db.workspaces.put({ ...row, deletedAt });
      break;
    }
    case "member":
      await db.members.delete(id);
      break;
    case "notebook": {
      const row = await db.notebooks.get(id);
      if (row) await db.notebooks.put({ ...row, deletedAt });
      break;
    }
    case "page": {
      const row = await db.pages.get(id);
      if (row) await db.pages.put({ ...row, deletedAt });
      break;
    }
    case "pageDocument":
      break;
    case "canvas": {
      const row = await db.canvases.get(id);
      if (row) await db.canvases.put({ ...row, deletedAt });
      break;
    }
    case "node": {
      const row = await db.nodes.get(id);
      if (row) await db.nodes.put({ ...row, deletedAt });
      break;
    }
    case "edge": {
      const row = await db.edges.get(id);
      if (row) await db.edges.put({ ...row, deletedAt });
      break;
    }
    case "tag": {
      const row = await db.tags.get(id);
      if (row) await db.tags.put({ ...row, deletedAt });
      break;
    }
    case "pageTag":
      await db.pageTags.delete(id);
      break;
    case "capture": {
      const row = await db.captures.get(id);
      if (row) await db.captures.put({ ...row, deletedAt });
      break;
    }
    case "template": {
      const row = await db.templates.get(id);
      if (row) await db.templates.put({ ...row, deletedAt });
      break;
    }
    case "deck": {
      const row = await db.decks.get(id);
      if (row) await db.decks.put({ ...row, deletedAt });
      break;
    }
    case "flashcard": {
      const row = await db.flashcards.get(id);
      if (row) await db.flashcards.put({ ...row, deletedAt });
      break;
    }
    case "comment": {
      const row = await db.comments.get(id);
      if (row) await db.comments.put({ ...row, deletedAt });
      break;
    }
    case "suggestedEdit": {
      const row = await db.suggestedEdits.get(id);
      if (row) await db.suggestedEdits.put({ ...row, deletedAt });
      break;
    }
    case "objectType": {
      const row = await db.objectTypes.get(id);
      if (row) await db.objectTypes.put({ ...row, deletedAt });
      break;
    }
    case "attachment": {
      const row = await db.attachments.get(id);
      if (row) await db.attachments.put({ ...row, deletedAt });
      break;
    }
    default:
      break;
  }
}

export async function applyChange(db: LatticeDB, change: SyncChange): Promise<void> {
  const entity = change.entity as SyncEntity;
  const data = asRecord(change.data);
  if (change.op === "DELETE") {
    await markDeleted(db, entity, data);
    return;
  }
  switch (entity) {
    case "workspace":
      await db.workspaces.put(data as never);
      break;
    case "member":
      await db.members.put(data as never);
      break;
    case "notebook":
      await db.notebooks.put(data as never);
      break;
    case "page":
      await db.pages.put(data as never);
      break;
    case "pageDocument": {
      const pageId = change.entityId;
      const { source, ...rest } = data as Record<string, unknown> & { source?: unknown };
      const document = {
        ...rest,
        pageId,
        localUpdatedAt:
          typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
        lastChangeSource: source === "session" || source === "write" ? source : null,
      };
      await db.pageDocuments.put(document as never);
      break;
    }
    case "canvas":
      await db.canvases.put(data as never);
      break;
    case "node":
      await db.nodes.put(data as never);
      break;
    case "edge":
      await db.edges.put(data as never);
      break;
    case "tag":
      await db.tags.put(data as never);
      break;
    case "pageTag":
      await db.pageTags.put(data as never);
      break;
    case "capture":
      await db.captures.put(data as never);
      break;
    case "template":
      await db.templates.put(data as never);
      break;
    case "deck":
      await db.decks.put(data as never);
      break;
    case "flashcard":
      await db.flashcards.put(data as never);
      break;
    case "comment":
      await db.comments.put(data as never);
      break;
    case "suggestedEdit":
      await db.suggestedEdits.put(data as never);
      break;
    case "objectType":
      await db.objectTypes.put(data as never);
      break;
    case "attachment":
      await db.attachments.put(data as never);
      break;
    default:
      break;
  }
}

export async function applyAccepted(
  db: LatticeDB,
  accepted: {
    entity: SyncEntity;
    entityId: string;
    rev?: number;
    updatedAt: string;
  },
): Promise<void> {
  if (accepted.entity === "pageDocument") {
    const document = await db.pageDocuments.get(accepted.entityId);
    if (document) {
      await db.pageDocuments.put({
        ...document,
        rev: accepted.rev ?? document.rev,
        updatedAt: accepted.updatedAt,
      });
    }
    return;
  }
  if (accepted.entity === "canvas") {
    const canvas = await db.canvases.get(accepted.entityId);
    if (canvas) {
      await db.canvases.put({
        ...canvas,
        rev: accepted.rev ?? canvas.rev,
        updatedAt: accepted.updatedAt,
      });
    }
    return;
  }
  if (accepted.entity === "page") {
    const page = await db.pages.get(accepted.entityId);
    if (page) await db.pages.put({ ...page, updatedAt: accepted.updatedAt });
    return;
  }
  if (accepted.entity === "member") {
    const member = await db.members.get(accepted.entityId);
    if (member) await db.members.put({ ...member, updatedAt: accepted.updatedAt });
  }
}
