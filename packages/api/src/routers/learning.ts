import { randomUUID } from "node:crypto";

import {
  buildQuiz,
  createId,
  dueCards,
  extractOutline,
  generateFlashcardsFromDoc,
  knowledgeGaps,
  learningPath,
  masteryScore,
  safeDoc,
  scheduleReview,
  type Flashcard,
  type KnowledgeEdge,
  type KnowledgeNode,
  type ReviewRating,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { appendChanges, toJsonSafe, type PendingChange } from "../services/changes";
import { getAccessiblePageIds, pushSync } from "../services/sync";

export const learningRouter = {
  decks: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    return context.db.deck.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
  }),

  cards: workspaceProcedure("VIEWER")
    .input(
      z
        .object({
          deckId: z.string().optional(),
          pageId: z.string().optional(),
        })
        .optional(),
    )
    .handler(async ({ context, input }) => {
      return context.db.flashcard.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          ...(input?.deckId ? { deckId: input.deckId } : {}),
          ...(input?.pageId ? { pageId: input.pageId } : {}),
        },
        orderBy: { dueAt: "asc" },
      });
    }),

  due: workspaceProcedure("VIEWER")
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .handler(async ({ context, input }) => {
      const cards = await context.db.flashcard.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          dueAt: { lte: new Date() },
        },
        orderBy: { dueAt: "asc" },
        take: input?.limit ?? 30,
      });
      return cards;
    }),

  stats: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const cards = await context.db.flashcard.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
    });
    const logs = await context.db.reviewLog.findMany({
      where: {
        workspaceId: context.workspaceId,
        userId: context.userId,
        reviewedAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { reviewedAt: "desc" },
    });
    const due = dueCards(cards as unknown as Flashcard[]);
    const byPage = new Map<string, typeof cards>();
    for (const card of cards) {
      if (!card.pageId) continue;
      const list = byPage.get(card.pageId) ?? [];
      list.push(card);
      byPage.set(card.pageId, list);
    }
    const reviewDays = new Set(
      logs.map((log) => new Date(log.reviewedAt).toISOString().slice(0, 10)),
    );
    let streak = 0;
    const cursor = new Date();
    while (reviewDays.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return {
      totalCards: cards.length,
      dueCount: due.length,
      reviewsLast60Days: logs.length,
      streak,
      mastery: masteryScore(cards),
      masteryByPage: [...byPage.entries()].map(([pageId, pageCards]) => ({
        pageId,
        mastery: masteryScore(pageCards),
        cards: pageCards.length,
      })),
      nextDueAt: cards
        .map((card) => card.dueAt)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
    };
  }),

  generate: workspaceProcedure("EDITOR")
    .input(
      z.object({
        pageId: z.string().min(1),
        deckId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      if (allowed && !allowed.has(input.pageId)) throw new ORPCError("FORBIDDEN");
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: { document: true },
      });
      if (!page?.document) throw new ORPCError("NOT_FOUND");
      const generated = generateFlashcardsFromDoc(safeDoc(page.document.content));
      if (!generated.length) {
        return { cards: [], created: 0, deckId: null };
      }

      const result = await context.db.$transaction(async (tx) => {
        let deckId = input.deckId ?? null;
        if (deckId) {
          const deck = await tx.deck.findFirst({
            where: { id: deckId, workspaceId: context.workspaceId, deletedAt: null },
          });
          if (!deck) throw new ORPCError("NOT_FOUND", { message: "Deck not found" });
        } else {
          const existing = await tx.deck.findFirst({
            where: {
              workspaceId: context.workspaceId,
              name: "Daily review",
              deletedAt: null,
            },
          });
          if (existing) {
            deckId = existing.id;
          } else {
            const created = await tx.deck.create({
              data: {
                id: createId(),
                workspaceId: context.workspaceId,
                name: "Daily review",
                description: "Cards generated from your notes",
                color: "#2f6b4f",
              },
            });
            deckId = created.id;
          }
        }
        const existingCards = await tx.flashcard.findMany({
          where: {
            workspaceId: context.workspaceId,
            pageId: page.id,
            deletedAt: null,
          },
          select: { front: true },
        });
        const existingFronts = new Set(existingCards.map((card) => card.front.toLowerCase()));
        const changes: PendingChange[] = [];
        const cards = [];
        for (const card of generated) {
          if (existingFronts.has(card.front.toLowerCase())) continue;
          const created = await tx.flashcard.create({
            data: {
              id: createId(),
              workspaceId: context.workspaceId,
              deckId,
              pageId: page.id,
              blockId: card.blockId ?? null,
              front: card.front,
              back: card.back,
              source: "NOTE",
              dueAt: new Date(),
            },
          });
          cards.push(created);
          changes.push({
            entity: "flashcard",
            entityId: created.id,
            op: "UPSERT",
            data: toJsonSafe(created),
          });
        }
        await appendChanges(tx, context.workspaceId, context.userId, changes);
        return { cards, deckId };
      });
      return { cards: result.cards, created: result.cards.length, deckId: result.deckId };
    }),

  createCard: workspaceProcedure("EDITOR")
    .input(
      z.object({
        deckId: z.string().nullable().optional(),
        pageId: z.string().nullable().optional(),
        front: z.string().trim().min(1).max(2000),
        back: z.string().trim().min(1).max(4000),
        hint: z.string().max(500).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      let deckId = input.deckId ?? null;
      if (!deckId) {
        const existing = await context.db.deck.findFirst({
          where: { workspaceId: context.workspaceId, name: "Daily review", deletedAt: null },
        });
        deckId =
          existing?.id ??
          (
            await context.db.deck.create({
              data: {
                id: createId(),
                workspaceId: context.workspaceId,
                name: "Daily review",
                color: "#2f6b4f",
              },
            })
          ).id;
      }
      const cardId = createId();
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-card-${cardId}`,
            entity: "flashcard",
            entityId: cardId,
            op: "UPSERT",
            payload: {
              deckId,
              pageId: input.pageId ?? null,
              front: input.front,
              back: input.back,
              hint: input.hint ?? null,
              source: "MANUAL",
              dueAt: new Date().toISOString(),
            },
          },
        ],
      });
      return context.db.flashcard.findUnique({ where: { id: cardId } });
    }),

  updateCard: workspaceProcedure("EDITOR")
    .input(
      z.object({
        flashcardId: z.string().min(1),
        front: z.string().trim().min(1).max(2000).optional(),
        back: z.string().trim().min(1).max(4000).optional(),
        hint: z.string().max(500).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const card = await context.db.flashcard.findFirst({
        where: {
          id: input.flashcardId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!card) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-card-update-${randomUUID()}`,
            entity: "flashcard",
            entityId: card.id,
            op: "UPSERT",
            payload: {
              ...(input.front !== undefined ? { front: input.front } : {}),
              ...(input.back !== undefined ? { back: input.back } : {}),
              ...(input.hint !== undefined ? { hint: input.hint } : {}),
            },
          },
        ],
      });
      return context.db.flashcard.findUnique({ where: { id: card.id } });
    }),

  removeCard: workspaceProcedure("EDITOR")
    .input(z.object({ flashcardId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const card = await context.db.flashcard.findFirst({
        where: {
          id: input.flashcardId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!card) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-card-delete-${randomUUID()}`,
            entity: "flashcard",
            entityId: card.id,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),

  review: workspaceProcedure("EDITOR")
    .input(
      z.object({
        flashcardId: z.string().min(1),
        rating: z.number().int().min(1).max(4),
      }),
    )
    .handler(async ({ context, input }) => {
      const card = await context.db.flashcard.findFirst({
        where: {
          id: input.flashcardId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!card) throw new ORPCError("NOT_FOUND");
      const schedule = scheduleReview(card, input.rating as ReviewRating);
      const updated = await context.db.$transaction(async (tx) => {
        const result = await tx.flashcard.update({
          where: { id: card.id },
          data: {
            interval: schedule.interval,
            ease: schedule.ease,
            reps: schedule.reps,
            lapses: schedule.lapses,
            dueAt: new Date(schedule.dueAt),
            lastReviewedAt: new Date(),
          },
        });
        await tx.reviewLog.create({
          data: {
            id: createId(),
            workspaceId: context.workspaceId,
            flashcardId: card.id,
            userId: context.userId,
            rating: input.rating,
            previousDueAt: card.dueAt,
            nextDueAt: new Date(schedule.dueAt),
            interval: schedule.interval,
          },
        });
        await appendChanges(tx, context.workspaceId, context.userId, [
          {
            entity: "flashcard",
            entityId: result.id,
            op: "UPSERT",
            data: toJsonSafe(result),
          },
        ]);
        return result;
      });
      return { card: updated, schedule };
    }),

  quiz: workspaceProcedure("VIEWER")
    .input(
      z.object({
        deckId: z.string().optional(),
        pageId: z.string().optional(),
        count: z.number().int().min(1).max(30).default(8),
      }),
    )
    .handler(async ({ context, input }) => {
      const cards = await context.db.flashcard.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          ...(input.deckId ? { deckId: input.deckId } : {}),
          ...(input.pageId ? { pageId: input.pageId } : {}),
        },
      });
      return buildQuiz(cards, input.count);
    }),

  paths: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const [nodes, edges, cards] = await Promise.all([
      context.db.knowledgeNode.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
      }),
      context.db.knowledgeEdge.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
      }),
      context.db.flashcard.findMany({
        where: { workspaceId: context.workspaceId, deletedAt: null },
      }),
    ]);
    const mastery = new Map<string, number>();
    const byPage = new Map<string, typeof cards>();
    for (const card of cards) {
      if (!card.pageId) continue;
      const list = byPage.get(card.pageId) ?? [];
      list.push(card);
      byPage.set(card.pageId, list);
    }
    for (const [pageId, pageCards] of byPage) {
      mastery.set(pageId, masteryScore(pageCards));
    }
    return {
      path: learningPath(
        nodes as unknown as KnowledgeNode[],
        edges as unknown as KnowledgeEdge[],
        mastery,
      ),
      gaps: knowledgeGaps(
        nodes as unknown as KnowledgeNode[],
        edges as unknown as KnowledgeEdge[],
        mastery,
      ),
    };
  }),

  outline: workspaceProcedure("VIEWER")
    .input(z.object({ pageId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: { document: true },
      });
      if (!page) throw new ORPCError("NOT_FOUND");
      return extractOutline(safeDoc(page.document?.content));
    }),
};
