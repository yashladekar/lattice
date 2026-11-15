import { describe, expect, it } from "vitest";

import { publicCanvasData } from "./public-canvas";

describe("publicCanvasData", () => {
  it("returns an empty board for anything that is not a canvas document", () => {
    expect(publicCanvasData(null)).toEqual({ version: 1, elements: [] });
    expect(publicCanvasData({ elements: "nope" })).toEqual({ version: 1, elements: [] });
  });

  it("drops linked notes and nested canvases", () => {
    const result = publicCanvasData({
      version: 1,
      elements: [
        { id: "a", type: "note" },
        { id: "p", type: "page", pageId: "secret" },
        { id: "c", type: "canvas", canvasId: "secret" },
      ],
    });
    expect(result.elements.map((element) => element.id)).toEqual(["a"]);
  });

  it("drops connectors attached to a removed element, keeps the rest", () => {
    const result = publicCanvasData({
      version: 1,
      background: "dots",
      elements: [
        { id: "a", type: "note" },
        { id: "b", type: "note" },
        { id: "p", type: "page", pageId: "secret" },
        { id: "keep", type: "connector", from: { elementId: "a" }, to: { elementId: "b" } },
        { id: "to-page", type: "connector", from: { elementId: "a" }, to: { elementId: "p" } },
        { id: "from-page", type: "connector", from: { elementId: "p" }, to: { elementId: "b" } },
        { id: "free", type: "connector", from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
      ],
    });
    expect(result.background).toBe("dots");
    expect(result.elements.map((element) => element.id)).toEqual(["a", "b", "keep", "free"]);
  });
});
