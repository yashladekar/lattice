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

export function sortPagesByRecency(pages: Page[], limit = 10): Page[] {
  return [...pages]
    .filter((page) => !page.deletedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}
