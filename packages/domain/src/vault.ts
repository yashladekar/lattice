import type { TipTapDoc, TipTapNode } from "./types";

export interface VaultFile {
  /** Path relative to the vault root, using forward slashes. */
  path: string;
  markdown: string;
}

export interface VaultFrontmatter {
  data: Record<string, string>;
  body: string;
}

export interface VaultWikiLink {
  target: string;
  alias: string | null;
  heading: string | null;
}

export interface VaultPagePlan {
  path: string;
  title: string;
  /** Notebook path, or null for the vault root. */
  folder: string | null;
  tags: string[];
  aliases: string[];
}

export interface VaultPlan {
  folders: string[];
  pages: VaultPagePlan[];
}

export interface VaultLinkPlan {
  fromPath: string;
  toPath: string;
  label: string | null;
}

export interface VaultImportPlan {
  folders: string[];
  pages: VaultPagePlan[];
  links: VaultLinkPlan[];
  /** Link targets with no matching note in the vault. */
  unresolved: Array<{ fromPath: string; target: string }>;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const WIKI_LINK_PATTERN = /(!?)\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g;
const INLINE_TAG_PATTERN = /(^|[\s(])#([A-Za-z0-9][A-Za-z0-9/_-]*)/g;
const CODE_FENCE_PATTERN = /^(```|~~~)/;

function parseList(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Splits YAML-style frontmatter from the note body, without a YAML dependency. */
export function parseFrontmatter(markdown: string): VaultFrontmatter {
  const match = markdown.match(FRONTMATTER_PATTERN);
  if (!match) return { data: {}, body: markdown };
  const data: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!key) continue;
    data[key] = line.slice(separator + 1).trim();
  }
  return { data, body: markdown.slice(match[0].length) };
}

/** Strips fenced code so link and tag scans do not read example syntax. */
function outsideCodeFences(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let fenced = false;
  let fence = "";
  for (const line of lines) {
    const fenceMatch = line.trimStart().match(CODE_FENCE_PATTERN);
    if (fenceMatch) {
      if (!fenced) {
        fenced = true;
        fence = fenceMatch[1] ?? "```";
      } else if (line.trimStart().startsWith(fence)) {
        fenced = false;
      }
      kept.push("");
      continue;
    }
    kept.push(fenced ? "" : line);
  }
  return kept.join("\n");
}

export function parseWikiLinks(markdown: string): VaultWikiLink[] {
  const links: VaultWikiLink[] = [];
  for (const match of outsideCodeFences(markdown).matchAll(WIKI_LINK_PATTERN)) {
    // `![[embed]]` is a transclusion, not a link between notes.
    if (match[1] === "!") continue;
    const target = (match[2] ?? "").trim();
    if (!target) continue;
    links.push({
      target,
      heading: match[3]?.trim() ?? null,
      alias: match[4]?.trim() ?? null,
    });
  }
  return links;
}

export function extractVaultTags(markdown: string, frontmatter?: Record<string, string>): string[] {
  const tags = new Set<string>();
  const declared = frontmatter?.tags ?? frontmatter?.tag;
  if (declared) {
    for (const tag of parseList(declared)) tags.add(tag.replace(/^#/, ""));
  }
  for (const match of outsideCodeFences(markdown).matchAll(INLINE_TAG_PATTERN)) {
    const tag = match[2];
    if (tag) tags.add(tag);
  }
  return [...tags];
}

function fileStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

function stripOrderingPrefix(name: string): string {
  return name.replace(/^\d+[\s._-]+/, "");
}

/** Notion appends a 32-character hash to every exported file and folder. */
const NOTION_HASH_SUFFIX = /\s+[0-9a-f]{32}$/;

function cleanName(name: string): string {
  return stripOrderingPrefix(name.replace(NOTION_HASH_SUFFIX, "")).trim();
}

/** Ordered import plan: which notebooks to create and where each note lands. */
export function planVault(files: VaultFile[]): VaultPlan {
  const folders = new Set<string>();
  const pages: VaultPagePlan[] = [];

  for (const file of files) {
    if (!/\.md$/i.test(file.path)) continue;
    const segments = file.path.split("/").filter(Boolean);
    const name = segments.pop() ?? file.path;
    const folderSegments = segments.map(cleanName).filter(Boolean);
    for (let depth = 1; depth <= folderSegments.length; depth += 1) {
      folders.add(folderSegments.slice(0, depth).join("/"));
    }

    const { data, body } = parseFrontmatter(file.markdown);
    const declaredTitle = data.title ?? data.name;
    const aliases = data.aliases ? parseList(data.aliases) : data.alias ? parseList(data.alias) : [];
    pages.push({
      path: file.path,
      title: declaredTitle?.replace(/^["']|["']$/g, "") || cleanName(fileStem(name)),
      folder: folderSegments.length ? folderSegments.join("/") : null,
      tags: extractVaultTags(body, data),
      aliases,
    });
  }

  return { folders: entriesByDepth(folders), pages };
}

export interface VaultLinkTarget {
  pageId: string;
  title: string;
}

/**
 * Rewrites `[[wiki links]]` that survived Markdown conversion into `pageLink`
 * nodes, which is what the graph reads to draw edges between pages. Targets
 * without a match keep their literal text.
 */
export function linkWikiLinks(
  doc: TipTapDoc,
  resolve: (target: string) => VaultLinkTarget | null,
): { doc: TipTapDoc; linked: number; unresolved: string[] } {
  const unresolved = new Set<string>();
  let linked = 0;

  const rewriteText = (node: TipTapNode): TipTapNode[] => {
    const text = node.text ?? "";
    if (!text.includes("[[")) return [node];
    const parts: TipTapNode[] = [];
    let cursor = 0;

    for (const match of text.matchAll(WIKI_LINK_PATTERN)) {
      if (match[1] === "!") continue;
      if (match.index === undefined) continue;
      const target = (match[2] ?? "").trim();
      const resolved = target ? resolve(target) : null;
      if (!resolved) {
        if (target) unresolved.add(target);
        continue;
      }
      if (match.index > cursor) {
        parts.push({ ...node, text: text.slice(cursor, match.index) });
      }
      parts.push({
        type: "pageLink",
        attrs: { pageId: resolved.pageId, title: match[4]?.trim() || resolved.title },
      });
      linked += 1;
      cursor = match.index + match[0].length;
    }

    if (!parts.length) return [node];
    if (cursor < text.length) parts.push({ ...node, text: text.slice(cursor) });
    return parts.filter((part) => part.type !== "text" || (part.text ?? "").length > 0);
  };

  const walk = (node: TipTapNode): TipTapNode => {
    if (!node.content) return node;
    const content: TipTapNode[] = [];
    for (const child of node.content) {
      if (child.type === "text") {
        content.push(...rewriteText(child));
      } else if (child.content) {
        content.push(walk(child));
      } else {
        content.push(child);
      }
    }
    return { ...node, content };
  };

  return { doc: walk(doc) as TipTapDoc, linked, unresolved: [...unresolved] };
}

function entriesByDepth(folders: Set<string>): string[] {
  return [...folders].sort((a, b) => {
    const depth = a.split("/").length - b.split("/").length;
    return depth !== 0 ? depth : a.localeCompare(b);
  });
}

/**
 * Matches `[[wiki links]]` back to notes. Obsidian resolves by exact path
 * first, then by bare file name, both case-insensitively.
 */
export function resolveVaultLinks(files: VaultFile[], plan: VaultPlan): VaultImportPlan {
  const byPath = new Map<string, VaultPagePlan>();
  const byName = new Map<string, VaultPagePlan[]>();
  const byAlias = new Map<string, VaultPagePlan>();

  for (const page of plan.pages) {
    byPath.set(page.path.replace(/\.md$/i, "").toLowerCase(), page);
    const name = fileStem(page.path).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), page]);
    for (const alias of page.aliases) {
      const key = alias.toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, page);
    }
  }

  const links: VaultLinkPlan[] = [];
  const unresolved: Array<{ fromPath: string; target: string }> = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!/\.md$/i.test(file.path)) continue;
    for (const link of parseWikiLinks(file.markdown)) {
      const key = link.target.replace(/\.md$/i, "").toLowerCase();
      const stem = fileStem(key).toLowerCase();
      const byShortName = byName.get(stem);
      const match =
        byPath.get(key) ??
        byAlias.get(key) ??
        (byName.get(key)?.length === 1 ? byName.get(key)?.[0] : undefined) ??
        (byShortName?.length === 1 ? byShortName[0] : undefined);

      if (!match) {
        unresolved.push({ fromPath: file.path, target: link.target });
        continue;
      }
      if (match.path === file.path) continue;
      const dedupe = `${file.path}→${match.path}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      links.push({
        fromPath: file.path,
        toPath: match.path,
        label: link.alias ?? link.heading ?? null,
      });
    }
  }

  return { folders: plan.folders, pages: plan.pages, links, unresolved };
}
