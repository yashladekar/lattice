"use client";

import {
  buildTrashTree,
  formatRelative,
  isPurgeable,
  type TrashPageGroup,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useTrashPages } from "@/hooks/use-local-data";
import type { LocalPage } from "@/lib/local/types";
import { restorePageLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";

export function TrashView() {
  const router = useRouter();
  const { db, activeWorkspace } = useAppData();
  const pages = useTrashPages();
  const retentionDays = activeWorkspace?.trashRetentionDays ?? 0;
  const visiblePages =
    retentionDays > 0 ? pages.filter((page) => !isPurgeable(page.deletedAt, retentionDays)) : pages;
  const groups = buildTrashTree(visiblePages);

  const restore = async (pageId: string, navigate = true) => {
    if (!db) return;
    await restorePageLocal(db, pageId);
    toast.success("Page restored");
    if (navigate) router.push(appRouteObject({ view: "page", id: pageId }));
  };

  const renderChild = (group: TrashPageGroup<LocalPage>, depth: number) => (
    <div key={group.page.id}>
      <div
        className="flex items-center gap-2 rounded-md py-1 pr-1 hover:bg-muted/40"
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        <span className="w-4 shrink-0 text-center text-[11px] text-muted-foreground">
          {group.page.icon ?? "◇"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground/90">
          {group.page.title || "Untitled"}
        </span>
        <button
          type="button"
          onClick={() => void restore(group.page.id, false)}
          className="shrink-0 rounded px-1 text-[8px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Restore
        </button>
      </div>
      {group.children.map((child) => renderChild(child, depth + 1))}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg border border-border/70 bg-card">
          <Trash2 className="size-4 text-destructive" />
        </span>
        <div>
          <h1 className="font-display text-3xl tracking-[-0.03em]">Trash</h1>
          <p className="text-[10px] text-muted-foreground">
            Deleted pages stay recoverable. Nothing is purged silently.
          </p>
        </div>
      </div>

      {retentionDays > 0 ? (
        <p className="mt-4 rounded-lg border border-saffron/25 bg-saffron/[0.05] px-3 py-2 text-[9px] leading-relaxed text-muted-foreground">
          This workspace keeps trash for {retentionDays} days. Older items have been permanently
          removed by the server and no longer appear here. Change the window in Settings →
          General.
        </p>
      ) : null}

      <div className="mt-7 space-y-2">
        {groups.length ? (
          groups.map((group) => (
            <div key={group.page.id} className="rounded-xl border border-border/60 bg-card/35">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-background text-[12px]">
                  {group.page.icon ?? "◇"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[11px] font-medium">
                      {group.page.title || "Untitled"}
                    </span>
                    {group.descendantCount ? (
                      <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[8px] text-muted-foreground">
                        {group.descendantCount} sub-page
                        {group.descendantCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[8px] text-muted-foreground">
                    Deleted{" "}
                    {group.page.deletedAt ? formatRelative(group.page.deletedAt) : "recently"}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  onClick={() => void restore(group.page.id)}
                >
                  <RotateCcw className="size-3" /> Restore
                </Button>
              </div>
              {group.children.length ? (
                <div className="border-t border-border/40 px-3 pb-2 pt-1">
                  <div className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground/60">
                    Sub-pages · {group.descendantCount}
                  </div>
                  {group.children.map((child) => renderChild(child, 0))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            <Trash2 className="mx-auto size-6 text-muted-foreground/40" />
            <p className="mt-3 text-[12px] font-medium">Trash is empty</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Deleted pages will appear here with a restore action.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
