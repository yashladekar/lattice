import type { Database } from "@notes-learning/db";
import {
  buildSnippet,
  cosineSimilarityVectors,
  isEmbeddingVector,
  scoreText,
  type AiCitation,
  type Role,
} from "@notes-learning/domain";

import { embedTexts } from "../ai/provider";
import type { AiConfig } from "../context";
import { getAccessiblePageIds } from "./sync";

export interface RetrievedPage {
  pageId: string;
  title: string;
  body: string;
  score: number;
  excerpt: string;
  updatedAt: string;
}

/**
 * Lexical retrieval over the pages a member can read. Deliberately shared by
 * Ask, page actions, and the agent tools so a search returns the same ranking
 * wherever it is called from.
 */
export async function retrievePages(
  db: Database,
  workspaceId: string,
  userId: string,
  role: Role,
  query: string,
  scope?: { notebookId?: string | null; pageIds?: string[] },
  limit = 8,
): Promise<RetrievedPage[]> {
  const allowed = await getAccessiblePageIds(db, workspaceId, userId, role);
  const pages = await db.page.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(scope?.notebookId ? { notebookId: scope.notebookId } : {}),
      ...(scope?.pageIds?.length ? { id: { in: scope.pageIds } } : {}),
      ...(allowed ? { id: { in: [...allowed] } } : {}),
    },
  });
  const documents = await db.pageDocument.findMany({
    where: { workspaceId, pageId: { in: pages.map((page) => page.id) } },
  });
  const documentByPage = new Map(
    documents.map((document) => [document.pageId, document.plainText]),
  );
  return pages
    .map((page) => {
      const body = documentByPage.get(page.id) ?? "";
      return {
        pageId: page.id,
        title: page.title,
        body,
        score: scoreText(query, page.title, body),
        excerpt: buildSnippet(body, query, 700),
        updatedAt: page.updatedAt.toISOString(),
      };
    })
    .filter((page) => page.score > 0 || !query)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Ranks pages by embedding similarity when a vector index exists. Returns null
 * when there is nothing to rank, so callers fall back to token retrieval.
 */
export async function retrieveSemantic(
  db: Database,
  config: AiConfig,
  workspaceId: string,
  userId: string,
  role: Role,
  question: string,
  scope?: { notebookId?: string | null; pageIds?: string[] },
  limit = 8,
): Promise<RetrievedPage[] | null> {
  const rows = await db.pageEmbedding.findMany({
    where: { workspaceId },
    select: { pageId: true, vector: true },
  });
  if (!rows.length) return null;
  const embedded = await embedTexts(config, [question]);
  const questionVector = embedded?.[0];
  if (!questionVector) return null;
  const allowed = await getAccessiblePageIds(db, workspaceId, userId, role);
  const scopedIds =
    scope?.notebookId || scope?.pageIds?.length
      ? new Set(
          (
            await db.page.findMany({
              where: {
                workspaceId,
                deletedAt: null,
                ...(scope.notebookId ? { notebookId: scope.notebookId } : {}),
                ...(scope.pageIds?.length ? { id: { in: scope.pageIds } } : {}),
              },
              select: { id: true },
            })
          ).map((page) => page.id),
        )
      : null;
  const ranked = rows
    .map((row) => ({
      pageId: row.pageId,
      score: isEmbeddingVector(row.vector)
        ? cosineSimilarityVectors(questionVector, row.vector)
        : null,
    }))
    .filter((entry): entry is { pageId: string; score: number } => entry.score !== null)
    .filter((entry) => entry.score > 0.2)
    .filter((entry) => !allowed || allowed.has(entry.pageId))
    .filter((entry) => !scopedIds || scopedIds.has(entry.pageId))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  if (!ranked.length) return null;

  const pages = await db.page.findMany({
    where: { id: { in: ranked.map((entry) => entry.pageId) }, workspaceId, deletedAt: null },
    include: { document: true },
  });
  const byId = new Map(pages.map((page) => [page.id, page]));
  return ranked.flatMap((entry) => {
    const page = byId.get(entry.pageId);
    if (!page) return [];
    const body = page.document?.plainText ?? "";
    return [
      {
        pageId: page.id,
        title: page.title,
        body,
        score: entry.score,
        excerpt: buildSnippet(body, question, 700),
        updatedAt: page.updatedAt.toISOString(),
      } satisfies RetrievedPage,
    ];
  });
}

export function citationsFrom(pages: RetrievedPage[]): AiCitation[] {
  return pages.map((page) => ({
    pageId: page.pageId,
    title: page.title,
    excerpt: page.excerpt,
  }));
}

export function contextBlock(pages: RetrievedPage[]): string {
  return pages
    .map((page, index) => `[${index + 1}] ${page.title}\n${page.body.slice(0, 2400)}`)
    .join("\n\n---\n\n");
}
