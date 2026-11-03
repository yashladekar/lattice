import { nodePlainText } from "./editor";
import type { TipTapDoc, TipTapNode } from "./types";

export const MAX_DIAGRAM_SOURCE = 20_000;

export const DEFAULT_DIAGRAM_SOURCE = `flowchart TD
  idea["Idea"] --> sketch["Sketch it"]
  sketch --> decide{"Worth keeping?"}
  decide -->|yes| note["Write it down"]
  decide -->|no| archive["Archive"]
  note --> link["Link it to something"]`;

const DIAGRAM_TYPES: Record<string, string> = {
  graph: "flowchart",
  flowchart: "flowchart",
  sequenceDiagram: "sequence",
  classDiagram: "class",
  stateDiagram: "state",
  "stateDiagram-v2": "state",
  erDiagram: "entity relationship",
  journey: "journey",
  gantt: "gantt",
  pie: "pie",
  quadrantChart: "quadrant",
  requirementDiagram: "requirement",
  gitGraph: "git graph",
  mindmap: "mindmap",
  timeline: "timeline",
  sankey: "sankey",
  xychart: "xy chart",
  block: "block",
};

export function normalizeDiagramSource(source: string): string {
  return source
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .slice(0, MAX_DIAGRAM_SOURCE)
    .trim();
}

export function diagramTypeOf(source: string): string {
  const line = source
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !value.startsWith("%%"));
  if (!line) return "diagram";
  const keyword = line.split(/[\s{]/)[0] ?? "";
  if (!keyword) return "diagram";
  return DIAGRAM_TYPES[keyword] ?? keyword.replace(/Diagram$/, "").toLowerCase();
}

export function diagramSummary(source: string, max = 72): string {
  const line = source
    .split("\n")
    .map((value) => value.trim())
    .find((value) => {
      if (!value || value.startsWith("%%")) return false;
      const keyword = value.split(/[\s{]/)[0] ?? "";
      return !(keyword in DIAGRAM_TYPES);
    });
  const summary = (line ?? "").replace(/["[\]{}()|<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!summary) return "Empty diagram";
  return summary.length > max ? `${summary.slice(0, max - 1)}…` : summary;
}

export function diagramBlock(source: string = DEFAULT_DIAGRAM_SOURCE, caption = ""): TipTapNode {
  return {
    type: "diagram",
    attrs: { source: normalizeDiagramSource(source), caption },
  };
}

function mermaidLabel(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  if (!cleaned) return "Untitled";
  return cleaned.length > 90 ? `${cleaned.slice(0, 89)}…` : cleaned;
}

export interface OutlineDiagramOptions {
  direction?: "TD" | "LR";
  includeLists?: boolean;
  title?: string;
  maxNodes?: number;
}

/**
 * Turns a document outline into a Mermaid flowchart: headings nest by level,
 * and list items hang off the section they belong to.
 */
export function outlineToMermaid(
  doc: TipTapDoc | null | undefined,
  options: OutlineDiagramOptions = {},
): string {
  const direction = options.direction ?? "TD";
  const includeLists = options.includeLists ?? true;
  const maxNodes = options.maxNodes ?? 60;

  const nodes: string[] = [];
  const links: string[] = [];
  const stack: Array<{ level: number; id: string }> = [];
  let counter = 0;

  const newNode = (label: string, shape: "box" | "round"): string => {
    const id = `n${counter++}`;
    nodes.push(
      shape === "box"
        ? `  ${id}["${mermaidLabel(label)}"]`
        : `  ${id}(["${mermaidLabel(label)}"])`,
    );
    return id;
  };

  const attach = (id: string) => {
    const parent = stack[stack.length - 1];
    if (parent) links.push(`  ${parent.id} --> ${id}`);
  };

  const title = options.title?.trim();
  if (title) {
    const rootId = newNode(title, "round");
    stack.push({ level: 0, id: rootId });
  }

  for (const node of doc?.content ?? []) {
    if (counter >= maxNodes) break;
    if (node.type === "heading") {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      const id = newNode(nodePlainText(node).trim() || "Untitled", "box");
      while (stack.length && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
      attach(id);
      stack.push({ level, id });
      continue;
    }
    if (
      includeLists &&
      (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList")
    ) {
      for (const item of node.content ?? []) {
        if (counter >= maxNodes) break;
        const text = nodePlainText(item).trim();
        if (!text) continue;
        const id = newNode(text, "round");
        attach(id);
      }
    }
  }

  if (!nodes.length) return "";
  return [`flowchart ${direction}`, ...nodes, ...links].join("\n");
}
