import { describe, expect, it } from "vitest";

import { exportVaultMarkdown, stripPageIds } from "./vault-export";

const page = (overrides: Partial<Parameters<typeof exportVaultMarkdown>[0]["pages"][number]>) => ({
  id: "p1",
  title: "Spaced repetition",
  icon: "↺",
  notebookId: null as string | null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Review just before forgetting." }],
      },
      {
        type: "paragraph",
        content: [
          { type: "pageLink", attrs: { pageId: "p2", title: "Active recall" } },
        ],
      },
    ],
  },
  tags: [] as string[],
  ...overrides,
});

describe("vault export", () => {
  it("builds a markdown file with frontmatter and wiki links", () => {
    const files = exportVaultMarkdown({
      pages: [page({ tags: ["learning", "method"] })],
      notebooks: [],
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("Spaced repetition.md");
    expect(files[0]?.markdown).toContain("title: Spaced repetition");
    expect(files[0]?.markdown).toContain("tags: learning, method");
    expect(files[0]?.markdown).toContain("[[Active recall]]");
    expect(files[0]?.markdown).not.toContain("(p2)");
  });

  it("nests pages under their notebook path", () => {
    const files = exportVaultMarkdown({
      pages: [page({ notebookId: "child" })],
      notebooks: [
        { id: "root", name: "Learning lab", parentId: null },
        { id: "child", name: "Methods", parentId: "root" },
      ],
    });
    expect(files[0]?.path).toBe("Learning lab/Methods/Spaced repetition.md");
  });

  it("sanitizes path characters and de-duplicates names", () => {
    const files = exportVaultMarkdown({
      pages: [
        page({ id: "a", title: "A/B: test" }),
        page({ id: "b", title: "A/B: test" }),
        page({ id: "c", title: "..." }),
      ],
      notebooks: [],
    });
    expect(files[0]?.path).toBe("A-B- test.md");
    expect(files[1]?.path).toBe("A-B- test 2.md");
    expect(files[2]?.path).toBe("Untitled.md");
  });

  it("quotes frontmatter values that YAML would misread", () => {
    const files = exportVaultMarkdown({
      pages: [page({ title: "Order: chaos" })],
      notebooks: [],
    });
    expect(files[0]?.markdown).toContain('title: "Order: chaos"');
  });

  it("strips only the page-id suffix from links", () => {
    expect(stripPageIds("See [[Note]](abc) and [[Other]](def).")).toBe(
      "See [[Note]] and [[Other]].",
    );
  });
});
