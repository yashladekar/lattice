import type { SearchResult } from "./types";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

export type SearchType = "page" | "canvas" | "capture";

export interface SearchQuery {
  text: string;
  tags: string[];
  types: SearchType[];
  notebooks: string[];
}

const SEARCH_TYPES: SearchType[] = ["page", "canvas", "capture"];

function readTerms(input: string): string[] {
  const terms: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) terms.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) terms.push(current);
  return terms;
}

/**
 * Splits a query into free text and `tag:`, `type:`, and `notebook:` filters.
 * `#name` is shorthand for `tag:name`, and quoted values keep their spaces:
 * `tag:"deep work"`.
 */
export function parseSearchQuery(input: string): SearchQuery {
  const text: string[] = [];
  const tags = new Set<string>();
  const types = new Set<SearchType>();
  const notebooks = new Set<string>();

  for (const term of readTerms(input.trim())) {
    if (term.startsWith("#") && term.length > 1) {
      tags.add(term.slice(1).toLowerCase());
      continue;
    }
    const separator = term.indexOf(":");
    if (separator <= 0) {
      text.push(term);
      continue;
    }
    const operator = term.slice(0, separator).toLowerCase();
    const value = term.slice(separator + 1).trim();
    if (!value) {
      text.push(term);
      continue;
    }
    if (operator === "tag" || operator === "tags") {
      tags.add(value.toLowerCase());
      continue;
    }
    if (operator === "type") {
      const type = value.toLowerCase() as SearchType;
      if (SEARCH_TYPES.includes(type)) types.add(type);
      continue;
    }
    if (operator === "notebook" || operator === "in") {
      notebooks.add(value.toLowerCase());
      continue;
    }
    text.push(term);
  }

  return {
    text: text.join(" ").trim(),
    tags: [...tags],
    types: [...types],
    notebooks: [...notebooks],
  };
}

export function hasSearchFilters(query: SearchQuery): boolean {
  return query.tags.length > 0 || query.types.length > 0 || query.notebooks.length > 0;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}

export function cosineSimilarity(left: string, right: string): number {
  const a = termFrequency(tokenize(left));
  const b = termFrequency(tokenize(right));
  if (!a.size || !b.size) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [token, count] of a) {
    normA += count * count;
    dot += count * (b.get(token) ?? 0);
  }
  for (const count of b.values()) {
    normB += count * count;
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function scoreText(query: string, title: string, body: string, tags: string[] = []): number {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const normalizedTitle = normalizeText(title);
  const normalizedBody = normalizeText(body);
  const normalizedTags = tags.map((tag) => normalizeText(tag));
  let score = 0;

  for (const token of queryTokens) {
    if (normalizedTitle === normalizeText(query)) score += 24;
    if (normalizedTitle.startsWith(token)) score += 8;
    if (normalizedTitle.includes(token)) score += 5;
    if (normalizedTags.some((tag) => tag.includes(token))) score += 4;
    if (normalizedBody.includes(token)) score += 2;
  }

  const bodyTokens = tokenize(body);
  if (bodyTokens.length) {
    const overlap = bodyTokens.filter((token) => queryTokens.includes(token)).length;
    score += Math.min(6, overlap / Math.sqrt(bodyTokens.length));
  }
  return Math.round(score * 100) / 100;
}

export function buildSnippet(body: string, query: string, length = 180): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return normalized.slice(0, length);
  const lower = normalizeText(normalized);
  let index = -1;
  for (const token of queryTokens) {
    const found = lower.indexOf(token);
    if (found !== -1) {
      index = found;
      break;
    }
  }
  if (index === -1) return normalized.slice(0, length);
  const start = Math.max(0, index - Math.floor(length / 3));
  const end = Math.min(normalized.length, start + length);
  return `${start > 0 ? "…" : ""}${normalized.slice(start, end).trim()}${end < normalized.length ? "…" : ""}`;
}

export interface SearchableRecord {
  type: SearchResult["type"];
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  tags?: string[];
  icon?: string | null;
  updatedAt: string;
}

export function rankRecords(records: SearchableRecord[], query: string, limit = 50): SearchResult[] {
  const results: SearchResult[] = [];
  for (const record of records) {
    const score = scoreText(query, record.title, record.body, record.tags);
    if (score <= 0) continue;
    results.push({
      type: record.type,
      id: record.id,
      workspaceId: record.workspaceId,
      title: record.title || "Untitled",
      snippet: buildSnippet(record.body, query),
      score,
      icon: record.icon ?? null,
      updatedAt: record.updatedAt,
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface RelatedDocument {
  id: string;
  title: string;
  body: string;
  tags?: string[];
}

export function relatedDocuments(
  source: RelatedDocument,
  candidates: RelatedDocument[],
  limit = 6,
): Array<RelatedDocument & { score: number }> {
  const sourceText = `${source.title} ${source.body} ${(source.tags ?? []).join(" ")}`;
  return candidates
    .filter((candidate) => candidate.id !== source.id)
    .map((candidate) => ({
      ...candidate,
      score: cosineSimilarity(
        sourceText,
        `${candidate.title} ${candidate.body} ${(candidate.tags ?? []).join(" ")}`,
      ),
    }))
    .filter((candidate) => candidate.score > 0.04)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function suggestTagNames(text: string, existing: string[] = [], limit = 5): string[] {
  const counts = new Map<string, number>();
  const tokens = tokenize(text);
  for (const token of tokens) {
    if (token.length < 4) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const normalizedExisting = new Set(existing.map((tag) => normalizeText(tag)));
  return [...counts.entries()]
    .filter(([token, count]) => count >= 2 && !normalizedExisting.has(token))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([token]) => token);
}
