export const MAX_EMBEDDING_DIMENSIONS = 4096;

/** Accepts only finite numeric vectors of a plausible size. */
export function isEmbeddingVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_EMBEDDING_DIMENSIONS &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

/**
 * Cosine similarity for stored embeddings. Returns null when the vectors are
 * unusable or come from different models/dimensions, so callers rank only
 * comparable rows instead of treating a mismatch as a zero score.
 */
export function cosineSimilarityVectors(left: number[], right: number[]): number | null {
  if (!isEmbeddingVector(left) || !isEmbeddingVector(right)) return null;
  if (left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return null;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/** Text sent to the embedding provider for a page. */
export function embeddingSource(title: string, plainText: string): string {
  return `${title}\n\n${plainText}`.trim().slice(0, 8000);
}
