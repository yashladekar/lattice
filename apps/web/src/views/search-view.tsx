"use client";

import { rankRecords } from "@notes-learning/domain";
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
  const [type, setType] = useState<"all" | "page" | "canvas" | "capture">("all");

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const docByPage = new Map(index.documents.map((document) => [document.pageId, document.plainText]));
    const records = [
      ...index.pages.map((page) => ({
        type: "page" as const,
        id: page.id,
        workspaceId: page.workspaceId,
        title: page.title,
        body: docByPage.get(page.id) ?? "",
        icon: page.icon,
        updatedAt: page.updatedAt,
      })),
      ...index.canvases.map((canvas) => ({
        type: "canvas" as const,
        id: canvas.id,
        workspaceId: canvas.workspaceId,
        title: canvas.title,
        body: canvas.data.elements
          .map((element) => ("text" in element ? element.text : element.type === "frame" ? element.title : ""))
          .join(" "),
        icon: canvas.icon,
        updatedAt: canvas.updatedAt,
      })),
      ...index.captures.map((capture) => ({
        type: "capture" as const,
        id: capture.id,
        workspaceId: capture.workspaceId,
        title: capture.title || capture.url || "Capture",
        body: `${capture.content ?? ""} ${capture.url ?? ""}`,
        icon: "⌁",
        updatedAt: capture.updatedAt,
      })),
    ];
    return rankRecords(records, query, 60).filter(
      (result) => type === "all" || result.type === type,
    );
  }, [index, query, type]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg border border-border/70 bg-card">
          <Search className="size-4 text-saffron" />
        </span>
        <div>
          <h1 className="font-display text-3xl tracking-[-0.03em]">Search knowledge</h1>
          <p className="text-[10px] text-muted-foreground">
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
          className="h-11 rounded-xl bg-card/60 pl-10 text-[13px]"
          autoFocus
        />
      </div>

      <div className="mt-3 flex items-center gap-1">
        {(["all", "page", "canvas", "capture"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setType(value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[9px] capitalize transition-colors",
              type === value
                ? "border-saffron/30 bg-saffron/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {value === "all" ? "Everything" : `${value}s`}
          </button>
        ))}
        <span className="ml-auto text-[9px] text-muted-foreground">
          {query ? `${results.length} results` : "Type to search"}
        </span>
      </div>

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
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-card text-[12px]">
              {result.icon ?? (result.type === "canvas" ? <Frame className="size-3.5" /> : result.type === "capture" ? <Inbox className="size-3.5" /> : <FileText className="size-3.5" />)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[12px] font-medium">{result.title}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[7px] uppercase tracking-[0.1em] text-muted-foreground">
                  {result.type}
                </span>
              </span>
              {result.snippet ? (
                <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-muted-foreground">
                  {result.snippet}
                </span>
              ) : null}
            </span>
            <span className="mt-1 flex shrink-0 items-center gap-1 text-[8px] text-muted-foreground">
              <Clock className="size-2.5" />
              {new Date(result.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </button>
        ))}
        {query && !results.length ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center">
            <Search className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-3 text-[12px] font-medium">No results for “{query}”</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Try fewer words or search in a different content type.
            </p>
          </div>
        ) : null}
        {!query ? (
          <div className="rounded-xl border border-dashed border-border py-14 text-center">
            <Search className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-3 text-[12px] font-medium">Search across your lattice</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Results include page bodies, whiteboard text, and captured links.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
