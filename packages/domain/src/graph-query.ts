import { RELATION_META } from "./graph";
import type { KnowledgeEdge, KnowledgeNode, RelationType } from "./types";

export interface GraphQueryAnswer {
  kind: "neighbors" | "path" | "orphans" | "hubs";
  answer: string;
  citations: Array<{ pageId: string | null; title: string; excerpt: string }>;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function label(node: KnowledgeNode): string {
  return node.title || "Untitled";
}

function citation(node: KnowledgeNode): GraphQueryAnswer["citations"][number] {
  return {
    pageId: node.pageId,
    title: label(node),
    excerpt:
      node.description?.trim() ||
      (node.kind === "PAGE" ? "Page in your workspace" : `${node.kind.toLowerCase()} node`),
  };
}

function resolveNode(
  raw: string,
  nodes: KnowledgeNode[],
): { node: KnowledgeNode } | { candidates: KnowledgeNode[] } | null {
  const name = normalize(raw);
  if (name.length < 2) return null;
  const exact = nodes.filter((node) => normalize(node.title) === name);
  if (exact.length === 1) return { node: exact[0]! };
  const partial = nodes.filter((node) => {
    const title = normalize(node.title);
    return title.includes(name) || (name.includes(title) && title.length >= 3);
  });
  if (partial.length === 1) return { node: partial[0]! };
  if (partial.length > 1) return { candidates: partial.slice(0, 5) };
  return null;
}

function adjacency(edges: KnowledgeEdge[]) {
  const map = new Map<string, Array<{ otherId: string; relation: RelationType; outgoing: boolean }>>();
  const push = (from: string, to: string, relation: RelationType, outgoing: boolean) => {
    const list = map.get(from) ?? [];
    list.push({ otherId: to, relation, outgoing });
    map.set(from, list);
  };
  for (const edge of edges) {
    if (edge.deletedAt) continue;
    push(edge.sourceNodeId, edge.targetNodeId, edge.relationType, true);
    push(edge.targetNodeId, edge.sourceNodeId, edge.relationType, false);
  }
  return map;
}

function shortestPath(
  fromId: string,
  toId: string,
  edges: KnowledgeEdge[],
): Array<{ nodeId: string; relation: RelationType | null }> | null {
  const connections = adjacency(edges);
  const queue: string[] = [fromId];
  const previous = new Map<string, { nodeId: string; relation: RelationType }>();
  const seen = new Set<string>([fromId]);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === toId) break;
    for (const link of connections.get(current) ?? []) {
      if (seen.has(link.otherId)) continue;
      seen.add(link.otherId);
      previous.set(link.otherId, { nodeId: current, relation: link.relation });
      queue.push(link.otherId);
    }
  }
  if (!seen.has(toId)) return null;
  const path: Array<{ nodeId: string; relation: RelationType | null }> = [{ nodeId: toId, relation: null }];
  let cursor = toId;
  while (cursor !== fromId) {
    const step = previous.get(cursor);
    if (!step) return null;
    path.unshift({ nodeId: step.nodeId, relation: step.relation });
    cursor = step.nodeId;
  }
  return path;
}

function describeCandidates(candidates: KnowledgeNode[]): string {
  return `I found more than one match: ${candidates.map((node) => `**${label(node)}**`).join(", ")}. Try the full title.`;
}

export function answerGraphQuery(
  question: string,
  nodes: KnowledgeNode[],
  edges: KnowledgeEdge[],
): GraphQueryAnswer | null {
  const text = normalize(question);
  if (!text) return null;
  const liveNodes = nodes.filter((node) => !node.deletedAt);
  const liveEdges = edges.filter((edge) => !edge.deletedAt);
  if (!liveNodes.length) return null;
  const nodeById = new Map(liveNodes.map((node) => [node.id, node]));

  const pathMatch =
    /^how (?:are|is) (.+?) and (.+?)(?: related| connected)?$/.exec(text) ??
    /^how (?:are|is) (.+?) (?:related|connected) to (.+)$/.exec(text) ??
    /^(?:what is |whats )?the (?:connection|relationship) between (.+?) and (.+)$/.exec(text) ??
    /^connection between (.+?) and (.+)$/.exec(text);
  if (pathMatch) {
    const left = resolveNode(pathMatch[1] ?? "", liveNodes);
    const right = resolveNode(pathMatch[2] ?? "", liveNodes);
    for (const resolved of [left, right]) {
      if (resolved && "candidates" in resolved) {
        return { kind: "path", answer: describeCandidates(resolved.candidates), citations: resolved.candidates.map(citation) };
      }
    }
    if (!left || !right || !("node" in left) || !("node" in right)) return null;
    const path = shortestPath(left.node.id, right.node.id, liveEdges);
    if (!path) {
      return {
        kind: "path",
        answer: `No connection found between **${label(left.node)}** and **${label(right.node)}** in the current graph. They may sit in different clusters — link them manually or add a shared topic.`,
        citations: [citation(left.node), citation(right.node)],
      };
    }
    const steps: string[] = [];
    for (let index = 0; index < path.length; index += 1) {
      const step = path[index]!;
      const node = nodeById.get(step.nodeId);
      if (!node) continue;
      if (index === 0) {
        steps.push(`**${label(node)}**`);
        continue;
      }
      const relation = step.relation ? RELATION_META[step.relation].label.toLowerCase() : "links to";
      steps.push(`→ _${relation}_ → **${label(node)}**`);
    }
    return {
      kind: "path",
      answer: `**Graph path** — ${path.length - 1} hop${path.length === 2 ? "" : "s"}:\n\n${steps.join(" ")}`,
      citations: path
        .map((step) => nodeById.get(step.nodeId))
        .filter((node): node is KnowledgeNode => Boolean(node))
        .map(citation),
    };
  }

  if (/orphan|disconnected|unlinked/.test(text)) {
    const connected = new Set<string>();
    for (const edge of liveEdges) {
      connected.add(edge.sourceNodeId);
      connected.add(edge.targetNodeId);
    }
    const orphans = liveNodes.filter((node) => !connected.has(node.id));
    return {
      kind: "orphans",
      answer: orphans.length
        ? `**Orphan notes** — ${orphans.length} node${orphans.length === 1 ? "" : "s"} with no connections:\n\n${orphans
            .slice(0, 12)
            .map((node) => `- ${label(node)}`)
            .join("\n")}`
        : "Every node in the graph has at least one connection.",
      citations: orphans.slice(0, 12).map(citation),
    };
  }

  if (/most connected|hubs?|central node/.test(text)) {
    const degree = new Map<string, number>();
    for (const edge of liveEdges) {
      degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
      degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
    }
    const hubs = [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ node: nodeById.get(id), count }))
      .filter((entry): entry is { node: KnowledgeNode; count: number } => Boolean(entry.node));
    return {
      kind: "hubs",
      answer: hubs.length
        ? `**Most connected nodes:**\n\n${hubs
            .map((entry) => `- **${label(entry.node)}** — ${entry.count} connection${entry.count === 1 ? "" : "s"}`)
            .join("\n")}`
        : "The graph has no connections yet.",
      citations: hubs.map((entry) => citation(entry.node)),
    };
  }

  const neighborMatch =
    /^what (?:is|are) (?:connected|linked|related) to (.+)$/.exec(text) ??
    /^what (?:links|references|connects) (?:to )?(.+)$/.exec(text) ??
    /^(?:neighbors?|connections?|links?) of (.+)$/.exec(text) ??
    /^(?:show|find) (?:connections|links|relations) (?:for|to|of) (.+)$/.exec(text);
  if (neighborMatch) {
    const resolved = resolveNode(neighborMatch[1] ?? "", liveNodes);
    if (!resolved) return null;
    if ("candidates" in resolved) {
      return { kind: "neighbors", answer: describeCandidates(resolved.candidates), citations: resolved.candidates.map(citation) };
    }
    const target = resolved.node;
    const connections = adjacency(liveEdges).get(target.id) ?? [];
    if (!connections.length) {
      return {
        kind: "neighbors",
        answer: `**${label(target)}** has no connections yet. Link it from the graph or add a page link.`,
        citations: [citation(target)],
      };
    }
    const lines = connections.map((link) => {
      const other = nodeById.get(link.otherId);
      const relation = RELATION_META[link.relation]?.label ?? link.relation;
      const name = other ? label(other) : "Unknown node";
      return link.outgoing ? `- ${relation} → **${name}**` : `- ${name} ← ${relation}`;
    });
    return {
      kind: "neighbors",
      answer: `**${label(target)}** is connected to ${connections.length} node${connections.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}`,
      citations: [
        citation(target),
        ...connections
          .map((link) => nodeById.get(link.otherId))
          .filter((node): node is KnowledgeNode => Boolean(node))
          .map(citation),
      ],
    };
  }

  return null;
}
