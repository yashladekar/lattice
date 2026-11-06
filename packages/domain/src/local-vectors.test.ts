import { describe, expect, it } from "vitest";

import {
  buildLocalVectorIndex,
  localVectorNeighbors,
  localVectorSearch,
  localVectorTokens,
  stemLocalWord,
} from "./local-vectors";

const documents = [
  { id: "habits", text: "Building better habits takes repetition and a stable cue." },
  { id: "sleep", text: "Sleep hygiene: light, caffeine, and a consistent bedtime routine." },
  { id: "pasta", text: "Boil the pasta, salt the water, keep a cup of the cooking water." },
  { id: "review", text: "Spaced repetition review schedules flashcards by difficulty." },
];

describe("local vectors", () => {
  it("folds plurals and gerunds consistently on both sides of a pair", () => {
    expect(stemLocalWord("habits")).toBe(stemLocalWord("habit"));
    expect(stemLocalWord("routines")).toBe(stemLocalWord("routine"));
    expect(stemLocalWord("studying")).toBe(stemLocalWord("study"));
    expect(stemLocalWord("the")).toBe("the");
    expect(stemLocalWord("idea")).toBe("idea");
  });

  it("tokenizes with stopwords removed and bigrams added", () => {
    const tokens = localVectorTokens("The habits of a good routine");
    expect(tokens).toContain(stemLocalWord("habits"));
    expect(tokens).toContain(stemLocalWord("routine"));
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("of");
    expect(tokens).toContain(`${stemLocalWord("good")}_${stemLocalWord("routine")}`);
  });

  it("finds a document the exact token would miss", () => {
    const index = buildLocalVectorIndex(documents);
    const hits = localVectorSearch(index, "habit formation", 4);
    expect(hits[0]?.id).toBe("habits");
  });

  it("keeps other topics out of the top result", () => {
    const index = buildLocalVectorIndex(documents);
    expect(localVectorSearch(index, "bedtime routine", 4)[0]?.id).toBe("sleep");
    expect(localVectorSearch(index, "spaced repetition flashcards", 4)[0]?.id).toBe("review");
  });

  it("uses bigrams so word order matters", () => {
    const index = buildLocalVectorIndex([
      { id: "a", text: "graph playback of history" },
      { id: "b", text: "playback graph of history" },
    ]);
    const hits = localVectorSearch(index, "graph playback", 2);
    expect(hits[0]?.id).toBe("a");
  });

  it("returns nothing for stopwords, blanks, or an empty index", () => {
    const index = buildLocalVectorIndex(documents);
    expect(localVectorSearch(index, "")).toEqual([]);
    expect(localVectorSearch(index, "the of and")).toEqual([]);
    expect(localVectorSearch(index, "anything", 5)).not.toEqual([]);
    expect(localVectorSearch(buildLocalVectorIndex([]), "habits")).toEqual([]);
  });

  it("normalizes vectors and stays deterministic", () => {
    const first = buildLocalVectorIndex(documents);
    const second = buildLocalVectorIndex(documents);
    const vector = first.vectors.get("habits")!;
    let norm = 0;
    for (const value of vector) norm += value * value;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
    expect([...second.vectors.get("habits")!]).toEqual([...vector]);
    expect(localVectorSearch(first, "habits")).toEqual(localVectorSearch(second, "habits"));
  });

  it("ranks neighbors of a document", () => {
    const index = buildLocalVectorIndex([
      { id: "one", text: "flashcards and spaced repetition for memory" },
      { id: "two", text: "spaced repetition schedules flashcards" },
      { id: "three", text: "sourdough needs a warm proof and patience" },
    ]);
    const neighbors = localVectorNeighbors(index, "one", 2);
    expect(neighbors[0]?.id).toBe("two");
    expect(neighbors.map((hit) => hit.id)).not.toContain("three");
    expect(localVectorNeighbors(index, "missing")).toEqual([]);
  });
});
