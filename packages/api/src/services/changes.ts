import { randomUUID } from "node:crypto";

import { Prisma, type TransactionClient } from "@notes-learning/db";
import {
  dedupeChanges,
  extractPageLinks,
  parseWebhookFilters,
  safeDoc,
  webhookEventForChange,
  webhookMatchesFilters,
  type PendingSyncChange,
  type SyncEntity,
} from "@notes-learning/domain";

export interface PendingChange extends PendingSyncChange {
  entity: SyncEntity;
  data: Record<string, unknown>;
}

export function toJsonSafe(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (!serialized) return {};
  return JSON.parse(serialized) as Record<string, unknown>;
}

export async function appendChanges(
  tx: TransactionClient,
  workspaceId: string,
  actorId: string | null,
  changes: PendingChange[],
): Promise<number> {
  const workspace = await tx.workspace.findUnique({
    where: { id: workspaceId },
    select: { syncVersion: true },
  });
  if (!workspace) throw new Error("Workspace not found");

  if (!changes.length) return workspace.syncVersion;

  // One batch can touch the same entity more than once — creating a page also
  // creates its document, for example. Record only the final write.
  const finalChanges = dedupeChanges(changes);

  const updated = await tx.workspace.update({
    where: { id: workspaceId },
    data: { syncVersion: { increment: 1 } },
    select: { syncVersion: true },
  });

  await tx.syncChange.createMany({
    data: finalChanges.map((change) => ({
      id: `sc_${randomUUID()}`,
      workspaceId,
      version: updated.syncVersion,
      entity: change.entity,
      entityId: change.entityId,
      op: change.op,
      data: change.data as Prisma.InputJsonValue,
      actorId,
    })),
  });

  await enqueueWebhookDeliveries(tx, workspaceId, actorId, finalChanges);

  return updated.syncVersion;
}

/**
 * Queues webhook deliveries in the same transaction as the change log, so an
 * event is never lost if the process restarts. Delivery itself happens in the
 * server's scheduler, not here.
 */
async function enqueueWebhookDeliveries(
  tx: TransactionClient,
  workspaceId: string,
  actorId: string | null,
  changes: PendingChange[],
): Promise<void> {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { workspaceId, enabled: true },
    select: { id: true, events: true, filters: true },
  });
  if (!endpoints.length) return;

  const occurredAt = new Date().toISOString();
  const deliveries: Prisma.WebhookDeliveryCreateManyInput[] = [];
  for (const endpoint of endpoints) {
    const subscribed = Array.isArray(endpoint.events)
      ? new Set(endpoint.events.filter((event): event is string => typeof event === "string"))
      : new Set<string>();
    if (!subscribed.size) continue;
    const filters = parseWebhookFilters(endpoint.filters);
    for (const change of changes) {
      const event = webhookEventForChange(change.entity, change.op);
      if (!event || !subscribed.has(event)) continue;
      if (!webhookMatchesFilters(filters, change, actorId)) continue;
      const serialized = JSON.stringify(change.data);
      deliveries.push({
        id: `whd_${randomUUID()}`,
        workspaceId,
        endpointId: endpoint.id,
        event,
        payload: {
          event,
          workspaceId,
          entity: change.entity,
          entityId: change.entityId,
          op: change.op,
          actorId,
          occurredAt,
          ...(serialized.length <= 20_000 ? { data: change.data } : {}),
        } as Prisma.InputJsonValue,
      });
    }
  }
  if (deliveries.length) {
    await tx.webhookDelivery.createMany({ data: deliveries });
  }
}

export async function ensurePageNode(
  tx: TransactionClient,
  page: {
    id: string;
    workspaceId: string;
    title: string;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  },
  changes: PendingChange[],
): Promise<string> {
  const existing = await tx.knowledgeNode.findFirst({
    where: { OR: [{ id: page.id }, { pageId: page.id }] },
  });
  if (existing) {
    const updated = await tx.knowledgeNode.update({
      where: { id: existing.id },
      data: {
        title: page.title,
        deletedAt: page.deletedAt,
        kind: "PAGE",
      },
    });
    changes.push({
      entity: "node",
      entityId: updated.id,
      op: page.deletedAt ? "DELETE" : "UPSERT",
      data: toJsonSafe(updated),
    });
    return updated.id;
  }
  const node = await tx.knowledgeNode.create({
    data: {
      id: page.id,
      workspaceId: page.workspaceId,
      kind: "PAGE",
      title: page.title,
      pageId: page.id,
      createdById: page.createdById,
    },
  });
  changes.push({
    entity: "node",
    entityId: node.id,
    op: "UPSERT",
    data: toJsonSafe(node),
  });
  return node.id;
}

export async function ensureCanvasNode(
  tx: TransactionClient,
  canvas: {
    id: string;
    workspaceId: string;
    title: string;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  },
  changes: PendingChange[],
): Promise<string> {
  const existing = await tx.knowledgeNode.findFirst({
    where: { OR: [{ id: canvas.id }, { canvasId: canvas.id }] },
  });
  if (existing) {
    const updated = await tx.knowledgeNode.update({
      where: { id: existing.id },
      data: { title: canvas.title, deletedAt: canvas.deletedAt, kind: "CANVAS" },
    });
    changes.push({
      entity: "node",
      entityId: updated.id,
      op: canvas.deletedAt ? "DELETE" : "UPSERT",
      data: toJsonSafe(updated),
    });
    return updated.id;
  }
  const node = await tx.knowledgeNode.create({
    data: {
      id: canvas.id,
      workspaceId: canvas.workspaceId,
      kind: "CANVAS",
      title: canvas.title,
      canvasId: canvas.id,
      createdById: canvas.createdById,
    },
  });
  changes.push({
    entity: "node",
    entityId: node.id,
    op: "UPSERT",
    data: toJsonSafe(node),
  });
  return node.id;
}

export async function recomputePageLinkEdges(
  tx: TransactionClient,
  page: { id: string; workspaceId: string; title: string },
  content: unknown,
  actorId: string | null,
  changes: PendingChange[],
): Promise<void> {
  const doc = safeDoc(content);
  const links = extractPageLinks(doc).filter((link) => link.pageId !== page.id);
  const targetIds = [...new Set(links.map((link) => link.pageId))];
  const targets = targetIds.length
    ? await tx.page.findMany({
        where: { workspaceId: page.workspaceId, id: { in: targetIds }, deletedAt: null },
        select: {
          id: true,
          workspaceId: true,
          title: true,
          createdById: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      })
    : [];

  const validTargets = new Set(targets.map((target) => target.id));
  // Soft-deleted edges keep holding their id and their (source, target, relation,
  // origin) tuple, so they have to be revived instead of created again.
  const existingEdges = await tx.knowledgeEdge.findMany({
    where: {
      workspaceId: page.workspaceId,
      sourceNodeId: page.id,
      origin: "PAGE_LINK",
    },
  });
  const existingByTarget = new Map<string, (typeof existingEdges)[number]>();
  for (const edge of existingEdges) {
    const current = existingByTarget.get(edge.targetNodeId);
    if (!current || (current.deletedAt && !edge.deletedAt)) {
      existingByTarget.set(edge.targetNodeId, edge);
    }
  }

  for (const target of targets) {
    const targetNodeId = await ensurePageNode(tx, target, changes);
    const existing = existingByTarget.get(targetNodeId);
    if (existing && !existing.deletedAt) continue;
    const edge = existing
      ? await tx.knowledgeEdge.update({
          where: { id: existing.id },
          data: { deletedAt: null },
        })
      : await tx.knowledgeEdge.create({
          data: {
            id: `link:${page.id}:${target.id}`,
            workspaceId: page.workspaceId,
            sourceNodeId: page.id,
            targetNodeId,
            relationType: "REFERENCES",
            origin: "PAGE_LINK",
            createdById: actorId,
          },
        });
    changes.push({
      entity: "edge",
      entityId: edge.id,
      op: "UPSERT",
      data: toJsonSafe(edge),
    });
  }

  for (const edge of existingEdges) {
    if (edge.deletedAt || validTargets.has(edge.targetNodeId)) continue;
    const deleted = await tx.knowledgeEdge.update({
      where: { id: edge.id },
      data: { deletedAt: new Date() },
    });
    changes.push({
      entity: "edge",
      entityId: deleted.id,
      op: "DELETE",
      data: toJsonSafe(deleted),
    });
  }
}
