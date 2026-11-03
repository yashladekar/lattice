"use client";

import { diagramSummary, diagramTypeOf } from "@notes-learning/domain";
import { cn } from "@notes-learning/ui/lib/utils";
import { useTheme } from "next-themes";
import { useEffect, useId, useMemo, useState } from "react";

type MermaidApi = typeof import("mermaid").default;

let loader: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  loader ??= import("mermaid").then((module) => module.default);
  return loader;
}

// Mermaid keeps module-level config and a shared DOM scratch space, so renders
// must not overlap or two diagrams can pick up each other's settings.
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  renderQueue = run.catch(() => undefined);
  return run;
}

function themeConfig(resolvedTheme: string | undefined) {
  const dark = resolvedTheme === "dark";
  return {
    theme: "base" as const,
    darkMode: dark,
    background: "transparent",
    fontFamily: "inherit",
    securityLevel: "strict" as const,
    startOnLoad: false,
    suppressErrorRendering: true,
    // SVG <text> keeps diagrams portable to export, print, and read-only
    // surfaces; HTML labels rely on <foreignObject>.
    htmlLabels: false,
    flowchart: { useMaxWidth: true },
    themeVariables: dark
      ? {
          primaryColor: "#2a2a24",
          primaryTextColor: "#efeade",
          primaryBorderColor: "#4a4a3f",
          lineColor: "#8d8c82",
          secondaryColor: "#33332c",
          tertiaryColor: "#1f1f1b",
          fontSize: "13px",
        }
      : {
          primaryColor: "#fdf6e8",
          primaryTextColor: "#20201b",
          primaryBorderColor: "#e2d9c6",
          lineColor: "#8a8577",
          secondaryColor: "#f4efe3",
          tertiaryColor: "#faf7f0",
          fontSize: "13px",
        },
  };
}

export type DiagramStatus = "rendering" | "ready" | "error";

export function MermaidDiagram({
  source,
  className,
  onStatusChange,
}: {
  source: string;
  className?: string;
  onStatusChange?: (status: DiagramStatus) => void;
}) {
  const reactId = useId();
  const renderId = useMemo(() => `lattice-diagram-${reactId.replace(/[^a-zA-Z0-9-]/g, "")}`, [reactId]);
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DiagramStatus>("rendering");

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    const trimmed = source.trim();
    if (!trimmed) {
      setSvg(null);
      setError(null);
      setStatus("ready");
      return;
    }

    let cancelled = false;
    setStatus("rendering");

    enqueue(async () => {
      const mermaid = await loadMermaid();
      mermaid.initialize(themeConfig(resolvedTheme));
      return mermaid.render(renderId, trimmed);
    })
      .then((result) => {
        if (cancelled) return;
        setSvg(result.svg);
        setError(null);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message =
          reason instanceof Error ? reason.message : "This diagram could not be rendered.";
        setSvg(null);
        setError(message.split("\n").slice(0, 3).join(" "));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [source, resolvedTheme, renderId]);

  if (status === "rendering" && !svg) {
    return (
      <div
        className={cn(
          "diagram-surface flex items-center justify-center gap-2 text-[10px] text-muted-foreground",
          className,
        )}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-saffron" />
        Rendering {diagramTypeOf(source)}…
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("diagram-surface diagram-surface-error", className)}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
          Diagram error
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{error}</p>
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-background/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
          <code>{source}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      className={cn("diagram-surface diagram-svg", className)}
      role="img"
      aria-label={`${diagramTypeOf(source)} diagram: ${diagramSummary(source)}`}
      // Mermaid sanitizes its own output in strict security mode.
      dangerouslySetInnerHTML={{ __html: svg ?? "" }}
    />
  );
}
