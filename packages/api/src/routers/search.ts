import { rankRecords, type SearchableRecord } from "@notes-learning/domain";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { getAccessiblePageIds } from "../services/sync";

function canvasText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const elements = (data as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return "";
  return elements
    .map((element) => {
      if (typeof element !== "object" || element === null) return "";
      const record = element as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.title === "string") return record.title;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export const searchRouter = {
  query: workspaceProcedure("VIEWER")
    .input(
      z.object({
        query: z.string().trim().max(300),
        limit: z.number().int().min(1).max(100).default(40),
        types: z
          .array(z.enum(["page", "canvas", "capture", "flashcard"]))
          .optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!input.query) return [];
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      const [pages, documents, canvases, captures, flashcards, tags, pageTags] =
        await Promise.all([
          context.db.page.findMany({
            where: {
              workspaceId: context.workspaceId,
              deletedAt: null,
              ...(allowed ? { id: { in: [...allowed] } } : {}),
            },
          }),
          context.db.pageDocument.findMany({
            where: {
              workspaceId: context.workspaceId,
              ...(allowed ? { pageId: { in: [...allowed] } } : {}),
            },
          }),
          context.db.canvas.findMany({
            where: { workspaceId: context.workspaceId, deletedAt: null },
          }),
          context.db.capture.findMany({
            where: { workspaceId: context.workspaceId, deletedAt: null },
          }),
          context.db.flashcard.findMany({
            where: { workspaceId: context.workspaceId, deletedAt: null },
          }),
          context.db.tag.findMany({
            where: { workspaceId: context.workspaceId, deletedAt: null },
          }),
          context.db.pageTag.findMany({
            where: { page: { workspaceId: context.workspaceId } },
          }),
        ]);
      const tagById = new Map(tags.map((tag) => [tag.id, tag.name]));
      const tagsByPage = new Map<string, string[]>();
      for (const pageTag of pageTags) {
        const name = tagById.get(pageTag.tagId);
        if (!name) continue;
        const list = tagsByPage.get(pageTag.pageId) ?? [];
        list.push(name);
        tagsByPage.set(pageTag.pageId, list);
      }
      const documentByPage = new Map(
        documents.map((document) => [document.pageId, document.plainText]),
      );
      const records: SearchableRecord[] = [];
      if (!input.types || input.types.includes("page")) {
        for (const page of pages) {
          records.push({
            type: "page",
            id: page.id,
            workspaceId: page.workspaceId,
            title: page.title,
            body: documentByPage.get(page.id) ?? "",
            tags: tagsByPage.get(page.id),
            icon: page.icon,
            updatedAt: page.updatedAt.toISOString(),
          });
        }
      }
      if (!input.types || input.types.includes("canvas")) {
        for (const canvas of canvases) {
          records.push({
            type: "canvas",
            id: canvas.id,
            workspaceId: canvas.workspaceId,
            title: canvas.title,
            body: canvasText(canvas.data),
            icon: canvas.icon,
            updatedAt: canvas.updatedAt.toISOString(),
          });
        }
      }
      if (!input.types || input.types.includes("capture")) {
        for (const capture of captures) {
          if (allowed && typeof capture.metadata === "object" && capture.metadata) {
            const pageId = (capture.metadata as Record<string, unknown>).pageId;
            if (typeof pageId === "string" && !allowed.has(pageId)) continue;
          }
          records.push({
            type: "capture",
            id: capture.id,
            workspaceId: capture.workspaceId,
            title: capture.title || capture.url || "Capture",
            body: `${capture.content ?? ""} ${capture.url ?? ""}`,
            icon: "⌁",
            updatedAt: capture.updatedAt.toISOString(),
          });
        }
      }
      if (!input.types || input.types.includes("flashcard")) {
        for (const card of flashcards) {
          if (allowed && card.pageId && !allowed.has(card.pageId)) continue;
          records.push({
            type: "flashcard",
            id: card.id,
            workspaceId: card.workspaceId,
            title: card.front,
            body: card.back,
            icon: "◒",
            updatedAt: card.updatedAt.toISOString(),
          });
        }
      }
      return rankRecords(records, input.query, input.limit);
    }),
};
