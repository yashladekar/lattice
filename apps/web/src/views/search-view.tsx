"use client";

import {
  hasSearchFilters,
  parseSearchQuery,
  rankRecords,
  type SearchType,
} from "@notes-learning/domain";
import { Input } from "@notes-learning/ui/components/input";
import { cn } from "@notes-learning/ui/lib/utils";
import { Clock, FileText, Frame, Inbox, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useWorkspaceSearchIndex } from "@/hooks/use-local-data";
import { appRouteObject } from "@/lib/navigation";

export function SearchView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const index = useWorkspaceSearchIndex();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const hasFilters = hasSearchFilters(parsed);

  const typeToggle = (value: SearchType) => {
    const next = parsed.types.includes(value)
      ? parsed.types.filter((entry) => entry !== value)
      : [...parsed.types, value];
    const operators = [
      ...next.map((entry) => `type:${entry}`),
      ...parsed.tags.map((tag) => `tag:${tag.includes(" ") ? `"${tag}"` : tag}`),
      ...parsed.notebooks.map(
        (notebook) => `notebook:${notebook.includes(" ") ? `"${notebook}"` : notebook}`,
      ),
    ];
    setQuery([parsed.text, ...operators].filter(Boolean).join(" "));
  };

  const results = useMemo(() => {
    if (!parsed.text && !hasFilters) return [];

    const docByPage = new Map(
      index.documents.map((document) => [document.pageId, document.plainText]),
    );
    const tagNameById = new Map(index.tags.map((tag) => [tag.id, tag.name.toLowerCase()]));
    const tagsByPage = new Map<string, Set<string>>();
    for (const link of index.pageTags) {
      const name = tagNameById.get(link.tagId);
      if (!name) continue;
      const set = tagsByPage.get(link.pageId) ?? new Set<string>();
      set.add(name);
      tagsByPage.set(link.pageId, set);
    }
    const notebookName = new Map(
      index.notebooks.map((notebook) => [notebook.id, notebook.name.toLowerCase()]),
    );

    const wantsType = (type: SearchType) =>
      parsed.types.length === 0 || parsed.types.includes(type);
    const matchesNotebook = (notebookId: string | null) => {
      if (!parsed.notebooks.length) return true;
      if (!notebookId) return false;
      const name = notebookName.get(notebookId) ?? "";
      return parsed.notebooks.some(
        (value) => value === notebookId.toLowerCase() || name === value || name.includes(value),
      );
    };
    const matchesTags = (pageId: string) => {
      if (!parsed.tags.length) return true;
      const set = tagsByPage.get(pageId);
      return Boolean(set) && parsed.tags.every((tag) => set?.has(tag));
    };
    // Tags only exist on pages, so a tag filter narrows the result kinds.
    const tagFiltered = parsed.tags.length > 0;

    const records = [
      ...(wantsType("page")
        ? index.pages
            .filter((page) => matchesTags(page.id) && matchesNotebook(page.notebookId))
            .map((page) => ({
              type: "page" as const,
              id: page.id,
              workspaceId: page.workspaceId,
              title: page.title,
              body: docByPage.get(page.id) ?? "",
              icon: page.icon,
              updatedAt: page.updatedAt,
            }))
        : []),
      ...(!tagFiltered && wantsType("canvas")
        ? index.canvases
            .filter((canvas) => matchesNotebook(canvas.notebookId))
            .map((canvas) => ({
              type: "canvas" as const,
              id: canvas.id,
              workspaceId: canvas.workspaceId,
              title: canvas.title,
              body: canvas.data.elements
                .map((element) =>
                  "text" in element
                    ? element.text
                    : element.type === "frame"
                      ? element.title
                      : "",
                )
                .join(" "),
              icon: canvas.icon,
              updatedAt: canvas.updatedAt,
            }))
        : []),
      ...(!tagFiltered && wantsType("capture")
        ? index.captures.map((capture) => ({
            type: "capture" as const,
            id: capture.id,
            workspaceId: capture.workspaceId,
            title: capture.title || capture.url || "Capture",
            body: `${capture.content ?? ""} ${capture.url ?? ""}`,
            icon: "⌁",
            updatedAt: capture.updatedAt,
          }))
        : []),
    ];

    if (!parsed.text) {
      return records
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 60)
        .map((record) => ({
          ...record,
          snippet: record.body.replace(/\s+/g, " ").trim().slice(0, 140),
        }));
    }
    return rankRecords(records, parsed.text, 60);
  }, [index, parsed, hasFilters]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg border border-border/70 bg-card">
          <Search className="size-4 text-saffron" />
        </span>
        <div>
          <h1 className="font-display text-3xl tracking-[-0.03em]">Search knowledge</h1>
          <p className="text-xs text-muted-foreground">
            Local, instant, across every note and canvas on this device.
          </p>
        </div>
      </div>

      <div className="relative mt-6">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles, text, canvas notes, and captures…"
          className="h-11 rounded-xl bg-card/60 pl-10 text-sm"
          autoFocus
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => setQuery(parsed.text)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            parsed.types.length === 0
              ? "border-saffron/30 bg-saffron/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          Everything
        </button>
        {(["page", "canvas", "capture"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => typeToggle(value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors",
              parsed.types.includes(value)
                ? "border-saffron/30 bg-saffron/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {value === "page" ? "Pages" : value === "canvas" ? "Canvases" : "Captures"}
          </button>
        ))}
        {parsed.tags.map((tag) => (
          <span
            key={`tag-${tag}`}
            className="rounded-full border border-sky/30 bg-sky/10 px-2 py-1 text-xs text-foreground"
          >
            #{tag}
          </span>
        ))}
        {parsed.notebooks.map((notebook) => (
          <span
            key={`notebook-${notebook}`}
            className="rounded-full border border-moss/30 bg-moss/10 px-2 py-1 text-xs text-foreground"
          >
            in: {notebook}
          </span>
        ))}
        {hasFilters ? (
          <button
            type="button"
            onClick={() => setQuery(parsed.text)}
            className="rounded-full px-1.5 py-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear filters
          </button>
        ) : null}
        <span className="ml-auto text-xs text-muted-foreground">
          {query ? `${results.length} results` : "Type to search"}
        </span>
      </div>

      {!query ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Narrow results with <code className="rounded bg-muted px-1">tag:</code>{" "}
          <code className="rounded bg-muted px-1">type:</code>{" "}
          <code className="rounded bg-muted px-1">notebook:</code> — for example{" "}
          <code className="rounded bg-muted px-1">tag:research type:page</code>. Clicking a tag in the
          sidebar does the same thing.
        </p>
      ) : null}

      <div className="mt-5 space-y-1">
        {results.map((result) => (
          <button
            key={`${result.type}-${result.id}`}
            type="button"
            onClick={() =>
              router.push(
                appRouteObject({
                  view:
                    result.type === "page"
                      ? "page"
                      : result.type === "canvas"
                        ? "canvas"
                        : "inbox",
                  id: result.type === "capture" ? undefined : result.id,
                }),
              )
            }
            className="flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border/60 hover:bg-card/50"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-card text-xs">
              {result.icon ?? (result.type === "canvas" ? <Frame className="size-3.5" /> : result.type === "capture" ? <Inbox className="size-3.5" /> : <FileText className="size-3.5" />)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{result.title}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-xs uppercase tracking-[0.1em] text-muted-foreground">
                  {result.type}
                </span>
              </span>
              {result.snippet ? (
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                  {result.snippet}
                </span>
              ) : null}
            </span>
            <span className="mt-1 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-2.5" />
              {new Date(result.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </button>
        ))}
        {query && !results.length ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center">
            <Search className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-3 text-xs font-medium">No results for “{query}”</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasFilters
                ? "Try removing a filter, or widen the content type."
                : "Try fewer words or search in a different content type."}
            </p>
          </div>
        ) : null}
        {!query ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center">
            <Search className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-3 text-xs font-medium">Search across your lattice</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Results include page bodies, whiteboard text, and captured links.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
