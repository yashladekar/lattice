import { describe, expect, it } from "vitest";

import { answerGraphQuery } from "./graph-query";
import type { KnowledgeEdge, KnowledgeNode } from "./types";

const node = (id: string, title: string, kind: KnowledgeNode["kind"] = "PAGE"): KnowledgeNode => ({
  id,
  workspaceId: "w1",
  kind,
  title,
  description: null,
  pageId: kind === "PAGE" ? id : null,
  canvasId: null,
  color: null,
  x: null,
  y: null,
  aiGenerated: false,
  metadata: {},
  createdById: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const edge = (
  source: string,
  target: string,
  relation: KnowledgeEdge["relationType"] = "RELATED_TO",
): KnowledgeEdge => ({
  id: `edge:${source}:${target}:${relation}`,
  workspaceId: "w1",
  sourceNodeId: source,
  targetNodeId: target,
  relationType: relation,
  label: null,
  weight: 1,
  origin: "MANUAL",
  aiGenerated: false,
  createdById: "u1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
});

const nodes = [
  node("spaced", "Spaced repetition"),
  node("recall", "Active recall"),
  node("systems", "Systems thinking"),
  node("orphan", "Loose note"),
  node("topic", "Learning science", "TOPIC"),
];
const edges = [
  edge("spaced", "recall", "REFERENCES"),
  edge("recall", "topic", "PART_OF"),
  edge("systems", "topic", "RELATED_TO"),
];

describe("graph queries", () => {
  it("answers neighbor questions in both directions", () => {
    const answer = answerGraphQuery("What is connected to spaced repetition?", nodes, edges);
    expect(answer?.kind).toBe("neighbors");
    expect(answer?.answer).toContain("Active recall");
    expect(answer?.answer).toContain("References");
  });

  it("finds a shortest path and reports its hops", () => {
    const answer = answerGraphQuery("How are spaced repetition and systems thinking related?", nodes, edges);
    expect(answer?.kind).toBe("path");
    expect(answer?.answer).toContain("hops");
    expect(answer?.answer).toContain("Learning science");
    expect(answer?.citations.length).toBeGreaterThan(2);
  });

  it("reports no path for disconnected nodes", () => {
    const answer = answerGraphQuery("How is loose note connected to active recall?", nodes, edges);
    expect(answer?.kind).toBe("path");
    expect(answer?.answer).toContain("No connection found");
  });

  it("lists orphans", () => {
    const answer = answerGraphQuery("Which notes are orphans?", nodes, edges);
    expect(answer?.kind).toBe("orphans");
    expect(answer?.answer).toContain("Loose note");
  });

  it("lists hubs by degree", () => {
    const answer = answerGraphQuery("What are the most connected nodes?", nodes, edges);
    expect(answer?.kind).toBe("hubs");
    expect(answer?.answer).toContain("Learning science");
  });

  it("does not hijack ordinary questions", () => {
    expect(answerGraphQuery("Summarize what I know about spaced repetition", nodes, edges)).toBeNull();
    expect(answerGraphQuery("Connect the ideas I have about graphs", nodes, edges)).toBeNull();
  });

  it("suggests candidates when a name is ambiguous", () => {
    const answer = answerGraphQuery("What is connected to ing?", nodes, edges);
    expect(answer?.answer).toContain("more than one match");
  });
});
