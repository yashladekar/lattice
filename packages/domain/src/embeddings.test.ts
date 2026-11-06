import { describe, expect, it } from "vitest";

import {
  cosineSimilarityVectors,
  embeddingSource,
  isEmbeddingVector,
  MAX_EMBEDDING_DIMENSIONS,
} from "./embeddings";

describe("embeddings", () => {
  it("accepts finite vectors and rejects junk", () => {
    expect(isEmbeddingVector([0.1, -0.2, 3])).toBe(true);
    expect(isEmbeddingVector([])).toBe(false);
    expect(isEmbeddingVector([1, Number.NaN])).toBe(false);
    expect(isEmbeddingVector([1, "2"])).toBe(false);
    expect(isEmbeddingVector(new Array(MAX_EMBEDDING_DIMENSIONS + 1).fill(0.1))).toBe(false);
  });

  it("scores parallel and opposite vectors", () => {
    expect(cosineSimilarityVectors([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosineSimilarityVectors([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarityVectors([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns null for mismatched or empty vectors", () => {
    expect(cosineSimilarityVectors([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarityVectors([], [])).toBeNull();
    expect(cosineSimilarityVectors([0, 0], [1, 1])).toBeNull();
  });

  it("bounds the text sent to the provider", () => {
    const source = embeddingSource("Title", "x".repeat(10_000));
    expect(source.startsWith("Title\n\n")).toBe(true);
    expect(source.length).toBe(8000);
  });
});
