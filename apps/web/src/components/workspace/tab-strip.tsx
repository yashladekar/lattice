"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import { Plus, X } from "lucide-react";

import type { OpenTab } from "@/hooks/use-tabs";

export function TabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: OpenTab[];
  activeKey: string;
  onSelect: (tab: OpenTab) => void;
  onClose: (key: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex h-8 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-background/55 px-2 no-scrollbar">
      {tabs.map((tab) => (
        <div
          key={tab.key}
          className={cn(
            "group flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2 text-[10px] transition-colors",
            activeKey === tab.key
              ? "border-border/70 bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <button type="button" onClick={() => onSelect(tab)} className="flex items-center gap-1.5">
            <span className="text-[10px]">{tab.icon}</span>
            <span className="max-w-40 truncate">{tab.title || "Untitled"}</span>
          </button>
          {tab.key !== "home" ? (
            <button
              type="button"
              aria-label="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.key);
              }}
              className="grid size-3.5 place-items-center rounded text-muted-foreground/50 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
            >
              <X className="size-2.5" />
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        aria-label="New tab"
        onClick={onNew}
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}
