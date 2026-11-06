import {
  buildLocalVectorIndex,
  buildSnippet,
  docToMarkdown,
  localVectorSearch,
  rankRecords,
  type LocalVectorIndex,
  type SearchResult,
  type SearchableRecord,
} from "@notes-learning/domain";

import type {
  LocalCanvas,
  LocalCapture,
  LocalPage,
  LocalPageDocument,
} from "@/lib/local/types";

function canvasText(canvas: LocalCanvas): string {
  return canvas.data.elements
    .map((element) => {
      if ("text" in element && typeof element.text === "string") return element.text;
      if (element.type === "frame") return element.title;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

interface SearchIndexShape {
  pages: LocalPage[];
  documents: LocalPageDocument[];
  canvases: LocalCanvas[];
  captures: LocalCapture[];
}

function recordsFor(index: SearchIndexShape): SearchableRecord[] {
  const documentByPage = new Map(
    index.documents.map((document) => [document.pageId, document.plainText]),
  );
  return [
    ...index.pages.map((page) => ({
      type: "page" as const,
      id: page.id,
      workspaceId: page.workspaceId,
      title: page.title,
      body: documentByPage.get(page.id) ?? "",
      icon: page.icon,
      updatedAt: page.updatedAt,
    })),
    ...index.canvases.map((canvas) => ({
      type: "canvas" as const,
      id: canvas.id,
      workspaceId: canvas.workspaceId,
      title: canvas.title,
      body: canvasText(canvas),
      icon: canvas.icon,
      updatedAt: canvas.updatedAt,
    })),
    ...index.captures.map((capture) => ({
      type: "capture" as const,
      id: capture.id,
      workspaceId: capture.workspaceId,
      title: capture.title || capture.url || "Capture",
      body: `${capture.content ?? ""} ${capture.url ?? ""}`,
      icon: "⌁",
      updatedAt: capture.updatedAt,
    })),
  ];
}

/**
 * Local vectors are expensive to build, so they are cached per index object.
 * The index comes from a live query and only changes when local data does.
 */
const vectorCache = new WeakMap<SearchIndexShape, LocalVectorIndex>();

function vectorsFor(index: SearchIndexShape, records: SearchableRecord[]): LocalVectorIndex {
  const cached = vectorCache.get(index);
  if (cached) return cached;
  const built = buildLocalVectorIndex(
    records.map((record) => ({
      id: `${record.type}:${record.id}`,
      text: `${record.title}\n${record.body}`,
    })),
  );
  vectorCache.set(index, built);
  return built;
}

/** Cosine score is 0–1; scaling it to the lexical range keeps one ranking. */
const VECTOR_WEIGHT = 14;

/**
 * Hybrid retrieval: the lexical score still decides between documents that
 * share words, and local vectors add the ones a token search would miss
 * (different word forms, related phrasing) plus a boost where both agree.
 */
export function searchWorkspaceIndex(
  index: SearchIndexShape,
  query: string,
  limit = 24,
): SearchResult[] {
  if (!query.trim()) return [];
  const records = recordsFor(index);
  const lexical = rankRecords(records, query, limit * 2);
  const semantic = localVectorSearch(vectorsFor(index, records), query, limit * 2);
  if (!semantic.length) return lexical.slice(0, limit);

  const byKey = new Map(records.map((record) => [`${record.type}:${record.id}`, record]));
  const vectorScore = new Map(semantic.map((hit) => [hit.id, hit.score]));
  const merged = new Map<string, SearchResult>();

  for (const result of lexical) {
    const key = `${result.type}:${result.id}`;
    merged.set(key, {
      ...result,
      score: Math.round((result.score + (vectorScore.get(key) ?? 0) * VECTOR_WEIGHT) * 100) / 100,
    });
  }
  for (const hit of semantic) {
    if (merged.has(hit.id)) continue;
    const record = byKey.get(hit.id);
    if (!record) continue;
    merged.set(hit.id, {
      type: record.type,
      id: record.id,
      workspaceId: record.workspaceId,
      title: record.title || "Untitled",
      snippet: buildSnippet(record.body, query),
      score: Math.round(hit.score * VECTOR_WEIGHT * 100) / 100,
      icon: record.icon ?? null,
      updatedAt: record.updatedAt,
    });
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function exportPageMarkdown(page: LocalPage, document: LocalPageDocument | null): string {
  const body = document ? docToMarkdown(document.content) : "";
  return `# ${page.title}\n\n${body}`.trim();
}
