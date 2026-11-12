import type { Database } from "@notes-learning/db";
import {
  extractPlainText,
  safeDoc,
  type TipTapDoc,
  type TipTapNode,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";

function sanitizeNode(node: TipTapNode, allowedPageIds: Set<string>): TipTapNode | null {
  if (node.type === "pageLink") {
    const pageId = node.attrs?.pageId;
    if (typeof pageId === "string" && allowedPageIds.has(pageId)) return node;
    return { type: "text", text: "Linked page", marks: [{ type: "italic" }] };
  }
  if (node.type === "pageEmbed" || node.type === "liveBlock") {
    return { type: "text", text: "Embedded page", marks: [{ type: "italic" }] };
  }
  const content: TipTapNode[] = [];
  for (const child of node.content ?? []) {
    const sanitized = sanitizeNode(child, allowedPageIds);
    if (sanitized) content.push(sanitized);
  }
  return {
    ...node,
    ...(node.content ? { content } : {}),
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
  };
}

export function publicDocument(doc: unknown, allowedPageIds: Set<string>): TipTapDoc {
  const source = safeDoc(doc);
  const content = source.content
    .map((node) => sanitizeNode(node, allowedPageIds))
    .filter((node): node is TipTapNode => Boolean(node));
  return { type: "doc", content };
}

export interface PublicSubPage {
  id: string;
  title: string;
  icon: string | null;
  parentId: string;
  updatedAt: string;
}

export interface PublicTrailPage {
  id: string;
  title: string;
  icon: string | null;
}

export interface ResolvePublicPageInput {
  workspaceId: string;
  rootPageId: string;
  includeSubPages: boolean;
  pageId?: string | null;
}

interface PublicPageRow {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  notebookId: string | null;
  visibility: string;
  sortOrder: number;
  updatedAt: Date;
  createdById: string;
}

/**
 * Resolves the page a public share link should show. The link owner opts in to
 * sub-pages explicitly; only WORKSPACE and PUBLIC descendants are reachable,
 * and a hidden page hides everything beneath it so a breadcrumb can never
 * reveal a private title.
 */
export async function resolvePublicPage(db: Database, input: ResolvePublicPageInput) {
  const pages = (await db.page.findMany({
    where: { workspaceId: input.workspaceId, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      title: true,
      icon: true,
      coverUrl: true,
      notebookId: true,
      visibility: true,
      sortOrder: true,
      updatedAt: true,
      createdById: true,
    },
  })) as PublicPageRow[];
  const byId = new Map(pages.map((page) => [page.id, page]));
  const root = byId.get(input.rootPageId);
  if (!root) throw new ORPCError("NOT_FOUND", { message: "Page not found" });

  const childrenByParent = new Map<string, PublicPageRow[]>();
  for (const page of pages) {
    if (!page.parentId) continue;
    const list = childrenByParent.get(page.parentId) ?? [];
    list.push(page);
    childrenByParent.set(page.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }

  const allowedIds = new Set<string>([root.id]);
  if (input.includeSubPages) {
    const walk = (parentId: string) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (child.visibility !== "WORKSPACE" && child.visibility !== "PUBLIC") continue;
        allowedIds.add(child.id);
        walk(child.id);
      }
    };
    walk(root.id);
  }

  const requestedId = input.pageId ?? root.id;
  const current = byId.get(requestedId);
  if (!current) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  if (!allowedIds.has(current.id)) {
    throw new ORPCError("NOT_FOUND", { message: "Page is not shared" });
  }

  const document = await db.pageDocument.findUnique({ where: { pageId: current.id } });
  if (!document) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
  const publicDoc = publicDocument(document.content, new Set([current.id]));
  const author = await db.user.findUnique({
    where: { id: current.createdById },
    select: { name: true },
  });
  const notebook = current.notebookId
    ? await db.notebook.findFirst({
        where: { id: current.notebookId, workspaceId: input.workspaceId },
        select: { name: true, icon: true },
      })
    : null;

  const trail: PublicTrailPage[] = [];
  const seen = new Set<string>();
  let cursor: PublicPageRow | undefined = current;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    trail.unshift({ id: cursor.id, title: cursor.title, icon: cursor.icon });
    if (cursor.id === root.id) break;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }

  const subPages: PublicSubPage[] = [];
  if (input.includeSubPages) {
    const walk = (parentId: string) => {
      for (const child of childrenByParent.get(parentId) ?? []) {
        if (!allowedIds.has(child.id)) continue;
        const parent = child.parentId;
        if (parent) {
          subPages.push({
            id: child.id,
            title: child.title,
            icon: child.icon,
            parentId: parent,
            updatedAt: child.updatedAt.toISOString(),
          });
        }
        walk(child.id);
      }
    };
    walk(root.id);
  }

  return {
    page: {
      id: current.id,
      title: current.title,
      icon: current.icon,
      coverUrl: current.coverUrl,
      updatedAt: current.updatedAt.toISOString(),
      authorName: author?.name ?? "Anonymous",
      document: publicDoc,
      plainText: extractPlainText(publicDoc),
    },
    notebook,
    subPages,
    trail,
  };
}
