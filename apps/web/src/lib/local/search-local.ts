import {
  buildSnippet,
  docToMarkdown,
  rankRecords,
  scoreText,
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

export function searchWorkspaceIndex(
  index: {
    pages: LocalPage[];
    documents: LocalPageDocument[];
    canvases: LocalCanvas[];
    captures: LocalCapture[];
  },
  query: string,
  limit = 24,
): SearchResult[] {
  if (!query.trim()) return [];
  const documentByPage = new Map(
    index.documents.map((document) => [document.pageId, document.plainText]),
  );
  const records: SearchableRecord[] = [
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
  return rankRecords(records, query, limit);
}

export function pageRelatedRecords(
  index: {
    pages: LocalPage[];
    documents: LocalPageDocument[];
  },
  pageId: string,
) {
  const documentByPage = new Map(
    index.documents.map((document) => [document.pageId, document.plainText]),
  );
  return index.pages
    .filter((page) => page.id !== pageId)
    .map((page) => ({
      page,
      score: scoreText(
        documentByPage.get(pageId) ?? "",
        page.title,
        documentByPage.get(page.id) ?? "",
      ),
      snippet: buildSnippet(documentByPage.get(page.id) ?? "", "", 120),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function exportPageMarkdown(page: LocalPage, document: LocalPageDocument | null): string {
  const body = document ? docToMarkdown(document.content) : "";
  return `# ${page.title}\n\n${body}`.trim();
}
