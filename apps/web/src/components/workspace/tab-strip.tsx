"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import { Columns2, Plus, X } from "lucide-react";
import { useRef } from "react";

import type { OpenTab } from "@/hooks/use-tabs";

export function TabStrip({
  tabs,
  activeKey,
  paneKey,
  onSelect,
  onClose,
  onNew,
  onTogglePane,
}: {
  tabs: OpenTab[];
  activeKey: string;
  paneKey: string | null;
  onSelect: (tab: OpenTab) => void;
  onClose: (key: string) => void;
  onNew: () => void;
  onTogglePane: (tab: OpenTab) => void;
}) {
  const stripRef = useRef<HTMLElement>(null);

  // A list of open documents, not an ARIA tab set: each item carries its own
  // split and close controls, which a `tab` role may not contain.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const items = Array.from(
      stripRef.current?.querySelectorAll<HTMLButtonElement>("[data-tab-select]") ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1 || items.length < 2) return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  };

  return (
    <nav
      ref={stripRef}
      aria-label="Open pages"
      onKeyDown={onKeyDown}
      className="flex h-8 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-background/55 px-2 no-scrollbar"
    >
      {tabs.map((tab) => {
        const title = tab.title || "Untitled";
        const active = activeKey === tab.key;
        return (
          <div
            key={tab.key}
            className={cn(
              "group flex h-7 shrink-0 items-center gap-1 rounded-md border border-transparent px-2 text-xs transition-colors",
              active
                ? "border-border/70 bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <button
              type="button"
              data-tab-select
              aria-current={active ? "page" : undefined}
              onClick={() => onSelect(tab)}
              className="flex min-w-0 items-center gap-1.5 self-stretch rounded text-sm"
            >
              <span aria-hidden className="text-xs">
                {tab.icon}
              </span>
              <span className="max-w-40 truncate">{title}</span>
            </button>
            <button
              type="button"
              aria-label={
                paneKey === tab.key ? `Close split view for ${title}` : `Open ${title} in split view`
              }
              title={paneKey === tab.key ? "Close split view" : "Open in split view"}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePane(tab);
              }}
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded hover:bg-muted hover:text-foreground",
                paneKey === tab.key ? "text-primary opacity-100" : "text-muted-foreground/50 hover-reveal",
              )}
            >
              <Columns2 className="size-3" />
            </button>
            {tab.key !== "home" ? (
              <button
                type="button"
                aria-label={`Close ${title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.key);
                }}
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground hover-reveal"
              >
                <X className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        onClick={onNew}
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
      >
        <Plus className="size-3" />
      </button>
    </nav>
  );
}
