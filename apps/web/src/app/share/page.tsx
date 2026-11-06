"use client";

import type { CanvasDocument, TipTapDoc } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { AlertTriangle, ArrowLeft, BookOpen, Calendar, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { LatticeLogo, LatticeMark } from "@/components/brand/logo";
import { ModeToggle } from "@/components/mode-toggle";
import { ReadOnlyDocument } from "@/components/editor/read-only-document";
import { canvasToSvg } from "@/lib/canvas-export";
import { client } from "@/utils/orpc";

interface PublicPage {
  id: string;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  updatedAt: string;
  authorName: string;
  document: TipTapDoc;
}
interface PublicCanvas {
  id: string;
  title: string;
  icon: string | null;
  data: CanvasDocument;
  updatedAt: string;
}
interface PublicNotebookPage {
  id: string;
  title: string;
  icon: string | null;
  updatedAt: string;
  document: TipTapDoc;
}
interface PublicGraphNode {
  id: string;
  title: string;
  kind: string;
  pageId: string | null;
}
interface PublicGraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  relationType: string;
}

type PublicPayload =
  | {
      type: "PAGE";
      workspace: { name: string; icon: string | null };
      page: PublicPage;
      notebook: { name: string; icon: string | null } | null;
      permission: string;
    }
  | {
      type: "CANVAS";
      workspace: { name: string; icon: string | null };
      canvas: PublicCanvas;
      permission: string;
    }
  | {
      type: "NOTEBOOK";
      workspace: { name: string; icon: string | null };
      notebook: { name: string; icon: string | null; description: string | null };
      pages: PublicNotebookPage[];
      permission: string;
    }
  | {
      type: "GRAPH";
      workspace: { name: string; icon: string | null };
      nodes: PublicGraphNode[];
      edges: PublicGraphEdge[];
      permission: string;
    };

function PublicGraph({ nodes, edges }: { nodes: PublicGraphNode[]; edges: PublicGraphEdge[] }) {
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, index) => {
      const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
      const radius = 180 + ((index * 37) % 90);
      map.set(node.id, {
        x: 400 + Math.cos(angle) * radius,
        y: 300 + Math.sin(angle) * radius * 0.72,
      });
    });
    return map;
  }, [nodes]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#faf8f2]">
      <svg viewBox="0 0 800 600" className="h-auto w-full">
        {edges.map((edge, index) => {
          const from = positions.get(edge.sourceNodeId);
          const to = positions.get(edge.targetNodeId);
          if (!from || !to) return null;
          return (
            <line
              key={index}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#9d9a8d"
              strokeOpacity={0.4}
              strokeWidth={1}
            />
          );
        })}
        {nodes.map((node, index) => {
          const point = positions.get(node.id);
          if (!point) return null;
          const colors = ["#e8892f", "#6f9c7d", "#3b82f6", "#8b5cf6", "#d97706"];
          const color = colors[index % colors.length] ?? "#e8892f";
          return (
            <g key={node.id}>
              <circle cx={point.x} cy={point.y} r={index === 0 ? 12 : 7} fill={color} />
              <text
                x={point.x}
                y={point.y + 22}
                textAnchor="middle"
                fill="#25251f"
                fontFamily="Inter, sans-serif"
                fontSize={10}
              >
                {node.title.slice(0, 30)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PublicCanvasView({ canvas }: { canvas: PublicCanvas }) {
  const exported = useMemo(() => canvasToSvg(canvas.data), [canvas.data]);
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-[#faf8f2] p-2">
      <div className="mx-auto w-fit" dangerouslySetInnerHTML={{ __html: exported.svg }} />
    </div>
  );
}

function SharedContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [payload, setPayload] = useState<PublicPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("This share link is incomplete.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    void client.share
      .public({ token })
      .then((result) => {
        if (cancelled) return;
        const data = result as unknown as PublicPayload;
        setPayload(data);
        if (data.type === "NOTEBOOK" && data.pages[0]) setSelectedPage(data.pages[0].id);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "This link is not available.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div
      className="min-h-dvh bg-[#f7f4ed] text-[#20201b]"
      style={
        {
          "--background": "oklch(0.982 0.009 85)",
          "--foreground": "oklch(0.19 0.012 75)",
          "--card": "oklch(1 0 0)",
          "--card-foreground": "oklch(0.19 0.012 75)",
          "--popover": "oklch(0.995 0.005 85)",
          "--popover-foreground": "oklch(0.19 0.012 75)",
          "--primary": "oklch(0.69 0.16 55)",
          "--primary-foreground": "oklch(0.16 0.012 75)",
          "--muted": "oklch(0.955 0.01 85)",
          "--muted-foreground": "oklch(0.52 0.018 75)",
          "--accent": "oklch(0.94 0.035 75)",
          "--accent-foreground": "oklch(0.24 0.02 65)",
          "--border": "oklch(0.9 0.012 80)",
          "--input": "oklch(0.88 0.012 80)",
          "--ring": "oklch(0.72 0.13 60)",
          "--saffron": "oklch(0.75 0.15 62)",
          "--moss": "oklch(0.5 0.09 155)",
          "--sky": "oklch(0.66 0.12 235)",
          "--lilac": "oklch(0.68 0.12 305)",
          "--rose": "oklch(0.7 0.13 18)",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto max-w-4xl px-5 pb-16">
        <header className="flex h-16 items-center justify-between">
          <LatticeLogo href="/" />
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-[#20201b]/10 bg-white/60 px-2.5 py-1 text-xs text-[#6b6a60] sm:flex">
              <Lock className="size-2.5" /> Read-only shared view
            </span>
            <ModeToggle />
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-lg border-[#20201b]/15 bg-white/60 text-xs"
              render={<Link href="/login" />}
            >
              Open Lattice
            </Button>
          </div>
        </header>

        {loading ? (
          <div className="grid min-h-[60vh] place-items-center">
            <div className="flex flex-col items-center">
              <Loader2 className="size-5 animate-spin text-[#e8892f]" />
              <p className="mt-2 text-xs text-[#6b6a60]">Opening shared knowledge…</p>
            </div>
          </div>
        ) : error ? (
          <div className="grid min-h-[60vh] place-items-center text-center">
            <div className="max-w-sm">
              <AlertTriangle className="mx-auto size-7 text-[#b45309]" />
              <h1 className="mt-3 font-display text-3xl">This link is unavailable</h1>
              <p className="mt-2 text-xs leading-relaxed text-[#6b6a60]">{error}</p>
              <Link href="/" className="mt-4 inline-flex items-center gap-1 text-xs text-[#b45309]">
                <ArrowLeft className="size-3" /> Go to Lattice
              </Link>
            </div>
          </div>
        ) : payload ? (
          <main>
            <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-[#6b6a60]">
              <span className="inline-flex items-center gap-1.5">
                <LatticeMark className="size-5" />
                {payload.workspace.name}
              </span>
              <span className="opacity-40">/</span>
              <span className="capitalize">{payload.type.toLowerCase()}</span>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/60 px-2 py-1">
                <Calendar className="size-2.5" />
                {(payload.type === "PAGE"
                  ? payload.page.updatedAt
                  : payload.type === "CANVAS"
                    ? payload.canvas.updatedAt
                    : new Date().toISOString()
                ).slice(0, 10)}
              </span>
            </div>

            {payload.type === "PAGE" ? (
              <article className="rounded-2xl border border-[#20201b]/10 bg-[#fffdf8] p-6 shadow-sm md:p-10">
                {payload.page.coverUrl ? (
                  <img src={payload.page.coverUrl} alt="" className="mb-6 max-h-56 w-full rounded-xl object-cover" />
                ) : null}
                <div className="mb-2 flex items-center gap-2 text-xs text-[#6b6a60]">
                  {payload.notebook ? (
                    <>
                      <span>{payload.notebook.icon ?? "◫"}</span>
                      {payload.notebook.name}
                    </>
                  ) : null}
                </div>
                <h1 className="mb-2 font-display text-4xl leading-[1.05] tracking-[-0.03em] md:text-5xl">
                  {payload.page.icon ? <span className="mr-2">{payload.page.icon}</span> : null}
                  {payload.page.title}
                </h1>
                <p className="mb-8 text-xs text-[#6b6a60]">
                  By {payload.page.authorName} · hosted with Lattice
                </p>
                <ReadOnlyDocument doc={payload.page.document} />
              </article>
            ) : null}

            {payload.type === "CANVAS" ? (
              <section>
                <h1 className="mb-4 font-display text-4xl tracking-[-0.03em]">{payload.canvas.title}</h1>
                <PublicCanvasView canvas={payload.canvas} />
              </section>
            ) : null}

            {payload.type === "NOTEBOOK" ? (
              <section className="grid gap-4 md:grid-cols-[210px_1fr]">
                <aside className="rounded-xl border border-[#20201b]/10 bg-white/55 p-2">
                  <div className="px-2 py-1 text-xs font-medium uppercase tracking-[0.14em] text-[#6b6a60]">
                    {payload.notebook.icon ?? "◫"} {payload.notebook.name}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {payload.pages.map((page) => (
                      <button
                        key={page.id}
                        type="button"
                        onClick={() => setSelectedPage(page.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs",
                          selectedPage === page.id ? "bg-[#20201b] text-white" : "text-[#55544c] hover:bg-white/70",
                        )}
                      >
                        <span>{page.icon ?? "◇"}</span>
                        <span className="truncate">{page.title}</span>
                      </button>
                    ))}
                    {!payload.pages.length ? (
                      <p className="px-2 py-4 text-xs text-[#6b6a60]">No public pages in this notebook.</p>
                    ) : null}
                  </div>
                </aside>
                <article className="rounded-2xl border border-[#20201b]/10 bg-[#fffdf8] p-6 md:p-8">
                  {(() => {
                    const page = payload.pages.find((entry) => entry.id === selectedPage) ?? payload.pages[0];
                    if (!page) {
                      return <p className="text-xs text-[#6b6a60]">Select a page to read.</p>;
                    }
                    return (
                      <>
                        <h1 className="font-display text-3xl leading-tight tracking-[-0.03em]">
                          {page.icon ? <span className="mr-1.5">{page.icon}</span> : null}
                          {page.title}
                        </h1>
                        <p className="mb-6 mt-1 text-xs text-[#6b6a60]">
                          Updated {page.updatedAt.slice(0, 10)}
                        </p>
                        <ReadOnlyDocument doc={page.document} />
                      </>
                    );
                  })()}
                </article>
              </section>
            ) : null}

            {payload.type === "GRAPH" ? (
              <section>
                <h1 className="mb-1 font-display text-4xl tracking-[-0.03em]">
                  {payload.workspace.name} graph
                </h1>
                <p className="mb-4 text-xs text-[#6b6a60]">
                  {payload.nodes.length} nodes · {payload.edges.length} connections · read-only
                </p>
                <PublicGraph nodes={payload.nodes} edges={payload.edges} />
              </section>
            ) : null}

            <footer className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-[#20201b]/10 pt-4 text-xs text-[#6b6a60]">
              <span className="flex items-center gap-1.5">
                <LatticeMark className="size-4" />
                Published from a local-first Lattice workspace.
              </span>
              <span className="flex items-center gap-1">
                <BookOpen className="size-2.5" /> {payload.permission.toLowerCase()} permission
              </span>
            </footer>
          </main>
        ) : null}
      </div>
    </div>
  );
}

export default function SharePage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-dvh place-items-center bg-[#f7f4ed]">
          <Loader2 className="size-5 animate-spin text-[#e8892f]" />
        </div>
      }
    >
      <SharedContent />
    </Suspense>
  );
}
