"use client";

import { formatRelative } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { RotateCcw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useTrashPages } from "@/hooks/use-local-data";
import { restorePageLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";

export function TrashView() {
  const router = useRouter();
  const { db } = useAppData();
  const pages = useTrashPages();

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

      <div className="mt-7 space-y-1">
        {pages.length ? (
          pages.map((page) => (
            <div
              key={page.id}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/35 px-3 py-2.5"
            >
              <span className="grid size-7 place-items-center rounded-lg border border-border/60 bg-background text-[12px]">
                {page.icon ?? "◇"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium">{page.title}</div>
                <div className="text-[8px] text-muted-foreground">
                  Deleted {page.deletedAt ? formatRelative(page.deletedAt) : "recently"}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-md text-[9px]"
                onClick={async () => {
                  if (!db) return;
                  await restorePageLocal(db, page.id);
                  toast.success("Page restored");
                  router.push(appRouteObject({ view: "page", id: page.id }));
                }}
              >
                <RotateCcw className="size-3" /> Restore
              </Button>
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
