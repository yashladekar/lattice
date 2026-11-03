import { describe, expect, it } from "vitest";

import {
  extractVaultTags,
  linkWikiLinks,
  parseFrontmatter,
  parseWikiLinks,
  planVault,
  resolveVaultLinks,
  type VaultFile,
} from "./vault";

const note = (path: string, markdown: string): VaultFile => ({ path, markdown });

describe("parseFrontmatter", () => {
  it("reads keys and returns the body", () => {
    const { data, body } = parseFrontmatter("---\ntitle: On CRDTs\ntags: [distributed, notes]\n---\n# Body\n");
    expect(data.title).toBe("On CRDTs");
    expect(body).toBe("# Body\n");
  });

  it("leaves documents without frontmatter untouched", () => {
    const markdown = "# Just a note\n";
    expect(parseFrontmatter(markdown)).toEqual({ data: {}, body: markdown });
  });

  it("ignores a horizontal rule that is not frontmatter", () => {
    const markdown = "# Title\n\n---\n\nAfter the rule\n";
    expect(parseFrontmatter(markdown).body).toBe(markdown);
  });
});

describe("parseWikiLinks", () => {
  it("reads targets, headings and aliases", () => {
    const links = parseWikiLinks("See [[Design Doc]] and [[Notes#Part two|the notes]].");
    expect(links).toEqual([
      { target: "Design Doc", alias: null, heading: null },
      { target: "Notes", alias: "the notes", heading: "Part two" },
    ]);
  });

  it("skips embeds and code fences", () => {
    const markdown = "![[an-image.png]]\n\n```md\n[[not a link]]\n```\n\n[[real]]\n";
    expect(parseWikiLinks(markdown).map((link) => link.target)).toEqual(["real"]);
  });
});

describe("extractTags", () => {
  it("merges frontmatter and inline tags without duplicates", () => {
    const tags = extractVaultTags("Text with #project/lattice and #project/lattice again.", {
      tags: "[lattice, #project/lattice]",
    });
    expect(tags.sort()).toEqual(["lattice", "project/lattice"]);
  });

  it("does not read tags inside code fences", () => {
    expect(extractVaultTags("```\n#not-a-tag\n```\n")).toEqual([]);
  });
});

describe("planVault", () => {
  it("derives titles, folders and ordering-prefix stripping", () => {
    const plan = planVault([
      note("Root.md", "# Root"),
      note("01 Projects/Lattice/Notes.md", "# Notes"),
      note("01 Projects/Lattice/Sub/Deep.md", "# Deep"),
    ]);

    expect(plan.pages.map((page) => [page.title, page.folder])).toEqual([
      ["Root", null],
      ["Notes", "Projects/Lattice"],
      ["Deep", "Projects/Lattice/Sub"],
    ]);
    expect(plan.folders).toEqual(["Projects", "Projects/Lattice", "Projects/Lattice/Sub"]);
  });

  it("prefers a declared frontmatter title", () => {
    const plan = planVault([note("daily/2026-01-01.md", "---\ntitle: New Year\n---\n# Hi")]);
    expect(plan.pages[0].title).toBe("New Year");
  });

  it("ignores non-markdown files", () => {
    const plan = planVault([note("Vault/image.png", ""), note("Note.md", "")]);
    expect(plan.pages).toHaveLength(1);
  });

  it("strips the hash Notion appends to exported names", () => {
    const plan = planVault([
      note("Reading List 8f3ac1d2e4b54a6c8d9e0f1a2b3c4d5e.md", "# Reading"),
      note("Notes 1a2b3c4d5e6f708192a3b4c5d6e7f809/Page 9f8e7d6c5b4a39281706f5e4d3c2b1a0.md", ""),
    ]);
    expect(plan.pages.map((page) => [page.title, page.folder])).toEqual([
      ["Reading List", null],
      ["Page", "Notes"],
    ]);
    expect(plan.folders).toEqual(["Notes"]);
  });
});

describe("resolveVaultLinks", () => {
  const files = [
    note("Index.md", "Links to [[Alpha]] and [[Missing Note]] and [[Nested/Beta]]."),
    note("Alpha.md", "Back to [[Index]]."),
    note("Nested/Beta.md", "# Beta"),
  ];

  it("resolves by name and by path, and reports unresolved targets", () => {
    const plan = resolveVaultLinks(files, planVault(files));
    expect(plan.links).toEqual([
      { fromPath: "Index.md", toPath: "Alpha.md", label: null },
      { fromPath: "Index.md", toPath: "Nested/Beta.md", label: null },
      { fromPath: "Alpha.md", toPath: "Index.md", label: null },
    ]);
    expect(plan.unresolved).toEqual([{ fromPath: "Index.md", target: "Missing Note" }]);
  });

  it("keeps the alias as the link label", () => {
    const withAlias = [note("Index.md", "[[Alpha|the first note]]"), note("Alpha.md", "")];
    const plan = resolveVaultLinks(withAlias, planVault(withAlias));
    expect(plan.links[0]?.label).toBe("the first note");
  });

  it("does not link a note to itself", () => {
    const self = [note("Solo.md", "[[Solo]]")];
    const plan = resolveVaultLinks(self, planVault(self));
    expect(plan.links).toHaveLength(0);
  });

  it("refuses to guess when two notes share a file name", () => {
    const ambiguous = [
      note("Index.md", "[[Notes]]"),
      note("A/Notes.md", ""),
      note("B/Notes.md", ""),
    ];
    const plan = resolveVaultLinks(ambiguous, planVault(ambiguous));
    expect(plan.links).toHaveLength(0);
    expect(plan.unresolved).toEqual([{ fromPath: "Index.md", target: "Notes" }]);
  });

  it("matches a frontmatter alias", () => {
    const aliased = [
      note("Index.md", "[[the-deck]]"),
      note("Deck.md", "---\naliases: [the-deck, slides]\n---\n# Deck"),
    ];
    const plan = resolveVaultLinks(aliased, planVault(aliased));
    expect(plan.links).toEqual([{ fromPath: "Index.md", toPath: "Deck.md", label: null }]);
  });
});

describe("linkWikiLinks", () => {
  const doc = (text: string) => ({
    type: "doc" as const,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
  const targets = new Map([["Alpha", "page-a"]]);
  const resolve = (target: string) =>
    targets.has(target) ? { pageId: targets.get(target)!, title: target } : null;

  it("splits a resolved link into a pageLink node", () => {
    const result = linkWikiLinks(doc("See [[Alpha]] for detail."), resolve);
    expect(result.doc.content[0].content).toEqual([
      { type: "text", text: "See " },
      { type: "pageLink", attrs: { pageId: "page-a", title: "Alpha" } },
      { type: "text", text: " for detail." },
    ]);
    expect(result.linked).toBe(1);
    expect(result.unresolved).toEqual([]);
  });

  it("uses the alias as the label when one is given", () => {
    const result = linkWikiLinks(doc("[[Alpha|the first note]]"), resolve);
    expect(result.doc.content[0].content?.[0]).toEqual({
      type: "pageLink",
      attrs: { pageId: "page-a", title: "the first note" },
    });
  });

  it("reports unresolved targets and leaves their text alone", () => {
    const result = linkWikiLinks(doc("[[Nowhere]]"), resolve);
    expect(result.doc.content[0].content).toEqual([{ type: "text", text: "[[Nowhere]]" }]);
    expect(result.unresolved).toEqual(["Nowhere"]);
    expect(result.linked).toBe(0);
  });

  it("walks nested blocks such as lists and quotes", () => {
    const nested = {
      type: "doc" as const,
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "[[Alpha]]" }] }] },
          ],
        },
      ],
    };
    const result = linkWikiLinks(nested, resolve);
    expect(result.linked).toBe(1);
    expect(result.doc.content[0].content?.[0].content?.[0].content?.[0]).toEqual({
      type: "pageLink",
      attrs: { pageId: "page-a", title: "Alpha" },
    });
  });

  it("leaves documents without wiki links untouched", () => {
    const plain = doc("No links here.");
    expect(linkWikiLinks(plain, resolve).doc).toEqual(plain);
  });
});
