"use client";

import { describeAgentOp, nodePlainText, type AgentOp } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { Check, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import type { ApplyAgentPlanResult } from "@/lib/local/apply-agent-plan";

function previewOf(op: AgentOp): string {
  if (op.kind === "append_blocks" || op.kind === "insert_blocks" || op.kind === "replace_blocks") {
    const text = op.nodes
      .map((node) => nodePlainText(node))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 160 ? `${text.slice(0, 160)}…` : text || "Empty block";
  }
  if (op.kind === "replace_page") {
    const text = op.markdown.replace(/\s+/g, " ").trim();
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  if (op.kind === "create_page") {
    const text = op.markdown.replace(/\s+/g, " ").trim();
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  if (op.kind === "link_pages") {
    return op.label ?? op.relationType.toLowerCase().replace(/_/g, " ");
  }
  return op.cards.map((card) => card.front).join(" · ");
}

function targetOf(
  op: AgentOp,
  pageTitles: Record<string, string>,
  refTitles: Map<string, string>,
): string | null {
  const title = (pageId: string) => pageTitles[pageId] ?? refTitles.get(pageId) ?? "a page";
  switch (op.kind) {
    case "append_blocks":
    case "insert_blocks":
    case "replace_blocks":
    case "replace_page":
    case "create_flashcards":
      return title(op.pageId);
    case "link_pages":
      return `${title(op.sourcePageId)} → ${title(op.targetPageId)}`;
    case "create_page":
      return op.parentPageId ? `under ${title(op.parentPageId)}` : "workspace";
  }
}

export function AgentPlanCard({
  title,
  ops,
  warnings,
  pageTitles,
  appliedAt,
  onApply,
  onDiscard,
}: {
  title: string;
  ops: AgentOp[];
  warnings: string[];
  pageTitles: Record<string, string>;
  /** Set once this plan has been applied, locally or on another device. */
  appliedAt?: string;
  onApply: () => Promise<ApplyAgentPlanResult>;
  onDiscard: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyAgentPlanResult | null>(null);
  // A ref, not state: two clicks in the same tick would both pass a state check.
  const applying = useRef(false);

  // Pages this plan creates are referenced by alias until Apply, so preview the
  // titles the plan itself proposes rather than "a page".
  const refTitles = new Map<string, string>();
  for (const op of ops) {
    if (op.kind === "create_page" && op.ref) refTitles.set(op.ref, op.title);
  }

  const apply = async () => {
    if (applying.current || appliedAt) return;
    applying.current = true;
    setBusy(true);
    try {
      setResult(await onApply());
    } finally {
      applying.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-saffron/40 bg-saffron/5 p-2.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3 text-saffron" />
        <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Proposed plan
        </span>
        <span className="ml-auto text-[8px] text-muted-foreground">
          {ops.length} change{ops.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-1 text-[10px] font-medium">{title}</div>

      <ol className="mt-2 space-y-1">
        {ops.map((op, index) => (
          <li
            key={`${op.kind}-${index}`}
            className="rounded-lg border border-border/60 bg-background/60 px-2 py-1.5"
          >
            <div className="flex items-baseline gap-1.5">
              <span className="text-[8px] text-saffron">{index + 1}</span>
              <span className="text-[9px] font-medium">{describeAgentOp(op)}</span>
              <span className="ml-auto truncate text-[8px] text-muted-foreground">
                {targetOf(op, pageTitles, refTitles)}
              </span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[8px] leading-relaxed text-muted-foreground">
              {previewOf(op)}
            </div>
          </li>
        ))}
      </ol>

      {warnings.length ? (
        <div className="mt-2 space-y-0.5 rounded-lg border border-amber-500/40 bg-amber-500/5 px-2 py-1.5">
          {warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-1 text-[8px] text-amber-600">
              <ShieldAlert className="mt-0.5 size-2.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}

      {result || appliedAt ? (
        <div className="mt-2 space-y-0.5">
          <div className="flex items-center gap-1 text-[9px] text-moss">
            <Check className="size-3" />
            {result
              ? `Applied ${result.applied} change${result.applied === 1 ? "" : "s"}`
              : `Applied ${new Date(appliedAt!).toLocaleString()}`}
          </div>
          {result?.skipped.map((entry) => (
            <div key={entry} className="text-[8px] text-muted-foreground">
              {entry}
            </div>
          ))}
          <div className="text-[8px] text-muted-foreground">
            This plan has been applied. Edit the pages, or ask for a refinement.
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-6 rounded-md px-2 text-[9px]"
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-6 rounded-md px-2 text-[9px] text-muted-foreground")}
            disabled={busy}
            onClick={onDiscard}
          >
            Discard
          </Button>
          <span className="ml-auto text-[8px] text-muted-foreground">
            Nothing changes until you apply, once.
          </span>
        </div>
      )}
    </div>
  );
}
