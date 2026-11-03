import { describe, expect, it } from "vitest";

import {
  canvasFingerprint,
  diffCanvasElements,
  isEmptyDiff,
  mergeCanvasDocument,
  mergeCanvasElements,
} from "./canvas-sync";
import type { CanvasElement } from "./types";

const note = (id: string, x: number, text = "hello"): CanvasElement =>
  ({ id, type: "note", x, y: 0, width: 160, height: 120, text, color: "yellow" }) as CanvasElement;

const shape = (id: string, x: number): CanvasElement =>
  ({ id, type: "shape", shape: "rectangle", x, y: 0, width: 120, height: 80 }) as CanvasElement;

describe("diffCanvasElements", () => {
  it("reports nothing for an unchanged document", () => {
    const elements = [note("a", 0), shape("b", 10)];
    expect(isEmptyDiff(diffCanvasElements(elements, elements))).toBe(true);
  });

  it("reports an added element in full", () => {
    const diff = diffCanvasElements([note("a", 0)], [note("a", 0), shape("b", 10)]);
    expect(diff.added.map((element) => element.id)).toEqual(["b"]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("reports a removed element by id", () => {
    const diff = diffCanvasElements([note("a", 0), shape("b", 10)], [note("a", 0)]);
    expect(diff.removed).toEqual(["b"]);
  });

  it("reports only the fields that moved", () => {
    const diff = diffCanvasElements([note("a", 0)], [note("a", 40)]);
    expect(diff.changed).toEqual([{ id: "a", fields: { x: 40 } }]);
  });

  it("keeps untouched fields out of the payload", () => {
    const before = [note("a", 0, "original")];
    const after = [note("a", 25, "original")];
    const [change] = diffCanvasElements(before, after).changed;
    expect(Object.keys(change.fields)).toEqual(["x"]);
    expect(change.fields).not.toHaveProperty("text");
  });

  it("treats equal-but-rebuilt objects as unchanged", () => {
    const diff = diffCanvasElements([note("a", 0)], [note("a", 0)]);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("notices a change inside a nested field", () => {
    const before = [{ ...note("a", 0) }] as CanvasElement[];
    const after = [
      { ...note("a", 0), text: "retyped" } as CanvasElement,
    ];
    expect(diffCanvasElements(before, after).changed[0].fields).toEqual({ text: "retyped" });
  });

  it("handles a mixed edit in one pass", () => {
    const before = [note("a", 0), shape("b", 10), note("c", 20)];
    const after = [note("a", 5), note("c", 20), shape("d", 30)];
    const diff = diffCanvasElements(before, after);
    expect(diff.added.map((element) => element.id)).toEqual(["d"]);
    expect(diff.changed).toEqual([{ id: "a", fields: { x: 5 } }]);
    expect(diff.removed).toEqual(["b"]);
  });
});

describe("mergeCanvasElements", () => {
  it("lets the remote win on content and the local keep the order", () => {
    const local = [note("a", 0), shape("b", 10)];
    const merged = mergeCanvasElements(local, {
      a: note("a", 99),
      b: shape("b", 10),
    });
    expect(merged.map((element) => element.id)).toEqual(["a", "b"]);
    expect((merged[0] as { x: number }).x).toBe(99);
  });

  it("keeps a local element the remote has not heard about yet", () => {
    const local = [note("a", 0), shape("fresh", 5)];
    const merged = mergeCanvasElements(local, { a: note("a", 0) }, ["a"]);
    expect(merged.map((element) => element.id)).toEqual(["a", "fresh"]);
  });

  it("drops an element that was published and is now gone", () => {
    const local = [note("a", 0), shape("gone", 5)];
    const merged = mergeCanvasElements(local, { a: note("a", 0) }, ["a", "gone"]);
    expect(merged.map((element) => element.id)).toEqual(["a"]);
  });

  it("does not resurrect a deletion with a stale local copy", () => {
    const merged = mergeCanvasElements([shape("gone", 5)], {}, ["gone"]);
    expect(merged).toEqual([]);
  });

  it("appends remote elements the local side has never seen", () => {
    const merged = mergeCanvasElements([note("a", 0)], { a: note("a", 0), b: shape("b", 1) });
    expect(merged.map((element) => element.id)).toEqual(["a", "b"]);
  });

  it("produces an empty list when both sides are empty", () => {
    expect(mergeCanvasElements([], {})).toEqual([]);
  });
});

describe("mergeCanvasDocument", () => {
  it("keeps the rest of the document intact", () => {
    const local = { version: 1 as const, elements: [note("a", 0)], background: "grid" as const };
    const merged = mergeCanvasDocument(local, { a: note("a", 7) });
    expect(merged.background).toBe("grid");
    expect(merged.version).toBe(1);
    expect((merged.elements[0] as { x: number }).x).toBe(7);
  });
});

describe("canvasFingerprint", () => {
  it("ignores element order", () => {
    expect(canvasFingerprint({ version: 1, elements: [note("a", 0), shape("b", 1)] })).toBe(
      canvasFingerprint({ version: 1, elements: [shape("b", 1), note("a", 0)] }),
    );
  });

  it("changes when an element moves", () => {
    expect(canvasFingerprint({ version: 1, elements: [note("a", 0)] })).not.toBe(
      canvasFingerprint({ version: 1, elements: [note("a", 1)] }),
    );
  });

  it("distinguishes different counts with identical text", () => {
    expect(canvasFingerprint({ version: 1, elements: [note("a", 0)] })).not.toBe(
      canvasFingerprint({ version: 1, elements: [note("a", 0), note("a", 0)] }),
    );
  });
});
