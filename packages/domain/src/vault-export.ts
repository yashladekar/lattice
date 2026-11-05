import { docToMarkdown, safeDoc } from "./editor";
import type { VaultFile } from "./vault";

export interface VaultExportPage {
  id: string;
  title: string;
  icon: string | null;
  notebookId: string | null;
  updatedAt: string;
  content: unknown;
  tags: string[];
}

export interface VaultExportInput {
  pages: VaultExportPage[];
  notebooks: Array<{ id: string; name: string; parentId: string | null }>;
}

const INVALID_PATH = /[\\/:*?"<>|]/g;

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(INVALID_PATH, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return (cleaned || fallback).slice(0, 80);
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `[[Title]](pageId)` is the editor's internal form; vaults link by title. */
export function stripPageIds(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]\([^)]*\)/g, "[[$1]]");
}

function frontmatterValue(value: string): string {
  const yamlUnsafe = /[:#"'[\]{}&*!|>%@`]/.test(value) || /^\s|\s$/.test(value);
  return yamlUnsafe ? yamlString(value) : value;
}

export function exportVaultMarkdown(input: VaultExportInput): VaultFile[] {
  const notebookById = new Map(input.notebooks.map((notebook) => [notebook.id, notebook]));

  const folderOf = (notebookId: string | null): string | null => {
    if (!notebookId) return null;
    const parts: string[] = [];
    const seen = new Set<string>();
    let cursor = notebookById.get(notebookId);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      parts.unshift(sanitizeSegment(cursor.name, "Notebook"));
      cursor = cursor.parentId ? notebookById.get(cursor.parentId) : undefined;
    }
    return parts.length ? parts.join("/") : null;
  };

  const used = new Set<string>();
  const files: VaultFile[] = [];
  for (const page of input.pages) {
    const title = sanitizeSegment(page.title || "Untitled", "Untitled");
    const folder = folderOf(page.notebookId);
    const base = folder ? `${folder}/${title}` : title;
    let path = `${base}.md`;
    let counter = 2;
    while (used.has(path.toLowerCase())) {
      path = `${base} ${counter}.md`;
      counter += 1;
    }
    used.add(path.toLowerCase());

    const lines = ["---", `title: ${frontmatterValue(page.title || "Untitled")}`];
    const tags = page.tags.map((tag) => tag.replace(/[\s,]+/g, "-")).filter(Boolean);
    if (tags.length) lines.push(`tags: ${tags.join(", ")}`);
    if (page.icon) lines.push(`icon: ${frontmatterValue(page.icon)}`);
    lines.push("---", "");

    const body = stripPageIds(docToMarkdown(safeDoc(page.content))).trim();
    files.push({
      path,
      markdown: `${lines.join("\n")}\n${body}\n`,
    });
  }
  return files;
}
