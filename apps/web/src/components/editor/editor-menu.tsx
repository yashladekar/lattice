"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import { CornerDownLeft, Search } from "lucide-react";
import { createPortal } from "react-dom";

import type { EditorMenuItem, EditorMenuState } from "./menu-types";

export function EditorMenu({
  state,
  selected,
  onSelect,
  onHover,
}: {
  state: EditorMenuState | null;
  selected: number;
  onSelect: (item: EditorMenuItem) => void;
  onHover: (index: number) => void;
}) {
  if (!state?.rect || typeof document === "undefined") return null;
  const width = state.kind === "slash" ? 330 : 310;
  const left = Math.min(Math.max(8, state.rect.left), window.innerWidth - width - 12);
  const estimatedHeight = Math.min(330, state.items.length * 42 + 60);
  const top =
    state.rect.bottom + estimatedHeight + 16 < window.innerHeight
      ? state.rect.bottom + 8
      : Math.max(8, state.rect.top - estimatedHeight - 8);

  let lastGroup = "";

  return createPortal(
    <div
      className="fixed z-[90] overflow-hidden rounded-xl border border-border bg-popover shadow-[0_20px_60px_-20px_color-mix(in_oklch,var(--foreground)_45%,transparent)]"
      style={{ left, top, width }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <Search className="size-3 text-muted-foreground/60" />
        <span className="flex-1 truncate text-[10px] text-muted-foreground">
          {state.kind === "slash"
            ? state.query
              ? `Blocks matching “${state.query}”`
              : "Insert a block"
            : state.kind === "page"
              ? state.query
                ? `Pages matching “${state.query}”`
                : "Link a page"
              : state.query
                ? `Matching “${state.query}”`
                : "Mention a page, person, or date"}
        </span>
        <span className="kbd">esc</span>
      </div>
      <div className="max-h-[290px] overflow-y-auto p-1">
        {state.items.length ? (
          state.items.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {showGroup ? (
                  <div className="px-2 pb-0.5 pt-1.5 text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/55">
                    {item.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  onMouseEnter={() => onHover(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onSelect(item);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                    selected === index
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border/60 bg-background/70 text-muted-foreground">
                    {item.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-foreground">
                      {item.label}
                    </span>
                    {item.description ? (
                      <span className="block truncate text-[9px] text-muted-foreground">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {selected === index ? (
                    <CornerDownLeft className="size-3 shrink-0 text-muted-foreground/60" />
                  ) : null}
                </button>
              </div>
            );
          })
        ) : (
          <div className="px-3 py-8 text-center text-[10px] text-muted-foreground">
            No matching items.
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border/60 px-3 py-1.5 text-[8px] text-muted-foreground">
        <span>↑↓ navigate · ↵ insert</span>
        <span className="font-mono">lattice</span>
      </div>
    </div>,
    document.body,
  );
}
