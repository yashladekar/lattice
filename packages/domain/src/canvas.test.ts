import { describe, expect, it } from "vitest";

import { appendCanvasCluster, buildCanvasFromOutline, emptyCanvas } from "./canvas";
import type { CanvasDocument } from "./types";

const nodes = [
  { text: "System design", level: 1 },
  { text: "Requirements", level: 2 },
  { text: "Data", level: 2 },
];

describe("buildCanvasFromOutline", () => {
  it("builds a mind map with a root, children and connectors", () => {
    const document = buildCanvasFromOutline("mindmap", "System design", nodes);
    const shapes = document.elements.filter((element) => element.type === "shape");
    const connectors = document.elements.filter((element) => element.type === "connector");
    // One root plus one shape per outline entry.
    expect(shapes).toHaveLength(4);
    expect(connectors).toHaveLength(3);
    expect(shapes[0]?.text).toBe("System design");
    expect(document.background).toBe("dots");
  });

  it("builds a flow as a chain", () => {
    const document = buildCanvasFromOutline("flow", "Flow", nodes);
    const connectors = document.elements.filter((element) => element.type === "connector");
    expect(connectors).toHaveLength(nodes.length - 1);
    const boxes = document.elements.filter((element) => element.type === "shape");
    expect(boxes).toHaveLength(nodes.length);
  });

  it("builds a concept map with a hub and orbiting notes", () => {
    const document = buildCanvasFromOutline("concept", "Hub", nodes);
    const notes = document.elements.filter((element) => element.type === "note");
    const connectors = document.elements.filter((element) => element.type === "connector");
    expect(notes).toHaveLength(nodes.length);
    expect(connectors).toHaveLength(nodes.length);
  });

  it("gives every element a unique id", () => {
    const document = buildCanvasFromOutline("mindmap", "Ids", nodes);
    const ids = document.elements.map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("clamps outline levels into the supported range", () => {
    const document = buildCanvasFromOutline("mindmap", "Clamp", [
      { text: "too deep", level: 9 },
    ]);
    // A clamped level still produces a shape plus its connector to the root.
    expect(document.elements.filter((element) => element.type === "shape")).toHaveLength(2);
  });
});

describe("appendCanvasCluster", () => {
  const board = (): CanvasDocument => ({
    version: 1,
    background: "dots",
    elements: [
      {
        id: "existing-note",
        type: "note",
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        text: "Existing",
        color: "saffron",
      },
    ],
  });

  it("places the new cluster clear of the existing content", () => {
    const base = board();
    const next = appendCanvasCluster(base, "flow", "More", [{ text: "One" }, { text: "Two" }]);

    // Existing elements are untouched, in place and identity.
    expect(next.elements[0]).toBe(base.elements[0]);

    const added = next.elements.slice(1);
    const placed = added.filter((element) => element.type !== "connector");
    expect(placed.length).toBeGreaterThan(0);
    for (const element of placed) {
      expect(element.y).toBeGreaterThanOrEqual(120);
    }
  });

  it("only connects elements it created", () => {
    const next = appendCanvasCluster(board(), "flow", "More", [{ text: "One" }, { text: "Two" }]);
    const added = next.elements.slice(1);
    const ids = new Set(added.map((element) => element.id));
    for (const element of added) {
      if (element.type !== "connector") continue;
      expect(ids.has(element.from.elementId ?? "")).toBe(true);
      expect(ids.has(element.to.elementId ?? "")).toBe(true);
    }
  });

  it("starts at the origin on an empty board", () => {
    const next = appendCanvasCluster(emptyCanvas(), "flow", "Start", [{ text: "One" }]);
    const first = next.elements.find((element) => element.type !== "connector");
    expect(first?.x).toBe(0);
    expect(first?.y).toBe(0);
  });

  it("gives every appended element a fresh id", () => {
    const next = appendCanvasCluster(board(), "mindmap", "Map", [{ text: "One" }]);
    const ids = next.elements.map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
