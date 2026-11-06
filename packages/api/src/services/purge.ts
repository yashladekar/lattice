import type { Database } from "@notes-learning/db";
import {
  expandHeldCanvases,
  expandHeldDecks,
  expandHeldNodes,
  expandHeldPages,
  holdCoverage,
  retentionCutoff,
  type SyncEntity,
} from "@notes-learning/domain";

import { appendChanges, type PendingChange } from "./changes";

/**
 * Permanently removes soft-deleted rows older than the workspace's retention
 * window and records tombstone changes so clients reflect the purge.
 *
 * This is deliberately server-driven: an immediate "empty trash" button would
 * need its own op semantic and apply path, because a client that simply
 * dropped rows locally would disagree with the server and resurrect content on
 * the next pull.
 *
 * A legal hold outranks retention: rows covered by an active hold are left
 * alone, and a workspace hold stops the purge entirely.
 */
export async function purgeWorkspaceTrash(
  db: Database,
  workspaceId: string,
  retentionDays: number,
): Promise<{ purged: number }> {
  const cutoff = retentionCutoff(retentionDays);
  if (!cutoff) return { purged: 0 };

  const holds = await db.legalHold.findMany({
    where: { workspaceId, releasedAt: null },
    select: { scope: true, targetId: true, releasedAt: true },
  });
  const coverage = holdCoverage(holds);
  if (coverage.workspace) return { purged: 0 };

  const [pages, canvases, nodes, decks] = await Promise.all([
    db.page.findMany({ where: { workspaceId }, select: { id: true, notebookId: true } }),
    db.canvas.findMany({ where: { workspaceId }, select: { id: true, notebookId: true } }),
    db.knowledgeNode.findMany({
      where: { workspaceId },
      select: { id: true, pageId: true, canvasId: true },
    }),
    db.deck.findMany({ where: { workspaceId }, select: { id: true, notebookId: true } }),
  ]);
  const heldPages = expandHeldPages(coverage, pages);
  const heldCanvases = expandHeldCanvases(coverage, canvases);
  const heldNodes = expandHeldNodes(nodes, heldPages, heldCanvases);
  const heldDecks = expandHeldDecks(decks, coverage);

  return db.$transaction(async (tx) => {
    const changes: PendingChange[] = [];
    let purged = 0;

    /** Prisma filter that skips held rows, or nothing when none are held. */
    const exclusions = (field: "id" | "pageId" | "deckId", held: Set<string>) =>
      held.size ? { NOT: { [field]: { in: [...held] } } } : {};

    const purgeRows = async (
      entity: SyncEntity,
      rows: Array<{ id: string; deletedAt: Date | null }>,
      remove: (ids: string[]) => Promise<unknown>,
    ) => {
      const stale = rows.filter((row) => row.deletedAt && row.deletedAt.getTime() < cutoff.getTime());
      if (!stale.length) return;
      const ids = stale.map((row) => row.id);
      await remove(ids);
      for (const row of stale) {
        changes.push({
          entity,
          entityId: row.id,
          op: "DELETE",
          data: { id: row.id, workspaceId, deletedAt: row.deletedAt },
        });
      }
      purged += stale.length;
    };

    const staleWhere = { workspaceId, deletedAt: { lt: cutoff } };
    const select = { id: true, deletedAt: true } as const;

    await purgeRows(
      "comment",
      await tx.comment.findMany({
        where: { ...staleWhere, ...exclusions("pageId", heldPages) },
        select,
      }),
      (ids) => tx.comment.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "edge",
      await tx.knowledgeEdge.findMany({
        where: {
          ...staleWhere,
          ...(heldNodes.size
            ? {
                NOT: {
                  OR: [
                    { sourceNodeId: { in: [...heldNodes] } },
                    { targetNodeId: { in: [...heldNodes] } },
                  ],
                },
              }
            : {}),
        },
        select,
      }),
      (ids) => tx.knowledgeEdge.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "flashcard",
      await tx.flashcard.findMany({
        where: {
          ...staleWhere,
          ...(heldPages.size || heldDecks.size
            ? {
                NOT: {
                  OR: [
                    ...(heldPages.size ? [{ pageId: { in: [...heldPages] } }] : []),
                    ...(heldDecks.size ? [{ deckId: { in: [...heldDecks] } }] : []),
                  ],
                },
              }
            : {}),
        },
        select,
      }),
      (ids) => tx.flashcard.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "deck",
      await tx.deck.findMany({ where: { ...staleWhere, ...exclusions("id", heldDecks) }, select }),
      (ids) => tx.deck.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "attachment",
      await tx.attachment.findMany({
        where: { ...staleWhere, ...exclusions("pageId", heldPages) },
        select,
      }),
      (ids) => tx.attachment.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "capture",
      await tx.capture.findMany({ where: staleWhere, select }),
      (ids) => tx.capture.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "template",
      await tx.template.findMany({ where: staleWhere, select }),
      (ids) => tx.template.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "node",
      await tx.knowledgeNode.findMany({ where: { ...staleWhere, ...exclusions("id", heldNodes) }, select }),
      (ids) => tx.knowledgeNode.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "page",
      await tx.page.findMany({ where: { ...staleWhere, ...exclusions("id", heldPages) }, select }),
      (ids) => tx.page.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "canvas",
      await tx.canvas.findMany({
        where: { ...staleWhere, ...exclusions("id", heldCanvases) },
        select,
      }),
      (ids) => tx.canvas.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "notebook",
      await tx.notebook.findMany({
        where: { ...staleWhere, ...exclusions("id", coverage.notebookIds) },
        select,
      }),
      (ids) => tx.notebook.deleteMany({ where: { id: { in: ids } } }),
    );
    await purgeRows(
      "tag",
      await tx.tag.findMany({ where: staleWhere, select }),
      (ids) => tx.tag.deleteMany({ where: { id: { in: ids } } }),
    );

    // Teams are server-only records and not part of the sync surface, so they
    // are removed without tombstones.
    const staleTeams = await tx.team.findMany({ where: staleWhere, select: { id: true } });
    if (staleTeams.length) {
      const teamIds = staleTeams.map((team) => team.id);
      await tx.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
      await tx.team.deleteMany({ where: { id: { in: teamIds } } });
      purged += teamIds.length;
    }

    await appendChanges(tx, workspaceId, null, changes);
    return { purged };
  });
}

export async function purgeExpiredTrash(
  db: Database,
): Promise<{ workspaces: number; purged: number }> {
  const workspaces = await db.workspace.findMany({
    where: { deletedAt: null, trashRetentionDays: { gt: 0 } },
    select: { id: true, trashRetentionDays: true },
  });
  let purged = 0;
  let touched = 0;
  for (const workspace of workspaces) {
    const result = await purgeWorkspaceTrash(db, workspace.id, workspace.trashRetentionDays);
    if (result.purged) {
      touched += 1;
      purged += result.purged;
    }
  }
  return { workspaces: touched, purged };
}
