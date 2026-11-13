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

import { appendChanges, toJsonSafe, type PendingChange } from "./changes";

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

  return db.$transaction(async (tx) => {
    // Serializes against a hold created while this sweep runs. A hold either
    // commits before this lock and is seen below, or waits for the sweep.
    await tx.$queryRaw`SELECT id FROM "workspace" WHERE id = ${workspaceId} FOR UPDATE`;

    const holds = await tx.legalHold.findMany({
      where: { workspaceId, releasedAt: null },
      select: { scope: true, targetId: true, releasedAt: true },
    });
    const coverage = holdCoverage(holds);
    if (coverage.workspace) return { purged: 0 };

    const [pages, canvases, nodes, decks] = await Promise.all([
      tx.page.findMany({ where: { workspaceId }, select: { id: true, notebookId: true } }),
      tx.canvas.findMany({ where: { workspaceId }, select: { id: true, notebookId: true } }),
      tx.knowledgeNode.findMany({
        where: { workspaceId },
        select: { id: true, pageId: true, canvasId: true },
      }),
      tx.deck.findMany({ where: { workspaceId }, select: { id: true, notebookId: true } }),
    ]);
    const heldPages = expandHeldPages(coverage, pages);
    const heldCanvases = expandHeldCanvases(coverage, canvases);
    const heldNodes = expandHeldNodes(nodes, heldPages, heldCanvases);
    const heldDecks = expandHeldDecks(decks, coverage);
    // A notebook that contains a held page must survive too, or deleting it
    // would silently unfile protected content.
    const heldNotebooks = new Set(coverage.notebookIds);
    for (const page of pages) {
      if (page.notebookId && heldPages.has(page.id)) heldNotebooks.add(page.notebookId);
    }

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
    const staleDecks = await tx.deck.findMany({
      where: { ...staleWhere, ...exclusions("id", heldDecks) },
      select,
    });
    if (staleDecks.length) {
      const deckIds = staleDecks.map((deck) => deck.id);
      // A held page's cards are protected even when their deck is stale.
      const protectedDeckIds = new Set(
        heldPages.size
          ? (
              await tx.flashcard.findMany({
                where: { deckId: { in: deckIds }, pageId: { in: [...heldPages] } },
                select: { deckId: true },
              })
            ).map((card) => card.deckId)
          : [],
      );
      const deletableDecks = staleDecks.filter((deck) => !protectedDeckIds.has(deck.id));
      // Deleting a deck cascades its live cards, so record their tombstones
      // before the rows disappear.
      const orphanCards = deletableDecks.length
        ? await tx.flashcard.findMany({
            where: { deckId: { in: deletableDecks.map((deck) => deck.id) } },
            select,
          })
        : [];
      if (orphanCards.length) {
        await tx.flashcard.deleteMany({ where: { id: { in: orphanCards.map((card) => card.id) } } });
        for (const card of orphanCards) {
          changes.push({
            entity: "flashcard",
            entityId: card.id,
            op: "DELETE",
            data: { id: card.id, workspaceId, deletedAt: card.deletedAt ?? new Date() },
          });
        }
        purged += orphanCards.length;
      }
      await purgeRows(
        "deck",
        deletableDecks,
        (ids) => tx.deck.deleteMany({ where: { id: { in: ids } } }),
      );
    }
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
    const staleNotebooks = await tx.notebook.findMany({
      where: { ...staleWhere, ...exclusions("id", heldNotebooks) },
      select,
    });
    if (staleNotebooks.length) {
      const notebookIds = staleNotebooks.map((notebook) => notebook.id);
      // The FK sets notebookId to null on live pages; tell the clients about it.
      const unfiledPages = await tx.page.findMany({
        where: { workspaceId, notebookId: { in: notebookIds }, deletedAt: null },
      });
      if (unfiledPages.length) {
        await tx.page.updateMany({
          where: { id: { in: unfiledPages.map((page) => page.id) } },
          data: { notebookId: null },
        });
        for (const page of unfiledPages) {
          changes.push({
            entity: "page",
            entityId: page.id,
            op: "UPSERT",
            data: toJsonSafe({ ...page, notebookId: null }),
          });
        }
      }
      await purgeRows(
        "notebook",
        staleNotebooks,
        (ids) => tx.notebook.deleteMany({ where: { id: { in: ids } } }),
      );
    }
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

    // Nothing to record means no reason to touch the workspace row, which may
    // have been deleted between the sweep listing it and this transaction.
    if (changes.length) await appendChanges(tx, workspaceId, null, changes);
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
    try {
      const result = await purgeWorkspaceTrash(db, workspace.id, workspace.trashRetentionDays);
      if (result.purged) {
        touched += 1;
        purged += result.purged;
      }
    } catch (error) {
      // A workspace deleted mid-sweep, or one bad row, must not stop the rest.
      console.error(`Trash purge failed for workspace ${workspace.id}`, error);
    }
  }
  // Op ids only need to outlive a delayed retry. Without a prune this table
  // grows forever.
  await db.syncOp
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } })
    .catch(() => undefined);
  return { workspaces: touched, purged };
}
