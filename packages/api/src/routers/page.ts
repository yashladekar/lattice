import { randomUUID } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { Prisma } from "@notes-learning/db";
import {
  PAGE_TEMPLATES,
  createId,
  emptyDoc,
  extractPlainText,
  safeDoc,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { writeAudit } from "../authz";
import { workspaceProcedure } from "../index";
import {
  appendChanges,
  recomputePageLinkEdges,
  toJsonSafe,
} from "../services/changes";
import { assertPageReadable } from "../services/page-access";
import { restorePageSubtree } from "../services/page-tree";
import { getAccessiblePageIds, pushSync } from "../services/sync";
import { versionTimeline } from "../services/version-timeline";

const pageIdInput = z.object({ pageId: z.string().min(1) });

async function loadTemplateContent(
  db: Database,
  workspaceId: string,
  templateId: string | null | undefined,
) {
  if (!templateId) return null;
  const builtIn = PAGE_TEMPLATES.find((template) => template.id === templateId);
  if (builtIn) return { content: builtIn.content, properties: builtIn.properties ?? {} };
  const template = await db.template.findFirst({
    where: { id: templateId, workspaceId, deletedAt: null },
  });
  if (!template) return null;
  return {
    content: safeDoc(template.content),
    properties: (template.properties as Record<string, unknown>) ?? {},
  };
}

export const pageRouter = {
  list: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const allowed = await getAccessiblePageIds(
      context.db,
      context.workspaceId,
      context.userId,
      context.role,
    );
    const pages = await context.db.page.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: [{ notebookId: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    return allowed ? pages.filter((page) => allowed.has(page.id)) : pages;
  }),

  recent: workspaceProcedure("VIEWER").handler(async ({ context }) => {
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
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return pages;
  }),

  get: workspaceProcedure("VIEWER")
    .input(pageIdInput)
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: {
          document: true,
          pageTags: { include: { tag: true } },
        },
      });
      if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
      return {
        ...page,
        tags: page.pageTags.map((pageTag) => pageTag.tag),
      };
    }),

  create: workspaceProcedure("EDITOR")
    .input(
      z.object({
        notebookId: z.string().nullable().optional(),
        parentId: z.string().nullable().optional(),
        title: z.string().trim().max(200).default("Untitled"),
        icon: z.string().max(16).nullable().optional(),
        visibility: z.enum(["PRIVATE", "SHARED", "WORKSPACE", "PUBLIC"]).default("WORKSPACE"),
        templateId: z.string().max(80).nullable().optional(),
        type: z.enum(["DOCUMENT", "CANVAS", "DATABASE"]).default("DOCUMENT"),
      }),
    )
    .handler(async ({ context, input }) => {
      const template = await loadTemplateContent(
        context.db,
        context.workspaceId,
        input.templateId,
      );
      const pageId = createId();
      const documentId = createId();
      const content = template?.content ?? emptyDoc();
      const pageResult = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-page-${documentId}`,
            entity: "page",
            entityId: pageId,
            op: "UPSERT",
            payload: {
              title: input.title,
              icon: input.icon ?? "◇",
              notebookId: input.notebookId ?? null,
              parentId: input.parentId ?? null,
              visibility: input.visibility,
              type: input.type,
              sortOrder: Date.now() % 100000,
              properties: template?.properties ?? {},
            },
          },
          {
            opId: `api-doc-${documentId}`,
            entity: "pageDocument",
            entityId: pageId,
            op: "UPSERT",
            baseRev: 0,
            payload: {
              content,
              plainText: extractPlainText(content),
              schemaVersion: 1,
              source: "write",
            },
          },
        ],
      });
      if (pageResult.conflicts.length) {
        throw new ORPCError("CONFLICT", { message: "Could not create page" });
      }
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "page.created",
        resourceType: "page",
        resourceId: pageId,
        metadata: { title: input.title },
      });
      const page = await context.db.page.findUnique({
        where: { id: pageId },
        include: { document: true },
      });
      if (!page) throw new ORPCError("INTERNAL_SERVER_ERROR");
      return page;
    }),

  update: workspaceProcedure("EDITOR")
    .input(
      z.object({
        pageId: z.string().min(1),
        title: z.string().trim().max(200).optional(),
        icon: z.string().max(16).nullable().optional(),
        coverUrl: z.string().max(2000).nullable().optional(),
        notebookId: z.string().nullable().optional(),
        parentId: z.string().nullable().optional(),
        visibility: z.enum(["PRIVATE", "SHARED", "WORKSPACE", "PUBLIC"]).optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-page-update-${randomUUID()}`,
            entity: "page",
            entityId: input.pageId,
            op: "UPSERT",
            payload: {
              ...(input.title !== undefined ? { title: input.title } : {}),
              ...(input.icon !== undefined ? { icon: input.icon } : {}),
              ...(input.coverUrl !== undefined ? { coverUrl: input.coverUrl } : {}),
              ...(input.notebookId !== undefined ? { notebookId: input.notebookId } : {}),
              ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
              ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
              ...(input.properties !== undefined ? { properties: input.properties } : {}),
              ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
            },
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      const page = await context.db.page.findUnique({ where: { id: input.pageId } });
      if (!page) throw new ORPCError("NOT_FOUND");
      return page;
    }),

  saveDocument: workspaceProcedure("EDITOR")
    .input(
      z.object({
        pageId: z.string().min(1),
        baseRev: z.number().int().nonnegative(),
        content: z.record(z.string(), z.unknown()),
        plainText: z.string().max(2_000_000).optional(),
        schemaVersion: z.number().int().positive().default(1),
      }),
    )
    .handler(async ({ context, input }) => {
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-doc-save-${randomUUID()}`,
            entity: "pageDocument",
            entityId: input.pageId,
            op: "UPSERT",
            baseRev: input.baseRev,
            payload: {
              content: input.content,
              plainText: input.plainText ?? extractPlainText(safeDoc(input.content)),
              schemaVersion: input.schemaVersion,
              source: "write",
            },
          },
        ],
      });
      if (result.conflicts.length) {
        return { conflict: result.conflicts[0] ?? null, document: null };
      }
      const document = await context.db.pageDocument.findUnique({
        where: { pageId: input.pageId },
      });
      return { conflict: null, document };
    }),

  versions: workspaceProcedure("VIEWER")
    .input(pageIdInput)
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      return context.db.pageVersion.findMany({
        where: { pageId: input.pageId, workspaceId: context.workspaceId },
        orderBy: { version: "desc" },
        take: 50,
      });
    }),

  versionTimeline: workspaceProcedure("VIEWER")
    .input(
      z
        .object({ limit: z.number().int().min(1).max(500).default(200) })
        .optional(),
    )
    .handler(async ({ context, input }) => {
      return versionTimeline(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        role: context.role,
        limit: input?.limit ?? 200,
      });
    }),

  saveVersion: workspaceProcedure("EDITOR")
    .input(pageIdInput.extend({ note: z.string().max(300).optional() }))
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: { document: true },
      });
      if (!page?.document) throw new ORPCError("NOT_FOUND");
      const aggregate = await context.db.pageVersion.aggregate({
        where: { pageId: page.id },
        _max: { version: true },
      });
      const version = await context.db.pageVersion.create({
        data: {
          id: createId(),
          pageId: page.id,
          workspaceId: context.workspaceId,
          version: (aggregate._max.version ?? 0) + 1,
          title: page.title,
          content: page.document.content as Prisma.InputJsonValue,
          note: input.note ?? null,
          createdById: context.userId,
        },
      });
      return version;
    }),

  restoreVersion: workspaceProcedure("EDITOR")
    .input(pageIdInput.extend({ versionId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const version = await context.db.pageVersion.findFirst({
        where: {
          id: input.versionId,
          pageId: input.pageId,
          workspaceId: context.workspaceId,
        },
      });
      if (!version) throw new ORPCError("NOT_FOUND");
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: { document: true },
      });
      if (!page?.document) throw new ORPCError("NOT_FOUND");
      const currentDocument = page.document;
      const content = safeDoc(version.content);
      const changes = [] as import("../services/changes").PendingChange[];
      const document = await context.db.$transaction(async (tx) => {
        const currentVersion = await tx.pageVersion.aggregate({
          where: { pageId: page.id },
          _max: { version: true },
        });
        await tx.pageVersion.create({
          data: {
            id: createId(),
            pageId: page.id,
            workspaceId: context.workspaceId,
            version: (currentVersion._max.version ?? 0) + 1,
            title: page.title,
            content: currentDocument.content as unknown as Prisma.InputJsonValue,
            note: "Snapshot before restoring an earlier version",
            createdById: context.userId,
          },
        });
        const updated = await tx.pageDocument.update({
          where: { pageId: page.id },
          data: {
            content: content as unknown as Prisma.InputJsonValue,
            plainText: extractPlainText(content),
            rev: currentDocument.rev + 1,
          },
        });
        const updatedPage = await tx.page.update({
          where: { id: page.id },
          data: { updatedAt: new Date(), updatedById: context.userId },
        });
        changes.push(
          {
            entity: "pageDocument",
            entityId: page.id,
            op: "UPSERT",
            data: { ...toJsonSafe(updated), source: "write" },
          },
          { entity: "page", entityId: page.id, op: "UPSERT", data: toJsonSafe(updatedPage) },
        );
        await recomputePageLinkEdges(tx, page, content, context.userId, changes);
        await appendChanges(tx, context.workspaceId, context.userId, changes);
        return updated;
      });
      return { document, page: { ...page, document: undefined } };
    }),

  duplicate: workspaceProcedure("EDITOR")
    .input(pageIdInput)
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const source = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
        include: { document: true },
      });
      if (!source) throw new ORPCError("NOT_FOUND");
      const pageId = createId();
      const content = safeDoc(source.document?.content);
      await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-page-duplicate-${pageId}`,
            entity: "page",
            entityId: pageId,
            op: "UPSERT",
            payload: {
              title: `${source.title} copy`,
              icon: source.icon,
              notebookId: source.notebookId,
              parentId: source.parentId,
              visibility: source.visibility,
              type: source.type,
              properties: source.properties,
              sortOrder: source.sortOrder + 1,
            },
          },
          {
            opId: `api-doc-duplicate-${pageId}`,
            entity: "pageDocument",
            entityId: pageId,
            op: "UPSERT",
            baseRev: 0,
            payload: {
              content,
              plainText: extractPlainText(content),
              schemaVersion: 1,
              source: "write",
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

  remove: workspaceProcedure("EDITOR")
    .input(pageIdInput)
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const page = await context.db.page.findFirst({
        where: { id: input.pageId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!page) throw new ORPCError("NOT_FOUND");
      const result = await pushSync(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        ops: [
          {
            opId: `api-page-delete-${randomUUID()}`,
            entity: "page",
            entityId: page.id,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      if (result.conflicts.length) throw new ORPCError("CONFLICT");
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "page.deleted",
        resourceType: "page",
        resourceId: page.id,
      });
      return { ok: true };
    }),

  backlinks: workspaceProcedure("VIEWER")
    .input(pageIdInput)
    .handler(async ({ context, input }) => {
      await assertPageReadable(
        context.db,
        context.workspaceId,
        input.pageId,
        context.userId,
        context.role,
      );
      const edges = await context.db.knowledgeEdge.findMany({
        where: {
          workspaceId: context.workspaceId,
          targetNodeId: input.pageId,
          deletedAt: null,
        },
      });
      const pages = await context.db.page.findMany({
        where: {
          id: { in: edges.map((edge) => edge.sourceNodeId) },
          workspaceId: context.workspaceId,
          deletedAt: null,
        },
        select: { id: true, title: true, icon: true, updatedAt: true },
      });
      return pages;
    }),

  templates: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const custom = await context.db.template.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return { builtIn: PAGE_TEMPLATES, custom };
  }),

  trash: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const allowed = await getAccessiblePageIds(
      context.db,
      context.workspaceId,
      context.userId,
      context.role,
    );
    const pages = await context.db.page.findMany({
      where: {
        workspaceId: context.workspaceId,
        deletedAt: { not: null },
        ...(allowed ? { id: { in: [...allowed] } } : {}),
      },
      orderBy: { deletedAt: "desc" },
      take: 100,
    });
    return pages;
  }),

  restore: workspaceProcedure("EDITOR")
    .input(pageIdInput)
    .handler(async ({ context, input }) => {
      const page = await context.db.page.findFirst({
        where: {
          id: input.pageId,
          workspaceId: context.workspaceId,
          deletedAt: { not: null },
        },
      });
      if (!page) throw new ORPCError("NOT_FOUND", { message: "Page is not in the trash" });
      return restorePageSubtree(context.db, {
        workspaceId: context.workspaceId,
        userId: context.userId,
        pageId: page.id,
      });
    }),
};
