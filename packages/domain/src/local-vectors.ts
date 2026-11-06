/**
 * Provider-free retrieval.
 *
 * These are deterministic local vectors, not a neural model: text is tokenized
 * with light stemming and phrase bigrams, terms are weighted by sublinear TF and
 * inverse document frequency, hashed into a fixed number of dimensions, and
 * L2-normalized so a dot product is cosine similarity. That widens recall past
 * exact tokens — "habits" finds "habit", word order matters through bigrams —
 * and it runs identically offline, in a worker, or on a phone.
 *
 * When an AI provider is configured, its embeddings still power Ask retrieval;
 * this is what the app uses when there is no provider and no index.
 */
export const LOCAL_VECTOR_DIMENSIONS = 512;

/** Longest documents are truncated before vectorizing: past this, noise dominates. */
export const LOCAL_VECTOR_TEXT_LIMIT = 12_000;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "you",
  "are",
  "was",
  "were",
  "but",
  "not",
  "have",
  "has",
  "had",
  "its",
  "it's",
  "their",
  "them",
  "they",
  "then",
  "than",
  "over",
  "under",
  "about",
  "which",
  "when",
  "what",
  "where",
  "while",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "also",
  "been",
  "being",
  "our",
  "out",
  "any",
  "all",
  "some",
  "such",
  "only",
  "just",
  "very",
  "more",
  "most",
  "each",
  "other",
  "these",
  "those",
  "there",
  "here",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "as",
  "an",
  "or",
  "if",
  "is",
  "be",
  "do",
  "so",
  "we",
  "us",
  "my",
  "me",
  "he",
  "she",
  "his",
  "her",
  "it",
  "no",
  "up",
  "via",
  "per",
  "off",
  "own",
  "same",
  "too",
]);

/** Plural and gerund folding. Deliberately shallow — it must stay predictable. */
export function stemLocalWord(word: string): string {
  let base = word;
  for (const suffix of ["ings", "ing", "ies", "ied", "ers", "est", "ed", "es", "s"]) {
    if (!base.endsWith(suffix)) continue;
    const candidate = base.slice(0, base.length - suffix.length);
    if (candidate.length < 3) continue;
    base = suffix === "ies" || suffix === "ied" ? `${candidate}y` : candidate;
    break;
  }
  // A trailing "e" is dropped on both sides of a pair, so "routine" and
  // "routines" still meet even though the shared stem is not a word.
  if (base.length >= 4 && base.endsWith("e")) base = base.slice(0, -1);
  return base;
}

export function localVectorTokens(text: string): string[] {
  const words = text
    .slice(0, LOCAL_VECTOR_TEXT_LIMIT)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word))
    .map(stemLocalWord);
  if (!words.length) return [];
  const tokens = [...words];
  for (let index = 1; index < words.length; index += 1) {
    tokens.push(`${words[index - 1]}_${words[index]}`);
  }
  return tokens;
}

/** FNV-1a, so buckets are stable across processes and platforms. */
function bucketFor(token: string, dimensions: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % dimensions;
}

export interface LocalVectorIndex {
  dimensions: number;
  idf: Map<string, number>;
  vectors: Map<string, Float32Array>;
  documentCount: number;
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export function buildLocalVectorIndex(
  documents: Array<{ id: string; text: string }>,
  dimensions = LOCAL_VECTOR_DIMENSIONS,
): LocalVectorIndex {
  const frequencies = new Map<string, Map<string, number>>();
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    const counts = termFrequencies(localVectorTokens(document.text));
    frequencies.set(document.id, counts);
    for (const term of counts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = Math.max(documents.length, 1);
  const idf = new Map<string, number>();
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log(1 + total / (1 + frequency)));
  }

  const vectors = new Map<string, Float32Array>();
  for (const [id, counts] of frequencies) {
    vectors.set(id, vectorize(counts, idf, total, dimensions));
  }
  return { dimensions, idf, vectors, documentCount: documents.length };
}

function vectorize(
  counts: Map<string, number>,
  idf: Map<string, number>,
  documentCount: number,
  dimensions: number,
): Float32Array {
  const vector = new Float32Array(dimensions);
  for (const [term, count] of counts) {
    const weight = (1 + Math.log(count)) * (idf.get(term) ?? Math.log(1 + documentCount));
    const bucket = bucketFor(term, dimensions);
    vector[bucket] = (vector[bucket] ?? 0) + weight;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  const length = Math.sqrt(norm);
  if (length) {
    for (let index = 0; index < vector.length; index += 1) {
      vector[index] = (vector[index] ?? 0) / length;
    }
  }
  return vector;
}

function dot(left: Float32Array, right: Float32Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index]! * right[index]!;
  return total;
}

export interface LocalVectorHit {
  id: string;
  score: number;
}

/** Cosine ranking of indexed documents against a free-text query. */
export function localVectorSearch(
  index: LocalVectorIndex,
  query: string,
  limit = 20,
  minimumScore = 0.05,
): LocalVectorHit[] {
  if (!query.trim() || !index.vectors.size) return [];
  const counts = termFrequencies(localVectorTokens(query));
  if (!counts.size) return [];
  const queryVector = vectorize(counts, index.idf, index.documentCount, index.dimensions);
  const hits: LocalVectorHit[] = [];
  for (const [id, vector] of index.vectors) {
    const score = dot(queryVector, vector);
    if (score < minimumScore) continue;
    hits.push({ id, score: Math.round(score * 1000) / 1000 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Documents closest to one indexed document, for "related notes" style lists. */
export function localVectorNeighbors(
  index: LocalVectorIndex,
  id: string,
  limit = 6,
  minimumScore = 0.08,
): LocalVectorHit[] {
  const target = index.vectors.get(id);
  if (!target) return [];
  const hits: LocalVectorHit[] = [];
  for (const [otherId, vector] of index.vectors) {
    if (otherId === id) continue;
    const score = dot(target, vector);
    if (score < minimumScore) continue;
    hits.push({ id: otherId, score: Math.round(score * 1000) / 1000 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
