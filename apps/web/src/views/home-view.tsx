"use client";

import {
  formatRelative,
  greeting,
  summarizeGraph,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  Clock,
  Frame,
  GraduationCap,
  Inbox,
  LayoutGrid,
  Network,
  Plus,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLiveQuery } from "dexie-react-hooks";

import { Skeleton } from "@notes-learning/ui/components/skeleton";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import {
  useCaptures,
  useCapturesCount,
  useDueFlashcards,
  useGraph,
  useLearningStats,
  useRecentPages,
  useWorkspaceCanvases,
  useWorkspaceNotebooks,
  useWorkspacePages,
  useWorkspaceReady,
  useWorkspaceSearchIndex,
  useWorkspaceTags,
} from "@/hooks/use-local-data";
import { createCaptureLocal, createCanvasLocal, createPageLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";
import { emptyCanvas } from "@notes-learning/domain";

type WidgetId =
  | "capture"
  | "continue"
  | "inbox"
  | "review"
  | "canvas"
  | "graph"
  | "learning"
  | "activity"
  | "notebooks";

const WIDGETS: Array<{ id: WidgetId; label: string }> = [
  { id: "capture", label: "Quick capture" },
  { id: "continue", label: "Continue working" },
  { id: "review", label: "Due reviews" },
  { id: "inbox", label: "Knowledge inbox" },
  { id: "graph", label: "Graph preview" },
  { id: "learning", label: "Learning progress" },
  { id: "canvas", label: "Recent whiteboards" },
  { id: "activity", label: "Recent activity" },
  { id: "notebooks", label: "Notebooks" },
];

const STORAGE_KEY = "lattice.home.widgets";

interface HomePrefs {
  hidden: WidgetId[];
  order: WidgetId[];
}

function loadPrefs(): HomePrefs {
  if (typeof window === "undefined") return { hidden: [], order: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { hidden: [], order: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return { hidden: parsed as WidgetId[], order: [] };
    const record = parsed as Partial<HomePrefs>;
    return {
      hidden: Array.isArray(record.hidden) ? record.hidden : [],
      order: Array.isArray(record.order) ? record.order : [],
    };
  } catch {
    return { hidden: [], order: [] };
  }
}

const DEFAULT_ORDER: WidgetId[] = WIDGETS.map((widget) => widget.id);

function MiniGraph({
  nodes,
  edges,
}: {
  nodes: Array<{ id: string; kind: string }>;
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>;
}) {
  const positions = useMemo(() => {
    const width = 260;
    const height = 140;
    const center = { x: width / 2, y: height / 2 };
    const visible = nodes.slice(0, 18);
    const map = new Map<string, { x: number; y: number }>();
    visible.forEach((node, index) => {
      if (index === 0) {
        map.set(node.id, center);
        return;
      }
      const angle = (index / Math.max(1, visible.length - 1)) * Math.PI * 2;
      const radius = 30 + ((index * 37) % 40);
      map.set(node.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius * 0.75,
      });
    });
    return { map, width, height };
  }, [nodes]);

  if (!nodes.length) {
    return (
      <div className="grid h-[150px] place-items-center rounded-lg border border-dashed border-border/70 text-[10px] text-muted-foreground">
        Connect your first two pages to grow a graph.
      </div>
    );
  }

  return (
    <svg viewBox={`0 0 ${positions.width} ${positions.height}`} className="h-[150px] w-full">
      {edges.map((edge, index) => {
        const from = positions.map.get(edge.sourceNodeId);
        const to = positions.map.get(edge.targetNodeId);
        if (!from || !to) return null;
        return (
          <line
            key={`${edge.sourceNodeId}-${edge.targetNodeId}-${index}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="currentColor"
            strokeOpacity={0.14}
            strokeWidth={1}
          />
        );
      })}
      {[...positions.map.entries()].map(([id, point], index) => (
        <circle
          key={id}
          cx={point.x}
          cy={point.y}
          r={index === 0 ? 7 : 4 + ((index * 7) % 3)}
          fill={index % 4 === 0 ? "var(--saffron)" : index % 4 === 1 ? "var(--moss)" : index % 4 === 2 ? "var(--sky)" : "var(--lilac)"}
          fillOpacity={index === 0 ? 1 : 0.8}
        />
      ))}
    </svg>
  );
}

function ProgressRing({ value, size = 54 }: { value: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(1, Math.max(0, value)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--saffron)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

export function HomeView({
  onQuickCapture,
  onOpenPalette,
  onOpenAsk,
}: {
  onQuickCapture: () => void;
  onOpenPalette: () => void;
  onOpenAsk: () => void;
}) {
  const router = useRouter();
  const { db, user, activeWorkspace, activeWorkspaceId } = useAppData();
  const ready = useWorkspaceReady();
  const pages = useWorkspacePages();
  const notebooks = useWorkspaceNotebooks();
  const canvases = useWorkspaceCanvases();
  const tags = useWorkspaceTags();
  const captures = useCaptures("INBOX");
  const inboxCount = useCapturesCount();
  const due = useDueFlashcards();
  const learning = useLearningStats();
  const graph = useGraph();
  const index = useWorkspaceSearchIndex();
  const recent = useRecentPages(6);
  const [captureText, setCaptureText] = useState("");
  const [savingCapture, setSavingCapture] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [prefs, setPrefs] = useState<HomePrefs>(loadPrefs);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const reviewLogCount =
    useLiveQuery(async () => (db ? db.reviewLogs.count() : 0), [db], 0) ?? 0;

  useEffect(() => {
    if (!user?.id) return;
    setOnboardingDismissed(
      window.localStorage.getItem(`lattice.onboarding.v1:${user.id}`) === "1",
    );
  }, [user?.id]);

  const dismissOnboarding = () => {
    if (user?.id) window.localStorage.setItem(`lattice.onboarding.v1:${user.id}`, "1");
    setOnboardingDismissed(true);
  };
  const hidden = prefs.hidden;
  const effectiveOrder = useMemo(
    () =>
      prefs.order.length === WIDGETS.length
        ? prefs.order
        : [
            ...prefs.order,
            ...DEFAULT_ORDER.filter((id) => !prefs.order.includes(id)),
          ],
    [prefs.order],
  );
  const orderOf = (id: WidgetId) => {
    const index = effectiveOrder.indexOf(id);
    return index === -1 ? WIDGETS.findIndex((widget) => widget.id === id) : index;
  };

  const visible = (id: WidgetId) => !hidden.includes(id);
  const documentByPage = useMemo(
    () => new Map(index.documents.map((document) => [document.pageId, document.plainText])),
    [index.documents],
  );
  const summary = summarizeGraph(graph);
  const activity = useMemo(() => {
    const pageEntries = pages.map((page) => ({
      id: page.id,
      type: "page" as const,
      title: page.title,
      icon: page.icon ?? "◇",
      updatedAt: page.updatedAt,
    }));
    const canvasEntries = canvases.map((canvas) => ({
      id: canvas.id,
      type: "canvas" as const,
      title: canvas.title,
      icon: canvas.icon ?? "▦",
      updatedAt: canvas.updatedAt,
    }));
    return [...pageEntries, ...canvasEntries]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 7);
  }, [pages, canvases]);

  const persistPrefs = (next: HomePrefs) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  };

  const toggleWidget = (id: WidgetId) => {
    setPrefs((current) =>
      persistPrefs({
        ...current,
        hidden: current.hidden.includes(id)
          ? current.hidden.filter((entry) => entry !== id)
          : [...current.hidden, id],
      }),
    );
  };

  const moveWidget = (id: WidgetId, direction: -1 | 1) => {
    setPrefs((current) => {
      const base = current.order.length === WIDGETS.length ? [...current.order] : [...effectiveOrder];
      const index = base.indexOf(id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= base.length) return current;
      [base[index], base[target]] = [base[target]!, base[index]!];
      return persistPrefs({ ...current, order: base });
    });
  };

  const saveCapture = async () => {
    if (!db || !user || !activeWorkspaceId || !captureText.trim()) return;
    setSavingCapture(true);
    try {
      await createCaptureLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        type: "NOTE",
        title: captureText.trim().slice(0, 80),
        content: captureText.trim(),
        source: "home",
      });
      setCaptureText("");
      toast.success("Captured to your inbox");
    } finally {
      setSavingCapture(false);
    }
  };

  const newPage = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const created = await createPageLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId: notebooks[0]?.id ?? null,
    });
    router.push(appRouteObject({ view: "page", id: created.page.id }));
  };

  const newCanvas = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const canvas = await createCanvasLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      title: "Untitled canvas",
      notebookId: notebooks[0]?.id ?? null,
      data: emptyCanvas(),
    });
    router.push(appRouteObject({ view: "canvas", id: canvas.id }));
  };

  const onboardingSteps = useMemo(
    () => [
      {
        id: "note",
        label: "Write your first note",
        done: pages.length > 0,
        action: () => void newPage(),
      },
      {
        id: "link",
        label: "Link two pages with [[",
        done: graph.edges.some((edge) => edge.relationType === "REFERENCES"),
        action: () => {
          const target = pages[0];
          if (target) router.push(appRouteObject({ view: "page", id: target.id }));
          else void newPage();
        },
      },
      {
        id: "canvas",
        label: "Sketch a whiteboard",
        done: canvases.length > 0,
        action: () => void newCanvas(),
      },
      {
        id: "review",
        label: "Review one card",
        done: reviewLogCount > 0,
        action: () => router.push(appRouteObject({ view: "learn" })),
      },
    ],
    [pages, canvases, graph.edges, reviewLogCount],
  );
  const onboardingComplete = onboardingSteps.every((step) => step.done);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-7 md:px-8 md:py-10">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
          <h1 className="mt-2 font-display text-4xl tracking-[-0.03em] md:text-5xl">
            {greeting()}, {user?.name?.split(" ")[0] ?? "there"}.
          </h1>
          {ready ? (
            <p className="mt-2 max-w-lg text-[12px] leading-relaxed text-muted-foreground">
              {activeWorkspace?.name ?? "Your workspace"} · {pages.length} pages ·{" "}
              {graph.edges.length} connections · {due.length} cards due.
            </p>
          ) : (
            <Skeleton className="mt-3 h-4 w-64 rounded" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-border bg-card/60 text-[11px]"
            onClick={() => setCustomizeOpen(true)}
          >
            <LayoutGrid className="size-3.5" /> Customize
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-border bg-card/60 text-[11px]"
            onClick={onQuickCapture}
          >
            <Inbox className="size-3.5" /> Capture
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg border-border bg-card/60 text-[11px]"
            onClick={() => void newCanvas()}
          >
            <Frame className="size-3.5" /> Whiteboard
          </Button>
          <Button size="sm" className="h-8 rounded-lg text-[11px]" onClick={() => void newPage()}>
            <Plus className="size-3.5" /> New page
          </Button>
        </div>
      </div>

      {!onboardingDismissed && !onboardingComplete ? (
        <section className="mt-6 rounded-xl border border-saffron/25 bg-saffron/[0.05] p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-saffron">
              <Sparkles className="size-3" /> Get started
            </div>
            <button
              type="button"
              onClick={dismissOnboarding}
              aria-label="Dismiss getting started"
              className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
            >
              <X className="size-3" />
            </button>
          </div>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {onboardingSteps.map((step) => (
              <button
                key={step.id}
                type="button"
                disabled={step.done}
                onClick={step.action}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[10.5px] transition-colors",
                  step.done
                    ? "border-transparent text-muted-foreground"
                    : "border-border/60 bg-background/40 hover:bg-muted/50",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    step.done ? "border-moss bg-moss text-background" : "border-border",
                  )}
                >
                  {step.done ? <Check className="size-2.5" /> : null}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", step.done && "line-through")}>
                  {step.label}
                </span>
                {step.done ? null : <ArrowRight className="size-3 shrink-0 text-muted-foreground/60" />}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <button
        type="button"
        onClick={onOpenPalette}
        className="mt-6 flex w-full items-center gap-2 rounded-xl border border-border/70 bg-card/50 px-3 py-2.5 text-left text-[11px] text-muted-foreground backdrop-blur transition-colors hover:bg-card"
      >
        <Sparkles className="size-3.5 text-saffron" />
        Ask your knowledge something, or jump anywhere…
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px]">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </button>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible("capture") ? (
          <section
            style={{ order: orderOf("capture") }}
            className="rounded-2xl border border-saffron/25 bg-saffron/[0.05] p-4 md:col-span-2 xl:col-span-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-saffron">
                <span className="size-1.5 rounded-full bg-saffron" /> Quick capture
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("capture")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide quick capture"
              >
                <X className="size-3" />
              </button>
            </div>
            <Textarea
              value={captureText}
              onChange={(event) => setCaptureText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void saveCapture();
                }
              }}
              placeholder="What is worth keeping?"
              className="mt-3 min-h-24 resize-none rounded-lg border-saffron/20 bg-background/70 text-[12px] leading-relaxed"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[9px] text-muted-foreground">Saved locally · organize later</span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md text-[10px]"
                  onClick={onOpenAsk}
                >
                  <Sparkles className="size-3" /> Ask
                </Button>
                <Button
                  size="sm"
                  className="h-7 rounded-md text-[10px]"
                  disabled={savingCapture || !captureText.trim()}
                  onClick={() => void saveCapture()}
                >
                  Capture
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {visible("continue") ? (
          <section
            style={{ order: orderOf("continue") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Clock className="size-3" /> Continue working
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("continue")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide continue working"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-2 space-y-0.5">
              {recent.length ? (
                recent.slice(0, 4).map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "page", id: page.id }))}
                    className="group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="mt-0.5 text-[12px]">{page.icon ?? "◇"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium">{page.title}</span>
                      <span className="mt-0.5 line-clamp-1 text-[9px] text-muted-foreground">
                        {documentByPage.get(page.id)?.slice(0, 100) || "No content yet"}
                      </span>
                    </span>
                    <span className="mt-1 text-[8px] text-muted-foreground/60">{formatRelative(page.updatedAt)}</span>
                  </button>
                ))
              ) : (
                <div className="py-8 text-center text-[10px] text-muted-foreground">
                  Create your first page to begin.
                </div>
              )}
            </div>
          </section>
        ) : null}

        {visible("review") ? (
          <section
            style={{ order: orderOf("review") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <GraduationCap className="size-3" /> Due reviews
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("review")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide due reviews"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-4">
              <div className="relative">
                <ProgressRing value={learning.mastery} size={64} />
                <div className="absolute inset-0 grid place-items-center text-[12px] font-semibold">
                  {Math.round(learning.mastery * 100)}%
                </div>
              </div>
              <div>
                <div className="text-2xl font-semibold tracking-[-0.03em]">
                  {ready ? due.length : <Skeleton className="h-7 w-10 rounded" />}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {ready ? "cards waiting" : <Skeleton className="h-4 w-24 rounded" />}
                </div>
                <div className="mt-1 text-[9px] text-muted-foreground">
                  {learning.streak > 0 ? `${learning.streak}-day streak` : "Start a streak today"}
                </div>
              </div>
              <Button
                size="sm"
                className="ml-auto h-8 rounded-lg text-[10px]"
                onClick={() => router.push(appRouteObject({ view: "learn" }))}
              >
                Review <ArrowRight className="size-3" />
              </Button>
            </div>
          </section>
        ) : null}

        {visible("inbox") ? (
          <section
            style={{ order: orderOf("inbox") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Inbox className="size-3" /> Knowledge inbox
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("inbox")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide inbox"
              >
                <X className="size-3" />
              </button>
            </div>
            {!ready ? (
              <div className="mt-3 space-y-2">
                <Skeleton className="h-7 w-12 rounded" />
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            ) : inboxCount ? (
              <>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tracking-[-0.03em]">{inboxCount}</span>
                  <span className="text-[10px] text-muted-foreground">unprocessed captures</span>
                </div>
                <div className="mt-2 space-y-1">
                  {captures.slice(0, 3).map((capture) => (
                    <div key={capture.id} className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
                      <span className="text-[9px] text-saffron">{capture.type === "BOOKMARK" ? "⌘" : "◇"}</span>
                      <span className="min-w-0 flex-1 truncate text-[10px]">{capture.title}</span>
                      <span className="text-[8px] text-muted-foreground">{formatRelative(capture.createdAt)}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 w-full justify-between rounded-md text-[10px] text-muted-foreground"
                  onClick={() => router.push(appRouteObject({ view: "inbox" }))}
                >
                  Process inbox <ChevronRight className="size-3" />
                </Button>
              </>
            ) : (
              <div className="py-8 text-center">
                <Check className="mx-auto size-5 text-moss" />
                <p className="mt-2 text-[11px]">Inbox zero</p>
                <p className="mt-0.5 text-[9px] text-muted-foreground">Nothing waiting for your attention.</p>
              </div>
            )}
          </section>
        ) : null}

        {visible("graph") ? (
          <section
            style={{ order: orderOf("graph") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4 md:col-span-2 xl:col-span-1"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Network className="size-3" /> Graph preview
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("graph")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide graph preview"
              >
                <X className="size-3" />
              </button>
            </div>
            <MiniGraph nodes={graph.nodes} edges={graph.edges} />
            <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground">
              <span>{summary.nodes} nodes · {summary.edges} edges · {summary.orphans} orphans</span>
              <button
                type="button"
                onClick={() => router.push(appRouteObject({ view: "graph" }))}
                className="flex h-7 items-center gap-0.5 rounded text-foreground hover:text-link"
              >
                Explore <ArrowUpRight className="size-2.5" />
              </button>
            </div>
          </section>
        ) : null}

        {visible("learning") ? (
          <section
            style={{ order: orderOf("learning") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Brain className="size-3" /> Learning progress
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("learning")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide learning progress"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold tracking-[-0.03em]">
                  {ready ? learning.cards.length : <Skeleton className="h-7 w-10 rounded" />}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {ready ? (
                    `cards across ${learning.decks.length} decks`
                  ) : (
                    <Skeleton className="h-4 w-32 rounded" />
                  )}
                </div>
              </div>
              <span className="rounded-full border border-border px-2 py-0.5 text-[9px] text-muted-foreground">
                {learning.logs.length} reviews / 60d
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {learning.byDeck.slice(0, 3).map((entry) => (
                <div key={entry.deckId}>
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="truncate">{entry.deck?.name ?? "Deck"}</span>
                    <span className="text-muted-foreground">{Math.round(entry.mastery * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-moss/70" style={{ width: `${Math.round(entry.mastery * 100)}%` }} />
                  </div>
                </div>
              ))}
              {!learning.byDeck.length ? (
                <div className="py-3 text-center text-[9px] text-muted-foreground">
                  Generate cards from a page to start.
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {visible("canvas") ? (
          <section
            style={{ order: orderOf("canvas") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Frame className="size-3" /> Recent whiteboards
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("canvas")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide whiteboards"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {canvases.slice(0, 3).map((canvas) => (
                <button
                  key={canvas.id}
                  type="button"
                  onClick={() => router.push(appRouteObject({ view: "canvas", id: canvas.id }))}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/50"
                >
                  <Frame className="size-3 text-moss" />
                  <span className="min-w-0 flex-1 truncate text-[10.5px]">{canvas.title}</span>
                  <span className="text-[8px] text-muted-foreground">{formatRelative(canvas.updatedAt)}</span>
                </button>
              ))}
              {!canvases.length ? (
                <div className="py-6 text-center text-[10px] text-muted-foreground">
                  No whiteboards yet.
                </div>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-7 w-full justify-between rounded-md text-[10px] text-muted-foreground"
              onClick={() => void newCanvas()}
            >
              New whiteboard <Plus className="size-3" />
            </Button>
          </section>
        ) : null}

        {visible("activity") ? (
          <section
            style={{ order: orderOf("activity") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <Circle className="size-3" /> Recent activity
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("activity")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide activity"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-2 space-y-0.5">
              {activity.map((entry) => (
                <button
                  key={`${entry.type}-${entry.id}`}
                  type="button"
                  onClick={() =>
                    router.push(
                      appRouteObject({
                        view: entry.type === "canvas" ? "canvas" : "page",
                        id: entry.id,
                      }),
                    )
                  }
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px] hover:bg-muted/50"
                >
                  <span className="text-[10px]">{entry.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  <span className="text-[8px] text-muted-foreground">{formatRelative(entry.updatedAt)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {visible("notebooks") ? (
          <section
            style={{ order: orderOf("notebooks") }}
            className="rounded-2xl border border-border/70 bg-card/50 p-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                <BookOpen className="size-3" /> Notebooks
              </div>
              <button
                type="button"
                onClick={() => toggleWidget("notebooks")}
                className="grid size-7 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground tap-target"
                aria-label="Hide notebooks"
              >
                <X className="size-3" />
              </button>
            </div>
            <div className="mt-2 space-y-1">
              {notebooks.slice(0, 4).map((notebook) => {
                const count = pages.filter((page) => page.notebookId === notebook.id).length;
                return (
                  <button
                    key={notebook.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "home", notebook: notebook.id }))}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[10px] hover:bg-muted/50"
                  >
                    <span>{notebook.icon ?? "◫"}</span>
                    <span className="min-w-0 flex-1 truncate">{notebook.name}</span>
                    <span className="text-[8px] text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
            {tags.length ? (
              <div className="mt-3 flex flex-wrap gap-1">
                {tags.slice(0, 6).map((tag) => (
                  <span key={tag.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[8px] text-muted-foreground">
                    <Tag className="size-2" /> {tag.name}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <Modal
        open={customizeOpen}
        onClose={() => setCustomizeOpen(false)}
        title="Customize home"
        description="Choose which widgets appear on your dashboard. The layout is stored on this device."
      >
        <div className="grid gap-1">
          {effectiveOrder.map((id) => {
            const widget = WIDGETS.find((entry) => entry.id === id);
            if (!widget) return null;
            const visibleWidget = !hidden.includes(widget.id);
            return (
              <div
                key={widget.id}
                className="flex items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => toggleWidget(widget.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      "grid size-4 place-items-center rounded border",
                      visibleWidget ? "border-moss bg-moss text-background" : "border-border",
                    )}
                  >
                    {visibleWidget ? <Check className="size-2.5" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px]">{widget.label}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {visibleWidget ? "Visible" : "Hidden"}
                  </span>
                </button>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${widget.label} up`}
                    onClick={() => moveWidget(widget.id, -1)}
                    className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
                  >
                    <ChevronUp className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${widget.label} down`}
                    onClick={() => moveWidget(widget.id, 1)}
                    className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
                  >
                    <ChevronDown className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
