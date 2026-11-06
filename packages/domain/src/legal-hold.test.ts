import { describe, expect, it } from "vitest";

import {
  describeLegalHoldHolders,
  expandHeldCanvases,
  expandHeldDecks,
  expandHeldNodes,
  expandHeldPages,
  holdCoverage,
  isLegalHoldScope,
} from "./legal-hold";

describe("legal hold coverage", () => {
  it("recognizes scopes", () => {
    expect(isLegalHoldScope("WORKSPACE")).toBe(true);
    expect(isLegalHoldScope("PAGE")).toBe(true);
    expect(isLegalHoldScope("TENANT")).toBe(false);
  });

  it("lets a workspace hold cover everything", () => {
    const coverage = holdCoverage([{ scope: "WORKSPACE", targetId: null }]);
    expect(coverage.workspace).toBe(true);
    expect(expandHeldPages(coverage, [{ id: "p1", notebookId: "n1" }])).toEqual(new Set());
  });

  it("expands notebook holds to their pages and canvases only", () => {
    const coverage = holdCoverage([{ scope: "NOTEBOOK", targetId: "n1" }]);
    const pages = [
      { id: "p1", notebookId: "n1" },
      { id: "p2", notebookId: "n2" },
      { id: "p3", notebookId: null },
    ];
    expect(expandHeldPages(coverage, pages)).toEqual(new Set(["p1"]));
    expect(
      expandHeldCanvases(coverage, [
        { id: "c1", notebookId: "n1" },
        { id: "c2", notebookId: "n2" },
      ]),
    ).toEqual(new Set(["c1"]));
  });

  it("holds a single page", () => {
    const coverage = holdCoverage([{ scope: "PAGE", targetId: "p2" }]);
    expect(coverage.notebookIds.size).toBe(0);
    expect(expandHeldPages(coverage, [{ id: "p1", notebookId: "n1" }])).toEqual(new Set(["p2"]));
  });

  it("ignores released holds and missing targets", () => {
    const coverage = holdCoverage([
      { scope: "WORKSPACE", targetId: null, releasedAt: "2024-01-01T00:00:00.000Z" },
      { scope: "PAGE", targetId: null },
      { scope: "PAGE", targetId: "p1", releasedAt: new Date() },
    ]);
    expect(coverage.workspace).toBe(false);
    expect(coverage.pageIds.size).toBe(0);
  });

  it("derives held nodes and decks from held content", () => {
    expect(
      expandHeldNodes(
        [
          { id: "n1", pageId: "p1", canvasId: null },
          { id: "n2", pageId: "p2", canvasId: null },
          { id: "n3", pageId: null, canvasId: "c1" },
        ],
        new Set(["p1"]),
        new Set(["c1"]),
      ),
    ).toEqual(new Set(["n1", "n3"]));
    expect(
      expandHeldDecks(
        [
          { id: "d1", notebookId: "n1" },
          { id: "d2", notebookId: "n2" },
          { id: "d3", notebookId: null },
        ],
        holdCoverage([{ scope: "NOTEBOOK", targetId: "n1" }]),
      ),
    ).toEqual(new Set(["d1"]));
  });

  it("summarizes what is held", () => {
    const summary = describeLegalHoldHolders(
      [
        { scope: "PAGE", targetId: "p1" },
        { scope: "NOTEBOOK", targetId: "n1" },
        { scope: "PAGE", targetId: "p2", releasedAt: "2024-01-01T00:00:00.000Z" },
      ],
      {
        page: new Map([["p1", "Retention memo"]]),
        notebook: new Map([["n1", "Litigation"]]),
      },
    );
    expect(summary).toBe("Held: Retention memo, Litigation.");
    expect(describeLegalHoldHolders([], { page: new Map(), notebook: new Map() })).toBe(
      "Nothing is under hold.",
    );
  });
});
