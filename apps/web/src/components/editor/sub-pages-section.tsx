"use client";

import { formatRelative } from "@notes-learning/domain";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useChildPages } from "@/hooks/use-local-data";
import { createSubPageLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";

export function SubPagesSection({ pageId }: { pageId: string }) {
  const router = useRouter();
  const { db, user } = useAppData();
  const children = useChildPages(pageId);
  const [open, setOpen] = useState(true);
  const [creating, setCreating] = useState(false);

  const addSubPage = async () => {
    if (!db || !user || creating) return;
    setCreating(true);
    try {
      const created = await createSubPageLocal(db, { parentId: pageId, userId: user.id });
      toast.success("Sub-page created");
      router.push(appRouteObject({ view: "page", id: created.page.id }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a sub-page");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-9">
      {children.length ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={open ? "Collapse sub-pages" : "Expand sub-pages"}
            onClick={() => setOpen((value) => !value)}
            className="grid size-4 place-items-center rounded text-muted-foreground/60 hover:bg-muted"
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
            Sub-pages · {children.length}
          </span>
        </div>
      ) : null}
      {open ? (
        <div className="mt-1 space-y-0.5">
          {children.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => router.push(appRouteObject({ view: "page", id: child.id }))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
            >
              <span className="w-4 shrink-0 text-center text-[11px] text-muted-foreground">
                {child.icon ?? "◇"}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground/90">
                {child.title || "Untitled"}
              </span>
              <span className="shrink-0 text-[8.5px] text-muted-foreground/60">
                {formatRelative(child.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => void addSubPage()}
        disabled={creating}
        className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-border/60 px-2 py-1.5 text-left text-[10px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:opacity-60"
      >
        <Plus className="size-3" />
        {creating ? "Creating…" : "Add a sub-page"}
      </button>
    </div>
  );
}
