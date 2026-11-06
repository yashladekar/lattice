import { validateManifest, type PluginManifest } from "./plugins";

export interface DirectoryPlugin {
  category: "writing" | "research" | "maintenance";
  manifest: PluginManifest;
  /** Audited source shipped with the app; installed locally, never fetched. */
  source: string;
}

/**
 * Small, audited plugins that ship with Lattice. They are ordinary plugin
 * bundles: the same sandbox, consent, and revocation rules apply. The catalog
 * is local so it works offline and cannot change under the user.
 */
export const DIRECTORY_PLUGINS: DirectoryPlugin[] = [
  {
    category: "writing",
    manifest: {
      id: "com.lattice.directory.word-count",
      name: "Word count",
      version: "1.0.0",
      description: "Counts words and characters on the open page and remembers the last run.",
      permissions: ["page:read", "storage"],
    },
    source: `async function run(ctx) {
  const page = await ctx.readPage();
  if (!page) return "No page selected.";
  const words = page.text.split(/\\s+/).filter(Boolean);
  await ctx.setItem("lastRun", page.title);
  return {
    words: words.length,
    characters: page.text.length,
    previousRun: await ctx.getItem("lastRun"),
  };
}`,
  },
  {
    category: "maintenance",
    manifest: {
      id: "com.lattice.directory.todo-extract",
      name: "TODO extractor",
      version: "1.0.0",
      description: "Finds TODO, FIXME, and TBD lines on the page and files them as a checklist page.",
      permissions: ["page:read", "page:create"],
    },
    source: `async function run(ctx) {
  const page = await ctx.readPage();
  if (!page) return "No page selected.";
  const lines = page.markdown.split("\\n").filter(function (line) {
    return /\\b(TODO|FIXME|TBD)\\b/i.test(line);
  });
  if (!lines.length) return "No TODOs on this page.";
  const checklist = lines
    .map(function (line) { return "- [ ] " + line.trim().replace(/^[-*]\\s+/, ""); })
    .join("\\n");
  const created = await ctx.createPage({
    title: "TODOs — " + page.title,
    markdown: "# TODOs from " + page.title + "\\n\\n" + checklist,
  });
  return { found: lines.length, pageId: created.pageId };
}`,
  },
  {
    category: "research",
    manifest: {
      id: "com.lattice.directory.related-notes",
      name: "Related notes",
      version: "1.0.0",
      description: "Searches the workspace for notes that share language with the open page.",
      permissions: ["page:read", "search:read"],
    },
    source: `async function run(ctx) {
  const page = await ctx.readPage();
  if (!page) return "No page selected.";
  const hits = await ctx.search(page.title);
  const related = hits
    .filter(function (hit) { return hit.title !== page.title; })
    .slice(0, 5);
  return related.length ? related : "No related notes found.";
}`,
  },
];

/** Every shipped directory entry must survive the same validation as remote ones. */
export function directoryPlugins(): DirectoryPlugin[] {
  return DIRECTORY_PLUGINS.filter((entry) => validateManifest(entry.manifest).ok && entry.source.trim());
}
