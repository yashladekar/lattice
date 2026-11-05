import { describe, expect, it } from "vitest";

import { createMindMap, snap, CANVAS_TEMPLATES } from "./canvas";
import { buildDerivedGraph, orphanNodes, summarizeGraph } from "./graph";
import { buildQuiz, generateFlashcardsFromDoc, masteryScore, scheduleReview } from "./learning";
import { buildSnippet, cosineSimilarity, rankRecords, scoreText } from "./search";
import type { Canvas, Flashcard, KnowledgeEdge, KnowledgeNode, Page, PageDocument } from "./types";

const now = "2026-01-01T00:00:00.000Z";

function page(id: string, title: string, extra: Partial<Page> = {}): Page {
  return {
    id,
    workspaceId: "w1",
    notebookId: null,
    parentId: null,
    type: "DOCUMENT",
    title,
    icon: null,
    coverUrl: null,
    properties: {},
    visibility: "WORKSPACE",
    sortOrder: 0,
    createdById: "u1",
    updatedById: "u1",
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...extra,
  };
}

describe("canvas utilities", () => {
  it("snaps to the grid", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(13, 8)).toBe(16);
  });

  it("builds a mind map with a connector per node", () => {
    const document = createMindMap("Root", [
      { id: "a", level: 1, text: "Branch", pos: 0 },
      { id: "b", level: 2, text: "Leaf", pos: 1 },
    ]);
    expect(document.elements.filter((element) => element.type === "shape")).toHaveLength(3);
    expect(document.elements.filter((element) => element.type === "connector")).toHaveLength(2);
  });

  it("ships a blank first template", () => {
    expect(CANVAS_TEMPLATES[0]?.id).toBe("blank");
  });
});

describe("graph derivation", () => {
  it("derives page-link edges and identifies orphans", () => {
    const pages = [page("p1", "One"), page("p2", "Two"), page("p3", "Orphan")];
    const documents: PageDocument[] = [
      {
        pageId: "p1",
        workspaceId: "w1",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "pageLink", attrs: { pageId: "p2", title: "Two" } }],
            },
          ],
        },
        plainText: "",
        schemaVersion: 1,
        rev: 0,
        updatedAt: now,
      },
    ];
    const nodes: KnowledgeNode[] = [];
    const edges: KnowledgeEdge[] = [];
    const graph = buildDerivedGraph(pages, documents, [], nodes, edges);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.relationType).toBe("REFERENCES");
    expect(summarizeGraph(graph)).toEqual({ nodes: 3, edges: 1, orphans: 1, clusters: 2 });
    expect(orphanNodes(graph.nodes, graph.edges)).toHaveLength(1);
  });

  it("derives CONNECTED_THROUGH edges from canvas cards and nested canvases", () => {
    const pages = [page("p1", "One"), page("p2", "Two")];
    const canvas = (id: string, title: string, elements: Canvas["data"]["elements"]): Canvas => ({
      id,
      workspaceId: "w1",
      notebookId: null,
      title,
      icon: null,
      data: { version: 1, elements },
      schemaVersion: 1,
      rev: 0,
      thumbnail: null,
      createdById: "u1",
      updatedById: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    const canvases = [
      canvas("c1", "Board", [
        { id: "e1", type: "page", x: 0, y: 0, width: 200, height: 150, pageId: "p1", variant: "card" },
        { id: "e2", type: "canvas", x: 0, y: 0, width: 200, height: 150, canvasId: "c2" },
        { id: "e3", type: "page", x: 0, y: 0, width: 200, height: 150, pageId: "missing", variant: "card" },
        { id: "e4", type: "note", x: 0, y: 0, width: 200, height: 150, text: "hi", color: "saffron" },
      ]),
      canvas("c2", "Detail", [
        { id: "e5", type: "page", x: 0, y: 0, width: 200, height: 150, pageId: "p2", variant: "link" },
      ]),
    ];
    const graph = buildDerivedGraph(pages, [], canvases, [], []);
    const connected = graph.edges.filter((edge) => edge.relationType === "CONNECTED_THROUGH");
    expect(connected).toHaveLength(3);
    expect(connected.every((edge) => edge.origin === "CANVAS_LINK")).toBe(true);
    expect(connected.some((edge) => edge.sourceNodeId === "c1" && edge.targetNodeId === "c2")).toBe(true);
    expect(connected.some((edge) => edge.sourceNodeId === "c2" && edge.targetNodeId === "p2")).toBe(true);
    expect(connected.some((edge) => edge.targetNodeId === "missing")).toBe(false);
  });
});

describe("learning utilities", () => {
  it("generates definition cards", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph" as const,
          attrs: { blockId: "b1" },
          content: [{ type: "text" as const, text: "Photosynthesis is the process by which plants convert light into chemical energy." }],
        },
      ],
    };
    const cards = generateFlashcardsFromDoc(doc);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]?.front.toLowerCase()).toContain("photosynthesis");
    expect(cards[0]?.blockId).toBe("b1");
  });

  it("builds quizzes and computes mastery", () => {
    const cards = [
      { id: "c1", front: "One?", back: "First" },
      { id: "c2", front: "Two?", back: "Second" },
      { id: "c3", front: "Three?", back: "Third" },
    ];
    const quiz = buildQuiz(cards, 3);
    expect(quiz).toHaveLength(3);
    for (const question of quiz) {
      expect(question.options).toHaveLength(3);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
    }
    const flashcards = cards.map(
      (card, index) =>
        ({
          ...card,
          interval: index === 0 ? 10 : 1,
          ease: 2.5,
          reps: index === 0 ? 5 : 1,
        }) as Flashcard,
    );
    expect(masteryScore(flashcards)).toBeGreaterThan(0);
    expect(scheduleReview({ interval: 3, ease: 2.5, reps: 2, lapses: 0 }, 1).lapses).toBe(1);
  });
});

describe("search utilities", () => {
  it("ranks title matches above body-only matches", () => {
    const results = rankRecords(
      [
        {
          type: "page",
          id: "a",
          workspaceId: "w1",
          title: "Knowledge graph",
          body: "A page about connections.",
          updatedAt: now,
        },
        {
          type: "page",
          id: "b",
          workspaceId: "w1",
          title: "Random notes",
          body: "Something about a knowledge graph inside the body.",
          updatedAt: now,
        },
      ],
      "knowledge graph",
    );
    expect(results[0]?.id).toBe("a");
    expect(scoreText("graph", "Knowledge graph", "")).toBeGreaterThan(0);
    expect(cosineSimilarity("local first sync", "local first knowledge sync")).toBeGreaterThan(0.5);
    expect(buildSnippet("A long note about local-first sync and conflict handling.", "sync")).toContain("sync");
  });
});
