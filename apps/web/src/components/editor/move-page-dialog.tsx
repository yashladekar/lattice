"use client";

import { descendantPageIds } from "@notes-learning/domain";
import { Input } from "@notes-learning/ui/components/input";
import { CornerUpLeft, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { useWorkspacePages } from "@/hooks/use-local-data";
import { updatePageLocal } from "@/lib/local/repository";
import type { LocalPage } from "@/lib/local/types";

export function MovePageDialog({
  open,
  page,
  onClose,
}: {
  open: boolean;
  page: LocalPage;
  onClose: () => void;
}) {
  const { db } = useAppData();
  const pages = useWorkspacePages();
  const [query, setQuery] = useState("");

  const excluded = useMemo(
    () => new Set([page.id, ...descendantPageIds(page.id, pages)]),
    [page.id, pages],
  );

  const targets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return pages
      .filter((entry) => !excluded.has(entry.id))
      .filter((entry) => (normalized ? entry.title.toLowerCase().includes(normalized) : true))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 60);
  }, [pages, excluded, query]);

  const move = async (target: LocalPage | null) => {
    if (!db) return;
    try {
      const ids = [page.id, ...descendantPageIds(page.id, pages)];
      for (const id of ids) {
        await updatePageLocal(db, {
          pageId: id,
          ...(id === page.id ? { parentId: target?.id ?? null } : {}),
          ...(target ? { notebookId: target.notebookId } : {}),
        });
      }
      toast.success(
        target ? `Moved under “${target.title || "Untitled"}”` : "Moved to the top level",
      );
      setQuery("");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move the page");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move page"
      description="Choose a new parent. A page cannot move inside itself or one of its own sub-pages."
    >
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a parent page…"
          className="h-9 rounded-lg pl-8 text-[12px]"
          autoFocus
        />
      </div>
      <div className="mt-3 max-h-64 space-y-0.5 overflow-y-auto">
        <button
          type="button"
          onClick={() => void move(null)}
          disabled={page.parentId === null}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CornerUpLeft className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[11px]">No parent (top level)</span>
        </button>
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            onClick={() => void move(target)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
          >
            <span className="w-4 text-center text-[11px]">{target.icon ?? "◇"}</span>
            <span className="min-w-0 flex-1 truncate text-[11px]">
              {target.title || "Untitled"}
            </span>
            <span className="shrink-0 text-[8px] text-muted-foreground">Page</span>
          </button>
        ))}
        {!targets.length ? (
          <div className="py-8 text-center">
            <FileText className="mx-auto size-5 text-muted-foreground/40" />
            <p className="mt-2 text-[10px] text-muted-foreground">No other pages match.</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
