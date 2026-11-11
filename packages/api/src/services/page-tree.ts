import type { Database } from "@notes-learning/db";
import { descendantPageIds } from "@notes-learning/domain";

import { appendChanges, ensurePageNode, toJsonSafe, type PendingChange } from "./changes";

/**
 * Restores a trashed page and every trashed page below it, mirroring the
 * subtree delete. Restoring is an undo of that delete, so descendant pages are
 * restored with the parent even when the actor could not edit each one alone.
 */
export async function restorePageSubtree(
  db: Database,
  input: { workspaceId: string; userId: string; pageId: string },
) {
  return db.$transaction(async (tx) => {
    const pages = await tx.page.findMany({
      where: { workspaceId: input.workspaceId },
      select: { id: true, parentId: true, deletedAt: true },
    });
    const ids = [
      input.pageId,
      ...descendantPageIds(input.pageId, pages, { includeDeleted: true }),
    ];
    const trashed = new Set(pages.filter((page) => page.deletedAt).map((page) => page.id));
    const targets = ids.filter((id) => trashed.has(id));
    const changes: PendingChange[] = [];

    for (const id of targets) {
      const restored = await tx.page.update({
        where: { id },
        data: { deletedAt: null, updatedById: input.userId },
      });
      changes.push({
        entity: "page",
        entityId: restored.id,
        op: "UPSERT",
        data: toJsonSafe(restored),
      });
      await ensurePageNode(tx, restored, changes);
    }

    const nodes = await tx.knowledgeNode.findMany({
      where: { pageId: { in: targets } },
      select: { id: true },
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    if (nodeIds.size) {
      const edges = await tx.knowledgeEdge.findMany({
        where: { workspaceId: input.workspaceId, deletedAt: { not: null } },
      });
      for (const edge of edges) {
        if (!nodeIds.has(edge.sourceNodeId) || !nodeIds.has(edge.targetNodeId)) continue;
        const restored = await tx.knowledgeEdge.update({
          where: { id: edge.id },
          data: { deletedAt: null },
        });
        changes.push({
          entity: "edge",
          entityId: restored.id,
          op: "UPSERT",
          data: toJsonSafe(restored),
        });
      }
    }

    await appendChanges(tx, input.workspaceId, input.userId, changes);
    return tx.page.findUniqueOrThrow({ where: { id: input.pageId } });
  });
}
