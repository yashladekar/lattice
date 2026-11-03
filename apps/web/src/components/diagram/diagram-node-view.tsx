"use client";

import {
  DEFAULT_DIAGRAM_SOURCE,
  diagramTypeOf,
  normalizeDiagramSource,
} from "@notes-learning/domain";
import { cn } from "@notes-learning/ui/lib/utils";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Check, Maximize2, Minimize2, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";

import { MermaidDiagram, type DiagramStatus } from "./mermaid-diagram";

export function DiagramNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const source = typeof node.attrs.source === "string" ? node.attrs.source : "";
  const caption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  const [editing, setEditing] = useState(!source.trim());
  const [draft, setDraft] = useState(source);
  const [captionDraft, setCaptionDraft] = useState(caption);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<DiagramStatus>("rendering");

  useEffect(() => {
    if (editing) return;
    setDraft(source);
  }, [source, editing]);

  useEffect(() => {
    if (editing) return;
    setCaptionDraft(caption);
  }, [caption, editing]);

  const apply = () => {
    updateAttributes({
      source: normalizeDiagramSource(draft) || DEFAULT_DIAGRAM_SOURCE,
      caption: captionDraft.trim(),
    });
    setEditing(false);
  };

  const cancel = () => {
    setDraft(source);
    setCaptionDraft(caption);
    setEditing(false);
  };

  return (
    <NodeViewWrapper
      className={cn(
        "diagram-block my-4 rounded-xl border border-border/80 bg-card/50 transition-shadow",
        selected && "ring-2 ring-primary/40",
        expanded && "diagram-expanded",
      )}
    >
      <div
        className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5"
        data-drag-handle
      >
        <span className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
          {editing ? "Diagram source" : `${diagramTypeOf(source)} diagram`}
        </span>
        {status === "error" && !editing ? (
          <span className="rounded-full border border-destructive/30 px-1.5 py-0.5 text-[8px] text-destructive">
            needs fixing
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-0.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancel}
                title="Cancel"
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
              <button
                type="button"
                onClick={apply}
                title="Apply source"
                className="grid size-6 place-items-center rounded text-moss hover:bg-moss/10"
              >
                <Check className="size-3" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                title={expanded ? "Collapse" : "Expand"}
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {expanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Edit diagram"
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil className="size-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {editing ? (
        <div className="p-3">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
            spellCheck={false}
            rows={Math.min(18, Math.max(6, draft.split("\n").length + 1))}
            placeholder={DEFAULT_DIAGRAM_SOURCE}
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-primary/40"
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={captionDraft}
              onChange={(event) => setCaptionDraft(event.target.value)}
              placeholder="Caption (optional)"
              className="h-7 flex-1 rounded-md border border-border bg-background px-2 text-[10px] outline-none focus:border-primary/40"
            />
            <span className="text-[9px] text-muted-foreground">⌘↵ to apply</span>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <MermaidDiagram
            source={source || DEFAULT_DIAGRAM_SOURCE}
            className={expanded ? "max-h-[70vh]" : "max-h-80"}
            onStatusChange={setStatus}
          />
          {caption ? (
            <p className="mt-2 text-center text-[9.5px] text-muted-foreground">{caption}</p>
          ) : null}
        </div>
      )}
    </NodeViewWrapper>
  );
}
