"use client";

import { formatDate, formatRelative } from "@notes-learning/domain";
import { Clock, FileText, Frame, Inbox } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import {
  useCaptures,
  useDueFlashcards,
  useWorkspaceCanvases,
  useWorkspacePages,
} from "@/hooks/use-local-data";
import { appRouteObject } from "@/lib/navigation";

export function TimelineView() {
  const router = useRouter();
  const pages = useWorkspacePages();
  const canvases = useWorkspaceCanvases();
  const captures = useCaptures();
  const cards = useDueFlashcards();

  const groups = useMemo(() => {
    const entries = [
      ...pages.map((page) => ({
        id: page.id,
        kind: "page" as const,
        title: page.title,
        icon: page.icon,
        time: page.updatedAt,
      })),
      ...canvases.map((canvas) => ({
        id: canvas.id,
        kind: "canvas" as const,
        title: canvas.title,
        icon: canvas.icon,
        time: canvas.updatedAt,
      })),
      ...captures.map((capture) => ({
        id: capture.id,
        kind: "capture" as const,
        title: capture.title || capture.url || "Capture",
        icon: "⌁",
        time: capture.createdAt,
      })),
    ].sort((a, b) => b.time.localeCompare(a.time));

    const map = new Map<string, typeof entries>();
    for (const entry of entries) {
      const key = formatDate(entry.time);
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [pages, canvases, captures]);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg border border-border/70 bg-card">
          <Clock className="size-4 text-sky" />
        </span>
        <div>
          <h1 className="font-display text-3xl tracking-[-0.03em]">Timeline</h1>
          <p className="text-[10px] text-muted-foreground">
            How your thinking has moved across pages, canvases, and captures.
          </p>
        </div>
        <div className="ml-auto rounded-full border border-border px-2 py-1 text-[9px] text-muted-foreground">
          {cards.length} cards due
        </div>
      </div>

      <div className="mt-8 space-y-8">
        {groups.length ? (
          groups.map(([day, entries]) => (
            <section key={day}>
              <div className="sticky top-0 z-10 -mx-2 flex items-center gap-2 bg-background/90 px-2 py-1.5 backdrop-blur">
                <span className="text-[10px] font-medium">{day}</span>
                <span className="h-px flex-1 bg-border/60" />
                <span className="text-[8px] text-muted-foreground">{entries.length} updates</span>
              </div>
              <div className="mt-2 space-y-1 border-l border-border/60 pl-4">
                {entries.map((entry) => (
                  <button
                    key={`${entry.kind}-${entry.id}`}
                    type="button"
                    onClick={() =>
                      router.push(
                        appRouteObject({
                          view:
                            entry.kind === "page"
                              ? "page"
                              : entry.kind === "canvas"
                                ? "canvas"
                                : "inbox",
                          id: entry.kind === "capture" ? undefined : entry.id,
                        }),
                      )
                    }
                    className="group relative flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-card/60"
                  >
                    <span className="absolute -left-[21px] size-2 rounded-full border border-background bg-border group-hover:bg-saffron" />
                    <span className="grid size-6 place-items-center rounded-md border border-border/60 bg-card text-[10px]">
                      {entry.kind === "canvas" ? (
                        <Frame className="size-3 text-moss" />
                      ) : entry.kind === "capture" ? (
                        <Inbox className="size-3 text-saffron" />
                      ) : (
                        entry.icon ?? <FileText className="size-3" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px]">{entry.title}</span>
                    <span className="text-[8px] text-muted-foreground">{formatRelative(entry.time)}</span>
                  </button>
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <Clock className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-3 text-[12px] font-medium">Your timeline is quiet</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Create a page or capture something to see activity here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
