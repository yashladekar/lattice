import type { Database } from "@notes-learning/db";
import {
  canShare,
  createId,
  extractPlainText,
  safeDoc,
  type Role,
  type SyncOpInput,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

import { assertPageAccess } from "./page-access";
import { getAccessiblePageIds, pushSync } from "./sync";

export interface DuplicatePageSubtreeInput {
  workspaceId: string;
  userId: string;
  role: Role;
  pageId: string;
}

/**
 * Copies a page and every readable page below it, including documents,
 * properties, and covers. The copy is a sibling of the source; descendants keep
 * their titles and relative order under their new parents.
 */
export async function duplicatePageSubtree(db: Database, input: DuplicatePageSubtreeInput) {
  const source = await db.page.findFirst({
    where: { id: input.pageId, workspaceId: input.workspaceId, deletedAt: null },
    include: { document: true },
  });
  if (!source) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  await assertPageAccess(db, source, input.userId, input.role, "read");

  const [allowed, pages] = await Promise.all([
    getAccessiblePageIds(db, input.workspaceId, input.userId, input.role),
    db.page.findMany({
      where: { workspaceId: input.workspaceId, deletedAt: null },
      include: { document: true },
    }),
  ]);

  const childrenByParent = new Map<string, typeof pages>();
  for (const page of pages) {
    if (!page.parentId) continue;
    const list = childrenByParent.get(page.parentId) ?? [];
    list.push(page);
    childrenByParent.set(page.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }

  const ops: SyncOpInput[] = [];
  let rootId: string | null = null;

  const copyPage = (page: (typeof pages)[number], parentId: string | null, title: string): string => {
    const id = createId();
    if (!rootId) rootId = id;
    const content = safeDoc(page.document?.content);
    const visibility =
      page.visibility === "PUBLIC" && !canShare(input.role) ? "WORKSPACE" : page.visibility;
    ops.push(
      {
        opId: `api-page-duplicate-${id}`,
        entity: "page",
        entityId: id,
        op: "UPSERT",
        payload: {
          title,
          icon: page.icon,
          coverUrl: page.coverUrl,
          notebookId: page.notebookId,
          parentId,
          visibility,
          type: page.type,
          properties: page.properties,
          sortOrder: page.id === source.id ? page.sortOrder + 1 : page.sortOrder,
        },
      },
      {
        opId: `api-doc-duplicate-${id}`,
        entity: "pageDocument",
        entityId: id,
        op: "UPSERT",
        baseRev: 0,
        payload: {
          content,
          plainText: extractPlainText(content),
          schemaVersion: 1,
          source: "write",
        },
      },
    );

    for (const child of childrenByParent.get(page.id) ?? []) {
      if (allowed && !allowed.has(child.id)) continue;
      copyPage(child, id, child.title);
    }
    return id;
  };

  const rootPageId = copyPage(source, source.parentId, `${source.title} copy`);

  const result = await pushSync(db, {
    workspaceId: input.workspaceId,
    userId: input.userId,
    ops,
  });
  if (result.conflicts.length) {
    throw new ORPCError("CONFLICT", { message: "Could not duplicate the page" });
  }
  return db.page.findUniqueOrThrow({
    where: { id: rootPageId },
    include: { document: true },
  });
}
