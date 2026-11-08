import type { KnowledgeEdge, KnowledgeNode, NodeKind, RelationType } from "@notes-learning/domain";

export interface GraphPosition {
  x: number;
  y: number;
}

export const KIND_ORDER: NodeKind[] = [
  "PAGE",
  "CANVAS",
  "TOPIC",
  "CONCEPT",
  "PROJECT",
  "PERSON",
  "RESOURCE",
  "FLASHCARD",
];

export const KIND_COLORS: Record<NodeKind, string> = {
  PAGE: "#e8892f",
  CANVAS: "#2f6b4f",
  TOPIC: "#3b82f6",
  CONCEPT: "#8b5cf6",
  PROJECT: "#0891b2",
  PERSON: "#dc2626",
  RESOURCE: "#b45309",
  FLASHCARD: "#166534",
};

export const KIND_GLYPHS: Record<NodeKind, string> = {
  PAGE: "◇",
  CANVAS: "▦",
  TOPIC: "✦",
  CONCEPT: "◉",
  PROJECT: "▤",
  PERSON: "☺",
  RESOURCE: "↗",
  FLASHCARD: "▭",
};

export const RELATION_COLORS: Record<RelationType, string> = {
  RELATED_TO: "#8b8b7a",
  DEPENDS_ON: "#b45309",
  PART_OF: "#2f6b4f",
  EXPLAINS: "#3b82f6",
  EXAMPLE_OF: "#8b5cf6",
  CONTRADICTS: "#dc2626",
  PREREQUISITE_OF: "#0891b2",
  REFERENCES: "#6b7280",
  CREATED_FROM: "#a16207",
  CONNECTED_THROUGH: "#7c3aed",
};

export interface RecencyOption {
  value: "all" | "day" | "week" | "month" | "year";
  label: string;
  days: number;
}

export const RECENCY_OPTIONS: RecencyOption[] = [
  { value: "all", label: "All time", days: 0 },
  { value: "day", label: "Past day", days: 1 },
  { value: "week", label: "Past week", days: 7 },
  { value: "month", label: "Past month", days: 30 },
  { value: "year", label: "Past year", days: 365 },
];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/**
 * Deterministic force layout, ported from the web graph view. Running it on the
 * client keeps the graph usable offline and avoids shipping positions from the
 * server; pinned nodes (with stored x/y) never move.
 */
export function computeLayout(
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>();
  const velocities = new Map<string, GraphPosition>();
  const radius = Math.max(120, nodes.length * 18);
  for (const [index, node] of nodes.entries()) {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    const seed = hashString(node.id);
    const offset = ((seed % 100) / 100 - 0.5) * 60;
    positions.set(node.id, {
      x: node.x ?? Math.cos(angle) * (radius + offset),
      y: node.y ?? Math.sin(angle) * (radius + offset),
    });
    velocities.set(node.id, { x: 0, y: 0 });
  }

  for (let iteration = 0; iteration < 240; iteration += 1) {
    const list = [...positions.entries()];
    for (let i = 0; i < list.length; i += 1) {
      const [idA, a] = list[i]!;
      for (let j = i + 1; j < list.length; j += 1) {
        const [idB, b] = list[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        if (dx === 0 && dy === 0) {
          dx = (hashString(idA) % 10) - 5;
          dy = (hashString(idB) % 10) - 5;
        }
        const dist2 = Math.max(100, dx * dx + dy * dy);
        const force = 7000 / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const va = velocities.get(idA)!;
        const vb = velocities.get(idB)!;
        va.x += fx;
        va.y += fy;
        vb.x -= fx;
        vb.y -= fy;
      }
    }
    for (const edge of edges) {
      const a = positions.get(edge.sourceNodeId);
      const b = positions.get(edge.targetNodeId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ideal = 125;
      const force = (dist - ideal) * 0.009;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const va = velocities.get(edge.sourceNodeId)!;
      const vb = velocities.get(edge.targetNodeId)!;
      va.x += fx;
      va.y += fy;
      vb.x -= fx;
      vb.y -= fy;
    }
    for (const node of nodes) {
      const position = positions.get(node.id);
      const velocity = velocities.get(node.id);
      if (!position || !velocity) continue;
      const pinned = node.x !== null && node.y !== null;
      if (pinned) {
        velocity.x = 0;
        velocity.y = 0;
        continue;
      }
      velocity.x -= position.x * 0.0012;
      velocity.y -= position.y * 0.0012;
      velocity.x *= 0.82;
      velocity.y *= 0.82;
      position.x += velocity.x;
      position.y += velocity.y;
    }
  }
  return positions;
}

export function boundsOf(
  positions: Map<string, GraphPosition>,
): { x: number; y: number; width: number; height: number } {
  if (!positions.size) return { x: -400, y: -300, width: 800, height: 600 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x);
    maxY = Math.max(maxY, position.y);
  }
  return {
    x: minX - 160,
    y: minY - 160,
    width: Math.max(320, maxX - minX + 320),
    height: Math.max(320, maxY - minY + 320),
  };
}
