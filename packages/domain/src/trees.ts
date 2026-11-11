import type { Notebook, Page } from "./types";

export interface PageTreeNode {
  page: Page;
  children: PageTreeNode[];
}

export function buildPageTree(pages: Page[]): PageTreeNode[] {
  const active = pages.filter((page) => !page.deletedAt);
  const byParent = new Map<string | null, Page[]>();
  for (const page of active) {
    const key = page.parentId;
    const list = byParent.get(key) ?? [];
    list.push(page);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }
  const build = (parentId: string | null): PageTreeNode[] =>
    (byParent.get(parentId) ?? []).map((page) => ({
      page,
      children: build(page.id),
    }));
  const roots = build(null);
  const visited = new Set<string>();
  const mark = (nodes: PageTreeNode[]) => {
    for (const node of nodes) {
      visited.add(node.page.id);
      mark(node.children);
    }
  };
  mark(roots);
  for (const page of active) {
    if (!visited.has(page.id)) {
      roots.push({ page, children: build(page.id) });
    }
  }
  return roots;
}

export function flattenPageTree(nodes: PageTreeNode[]): Page[] {
  return nodes.flatMap((node) => [node.page, ...flattenPageTree(node.children)]);
}

export interface TrashPageLike {
  id: string;
  parentId: string | null;
  deletedAt?: string | Date | null;
  sortOrder: number;
  title: string;
}

export interface TrashPageGroup<T extends TrashPageLike> {
  page: T;
  children: TrashPageGroup<T>[];
  descendantCount: number;
}

/**
 * Groups trashed pages into subtree roots. A page whose parent is not also in
 * the trash becomes a root of its own group, so a restored or purged parent
 * never hides its children. Roots sort newest deletion first; siblings keep
 * their page order.
 */
export function buildTrashTree<T extends TrashPageLike>(pages: T[]): TrashPageGroup<T>[] {
  const trashed = pages.filter((page) => page.deletedAt);
  const byId = new Map(trashed.map((page) => [page.id, page]));
  const byParent = new Map<string, T[]>();
  const roots: T[] = [];

  for (const page of trashed) {
    if (page.parentId && byId.has(page.parentId)) {
      const list = byParent.get(page.parentId) ?? [];
      list.push(page);
      byParent.set(page.parentId, list);
    } else {
      roots.push(page);
    }
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }
  roots.sort((a, b) => deletedTime(b) - deletedTime(a) || a.title.localeCompare(b.title));

  const visited = new Set<string>();
  const build = (page: T): TrashPageGroup<T> => {
    visited.add(page.id);
    const children = (byParent.get(page.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .map(build);
    return {
      page,
      children,
      descendantCount: children.reduce((count, child) => count + 1 + child.descendantCount, 0),
    };
  };

  const groups = roots.map(build);
  for (const page of trashed) {
    if (!visited.has(page.id)) groups.push(build(page));
  }
  return groups;
}

function deletedTime(page: TrashPageLike): number {
  if (!page.deletedAt) return 0;
  const time = new Date(page.deletedAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

export interface NotebookTreeNode {
  notebook: Notebook;
  children: NotebookTreeNode[];
}

export function buildNotebookTree(notebooks: Notebook[]): NotebookTreeNode[] {
  const active = notebooks.filter((notebook) => !notebook.deletedAt);
  const byParent = new Map<string | null, Notebook[]>();
  for (const notebook of active) {
    const list = byParent.get(notebook.parentId) ?? [];
    list.push(notebook);
    byParent.set(notebook.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  const build = (parentId: string | null): NotebookTreeNode[] =>
    (byParent.get(parentId) ?? []).map((notebook) => ({
      notebook,
      children: build(notebook.id),
    }));
  return build(null);
}

export function pageBreadcrumbs(pageId: string, pages: Page[]): Page[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const trail: Page[] = [];
  let current = byId.get(pageId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return trail;
}

export function descendantPageIds(
  pageId: string,
  pages: Array<{ id: string; parentId: string | null; deletedAt?: unknown }>,
  options: { includeDeleted?: boolean } = {},
): string[] {
  const children = new Map<string | null, string[]>();
  for (const page of pages) {
    if (page.deletedAt && !options.includeDeleted) continue;
    const list = children.get(page.parentId) ?? [];
    list.push(page.id);
    children.set(page.parentId, list);
  }
  const result: string[] = [];
  const seen = new Set<string>([pageId]);
  const stack = [pageId];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      result.push(child);
      stack.push(child);
    }
  }
  return result;
}

export function wouldCreatePageCycle(
  pageId: string,
  nextParentId: string | null,
  pages: Page[],
): boolean {
  if (!nextParentId) return false;
  if (nextParentId === pageId) return true;
  return descendantPageIds(pageId, pages).includes(nextParentId);
}

export interface PageOrderCandidate {
  id: string;
  sortOrder: number;
  title: string;
}

export interface PageOrderPlan {
  sortOrder: number;
  siblingUpdates: Array<{ id: string; sortOrder: number }>;
}

export type PageDropPosition = "before" | "inside" | "after";

export interface PageDropLayout {
  id: string;
  y: number;
  height: number;
}

export function pageDropPosition(ratio: number): PageDropPosition {
  if (ratio < 0.3) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

/**
 * Resolves a pointer against the measured page rows. The zones are deliberately
 * shared by the web sidebar and the native long-press drag so both clients put
 * a drop in the same place.
 */
export function pageDropTarget(
  layouts: PageDropLayout[],
  absoluteY: number,
  forbiddenIds?: ReadonlySet<string>,
): { pageId: string; position: PageDropPosition } | null {
  for (const layout of layouts) {
    if (layout.height <= 0) continue;
    if (absoluteY < layout.y || absoluteY > layout.y + layout.height) continue;
    if (forbiddenIds?.has(layout.id)) return null;
    return {
      pageId: layout.id,
      position: pageDropPosition((absoluteY - layout.y) / layout.height),
    };
  }
  return null;
}

/**
 * Chooses an integer sortOrder that places the moved page before/after a
 * sibling without rewriting the list, and falls back to renumbering when the
 * two neighbours have no integer gap. `siblings` must exclude the moved page.
 */
export function planPageOrder(
  siblings: PageOrderCandidate[],
  options: { beforeId?: string | null; afterId?: string | null } = {},
): PageOrderPlan {
  const ordered = [...siblings].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title),
  );
  let index = ordered.length;
  if (options.beforeId) {
    const found = ordered.findIndex((sibling) => sibling.id === options.beforeId);
    if (found >= 0) index = found;
  } else if (options.afterId) {
    const found = ordered.findIndex((sibling) => sibling.id === options.afterId);
    if (found >= 0) index = found + 1;
  }

  const previous = ordered[index - 1];
  const next = ordered[index];
  if (previous && next && next.sortOrder - previous.sortOrder <= 1) {
    const sortOrder = (index + 1) * 1000;
    const siblingUpdates: Array<{ id: string; sortOrder: number }> = [];
    ordered.forEach((sibling, siblingIndex) => {
      const order = (siblingIndex < index ? siblingIndex + 1 : siblingIndex + 2) * 1000;
      if (sibling.sortOrder !== order) siblingUpdates.push({ id: sibling.id, sortOrder: order });
    });
    return { sortOrder, siblingUpdates };
  }
  if (previous && next) {
    return {
      sortOrder: Math.floor((previous.sortOrder + next.sortOrder) / 2),
      siblingUpdates: [],
    };
  }
  if (previous) return { sortOrder: previous.sortOrder + 1000, siblingUpdates: [] };
  if (next) return { sortOrder: next.sortOrder - 1000, siblingUpdates: [] };
  return { sortOrder: 1000, siblingUpdates: [] };
}

export function sortPagesByRecency(pages: Page[], limit = 10): Page[] {
  return [...pages]
    .filter((page) => !page.deletedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}
