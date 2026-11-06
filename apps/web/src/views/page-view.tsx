"use client";

import { extractOutline } from "@notes-learning/domain";
import { ArrowLeft, FileQuestion } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageContextPanel } from "@/components/editor/page-context-panel";
import { PageEditor } from "@/components/editor/page-editor";
import { usePage, usePageDocument } from "@/hooks/use-local-data";
import { appHref } from "@/lib/navigation";

export function PageView({
  pageId,
  rightPanelOpen,
  onOpenRightPanel,
  onToggleRightPanel,
  onShare,
  onToggleFocus,
  compact = false,
}: {
  pageId: string | null;
  rightPanelOpen: boolean;
  onOpenRightPanel: () => void;
  onToggleRightPanel: () => void;
  onShare: () => void;
  onToggleFocus: () => void;
  compact?: boolean;
}) {
  const page = usePage(pageId);
  const document = usePageDocument(pageId);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const outline = useMemo(
    () => (document ? extractOutline(document.content) : []),
    [document?.content],
  );

  useEffect(() => {
    setFocusBlockId(null);
  }, [pageId]);

  if (!pageId) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <FileQuestion className="mx-auto size-8 text-muted-foreground/40" />
          <h2 className="mt-3 font-display text-2xl">No page selected</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose a page from the sidebar or press ⌘K to search.
          </p>
          <Link href={appHref({ view: "home" })} className="mt-4 inline-flex items-center gap-1 text-xs text-link">
            <ArrowLeft className="size-3" /> Back home
          </Link>
        </div>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <FileQuestion className="mx-auto size-8 text-muted-foreground/40" />
          <h2 className="mt-3 font-display text-2xl">Page not available</h2>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            It may have been deleted, or it is private to another collaborator.
          </p>
          <Link href={appHref({ view: "home" })} className="mt-4 inline-flex items-center gap-1 text-xs text-link">
            <ArrowLeft className="size-3" /> Back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <PageEditor
          key={page.id}
          pageId={page.id}
          onShare={onShare}
          onOpenContext={() => {
            if (!rightPanelOpen) onOpenRightPanel();
          }}
          onCommentBlock={(blockId) => {
            setFocusBlockId(blockId || null);
            if (!rightPanelOpen) onOpenRightPanel();
          }}
          onToggleFocus={onToggleFocus}
        />
      </div>
      {rightPanelOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-foreground/20 backdrop-blur-[1px] xl:static xl:z-auto xl:bg-transparent xl:backdrop-blur-none">
          <button
            type="button"
            onClick={onToggleRightPanel}
            aria-label="Close page context"
            className="absolute inset-0 xl:hidden"
          />
          <div className="relative h-full">
            <PageContextPanel
              page={page}
              outline={outline}
              focusBlockId={focusBlockId}
              onClearBlock={() => setFocusBlockId(null)}
              onClose={onToggleRightPanel}
            />
          </div>
        </div>
      ) : compact ? null : (
        <button
          type="button"
          onClick={onToggleRightPanel}
          className="hidden w-7 shrink-0 items-start justify-center border-l border-border/50 pt-4 text-muted-foreground/40 hover:bg-muted/30 hover:text-foreground xl:flex"
          aria-label="Open page context"
        >
          <span className="rotate-90 whitespace-nowrap text-xs uppercase tracking-[0.15em]">Context</span>
        </button>
      )}
    </div>
  );
}
