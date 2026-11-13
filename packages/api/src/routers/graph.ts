import { randomUUID } from "node:crypto";

import {
  buildDerivedGraph,
  createId,
  relatedDocuments,
  summarizeGraph,
  type Canvas,
  type KnowledgeEdge,
  type KnowledgeNode,
  type Page,
  type PageDocument,
  type RelatedDocument,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { pushSync } from "../services/sync";
import { getAccessiblePageIds } from "../services/sync";

type GraphNodeRow = { id: string; pageId: string | null };
type GraphEdgeRow = { sourceNodeId: string; targetNodeId: string };

/** Drops nodes attached to pages the caller cannot read. */
function visibleNodes<T extends GraphNodeRow>(nodes: T[], allowed: Set<string> | null): T[] {
  return allowed ? nodes.filter((node) => !node.pageId || allowed.has(node.pageId)) : nodes;
}

/** Then drops edges that touch a hidden node, so their ids do not leak either. */
function visibleEdges<T extends GraphEdgeRow>(
  nodes: GraphNodeRow[],
  edges: T[],
  allowed: Set<string> | null,
): T[] {
  if (!allowed) return edges;
  const visible = new Set(visibleNodes(nodes, allowed).map((node) => node.id));
  return edges.filter((edge) => visible.has(edge.sourceNodeId) && visible.has(edge.targetNodeId));
}

export const graphRouter = {
  data: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const allowed = await getAccessiblePageIds(
      context.db,
      context.workspaceId,
      context.userId,
      context.role,
    );
    const [pages, documents, canvases, nodes, edges] = await Promise.all([
      context.db.page.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          ...(allowed ? { id: { in: [...allowed] } } : {}),
        },
      }),
      context.db.pageDocument.findMany({
        where: {
          workspaceId: context.workspaceId,
          ...(allowed ? { pageId: { in: [...allowed] } } : {}),
        },
      }),
      context.db.canvas.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
      }),
      context.db.knowledgeNode.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
      }),
      context.db.knowledgeEdge.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
      }),
    ]);
    const data = buildDerivedGraph(
      pages as unknown as Page[],
      documents as unknown as PageDocument[],
      canvases as unknown as Canvas[],
      visibleNodes(nodes, allowed) as unknown as KnowledgeNode[],
      visibleEdges(nodes, edges, allowed) as unknown as KnowledgeEdge[],
    );
    return { ...data, summary: summarizeGraph(data) };
  }),

  node: workspaceProcedure("VIEWER")
    .input(z.object({ nodeId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      const node = await context.db.knowledgeNode.findFirst({
        where: {
          id: input.nodeId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!node) throw new ORPCError("NOT_FOUND");
      if (node.pageId && allowed && !allowed.has(node.pageId)) {
        throw new ORPCError("NOT_FOUND");
      }
      const [outgoing, incoming] = await Promise.all([
        context.db.knowledgeEdge.findMany({
          where: {
            workspaceId: context.workspaceId,
            sourceNodeId: node.id,
            deletedAt: null,
          },
        }),
        context.db.knowledgeEdge.findMany({
          where: {
            workspaceId: context.workspaceId,
            targetNodeId: node.id,
            deletedAt: null,
          },
        }),
      ]);
      return { node, outgoing, incoming };
    }),

  upsertNode: workspaceProcedure("EDITOR")
    .input(
      z.object({
        id: z.string().min(1).optional(),
        kind: z
          .enum(["PAGE", "CANVAS", "TOPIC", "CONCEPT", "PROJECT", "PERSON", "RESOURCE", "FLASHCARD"])
          .default("TOPIC"),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(1000).nullable().optional(),
        pageId: z.string().nullable().optional(),
        canvasId: z.string().nullable().optional(),
        color: z.string().max(32).nullable().optional(),
        x: z.number().nullable().optional(),
        y: z.number().nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const nodeId = input.id ?? createId();
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-node-${randomUUID()}`,
            entity: "node",
            entityId: nodeId,
            op: "UPSERT",
            payload: {
              kind: input.kind,
              title: input.title,
              description: input.description ?? null,
              pageId: input.pageId ?? null,
              canvasId: input.canvasId ?? null,
              color: input.color ?? null,
              x: input.x ?? null,
              y: input.y ?? null,
              metadata: input.metadata ?? {},
            },
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      return context.db.knowledgeNode.findUnique({ where: { id: nodeId } });
    }),

  upsertEdge: workspaceProcedure("EDITOR")
    .input(
      z.object({
        id: z.string().min(1).optional(),
        sourceNodeId: z.string().min(1),
        targetNodeId: z.string().min(1),
        relationType: z.enum([
          "RELATED_TO",
          "DEPENDS_ON",
          "PART_OF",
          "EXPLAINS",
          "EXAMPLE_OF",
          "CONTRADICTS",
          "PREREQUISITE_OF",
          "REFERENCES",
          "CREATED_FROM",
          "CONNECTED_THROUGH",
        ]),
        label: z.string().max(200).nullable().optional(),
        weight: z.number().min(0).max(10).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const edgeId = input.id ?? createId();
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-edge-${randomUUID()}`,
            entity: "edge",
            entityId: edgeId,
            op: "UPSERT",
            payload: {
              sourceNodeId: input.sourceNodeId,
              targetNodeId: input.targetNodeId,
              relationType: input.relationType,
              label: input.label ?? null,
              weight: input.weight ?? 1,
              origin: "MANUAL",
            },
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      return context.db.knowledgeEdge.findUnique({ where: { id: edgeId } });
    }),

  removeEdge: workspaceProcedure("EDITOR")
    .input(z.object({ edgeId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const edge = await context.db.knowledgeEdge.findFirst({
        where: {
          id: input.edgeId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!edge) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-edge-delete-${randomUUID()}`,
            entity: "edge",
            entityId: edge.id,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),

  suggestions: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const allowed = await getAccessiblePageIds(
      context.db,
      context.workspaceId,
      context.userId,
      context.role,
    );
    const pages = await context.db.page.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        ...(allowed ? { id: { in: [...allowed] } } : {}),
      },
    });
    const documents = await context.db.pageDocument.findMany({
      where: {
        workspaceId: context.workspaceId,
        pageId: { in: pages.map((page) => page.id) },
      },
    });
    const documentByPage = new Map(documents.map((document) => [document.pageId, document]));
    const edges = await context.db.knowledgeEdge.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
    });
    const existing = new Set(
      edges.map((edge) => `${edge.sourceNodeId}->${edge.targetNodeId}`),
    );
    const candidates: RelatedDocument[] = pages.map((page) => ({
      id: page.id,
      title: page.title,
      body: documentByPage.get(page.id)?.plainText ?? "",
    }));
    const suggestions: Array<{
      sourceNodeId: string;
      targetNodeId: string;
      sourceTitle: string;
      targetTitle: string;
      score: number;
      reason: string;
    }> = [];
    for (const candidate of candidates) {
      for (const related of relatedDocuments(candidate, candidates, 3)) {
        if (
          !existing.has(`${candidate.id}->${related.id}`) &&
          !existing.has(`${related.id}->${candidate.id}`)
        ) {
          suggestions.push({
            sourceNodeId: candidate.id,
            targetNodeId: related.id,
            sourceTitle: candidate.title,
            targetTitle: related.title,
            score: Math.round(related.score * 100) / 100,
            reason: "Shared vocabulary and concepts",
          });
        }
      }
    }
    return suggestions
      .sort((a, b) => b.score - a.score)
      .filter(
        (suggestion, index, all) =>
          all.findIndex(
            (entry) =>
              entry.sourceNodeId === suggestion.targetNodeId &&
              entry.targetNodeId === suggestion.sourceNodeId,
          ) === index,
      )
      .slice(0, 12);
  }),
};
