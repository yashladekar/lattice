import { describe, expect, it } from "vitest";

import { buildCanvasFromOutline } from "./canvas";

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
