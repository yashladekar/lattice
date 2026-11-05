import type {
  Canvas,
  KnowledgeEdge,
  KnowledgeNode,
  NodeKind,
  Page,
  PageDocument,
  RelationType,
} from "./types";
import { extractPageLinks } from "./editor";

export const RELATION_META: Record<
  RelationType,
  { label: string; description: string; color: string; directional: boolean }
> = {
  RELATED_TO: {
    label: "Related to",
    description: "A loose conceptual connection",
    color: "#8b8b7a",
    directional: false,
  },
  DEPENDS_ON: {
    label: "Depends on",
    description: "Requires the target to make sense",
    color: "#d97706",
    directional: true,
  },
  PART_OF: {
    label: "Part of",
    description: "Belongs to a larger whole",
    color: "#2f6b4f",
    directional: true,
  },
  EXPLAINS: {
    label: "Explains",
    description: "Clarifies or teaches the target",
    color: "#3b82f6",
    directional: true,
  },
  EXAMPLE_OF: {
    label: "Example of",
    description: "A concrete instance of the target",
    color: "#8b5cf6",
    directional: true,
  },
  CONTRADICTS: {
    label: "Contradicts",
    description: "Conflicts with the target",
    color: "#dc2626",
    directional: false,
  },
  PREREQUISITE_OF: {
    label: "Prerequisite of",
    description: "Should be learned before the target",
    color: "#0891b2",
    directional: true,
  },
  REFERENCES: {
    label: "References",
    description: "An internal page link",
    color: "#a3a395",
    directional: true,
  },
  CREATED_FROM: {
    label: "Created from",
    description: "Derived from another object",
    color: "#65a30d",
    directional: true,
  },
  CONNECTED_THROUGH: {
    label: "Connected through",
    description: "Linked by a shared canvas or theme",
    color: "#c026d3",
    directional: false,
  },
};

export const NODE_META: Record<NodeKind, { label: string; color: string }> = {
  PAGE: { label: "Page", color: "#e07a2e" },
  CANVAS: { label: "Canvas", color: "#2f6b4f" },
  TOPIC: { label: "Topic", color: "#3b82f6" },
  CONCEPT: { label: "Concept", color: "#8b5cf6" },
  PROJECT: { label: "Project", color: "#dc2626" },
  PERSON: { label: "Person", color: "#0891b2" },
  RESOURCE: { label: "Resource", color: "#a16207" },
  FLASHCARD: { label: "Flashcard", color: "#db2777" },
};

export interface GraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export function edgeKey(edge: Pick<KnowledgeEdge, "sourceNodeId" | "targetNodeId" | "relationType">): string {
  return `${edge.sourceNodeId}->${edge.targetNodeId}:${edge.relationType}`;
}

export function buildDerivedGraph(
  pages: Page[],
  documents: PageDocument[],
  canvases: Canvas[],
  explicitNodes: KnowledgeNode[],
  explicitEdges: KnowledgeEdge[],
): GraphData {
  const nodes = new Map<string, KnowledgeNode>();
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const documentByPage = new Map(documents.map((document) => [document.pageId, document]));

  const ensureNode = (input: {
    id: string;
    kind: NodeKind;
    title: string;
    pageId?: string | null;
    canvasId?: string | null;
    createdAt: string;
    updatedAt: string;
    workspaceId: string;
  }): KnowledgeNode => {
    const existing = nodes.get(input.id);
    if (existing) return existing;
    const node: KnowledgeNode = {
      id: input.id,
      workspaceId: input.workspaceId,
      kind: input.kind,
      title: input.title,
      description: null,
      pageId: input.pageId ?? null,
      canvasId: input.canvasId ?? null,
      color: null,
      x: null,
      y: null,
      aiGenerated: false,
      metadata: {},
      createdById: null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
    nodes.set(input.id, node);
    return node;
  };

  for (const node of explicitNodes) {
    if (node.deletedAt) continue;
    nodes.set(node.id, node);
  }

  for (const page of pages) {
    if (page.deletedAt) continue;
    if (!nodes.has(page.id)) {
      ensureNode({
        id: page.id,
        kind: "PAGE",
        title: page.title,
        pageId: page.id,
        workspaceId: page.workspaceId,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      });
    }
  }

  for (const canvas of canvases) {
    if (canvas.deletedAt) continue;
    const existing = nodes.get(canvas.id);
    if (!existing) {
      ensureNode({
        id: canvas.id,
        kind: "CANVAS",
        title: canvas.title,
        canvasId: canvas.id,
        workspaceId: canvas.workspaceId,
        createdAt: canvas.createdAt,
        updatedAt: canvas.updatedAt,
      });
    }
  }

  const edges = new Map<string, KnowledgeEdge>();
  for (const edge of explicitEdges) {
    if (edge.deletedAt) continue;
    if (!nodes.has(edge.sourceNodeId) || !nodes.has(edge.targetNodeId)) continue;
    edges.set(edgeKey(edge), edge);
  }

  const timestamp = new Date().toISOString();
  for (const page of pages) {
    if (page.deletedAt) continue;
    const document = documentByPage.get(page.id);
    if (!document) continue;
    for (const link of extractPageLinks(document.content)) {
      if (!pageById.has(link.pageId) || link.pageId === page.id) continue;
      const edge: KnowledgeEdge = {
        id: `derived:${page.id}:${link.pageId}`,
        workspaceId: page.workspaceId,
        sourceNodeId: page.id,
        targetNodeId: link.pageId,
        relationType: "REFERENCES",
        label: null,
        weight: 1,
        origin: "PAGE_LINK",
        aiGenerated: false,
        createdById: page.createdById,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (!edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
    }
  }

  const canvasIds = new Set(canvases.filter((canvas) => !canvas.deletedAt).map((canvas) => canvas.id));
  for (const canvas of canvases) {
    if (canvas.deletedAt) continue;
    const elements = canvas.data?.elements ?? [];
    for (const element of elements) {
      if (element.type !== "page" && element.type !== "canvas") continue;
      const targetId = element.type === "page" ? element.pageId : element.canvasId;
      if (!targetId || targetId === canvas.id) continue;
      if (element.type === "page" && !pageById.has(targetId)) continue;
      if (element.type === "canvas" && !canvasIds.has(targetId)) continue;
      const edge: KnowledgeEdge = {
        id: `derived:${canvas.id}:${targetId}:canvas`,
        workspaceId: canvas.workspaceId,
        sourceNodeId: canvas.id,
        targetNodeId: targetId,
        relationType: "CONNECTED_THROUGH",
        label: null,
        weight: 1,
        origin: "CANVAS_LINK",
        aiGenerated: false,
        createdById: canvas.createdById,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (!edges.has(edgeKey(edge))) edges.set(edgeKey(edge), edge);
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function degreeMap(edges: KnowledgeEdge[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const edge of edges) {
    if (edge.deletedAt) continue;
    map.set(edge.sourceNodeId, (map.get(edge.sourceNodeId) ?? 0) + 1);
    map.set(edge.targetNodeId, (map.get(edge.targetNodeId) ?? 0) + 1);
  }
  return map;
}

export function orphanNodes(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): KnowledgeNode[] {
  const degree = degreeMap(edges);
  return nodes.filter((node) => (degree.get(node.id) ?? 0) === 0);
}

export function connectedComponents(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): string[][] {
  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)?.add(edge.targetNodeId);
    adjacency.get(edge.targetNodeId)?.add(edge.sourceNodeId);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const component: string[] = [];
    while (stack.length) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      component.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!seen.has(neighbor)) stack.push(neighbor);
      }
    }
    components.push(component);
  }
  return components.sort((a, b) => b.length - a.length);
}

export function relationLabel(type: RelationType): string {
  return RELATION_META[type].label;
}

export function learningPath(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  mastery: Map<string, number>,
): Array<KnowledgeNode & { mastery: number; step: number }> {
  const dependencyEdges = edges.filter(
    (edge) =>
      !edge.deletedAt &&
      (edge.relationType === "PREREQUISITE_OF" || edge.relationType === "DEPENDS_ON"),
  );
  const prerequisiteCount = new Map<string, number>();
  for (const node of nodes) prerequisiteCount.set(node.id, 0);
  for (const edge of dependencyEdges) {
    prerequisiteCount.set(edge.targetNodeId, (prerequisiteCount.get(edge.targetNodeId) ?? 0) + 1);
  }
  const sorted = [...nodes].sort((a, b) => {
    const aCount = prerequisiteCount.get(a.id) ?? 0;
    const bCount = prerequisiteCount.get(b.id) ?? 0;
    if (aCount !== bCount) return aCount - bCount;
    return (mastery.get(a.id) ?? 0) - (mastery.get(b.id) ?? 0);
  });
  return sorted.map((node, index) => ({
    ...node,
    mastery: mastery.get(node.id) ?? 0,
    step: index + 1,
  }));
}

export function knowledgeGaps(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
  mastery: Map<string, number>,
  threshold = 0.4,
): KnowledgeNode[] {
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    if (edge.deletedAt) continue;
    incoming.set(edge.targetNodeId, (incoming.get(edge.targetNodeId) ?? 0) + 1);
  }
  return nodes.filter((node) => {
    const score = mastery.get(node.id) ?? 0;
    return score < threshold && (incoming.get(node.id) ?? 0) > 0;
  });
}

export function summarizeGraph(data: GraphData): {
  nodes: number;
  edges: number;
  orphans: number;
  clusters: number;
} {
  const orphans = orphanNodes(data.nodes, data.edges).length;
  return {
    nodes: data.nodes.length,
    edges: data.edges.length,
    orphans,
    clusters: connectedComponents(data.nodes, data.edges).length,
  };
}
