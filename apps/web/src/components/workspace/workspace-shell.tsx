"use client";

import { appHref, appRouteObject, parsePaneKey, type AppRoute } from "@/lib/navigation";
import { cn } from "@notes-learning/ui/lib/utils";
import { Columns2, Command, Focus, Menu, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AiPanel } from "@/components/ai/ai-panel";
import { AppSplash } from "@/components/app-splash";
import { useAppData } from "@/components/app-data-provider";
import { DueReminders } from "@/components/learning-reminders";
import { ShareDialog } from "@/components/share/share-dialog";
import { CommandPalette } from "@/components/workspace/command-palette";
import { ConflictResolver } from "@/components/workspace/conflict-resolver";
import { BootErrorBanner, WorkspaceEmptyState } from "@/components/workspace/empty-state";
import { GitSyncScheduler } from "@/components/workspace/git-sync-scheduler";
import { QuickCaptureDialog, type CaptureInitial } from "@/components/workspace/quick-capture";
import { TemplatePickerDialog } from "@/components/workspace/template-picker";
import { WorkspaceSidebar } from "@/components/workspace/sidebar";
import { TabStrip } from "@/components/workspace/tab-strip";
import { WorkspaceTopbar } from "@/components/workspace/topbar";
import { useCanvas, usePage, useWorkspaceNotebooks } from "@/hooks/use-local-data";
import { useTabs } from "@/hooks/use-tabs";
import { createPageLocal } from "@/lib/local/repository";
import { CanvasView } from "@/views/canvas-view";
import { GraphView } from "@/views/graph-view";
import { HomeView } from "@/views/home-view";
import { InboxView } from "@/views/inbox-view";
import { LearnView } from "@/views/learn-view";
import { PageView } from "@/views/page-view";
import { SearchView } from "@/views/search-view";
import { SettingsView } from "@/views/settings-view";
import { TimelineView } from "@/views/timeline-view";
import { TrashView } from "@/views/trash-view";

const TAB_META: Record<AppRoute["view"], { title: string; icon: string }> = {
  home: { title: "Home", icon: "✦" },
  page: { title: "Page", icon: "◇" },
  canvas: { title: "Canvas", icon: "▦" },
  graph: { title: "Graph", icon: "◉" },
  inbox: { title: "Inbox", icon: "⌁" },
  learn: { title: "Learning", icon: "◒" },
  settings: { title: "Settings", icon: "⚙" },
  search: { title: "Search", icon: "⌕" },
  timeline: { title: "Timeline", icon: "◷" },
  trash: { title: "Trash", icon: "⌫" },
};

export function WorkspaceShell({ route }: { route: AppRoute }) {
  const router = useRouter();
  const {
    db,
    user,
    sessionPending,
    booting,
    bootError,
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    syncState,
    online,
  } = useAppData();
  const notebooks = useWorkspaceNotebooks();
  const page = usePage(route.view === "page" ? route.id : null);
  const canvas = useCanvas(route.view === "canvas" ? route.id : null);
  const paneTarget = parsePaneKey(route.pane);
  const panePage = usePage(paneTarget?.view === "page" ? paneTarget.id : null);
  const paneCanvas = useCanvas(paneTarget?.view === "canvas" ? paneTarget.id : null);
  const { tabs, activeKey, setActiveKey, openTab, closeTab } = useTabs();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareOverride, setShareOverride] = useState<{
    type: "NOTEBOOK" | "PAGE" | "CANVAS" | "GRAPH";
    id: string;
    title: string;
  } | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [sharedCapture, setSharedCapture] = useState<CaptureInitial | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedUrl = params.get("url");
    const sharedText = params.get("text");
    const sharedTitle = params.get("title");
    if (!sharedUrl && !sharedText) return;
    setSharedCapture({
      type: sharedUrl ? "BOOKMARK" : "NOTE",
      title: sharedTitle ?? "",
      content: sharedText ?? "",
      url: sharedUrl ?? "",
    });
    setCaptureOpen(true);
  }, []);

  useEffect(() => {
    if (!sessionPending && !user) {
      router.replace("/login");
    }
  }, [sessionPending, user, router]);

  useEffect(() => {
    if (route.view === "page") {
      if (!page) return;
      openTab({
        key: `page:${page.id}`,
        view: "page",
        id: page.id,
        title: page.title || "Untitled",
        icon: page.icon ?? "◇",
      });
      return;
    }
    if (route.view === "canvas") {
      if (!canvas) return;
      openTab({
        key: `canvas:${canvas.id}`,
        view: "canvas",
        id: canvas.id,
        title: canvas.title || "Canvas",
        icon: canvas.icon ?? "▦",
      });
      return;
    }
    if (route.view === "home") {
      setActiveKey("home");
      return;
    }
    openTab({
      key: `view:${route.view}`,
      view: route.view,
      id: null,
      title: TAB_META[route.view].title,
      icon: TAB_META[route.view].icon,
    });
  }, [route.view, route.id, page?.title, page?.icon, canvas?.title, canvas?.icon, openTab, setActiveKey]);

  const newPage = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const created = await createPageLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId: route.notebook ?? notebooks[0]?.id ?? null,
    });
    router.push(appRouteObject({ view: "page", id: created.page.id }));
    toast.success("Page created");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((value) => !value);
        return;
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setCaptureOpen(false);
        setConflictsOpen(false);
        setSidebarOpen(false);
        return;
      }
      if (typing) return;
      if (mod && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void newPage();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        setCaptureOpen(true);
        return;
      }
      if (mod && event.key === "\\") {
        event.preventDefault();
        setSidebarOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newPage]);

  const shareTarget = useMemo(() => {
    if (shareOverride) return shareOverride;
    if (route.view === "page" && page) {
      return { type: "PAGE" as const, id: page.id, title: page.title };
    }
    if (route.view === "canvas" && canvas) {
      return { type: "CANVAS" as const, id: canvas.id, title: canvas.title };
    }
    if (route.view === "graph" && activeWorkspace) {
      return {
        type: "GRAPH" as const,
        id: activeWorkspace.id,
        title: `${activeWorkspace.name} · knowledge graph`,
      };
    }
    return null;
  }, [shareOverride, route.view, page, canvas, activeWorkspace]);

  const withPane = (pane: string | null) => ({
    view: route.view,
    id: route.id,
    notebook: route.notebook,
    query: route.query,
    pane,
    tab: route.tab,
  });

  const handleTabSelect = (tab: (typeof tabs)[number]) => {
    setActiveKey(tab.key);
    router.push(
      appRouteObject(
        tab.view === "page" || tab.view === "canvas"
          ? { view: tab.view, id: tab.id, pane: route.pane }
          : { view: tab.view, pane: route.pane },
      ),
    );
  };

  if (sessionPending || booting || !user) {
    return <AppSplash />;
  }

  if (!activeWorkspace) {
    if (workspaces.length) return <AppSplash label="Loading workspace" />;
    return <WorkspaceEmptyState />;
  }

  if (!db) return <AppSplash />;

  const contentClassName = cn(
    "min-h-0 flex-1",
    ["page", "canvas", "graph"].includes(route.view) ? "overflow-hidden" : "overflow-y-auto",
  );

  const renderRoute = (
    target: Pick<AppRoute, "view" | "id" | "query">,
    options: { compact?: boolean } = {},
  ) => {
    switch (target.view) {
      case "page":
        return (
          <PageView
            pageId={target.id}
            compact={options.compact}
            rightPanelOpen={options.compact ? false : rightPanelOpen}
            onOpenRightPanel={() => setRightPanelOpen(true)}
            onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
            onShare={() => {
              if (options.compact && target.id) {
                setShareOverride({
                  type: "PAGE",
                  id: target.id,
                  title: panePage?.title ?? "Page",
                });
              }
              setShareOpen(true);
            }}
            onToggleFocus={() => setFocusMode((value) => !value)}
          />
        );
      case "canvas":
        return <CanvasView canvasId={target.id} />;
      case "graph":
        return <GraphView onShare={() => setShareOpen(true)} />;
      case "inbox":
        return <InboxView onQuickCapture={() => setCaptureOpen(true)} />;
      case "learn":
        return <LearnView />;
      case "settings":
        return <SettingsView />;
      case "search":
        return <SearchView initialQuery={target.query} />;
      case "timeline":
        return <TimelineView />;
      case "trash":
        return <TrashView />;
      default:
        return (
          <HomeView
            onQuickCapture={() => setCaptureOpen(true)}
            onOpenPalette={() => setCommandOpen(true)}
            onOpenAsk={() => setAiOpen(true)}
          />
        );
    }
  };

  const content = renderRoute(route);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[200] focus:rounded-md focus:border focus:border-border focus:bg-card focus:px-3 focus:py-1.5 focus:text-xs"
      >
        Skip to content
      </a>
      {!focusMode ? (
        <div className="hidden lg:flex">
          <WorkspaceSidebar
            route={route}
            onOpenPalette={() => setCommandOpen(true)}
            onQuickCapture={() => setCaptureOpen(true)}
            onOpenConflicts={() => setConflictsOpen(true)}
            onShareNotebook={(id, name) => {
              setShareOverride({ type: "NOTEBOOK", id, title: name });
              setShareOpen(true);
            }}
          />
        </div>
      ) : null}

      {sidebarOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-foreground/25 backdrop-blur-[1px]"
          />
          <div className="relative z-10 h-full">
            <WorkspaceSidebar
              mobile
              route={route}
              onOpenPalette={() => {
                setSidebarOpen(false);
                setCommandOpen(true);
              }}
              onQuickCapture={() => {
                setSidebarOpen(false);
                setCaptureOpen(true);
              }}
              onOpenConflicts={() => setConflictsOpen(true)}
              onShareNotebook={(id, name) => {
                setSidebarOpen(false);
                setShareOverride({ type: "NOTEBOOK", id, title: name });
                setShareOpen(true);
              }}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {!focusMode ? (
          <>
            <WorkspaceTopbar
              route={route}
              onToggleSidebar={() => setSidebarOpen(true)}
              onOpenPalette={() => setCommandOpen(true)}
              onOpenShare={() => setShareOpen(true)}
              onOpenAsk={() => setAiOpen(true)}
              onToggleRightPanel={() => setRightPanelOpen((value) => !value)}
              rightPanelOpen={rightPanelOpen}
              onOpenConflicts={() => setConflictsOpen(true)}
            />
            {bootError ? <BootErrorBanner /> : null}
            <TabStrip
              tabs={tabs}
              activeKey={activeKey}
              paneKey={route.pane}
              onSelect={handleTabSelect}
              onClose={(key) => {
                closeTab(key);
                if (route.pane === key) {
                  router.push(appHref(withPane(null)));
                  return;
                }
                if (key === activeKey) router.push(appHref({ view: "home", pane: route.pane }));
              }}
              onNew={() => void newPage()}
              onTogglePane={(tab) => {
                router.push(appHref(withPane(route.pane === tab.key ? null : tab.key)));
              }}
            />
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setFocusMode(false)}
              className="fixed right-4 top-4 z-50 inline-flex items-center gap-1 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur hover:text-foreground"
            >
              <Focus className="size-3" /> Exit focus mode
            </button>
            <div className="h-0" />
          </>
        )}
        <div id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 outline-none">
          <div className={contentClassName}>{content}</div>
          {paneTarget ? (
            <div className="flex min-h-0 w-[42%] max-w-[60%] min-w-[300px] shrink-0 flex-col border-l border-border/60">
              <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 bg-background/60 px-2 text-xs text-muted-foreground">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Columns2 className="size-3" />
                  <span className="truncate">
                    {panePage?.title ?? paneCanvas?.title ?? TAB_META[paneTarget.view].title}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Close split view"
                  onClick={() => router.push(appHref(withPane(null)))}
                  className="grid size-7 shrink-0 place-items-center rounded hover:bg-muted hover:text-foreground tap-target"
                >
                  <X className="size-3" />
                </button>
              </div>
              <div
                className={cn(
                  "min-h-0 flex-1",
                  ["page", "canvas", "graph"].includes(paneTarget.view)
                    ? "overflow-hidden"
                    : "overflow-y-auto",
                )}
              >
                {renderRoute(
                  { view: paneTarget.view, id: paneTarget.id, query: "" },
                  { compact: true },
                )}
              </div>
            </div>
          ) : null}
        </div>
        {!focusMode ? (
          <footer className="hidden h-7 shrink-0 items-center justify-between border-t border-border/50 bg-background/50 px-3 text-xs text-muted-foreground md:flex">
            <div className="flex items-center gap-2">
              <span className={cn("status-dot", online ? "bg-moss" : "bg-saffron")} />
              {online ? (syncState.pending ? `${syncState.pending} changes queued` : "All changes local") : "Offline · local only"}
              <span className="opacity-40">·</span>
              <span>{syncState.conflicts ? `${syncState.conflicts} conflicts preserved` : "No conflicts"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Command className="size-2.5" /> K commands
              </span>
              <span className="flex items-center gap-1">
                <Menu className="size-2.5" /> \ sidebar
              </span>
              <span className="flex items-center gap-1">
                <Plus className="size-2.5" /> N new page
              </span>
            </div>
          </footer>
        ) : null}
      </div>

      <DueReminders />
      <GitSyncScheduler />
      <CommandPalette
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        route={route}
        onQuickCapture={() => {
          setCommandOpen(false);
          setCaptureOpen(true);
        }}
        onOpenAsk={() => {
          setCommandOpen(false);
          setAiOpen(true);
        }}
        onOpenTemplates={() => {
          setCommandOpen(false);
          setTemplateOpen(true);
        }}
      />
      <QuickCaptureDialog
        open={captureOpen}
        initial={sharedCapture}
        onClose={() => {
          setCaptureOpen(false);
          setSharedCapture(null);
        }}
        onSaved={() => router.push(appHref({ view: "inbox" }))}
      />
      <TemplatePickerDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        notebookId={route.notebook ?? null}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => {
          setShareOpen(false);
          setShareOverride(null);
        }}
        resourceType={shareTarget?.type ?? "PAGE"}
        resourceId={shareTarget?.id ?? null}
        title={shareTarget?.title ?? "This resource"}
      />
      <AiPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        pageId={route.view === "page" ? route.id : null}
      />
      <ConflictResolver open={conflictsOpen} onClose={() => setConflictsOpen(false)} />

      {db && activeWorkspaceId && !page && route.view === "page" && route.id ? (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur">
          This page is missing or private.
          <button type="button" onClick={() => router.push(appHref({ view: "home" }))} className="ml-2 text-link hover:underline">
            Go home
          </button>
        </div>
      ) : null}
    </div>
  );
}
