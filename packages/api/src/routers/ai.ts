import { randomUUID } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { Prisma } from "@notes-learning/db";
import {
  AGENT_LIMITS,
  appendTranscript,
  createId,
  embeddingSource,
  extractOutline,
  generateFlashcardsFromDoc,
  hasRole,
  knowledgeGaps,
  masteryScore,
  relatedDocuments,
  safeDoc,
  tokenize,
  type AgentPlan,
  type AiCitation,
  type KnowledgeEdge,
  type KnowledgeNode,
  type Role,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { runAgent } from "../ai/agent";
import {
  aiEnabled,
  auxEnabled,
  chatCompletion,
  embedTexts,
  localAnswer,
  streamChatCompletion,
  transcribeAudio,
  type ChatMessage,
} from "../ai/provider";
import type { Context } from "../context";
import { aiWorkspaceProcedure } from "../index";
import { getAccessiblePageIds, pushSync } from "../services/sync";
import {
  citationsFrom,
  contextBlock,
  retrievePages,
  retrieveSemantic,
  type RetrievedPage,
} from "../services/retrieval";

const SYSTEM_PROMPT =
  "You are Lattice, a calm, precise knowledge assistant. Answer using the supplied notes. Cite sources as [1], [2] matching the order provided. If the notes do not support an answer, say what is missing. Do not invent facts. Keep responses compact and useful. Never claim to have modified the user's notes.";

async function saveThreadMessage(
  db: Database,
  input: {
    workspaceId: string;
    userId: string;
    threadId?: string | null;
    question: string;
    answer: string;
    citations: AiCitation[];
    provider: string;
  },
): Promise<string> {
  let threadId = input.threadId ?? null;
  if (threadId) {
    const thread = await db.aiThread.findFirst({
      where: { id: threadId, workspaceId: input.workspaceId, userId: input.userId },
    });
    if (!thread) throw new ORPCError("NOT_FOUND", { message: "AI thread not found" });
  } else {
    const thread = await db.aiThread.create({
      data: {
        id: createId(),
        workspaceId: input.workspaceId,
        userId: input.userId,
        title: input.question.slice(0, 120),
      },
    });
    threadId = thread.id;
  }
  await db.aiMessage.createMany({
    data: [
      {
        id: createId(),
        threadId,
        role: "user",
        content: input.question,
        citations: [],
      },
      {
        id: createId(),
        threadId,
        role: "assistant",
        content: input.answer,
        citations: input.citations as never,
        provider: input.provider,
      },
    ],
  });
  return threadId;
}

interface AiWorkspaceContext extends Context {
  workspaceId: string;
  userId: string;
  role: Role;
}

/**
 * Retrieval plus the prompt, shared by `ask` and `askStream` so citations and
 * provider selection cannot drift between the streaming and buffered paths.
 */
async function prepareAnswer(
  context: AiWorkspaceContext,
  input: {
    question: string;
    scope?: { notebookId?: string | null; pageIds?: string[] };
  },
): Promise<{ citations: AiCitation[]; messages: ChatMessage[] }> {
  let pages: RetrievedPage[] | null = null;
  if (auxEnabled(context)) {
    pages = await retrieveSemantic(
      context.db,
      context.aiAux,
      context.workspaceId,
      context.userId,
      context.role,
      input.question,
      input.scope,
    );
  }
  if (!pages) {
    pages = await retrievePages(
      context.db,
      context.workspaceId,
      context.userId,
      context.role,
      input.question,
      input.scope,
    );
  }
  return {
    citations: citationsFrom(pages),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Question: ${input.question}\n\nNotes:\n${contextBlock(pages)}`,
      },
    ],
  };
}

const askInput = z.object({
  question: z.string().trim().min(2).max(4000),
  scope: z
    .object({
      notebookId: z.string().nullable().optional(),
      pageIds: z.array(z.string()).max(50).optional(),
    })
    .optional(),
  threadId: z.string().nullable().optional(),
});

const agentInput = z.object({
  question: z.string().trim().min(2).max(4000),
  pageId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
});

export const aiRouter = {
  status: aiWorkspaceProcedure("VIEWER").handler(({ context }) => {
    const enabled = aiEnabled(context);
    return {
      enabled,
      mode: context.ai?.auth === "chatgpt" ? "chatgpt" : enabled ? "provider" : "local",
      model: context.ai?.model ?? null,
      source: context.aiSource ?? "none",
      chatgpt: context.aiChatGpt ?? null,
      degradedReason: context.aiDegradedReason ?? null,
      agent: {
        enabled: Boolean(context.aiAgent?.enabled),
        canApply: hasRole(context.role, "EDITOR"),
        maxSteps: AGENT_LIMITS.maxSteps,
        maxOps: AGENT_LIMITS.maxOps,
      },
    };
  }),

  embeddingStatus: aiWorkspaceProcedure("VIEWER").handler(async ({ context }) => {
    const [count, latest] = await Promise.all([
      context.db.pageEmbedding.count({ where: { workspaceId: context.workspaceId } }),
      context.db.pageEmbedding.findFirst({
        where: { workspaceId: context.workspaceId },
        select: { model: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      }),
    ]);
    return {
      enabled: auxEnabled(context),
      model: latest?.model ?? context.aiAux?.embeddingModel ?? "text-embedding-3-small",
      count,
      lastIndexedAt: latest?.updatedAt.toISOString() ?? null,
    };
  }),

  reindex: aiWorkspaceProcedure("EDITOR").handler(async ({ context }) => {
    if (!auxEnabled(context)) {
      return {
        ok: false as const,
        indexed: 0,
        skipped: 0,
        reason: aiEnabled(context)
          ? "ChatGPT plan usage can't create embeddings. Add a workspace API key to build the semantic index."
          : "Semantic search needs an AI provider with an embeddings endpoint.",
      };
    }
    const allowed = await getAccessiblePageIds(
      context.db,
      context.workspaceId,
      context.userId,
      context.role,
    );
    const pages = await context.db.page.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: null,
        ...(allowed ? { id: { in: [...allowed] } } : {}),
      },
      include: { document: true },
    });
    const indexable = pages.filter(
      (page) => page.document && (page.document.plainText.trim() || page.title.trim()),
    );
    const model = context.aiAux.embeddingModel ?? "text-embedding-3-small";
    let indexed = 0;
    const batchSize = 32;
    for (let offset = 0; offset < indexable.length; offset += batchSize) {
      const batch = indexable.slice(offset, offset + batchSize);
      const vectors = await embedTexts(
        context.aiAux,
        batch.map((page) => embeddingSource(page.title, page.document?.plainText ?? "")),
      );
      if (!vectors) {
        return {
          ok: false as const,
          indexed,
          skipped: pages.length - indexable.length,
          reason: "The embedding provider did not respond.",
        };
      }
      await context.db.$transaction(
        batch.map((page, index) => {
          const vector = vectors[index] ?? [];
          return context.db.pageEmbedding.upsert({
            where: { pageId: page.id },
            create: {
              pageId: page.id,
              workspaceId: context.workspaceId,
              model,
              dimensions: vector.length,
              vector: vector as Prisma.InputJsonValue,
            },
            update: {
              model,
              dimensions: vector.length,
              vector: vector as Prisma.InputJsonValue,
            },
          });
        }),
      );
      indexed += batch.length;
    }
    const keep = new Set(indexable.map((page) => page.id));
    const existing = await context.db.pageEmbedding.findMany({
      where: { workspaceId: context.workspaceId },
      select: { pageId: true },
    });
    const stale = existing.map((row) => row.pageId).filter((pageId) => !keep.has(pageId));
    if (stale.length) {
      await context.db.pageEmbedding.deleteMany({
        where: { workspaceId: context.workspaceId, pageId: { in: stale } },
      });
    }
    return {
      ok: true as const,
      indexed,
      skipped: pages.length - indexable.length,
      model,
    };
  }),

  threads: aiWorkspaceProcedure("VIEWER").handler(async ({ context }) => {
    return context.db.aiThread.findMany({
      where: {
        workspaceId: context.workspaceId,
        userId: context.userId,
        deletedAt: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });
  }),

  thread: aiWorkspaceProcedure("VIEWER")
    .input(z.object({ threadId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const thread = await context.db.aiThread.findFirst({
        where: {
          id: input.threadId,
          workspaceId: context.workspaceId,
          userId: context.userId,
        },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!thread) throw new ORPCError("NOT_FOUND");
      return thread;
    }),

  ask: aiWorkspaceProcedure("VIEWER")
    .input(askInput)
    .handler(async ({ context, input }) => {
      const { citations, messages } = await prepareAnswer(context, input);
      let answer = "";
      let provider = aiEnabled(context) ? context.ai.model : "local";
      let warning: { code: string; message: string } | null = null;

      if (aiEnabled(context)) {
        const result = await chatCompletion(context.ai, messages);
        if (result.ok) {
          answer = result.content;
          provider = result.provider;
        } else {
          // Never retry on another billing path: report the failure and answer locally.
          warning = { code: result.code, message: result.message };
        }
      }
      if (!answer) {
        answer = localAnswer(input.question, citations);
        provider = "local";
      }
      const threadId = await saveThreadMessage(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        threadId: input.threadId,
        question: input.question,
        answer,
        citations,
        provider,
      });
      return { answer, citations, provider, threadId, local: provider === "local", warning };
    }),

  askStream: aiWorkspaceProcedure("VIEWER")
    .input(askInput)
    .handler(async function* ({ context, input, signal }) {
      const { citations, messages } = await prepareAnswer(context, input);
      yield { type: "citations" as const, citations };

      let answer = "";
      let provider = aiEnabled(context) ? context.ai.model : "local";
      let warning: { code: string; message: string } | null = null;

      if (aiEnabled(context)) {
        for await (const event of streamChatCompletion(
          context.ai,
          messages,
          signal ?? undefined,
        )) {
          if (event.type === "delta") {
            answer += event.text;
            yield { type: "delta" as const, text: event.text };
          } else if (event.type === "done") {
            provider = event.provider;
          } else {
            warning = { code: event.code, message: event.message };
          }
        }
      }

      if (!answer.trim()) {
        answer = localAnswer(input.question, citations);
        provider = "local";
        yield { type: "delta" as const, text: answer };
      }

      const threadId = await saveThreadMessage(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        threadId: input.threadId,
        question: input.question,
        answer,
        citations,
        provider,
      });
      yield {
        type: "done" as const,
        threadId,
        provider,
        citations,
        local: provider === "local",
        warning,
      };
    }),

  agentStream: aiWorkspaceProcedure("VIEWER")
    .input(agentInput)
    .handler(async function* ({ context, input, signal }) {
      if (!context.aiAgent?.enabled) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Plan mode is not enabled on this server.",
        });
      }
      if (!aiEnabled(context)) {
        const text =
          "Plan mode needs an AI provider. Connect a ChatGPT plan or set AI_API_KEY on the server.";
        yield { type: "delta" as const, text };
        const threadId = await saveThreadMessage(context.db, {
          workspaceId: context.workspaceId,
          userId: context.userId,
          threadId: input.threadId,
          question: input.question,
          answer: text,
          citations: [],
          provider: "local",
        });
        yield {
          type: "done" as const,
          threadId,
          answer: text,
          provider: "local",
          plan: null,
          warnings: [],
          local: true,
        };
        return;
      }

      let answer = "";
      let provider = context.ai.model;
      let plan: AgentPlan | null = null;
      let warnings: string[] = [];

      for await (const event of runAgent({
        db: context.db,
        workspaceId: context.workspaceId,
        userId: context.userId,
        role: context.role,
        ai: context.ai,
        question: input.question,
        pageId: input.pageId ?? null,
        ...(signal ? { signal } : {}),
      })) {
        if (event.type === "step") {
          yield { type: "step" as const, label: event.label };
          continue;
        }
        if (event.type === "answer") {
          answer = event.text;
          yield { type: "delta" as const, text: event.text };
          continue;
        }
        if (event.type === "plan") {
          plan = event.plan;
          warnings = event.warnings;
          yield { type: "plan" as const, plan: event.plan, warnings: event.warnings };
          continue;
        }
        if (event.type === "error") {
          yield { type: "error" as const, code: event.code, message: event.message };
          return;
        }
        answer = event.answer;
        provider = event.provider;
        plan = event.plan;
        warnings = event.warnings;
      }

      const threadId = await saveThreadMessage(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        threadId: input.threadId,
        question: input.question,
        answer,
        citations: [],
        provider,
      });
      yield {
        type: "done" as const,
        threadId,
        answer,
        provider,
        plan,
        warnings,
        local: provider === "local",
      };
    }),

  transcribe: aiWorkspaceProcedure("EDITOR")
    .input(z.object({ captureId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      if (!auxEnabled(context)) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: aiEnabled(context)
            ? "ChatGPT plan usage can't transcribe audio. Add a workspace API key with a transcription model."
            : "Transcription needs an AI provider. Set AI_API_KEY on the server.",
        });
      }
      if (!context.uploads) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Uploads are not available on this server.",
        });
      }
      const capture = await context.db.capture.findFirst({
        where: { id: input.captureId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!capture) throw new ORPCError("NOT_FOUND");
      if (capture.type !== "AUDIO") {
        throw new ORPCError("BAD_REQUEST", { message: "Only audio captures can be transcribed." });
      }
      if (!capture.url) {
        throw new ORPCError("BAD_REQUEST", { message: "This capture has no audio file." });
      }
      const upload = await context.uploads.read(capture.url);
      if (!upload) {
        throw new ORPCError("NOT_FOUND", { message: "The audio file could not be read." });
      }
      if (upload.bytes.byteLength > 25 * 1024 * 1024) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Audio files up to 25 MB can be transcribed.",
        });
      }
      const text = await transcribeAudio(context.aiAux, upload);
      if (!text) {
        throw new ORPCError("BAD_GATEWAY", {
          message: "The transcription provider did not return text.",
        });
      }
      const content = appendTranscript(capture.content, text);
      const metadata = {
        ...(capture.metadata as Record<string, unknown>),
        transcribedAt: new Date().toISOString(),
        transcribeModel: context.aiAux.transcribeModel ?? "whisper-1",
      };
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `transcribe-${capture.id}-${randomUUID()}`,
            entity: "capture",
            entityId: capture.id,
            op: "UPSERT",
            payload: { content, metadata },
          },
        ],
      });
      return { text, content };
    }),

  pageAction: aiWorkspaceProcedure("VIEWER")
    .input(
      z.object({
        pageId: z.string().min(1),
        action: z.enum([
          "summarize",
          "explain",
          "compare",
          "connections",
          "flashcards",
          "mindmap",
          "gaps",
          "outdated",
          "examples",
        ]),
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
      const body = page.document.plainText;

      if (input.action === "connections") {
        const pages = await context.db.page.findMany({
          where: {
            workspaceId: context.workspaceId,
            deletedAt: null,
            ...(allowed ? { id: { in: [...allowed] } } : {}),
          },
        });
        const documents = await context.db.pageDocument.findMany({
          where: { workspaceId: context.workspaceId, pageId: { in: pages.map((entry) => entry.id) } },
        });
        const documentByPage = new Map(
          documents.map((document) => [document.pageId, document.plainText]),
        );
        const related = relatedDocuments(
          { id: page.id, title: page.title, body },
          pages.map((entry) => ({
            id: entry.id,
            title: entry.title,
            body: documentByPage.get(entry.id) ?? "",
          })),
          6,
        );
        const edges = await context.db.knowledgeEdge.findMany({
          where: {
            workspaceId: context.workspaceId,
            sourceNodeId: page.id,
            deletedAt: null,
          },
        });
        const linked = new Set(edges.map((edge) => edge.targetNodeId));
        return {
          action: input.action,
          suggestions: related
            .filter((entry) => !linked.has(entry.id))
            .map((entry) => ({
              pageId: entry.id,
              title: entry.title,
              score: Math.round(entry.score * 100) / 100,
              reason: "Shared language and concepts",
            })),
          local: true,
        };
      }

      if (input.action === "flashcards") {
        return {
          action: input.action,
          cards: generateFlashcardsFromDoc(safeDoc(page.document.content)),
          local: true,
        };
      }

      if (input.action === "mindmap") {
        return {
          action: input.action,
          title: page.title,
          outline: extractOutline(safeDoc(page.document.content)),
          local: true,
        };
      }

      if (input.action === "gaps") {
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
          action: input.action,
          gaps: knowledgeGaps(
            nodes as unknown as KnowledgeNode[],
            edges as unknown as KnowledgeEdge[],
            mastery,
          ).map((node) => ({
            id: node.id,
            title: node.title,
            kind: node.kind,
            mastery: mastery.get(node.id) ?? 0,
          })),
          local: true,
        };
      }

      if (input.action === "outdated") {
        const pages = await context.db.page.findMany({
          where: {
            workspaceId: context.workspaceId,
            deletedAt: null,
            ...(allowed ? { id: { in: [...allowed] } } : {}),
          },
          include: { document: true },
        });
        return {
          action: input.action,
          pages: pages
            .filter(
              (entry) =>
                Date.now() - entry.updatedAt.getTime() > 180 * 24 * 60 * 60 * 1000 ||
                /\b(TODO|FIXME|TBD)\b/.test(entry.document?.plainText ?? ""),
            )
            .slice(0, 12)
            .map((entry) => ({
              id: entry.id,
              title: entry.title,
              updatedAt: entry.updatedAt.toISOString(),
              reason:
                Date.now() - entry.updatedAt.getTime() > 180 * 24 * 60 * 60 * 1000
                  ? "Not updated in six months"
                  : "Contains an unresolved TODO",
            })),
          local: true,
        };
      }

      if (input.action === "compare") {
        const pages = await context.db.page.findMany({
          where: {
            workspaceId: context.workspaceId,
            deletedAt: null,
            ...(allowed ? { id: { in: [...allowed] } } : {}),
          },
          include: { document: true },
        });
        const related = relatedDocuments(
          { id: page.id, title: page.title, body },
          pages
            .filter((entry) => entry.id !== page.id)
            .map((entry) => ({
              id: entry.id,
              title: entry.title,
              body: entry.document?.plainText ?? "",
            })),
          3,
        ).filter((entry) => entry.score > 0.05);
        const sourceTerms = new Set(
          tokenize(`${page.title} ${body}`).filter((term) => term.length > 3),
        );
        const lines = related.length
          ? related.map((entry) => {
              const shared = [
                ...new Set(
                  tokenize(`${entry.title} ${entry.body}`).filter(
                    (term) => term.length > 3 && sourceTerms.has(term),
                  ),
                ),
              ].slice(0, 6);
              return `- **${entry.title}** — ${Math.round(entry.score * 100)}% shared language${
                shared.length ? `: ${shared.join(", ")}` : ""
              }`;
            })
          : ["- No closely related notes yet. Link a few pages, then compare again."];
        return {
          action: input.action,
          answer: `**Local mode — comparing “${page.title}” with ${related.length} related note${
            related.length === 1 ? "" : "s"
          }**\n\n${lines.join("\n")}\n\nOpen the notes side by side to trace where they agree and where they diverge.`,
          provider: "local",
          citations: related.map((entry) => ({
            pageId: entry.id,
            title: entry.title,
            excerpt: entry.body.slice(0, 500),
          })),
          local: true,
        };
      }

      let answer = "";
      let provider = "local";
      if (aiEnabled(context)) {
        const related = await retrievePages(
          context.db,
          context.workspaceId,
          context.userId,
          context.role,
          page.title,
          { pageIds: [page.id] },
          3,
        );
        const prompt =
          input.action === "summarize"
            ? "Summarize the page in 5 concise bullets, preserving nuance."
            : input.action === "explain"
              ? "Explain the page as if teaching a smart peer. Use a concrete example."
              : "Give two additional concrete examples that fit this note.";
        const result = await chatCompletion(context.ai, [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${prompt}\n\nPage: ${page.title}\n\n${contextBlock(related.length ? related : [{ pageId: page.id, title: page.title, body, score: 1, excerpt: body.slice(0, 700), updatedAt: page.updatedAt.toISOString() }])}`,
          },
        ]);
        if (result.ok) {
          answer = result.content;
          provider = result.provider;
        }
      }
      if (!answer) {
        answer =
          input.action === "summarize"
            ? `**Local summary**\n\n${body.slice(0, 1200) || "This page is empty."}`
            : input.action === "explain"
              ? `**Local mode**\n\n${body.slice(0, 900) || "This page is empty."}\n\nAdd an AI provider for a richer explanation and example.`
              : `**Local mode**\n\nAdd an AI provider to generate examples from “${page.title}”.`;
      }
      return {
        action: input.action,
        answer,
        provider,
        citations: [{ pageId: page.id, title: page.title, excerpt: body.slice(0, 500) }],
        local: provider === "local",
      };
    }),
};
