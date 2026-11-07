"use client";

import { Input } from "@notes-learning/ui/components/input";
import { cn } from "@notes-learning/ui/lib/utils";
import { FileText, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { useWorkspacePages } from "@/hooks/use-local-data";
import { createPageLocal } from "@/lib/local/repository";

export function PagePickerDialog({
  open,
  mode,
  onClose,
  onPick,
}: {
  open: boolean;
  mode: "link" | "embed" | "live";
  onClose: () => void;
  onPick: (pageId: string, title: string, icon: string | null) => void | Promise<void>;
}) {
  const { db, user, activeWorkspaceId } = useAppData();
  const pages = useWorkspacePages();
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      pages
        .filter((page) => page.title.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 40),
    [pages, query],
  );

  const createAndPick = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const created = await createPageLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId: null,
      title: query.trim() || "Linked page",
    });
    await onPick(created.page.id, created.page.title, created.page.icon);
    toast.success("Page created and linked");
    setQuery("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === "embed" ? "Embed a page" : mode === "live" ? "Sync a block" : "Link a page"}
      description={
        mode === "embed"
          ? "The page stays live: edits in the source appear here."
          : mode === "live"
            ? "Mirror a block from another page. Changes stay in sync."
            : "Create a durable connection in the knowledge graph."
      }
    >
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a page…"
          className="h-9 rounded-lg pl-8 text-[12px]"
          autoFocus
        />
      </div>
      <div className="mt-3 max-h-64 space-y-0.5 overflow-y-auto">
        {filtered.map((page) => (
          <button
            key={page.id}
            type="button"
            onClick={async () => {
              await onPick(page.id, page.title, page.icon);
              setQuery("");
              onClose();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60",
            )}
          >
            <span className="w-4 text-center text-[11px]">{page.icon ?? "◇"}</span>
            <span className="min-w-0 flex-1 truncate text-[11px]">{page.title}</span>
            <span className="text-[8px] text-muted-foreground">
              {new Date(page.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </button>
        ))}
        {!filtered.length ? (
          <div className="py-8 text-center">
            <FileText className="mx-auto size-5 text-muted-foreground/40" />
            <p className="mt-2 text-[10px] text-muted-foreground">No pages match.</p>
            <button
              type="button"
              onClick={() => void createAndPick()}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[10px] hover:bg-muted"
            >
              <Plus className="size-3" /> Create “{query.trim() || "Linked page"}”
            </button>
          </div>
        ) : null}
      </div>
      {query.trim() ? (
        <button
          type="button"
          onClick={() => void createAndPick()}
          className="mt-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-2 py-2 text-left text-[10px] text-muted-foreground hover:bg-muted/50"
        >
          <Plus className="size-3" /> Create a new page called “{query.trim()}”
        </button>
      ) : null}
    </Modal>
  );
}
