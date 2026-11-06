import type { Database } from "@notes-learning/db";
import { ORPCError } from "@orpc/server";

import { toJsonSafe } from "./changes";

import { getAccessiblePageIds } from "./sync";

/**
 * Paged workspace snapshot.
 *
 * A first device used to download every page, body, and card in one response,
 * which is a large parse in the browser and a long query on the server. The
 * snapshot is now a sequence of pages over a fixed order of collections.
 *
 * Correctness comes from the version: the first page pins the workspace's
 * sync version, every page reports it, and the client applies the assembled
 * payload only when the last page arrives. Anything that changes while the
 * download runs has a later change-log version, so the normal pull reconciles
 * it after the client stores the snapshot cursor.
 */
export const SNAPSHOT_PARTS = [
  "workspace",
  "members",
  "notebooks",
  "pages",
  "pageDocuments",
  "canvases",
  "nodes",
  "edges",
  "tags",
  "pageTags",
  "captures",
  "templates",
  "decks",
  "flashcards",
  "comments",
  "attachments",
  "suggestedEdits",
  "objectTypes",
] as const;

export type SnapshotPart = (typeof SNAPSHOT_PARTS)[number];

export const DEFAULT_SNAPSHOT_PAGE_SIZE = 500;
export const MAX_SNAPSHOT_PAGE_SIZE = 2_000;

interface SnapshotCursorState {
  version: number;
  part: number;
  after: string;
}

export function encodeSnapshotCursor(state: SnapshotCursorState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeSnapshotCursor(value: string): SnapshotCursorState | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const version = record.version;
    const part = record.part;
    const after = record.after;
    if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return null;
    if (typeof part !== "number" || !Number.isInteger(part) || part < 0) return null;
    if (part >= SNAPSHOT_PARTS.length) return null;
    if (typeof after !== "string") return null;
    return { version, part, after };
  } catch {
    return null;
  }
}

export interface SnapshotPage {
  version: number;
  role: string;
  done: boolean;
  cursor: string | null;
  payload: Record<string, unknown>;
}

const visiblePage = (
  allowed: Set<string> | null,
  pageId: string | null | undefined,
): boolean => !allowed || !pageId || allowed.has(pageId);

export async function snapshotPage(
  db: Database,
  input: {
    workspaceId: string;
    userId: string;
    role: string;
    cursor?: string | null;
    pageSize?: number;
  },
): Promise<SnapshotPage> {
  const pageSize = Math.min(
    MAX_SNAPSHOT_PAGE_SIZE,
    Math.max(1, Math.floor(input.pageSize ?? DEFAULT_SNAPSHOT_PAGE_SIZE)),
  );

  let state: SnapshotCursorState;
  if (input.cursor) {
    const decoded = decodeSnapshotCursor(input.cursor);
    if (!decoded) throw new ORPCError("BAD_REQUEST", { message: "Invalid snapshot cursor" });
    state = decoded;
  } else {
    const workspace = await db.workspace.findFirst({
      where: { id: input.workspaceId, deletedAt: null },
      select: { id: true, syncVersion: true },
    });
    if (!workspace) throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    state = { version: workspace.syncVersion, part: 0, after: "" };
  }

  // Visibility is recomputed per page. It is one query for viewers and none for
  // editors and admins, and a permission change mid-snapshot is picked up by the
  // following pull because pages are versioned entities.
  const allowed = await getAccessiblePageIds(
    db,
    input.workspaceId,
    input.userId,
    input.role as Parameters<typeof getAccessiblePageIds>[3],
  );

  const part = SNAPSHOT_PARTS[state.part]!;
  const payload: Record<string, unknown> = {};
  let done = false;
  let cursor: string | null = null;

  const finishPart = (rows: unknown[], rawCount: number, lastRawId: string | null) => {
    payload[part] = rows;
    if (rawCount > pageSize && lastRawId) {
      cursor = encodeSnapshotCursor({ version: state.version, part: state.part, after: lastRawId });
      return;
    }
    if (state.part + 1 >= SNAPSHOT_PARTS.length) {
      done = true;
      return;
    }
    cursor = encodeSnapshotCursor({
      version: state.version,
      part: state.part + 1,
      after: "",
    });
  };

  if (part === "workspace") {
    const workspace = await db.workspace.findFirst({
      where: { id: input.workspaceId, deletedAt: null },
    });
    if (!workspace) throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
    finishPart([workspace], 0, null);
    return { version: state.version, role: input.role, done, cursor, payload };
  }

  const take = pageSize + 1;
  const after = state.after ? { id: { gt: state.after } } : {};

  switch (part) {
    case "members": {
      const rows = await db.workspaceMember.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "notebooks": {
      const rows = await db.notebook.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "pages": {
      const rows = await db.page.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(page.filter((row) => visiblePage(allowed, row.id)), rows.length, page.at(-1)?.id ?? null);
      break;
    }
    case "pageDocuments": {
      const rows = await db.pageDocument.findMany({
        where: {
          workspaceId: input.workspaceId,
          page: { deletedAt: null },
          ...(state.after ? { pageId: { gt: state.after } } : {}),
        },
        orderBy: { pageId: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(
        page.filter((row) => visiblePage(allowed, row.pageId)),
        rows.length,
        page.at(-1)?.pageId ?? null,
      );
      break;
    }
    case "canvases": {
      const rows = await db.canvas.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "nodes": {
      const rows = await db.knowledgeNode.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(page.filter((row) => visiblePage(allowed, row.pageId)), rows.length, page.at(-1)?.id ?? null);
      break;
    }
    case "edges": {
      const rows = await db.knowledgeEdge.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      if (!allowed) {
        finishPart(page, rows.length, page.at(-1)?.id ?? null);
        break;
      }
      // Visibility for an edge depends on both endpoints; look up just this
      // page's endpoints rather than every node in the workspace.
      const endpointIds = [...new Set(page.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]))];
      const endpoints = await db.knowledgeNode.findMany({
        where: { id: { in: endpointIds } },
        select: { id: true, pageId: true },
      });
      const visibleNodeIds = new Set(
        endpoints.filter((node) => visiblePage(allowed, node.pageId)).map((node) => node.id),
      );
      finishPart(
        page.filter(
          (edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId),
        ),
        rows.length,
        page.at(-1)?.id ?? null,
      );
      break;
    }
    case "tags": {
      const rows = await db.tag.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "pageTags": {
      const rows = await db.pageTag.findMany({
        where: {
          page: { workspaceId: input.workspaceId, deletedAt: null },
          ...(state.after ? { id: { gt: state.after } } : {}),
        },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(page.filter((row) => visiblePage(allowed, row.pageId)), rows.length, page.at(-1)?.id ?? null);
      break;
    }
    case "captures": {
      const rows = await db.capture.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "templates": {
      const rows = await db.template.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "decks": {
      const rows = await db.deck.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    case "flashcards": {
      const rows = await db.flashcard.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(
        page.filter((row) => !row.pageId || visiblePage(allowed, row.pageId)),
        rows.length,
        page.at(-1)?.id ?? null,
      );
      break;
    }
    case "comments": {
      const rows = await db.comment.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(
        page.filter((row) => visiblePage(allowed, row.pageId)),
        rows.length,
        page.at(-1)?.id ?? null,
      );
      break;
    }
    case "attachments": {
      const rows = await db.attachment.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(
        page.filter((row) => !row.pageId || visiblePage(allowed, row.pageId)),
        rows.length,
        page.at(-1)?.id ?? null,
      );
      break;
    }
    case "suggestedEdits": {
      const rows = await db.suggestedEdit.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      const page = rows.slice(0, pageSize);
      finishPart(
        page.filter((row) => visiblePage(allowed, row.pageId)),
        rows.length,
        page.at(-1)?.id ?? null,
      );
      break;
    }
    case "objectTypes": {
      const rows = await db.objectType.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: null, ...after },
        orderBy: { id: "asc" },
        take,
      });
      finishPart(rows.slice(0, pageSize), rows.length, rows[pageSize - 1]?.id ?? null);
      break;
    }
    default:
      done = true;
  }

  return {
    version: state.version,
    role: input.role,
    done,
    cursor,
    payload: toJsonSafe(payload),
  };
}
