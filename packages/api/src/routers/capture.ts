import { randomUUID } from "node:crypto";

import {
  appendSection,
  createId,
  docFromText,
  extractPlainText,
  OutboundError,
  suggestTagNames,
  type TipTapDoc,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { extractText } from "unpdf";
import { z } from "zod";

import { workspaceProcedure } from "../index";
import { outbound } from "../services/outbound";
import { getAccessiblePageIds } from "../services/page-access";
import { searchWorkspace } from "../services/search";
import { pushSync } from "../services/sync";

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, property: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return null;
}

async function urlPreview(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid URL" });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ORPCError("BAD_REQUEST", { message: "Only http and https URLs are supported" });
  }
  let response: Response | null = null;
  try {
    response = await outbound.fetch(
      url,
      {
        headers: {
          "user-agent": "LatticeBot/1.0 (+https://lattice.local)",
          accept: "text/html,application/xhtml+xml",
        },
      },
      { allowHttp: true, timeoutMs: 6_000 },
    );
  } catch (error) {
    if (error instanceof OutboundError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
  }
  if (!response) {
    return { url: url.toString(), title: url.hostname, description: "", image: null, siteName: url.hostname };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) {
    return { url: url.toString(), title: url.pathname.split("/").pop() || url.hostname, description: "", image: null, siteName: url.hostname };
  }
  const html = (await response.text()).slice(0, 250_000);
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    (titleMatch?.[1] ? decodeEntities(titleMatch[1].trim()) : url.hostname);
  const description =
    metaContent(html, "og:description") ??
    metaContent(html, "description") ??
    metaContent(html, "twitter:description") ??
    "";
  const image = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  const siteName = metaContent(html, "og:site_name") ?? url.hostname;
  return { url: url.toString(), title: title.slice(0, 300), description: description.slice(0, 2000), image, siteName };
}

export const captureRouter = {
  list: workspaceProcedure("VIEWER")
    .input(
      z
        .object({
          status: z.enum(["INBOX", "ORGANIZED", "ARCHIVED"]).optional(),
          type: z.string().optional(),
        })
        .optional(),
    )
    .handler(async ({ context, input }) => {
      return context.db.capture.findMany({
        where: {
          workspaceId: context.workspaceId,
          deletedAt: null,
          ...(input?.status ? { status: input.status } : {}),
          ...(input?.type ? { type: input.type } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: workspaceProcedure("EDITOR")
    .input(
      z.object({
        type: z
          .enum(["NOTE", "BOOKMARK", "CLIP", "PDF", "IMAGE", "AUDIO", "VIDEO", "YOUTUBE", "TEXT", "EMAIL", "FILE"])
          .default("NOTE"),
        title: z.string().trim().max(300).default(""),
        content: z.string().max(2_000_000).nullable().optional(),
        url: z.string().max(4000).nullable().optional(),
        source: z.string().max(200).nullable().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
        previewUrl: z.boolean().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      let metadata = input.metadata ?? {};
      let title = input.title;
      if (input.previewUrl && input.url) {
        const preview = await urlPreview(input.url);
        metadata = { ...metadata, preview };
        title = title || preview.title;
      }
      const captureId = createId();
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-capture-${captureId}`,
            entity: "capture",
            entityId: captureId,
            op: "UPSERT",
            payload: {
              type: input.type,
              title: title || input.url || "Quick capture",
              content: input.content ?? null,
              url: input.url ?? null,
              source: input.source ?? null,
              status: "INBOX",
              metadata,
            },
          },
        ],
      });
      return context.db.capture.findUnique({ where: { id: captureId } });
    }),

  update: workspaceProcedure("EDITOR")
    .input(
      z.object({
        captureId: z.string().min(1),
        title: z.string().trim().max(300).optional(),
        content: z.string().max(2_000_000).nullable().optional(),
        status: z.enum(["INBOX", "ORGANIZED", "ARCHIVED"]).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const existing = await context.db.capture.findFirst({
        where: {
          id: input.captureId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!existing) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-capture-update-${randomUUID()}`,
            entity: "capture",
            entityId: input.captureId,
            op: "UPSERT",
            payload: {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.content !== undefined ? { content: input.content } : {}),
              ...(input.status !== undefined ? { status: input.status } : {}),
              ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
            },
          },
        ],
      });
      return context.db.capture.findUnique({ where: { id: input.captureId } });
    }),

  remove: workspaceProcedure("EDITOR")
    .input(z.object({ captureId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const existing = await context.db.capture.findFirst({
        where: {
          id: input.captureId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!existing) throw new ORPCError("NOT_FOUND");
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-capture-delete-${randomUUID()}`,
            entity: "capture",
            entityId: input.captureId,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      return { ok: true };
    }),

  organize: workspaceProcedure("EDITOR")
    .input(
      z.object({
        captureId: z.string().min(1),
        notebookId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const capture = await context.db.capture.findFirst({
        where: {
          id: input.captureId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!capture) throw new ORPCError("NOT_FOUND");
      const body = [capture.content, capture.url].filter(Boolean).join("\n\n");
      const doc: TipTapDoc = {
        type: "doc",
        content: [
          ...docFromText(body || capture.title).content,
          ...(capture.url
            ? [
                {
                  type: "bookmark",
                  attrs: { url: capture.url, title: capture.title || capture.url },
                },
              ]
            : []),
        ],
      };
      const pageId = createId();
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-capture-page-${pageId}`,
            entity: "page",
            entityId: pageId,
            op: "UPSERT",
            payload: {
              title: capture.title || "Captured note",
              icon: capture.type === "BOOKMARK" ? "⌘" : "◇",
              notebookId: input.notebookId ?? null,
              visibility: "WORKSPACE",
              type: "DOCUMENT",
            },
          },
          {
            opId: `api-capture-doc-${pageId}`,
            entity: "pageDocument",
            entityId: pageId,
            op: "UPSERT",
            baseRev: 0,
            payload: {
              content: doc,
              plainText: extractPlainText(doc),
              schemaVersion: 1,
              source: "write",
            },
          },
          {
            opId: `api-capture-organize-${randomUUID()}`,
            entity: "capture",
            entityId: capture.id,
            op: "UPSERT",
            payload: {
              status: "ORGANIZED",
              metadata: { ...(capture.metadata as Record<string, unknown>), pageId },
            },
          },
        ],
      });
      const page = await context.db.page.findUnique({
        where: { id: pageId },
        include: { document: true },
      });
      if (!page) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return page;
    }),

  suggest: workspaceProcedure("VIEWER")
    .input(z.object({ captureId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const capture = await context.db.capture.findFirst({
        where: {
          id: input.captureId,
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      if (!capture) throw new ORPCError("NOT_FOUND");
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      const text = `${capture.title} ${capture.content ?? ""}`.slice(0, 2_000);
      const tags = suggestTagNames(text);
      const hits = await searchWorkspace(context.db, {
        workspaceId: context.workspaceId,
        query: text,
        limit: 5,
        types: ["page"],
        match: "any",
        allowedPageIds: allowed,
      });
      return {
        tags,
        pages: hits.map((hit) => ({
          id: hit.id,
          title: hit.title,
          score: Math.round(hit.score * 100) / 100,
        })),
      };
    }),

  preview: workspaceProcedure("VIEWER")
    .input(z.object({ url: z.string().url().max(4000) }))
    .handler(async ({ input }) => urlPreview(input.url)),

  searchPages: workspaceProcedure("VIEWER")
    .input(z.object({ query: z.string().max(200) }))
    .handler(async ({ context, input }) => {
      const allowed = await getAccessiblePageIds(
        context.db,
        context.workspaceId,
        context.userId,
        context.role,
      );
      const hits = await searchWorkspace(context.db, {
        workspaceId: context.workspaceId,
        query: input.query,
        limit: 20,
        types: ["page"],
        allowedPageIds: allowed,
      });
      if (!hits.length) return [];

      const pages = await context.db.page.findMany({
        where: {
          id: { in: hits.map((hit) => hit.id) },
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
      });
      const byId = new Map(pages.map((page) => [page.id, page]));
      return hits.flatMap((hit) => {
        const page = byId.get(hit.id);
        return page ? [{ page, score: hit.score }] : [];
      });
    }),

  extractText: workspaceProcedure("EDITOR")
    .input(z.object({ captureId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      if (!context.uploads) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "Uploads are not available on this server.",
        });
      }
      const capture = await context.db.capture.findFirst({
        where: { id: input.captureId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!capture) throw new ORPCError("NOT_FOUND");
      if (capture.type !== "PDF") {
        throw new ORPCError("BAD_REQUEST", { message: "Only PDF captures can be extracted." });
      }
      if (!capture.url) {
        throw new ORPCError("BAD_REQUEST", { message: "This capture has no file." });
      }
      const upload = await context.uploads.read(capture.url, {
        userId: context.userId,
        workspaceId: context.workspaceId,
      });
      if (!upload) {
        throw new ORPCError("NOT_FOUND", { message: "The PDF could not be read." });
      }
      if (upload.bytes.byteLength > 25 * 1024 * 1024) {
        throw new ORPCError("BAD_REQUEST", { message: "PDFs up to 25 MB can be extracted." });
      }
      let pages = 0;
      let text = "";
      try {
        const result = await extractText(upload.bytes, { mergePages: true });
        pages = result.totalPages;
        text = result.text.replace(/\n{3,}/g, "\n\n").trim();
      } catch {
        throw new ORPCError("BAD_GATEWAY", { message: "This PDF could not be parsed." });
      }
      if (!text) {
        // The web app matches on "no selectable text" and falls back to
        // in-browser OCR, so the wording here is part of that contract.
        throw new ORPCError("BAD_REQUEST", {
          message:
            "This PDF has no selectable text. Scanned pages can be read with OCR in the browser.",
        });
      }
      const content = appendSection(capture.content, "Extracted text", text);
      const metadata = {
        ...(capture.metadata as Record<string, unknown>),
        pdfPages: pages,
        extractedAt: new Date().toISOString(),
      };
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `pdf-extract-${capture.id}-${randomUUID()}`,
            entity: "capture",
            entityId: capture.id,
            op: "UPSERT",
            payload: { content, metadata },
          },
        ],
      });
      return { text, pages };
    }),
};
