"use client";

import {
  buildDerivedGraph,
  buildPageTree,
  dueCards,
  masteryScore,
  sortPagesByRecency,
  type PageTreeNode,
} from "@notes-learning/domain";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

import { useAppData } from "@/components/app-data-provider";
import type {
  LocalCanvas,
  LocalCapture,
  LocalComment,
  LocalDeck,
  LocalEdge,
  LocalFlashcard,
  LocalNotebook,
  LocalPage,
  LocalPageDocument,
  LocalReviewLog,
  LocalTag,
  LocalTemplate,
} from "@/lib/local/types";

export function useWorkspaceNotebooks(): LocalNotebook[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.notebooks.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows
          .filter((row) => !row.deletedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function useWorkspacePages(): LocalPage[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.pages.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows.filter((row) => !row.deletedAt);
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function usePageTree(): PageTreeNode[] {
  const pages = useWorkspacePages();
  return useMemo(() => buildPageTree(pages), [pages]);
}

export function useRecentPages(limit = 8): LocalPage[] {
  const pages = useWorkspacePages();
  return useMemo(() => sortPagesByRecency(pages, limit), [pages, limit]);
}

export function usePage(pageId: string | null | undefined): LocalPage | null {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !pageId) return null;
        return (await db.pages.get(pageId)) ?? null;
      },
      [db, pageId],
      null,
    ) ?? null
  );
}

export function usePageDocument(pageId: string | null | undefined): LocalPageDocument | null {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !pageId) return null;
        return (await db.pageDocuments.get(pageId)) ?? null;
      },
      [db, pageId],
      null,
    ) ?? null
  );
}

export function useNotebook(notebookId: string | null | undefined): LocalNotebook | null {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !notebookId) return null;
        return (await db.notebooks.get(notebookId)) ?? null;
      },
      [db, notebookId],
      null,
    ) ?? null
  );
}

export function useWorkspaceCanvases(): LocalCanvas[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.canvases.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows
          .filter((row) => !row.deletedAt)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function useCanvas(canvasId: string | null | undefined): LocalCanvas | null {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !canvasId) return null;
        return (await db.canvases.get(canvasId)) ?? null;
      },
      [db, canvasId],
      null,
    ) ?? null
  );
}

export function useWorkspaceTags(): LocalTag[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.tags.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows.filter((row) => !row.deletedAt);
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function usePageTags(pageId: string | null | undefined): LocalTag[] {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !pageId) return [];
        const pageTags = await db.pageTags.where("pageId").equals(pageId).toArray();
        if (!pageTags.length) return [];
        const tags = await db.tags.bulkGet(pageTags.map((entry) => entry.tagId));
        return tags.filter((tag): tag is LocalTag => Boolean(tag && !tag.deletedAt));
      },
      [db, pageId],
      [],
    ) ?? []
  );
}

export function usePageComments(pageId: string | null | undefined): LocalComment[] {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !pageId) return [];
        const rows = await db.comments.where("pageId").equals(pageId).toArray();
        return rows
          .filter((row) => !row.deletedAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
      [db, pageId],
      [],
    ) ?? []
  );
}

export function useGraph() {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return { nodes: [], edges: [] };
        const [pages, documents, canvases, nodes, edges] = await Promise.all([
          db.pages.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.pageDocuments.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.canvases.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.nodes.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.edges.where("workspaceId").equals(activeWorkspaceId).toArray(),
        ]);
        return buildDerivedGraph(
          pages.filter((page) => !page.deletedAt),
          documents,
          canvases.filter((canvas) => !canvas.deletedAt),
          nodes.filter((node) => !node.deletedAt),
          edges.filter((edge) => !edge.deletedAt),
        );
      },
      [db, activeWorkspaceId],
      { nodes: [], edges: [] },
    ) ?? { nodes: [], edges: [] }
  );
}

export function useBacklinks(pageId: string | null | undefined) {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !pageId) return [];
        const edges = await db.edges.where("targetNodeId").equals(pageId).toArray();
        const active = edges.filter((edge) => !edge.deletedAt);
        const pages = await db.pages.bulkGet(active.map((edge) => edge.sourceNodeId));
        return pages.filter((page): page is LocalPage => Boolean(page && !page.deletedAt));
      },
      [db, pageId],
      [],
    ) ?? []
  );
}

export function useOutgoingLinks(pageId: string | null | undefined) {
  const { db } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !pageId) return [];
        const edges = await db.edges.where("sourceNodeId").equals(pageId).toArray();
        const active = edges.filter((edge) => !edge.deletedAt);
        const pages = await db.pages.bulkGet(active.map((edge) => edge.targetNodeId));
        return pages.filter((page): page is LocalPage => Boolean(page && !page.deletedAt));
      },
      [db, pageId],
      [],
    ) ?? []
  );
}

export function useWorkspaceEdges(): LocalEdge[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.edges.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows.filter((row) => !row.deletedAt);
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function useCaptures(status?: LocalCapture["status"]): LocalCapture[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.captures.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows
          .filter((row) => !row.deletedAt && (!status || row.status === status))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      },
      [db, activeWorkspaceId, status],
      [],
    ) ?? []
  );
}

export function useCapturesCount(): number {
  const captures = useCaptures("INBOX");
  return captures.length;
}

export function useTemplates(): LocalTemplate[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.templates.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows.filter((row) => !row.deletedAt);
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function useDecks(): LocalDeck[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.decks.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows.filter((row) => !row.deletedAt);
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function useFlashcards(): LocalFlashcard[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.flashcards.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows.filter((row) => !row.deletedAt);
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}

export function useDueFlashcards(): LocalFlashcard[] {
  const cards = useFlashcards();
  return useMemo(() => dueCards(cards), [cards]);
}

export function useLearningStats() {
  const cards = useFlashcards();
  const decks = useDecks();
  const { db, activeWorkspaceId, user } = useAppData();
  const logs =
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId || !user) return [];
        const rows = await db.reviewLogs.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows
          .filter((row) => row.userId === user.id)
          .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
      },
      [db, activeWorkspaceId, user?.id],
      [],
    ) ?? [];
  return useMemo(() => {
    const due = dueCards(cards);
    const mastery = masteryScore(cards);
    const reviewDays = new Set(logs.map((log: LocalReviewLog) => log.reviewedAt.slice(0, 10)));
    const cursor = new Date();
    let streak = 0;
    while (reviewDays.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    const byDeck = new Map<string, LocalFlashcard[]>();
    for (const card of cards) {
      const list = byDeck.get(card.deckId) ?? [];
      list.push(card);
      byDeck.set(card.deckId, list);
    }
    return {
      cards,
      decks,
      due,
      logs,
      streak,
      mastery,
      byDeck: [...byDeck.entries()].map(([deckId, deckCards]) => ({
        deckId,
        deck: decks.find((deck) => deck.id === deckId) ?? null,
        cards: deckCards,
        due: dueCards(deckCards).length,
        mastery: masteryScore(deckCards),
      })),
    };
  }, [cards, decks, logs]);
}

export function usePageFlashcards(pageId: string | null | undefined): LocalFlashcard[] {
  const cards = useFlashcards();
  return useMemo(
    () => (pageId ? cards.filter((card) => card.pageId === pageId) : []),
    [cards, pageId],
  );
}

export function useWorkspaceSearchIndex() {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return { pages: [], documents: [], canvases: [], captures: [] };
        const [pages, documents, canvases, captures] = await Promise.all([
          db.pages.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.pageDocuments.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.canvases.where("workspaceId").equals(activeWorkspaceId).toArray(),
          db.captures.where("workspaceId").equals(activeWorkspaceId).toArray(),
        ]);
        return {
          pages: pages.filter((page) => !page.deletedAt),
          documents,
          canvases: canvases.filter((canvas) => !canvas.deletedAt),
          captures: captures.filter((capture) => !capture.deletedAt),
        };
      },
      [db, activeWorkspaceId],
      { pages: [], documents: [], canvases: [], captures: [] },
    ) ?? { pages: [], documents: [], canvases: [], captures: [] }
  );
}

export function useTrashPages(): LocalPage[] {
  const { db, activeWorkspaceId } = useAppData();
  return (
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        const rows = await db.pages.where("workspaceId").equals(activeWorkspaceId).toArray();
        return rows
          .filter((row) => row.deletedAt)
          .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));
      },
      [db, activeWorkspaceId],
      [],
    ) ?? []
  );
}
