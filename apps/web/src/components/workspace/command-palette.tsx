"use client";

import { cn } from "@notes-learning/ui/lib/utils";
import {
  ArrowRight,
  BookOpen,
  Command,
  Download,
  FilePlus2,
  Frame,
  GraduationCap,
  Home,
  Inbox,
  Moon,
  Network,
  NotebookPen,
  Search,
  Settings,
  Sparkles,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useRecentPages, useWorkspaceNotebooks, useWorkspaceSearchIndex } from "@/hooks/use-local-data";
import { downloadTextFile } from "@/lib/download";
import {
  createCanvasLocal,
  createNotebookLocal,
  createPageLocal,
  exportWorkspaceLocal,
} from "@/lib/local/repository";
import { searchWorkspaceIndex } from "@/lib/local/search-local";
import { appRouteObject, type AppRoute } from "@/lib/navigation";

interface PaletteItem {
  id: string;
  label: string;
  description?: string;
  group: string;
  icon: React.ReactNode;
  keywords?: string;
  onSelect: () => void | Promise<void>;
}

function scoreCommand(query: string, item: PaletteItem): number {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return 1;
  const haystack = `${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  if (haystack.includes(normalized)) return 10;
  const tokens = normalized.split(/\s+/);
  return tokens.every((token) => haystack.includes(token)) ? 5 : 0;
}

export function CommandPalette({
  open,
  onClose,
  route,
  onQuickCapture,
  onOpenAsk,
  onOpenTemplates,
}: {
  open: boolean;
  onClose: () => void;
  route: AppRoute;
  onQuickCapture: () => void;
  onOpenAsk: () => void;
  onOpenTemplates: () => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const {
    db,
    user,
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    setActiveWorkspace,
    refreshWorkspace,
  } = useAppData();
  const notebooks = useWorkspaceNotebooks();
  const recentPages = useRecentPages(5);
  const index = useWorkspaceSearchIndex();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  const navigate = (next: Parameters<typeof appRouteObject>[0]) => {
    router.push(appRouteObject(next));
    onClose();
  };

  const createPage = async (notebookId?: string | null, title?: string) => {
    if (!db || !user || !activeWorkspaceId) return;
    const created = await createPageLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId: notebookId ?? route.notebook ?? notebooks[0]?.id ?? null,
      title: title ?? "Untitled",
    });
    navigate({ view: "page", id: created.page.id });
    toast.success("Page created");
  };

  const createCanvas = async (title?: string) => {
    if (!db || !user || !activeWorkspaceId) return;
    const { emptyCanvas } = await import("@notes-learning/domain");
    const canvas = await createCanvasLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      title: title ?? "Untitled canvas",
      notebookId: route.notebook ?? notebooks[0]?.id ?? null,
      data: emptyCanvas(),
    });
    navigate({ view: "canvas", id: canvas.id });
  };

  const createNotebook = async (name?: string) => {
    if (!db || !user || !activeWorkspaceId) return;
    const notebook = await createNotebookLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      name: name?.trim() || "New notebook",
    });
    navigate({ view: "home", notebook: notebook.id });
    toast.success("Notebook created");
  };

  const exportWorkspace = async () => {
    if (!db || !activeWorkspaceId) return;
    const data = await exportWorkspaceLocal(db, activeWorkspaceId);
    downloadTextFile(
      `${(activeWorkspace?.name ?? "lattice").toLowerCase().replace(/\s+/g, "-")}-export.json`,
      JSON.stringify(data, null, 2),
    );
    toast.success("Workspace exported");
    onClose();
  };

  const commands = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "new-page",
        label: "New page",
        description: "Create a blank page in the current notebook",
        group: "Create",
        icon: <FilePlus2 className="size-3.5" />,
        keywords: "note document write",
        onSelect: () => void createPage(),
      },
      {
        id: "new-from-template",
        label: "New page from template",
        description: "Start from a saved or built-in structure",
        group: "Create",
        icon: <FilePlus2 className="size-3.5" />,
        keywords: "template adr meeting research structure",
        onSelect: onOpenTemplates,
      },
      {
        id: "new-canvas",
        label: "New whiteboard",
        description: "Open an infinite canvas",
        group: "Create",
        icon: <Frame className="size-3.5" />,
        keywords: "canvas board draw",
        onSelect: () => void createCanvas(),
      },
      {
        id: "new-notebook",
        label: "New notebook",
        description: "Create a notebook for pages and canvases",
        group: "Create",
        icon: <NotebookPen className="size-3.5" />,
        keywords: "folder collection",
        onSelect: () => void createNotebook(),
      },
      {
        id: "quick-capture",
        label: "Quick capture",
        description: "Send a note or link to the inbox",
        group: "Create",
        icon: <Inbox className="size-3.5" />,
        keywords: "inbox clip bookmark",
        onSelect: onQuickCapture,
      },
      {
        id: "ask",
        label: "Ask Lattice",
        description: "Search across your thinking with citations",
        group: "Navigate",
        icon: <Sparkles className="size-3.5" />,
        keywords: "ai question assistant",
        onSelect: onOpenAsk,
      },
      {
        id: "home",
        label: "Go home",
        description: "Knowledge dashboard",
        group: "Navigate",
        icon: <Home className="size-3.5" />,
        onSelect: () => navigate({ view: "home" }),
      },
      {
        id: "graph",
        label: "Open knowledge graph",
        description: "Explore connected pages, concepts, and orphans",
        group: "Navigate",
        icon: <Network className="size-3.5" />,
        keywords: "network connections links",
        onSelect: () => navigate({ view: "graph" }),
      },
      {
        id: "inbox",
        label: "Open inbox",
        description: "Process captured notes and links",
        group: "Navigate",
        icon: <Inbox className="size-3.5" />,
        onSelect: () => navigate({ view: "inbox" }),
      },
      {
        id: "learn",
        label: "Open learning",
        description: "Review due cards and learning paths",
        group: "Navigate",
        icon: <GraduationCap className="size-3.5" />,
        keywords: "flashcards review study",
        onSelect: () => navigate({ view: "learn" }),
      },
      {
        id: "settings",
        label: "Open settings",
        description: "Workspace, members, sync, and export",
        group: "Navigate",
        icon: <Settings className="size-3.5" />,
        onSelect: () => navigate({ view: "settings" }),
      },
      {
        id: "export",
        label: "Export workspace",
        description: "Download all local data as JSON",
        group: "Workspace",
        icon: <Download className="size-3.5" />,
        onSelect: () => void exportWorkspace(),
      },
      {
        id: "theme",
        label: "Toggle light / dark",
        description: "Switch the interface theme",
        group: "Workspace",
        icon: <Moon className="size-3.5" />,
        onSelect: () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark"),
      },
      {
        id: "theme-light",
        label: "Use light mode",
        group: "Workspace",
        icon: <Sun className="size-3.5" />,
        onSelect: () => setTheme("light"),
      },
      {
        id: "theme-dark",
        label: "Use dark mode",
        group: "Workspace",
        icon: <Moon className="size-3.5" />,
        onSelect: () => setTheme("dark"),
      },
    ];
    if (activeWorkspace && activeWorkspace.type === "ORGANIZATION") {
      items.push({
        id: "members",
        label: "Manage members",
        description: "Invite people and change roles",
        group: "Workspace",
        icon: <BookOpen className="size-3.5" />,
        onSelect: () => navigate({ view: "settings" }),
      });
    }
    for (const workspace of workspaces.filter((entry) => entry.id !== activeWorkspaceId)) {
      items.push({
        id: `workspace-${workspace.id}`,
        label: `Switch to ${workspace.name}`,
        description: workspace.type === "ORGANIZATION" ? "Organization" : "Personal workspace",
        group: "Workspaces",
        icon: <span className="text-[10px]">{workspace.icon ?? "◇"}</span>,
        onSelect: () => {
          setActiveWorkspace(workspace.id);
          void refreshWorkspace(workspace.id);
          navigate({ view: "home" });
        },
      });
    }
    return items;
  }, [
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    notebooks,
    route.notebook,
    db,
    user,
    onOpenTemplates,
  ]);

  const pageResults = useMemo(() => {
    if (!query.trim()) return [];
    return searchWorkspaceIndex(index, query, 10);
  }, [index, query]);

  const pageItems = useMemo<PaletteItem[]>(() => {
    if (query.trim()) {
      return pageResults.map((result) => ({
        id: `${result.type}:${result.id}`,
        label: result.title,
        description: result.snippet,
        group: "Search results",
        icon:
          result.type === "canvas" ? (
            <Frame className="size-3.5 text-moss" />
          ) : result.type === "capture" ? (
            <Inbox className="size-3.5 text-saffron" />
          ) : (
            <BookOpen className="size-3.5 text-sky" />
          ),
        onSelect: () =>
          result.type === "page"
            ? navigate({ view: "page", id: result.id })
            : result.type === "canvas"
              ? navigate({ view: "canvas", id: result.id })
              : navigate({ view: "inbox" }),
      }));
    }
    return recentPages.map((page) => ({
      id: `recent:${page.id}`,
      label: page.title,
      description: "Recently edited",
      group: "Recent",
      icon: <span className="text-[12px]">{page.icon ?? "◇"}</span>,
      keywords: page.title,
      onSelect: () => navigate({ view: "page", id: page.id }),
    }));
  }, [query, pageResults, recentPages]);

  const filteredCommands = useMemo(
    () =>
      query.trim()
        ? commands.filter((command) => scoreCommand(query, command) > 0)
        : commands,
    [commands, query],
  );

  const naturalAction = useMemo<PaletteItem | null>(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return null;
    const pageMatch = /^(?:new|create) page(?: in (.+))?$/.exec(normalized);
    if (pageMatch) {
      const notebookName = pageMatch[1];
      const notebook = notebookName
        ? notebooks.find((entry) => entry.name.toLowerCase().includes(notebookName))
        : null;
      return {
        id: "natural-page",
        label: `Create page${notebook ? ` in ${notebook.name}` : ""}`,
        description: normalized,
        group: "Quick action",
        icon: <FilePlus2 className="size-3.5" />,
        onSelect: () => void createPage(notebook?.id ?? undefined),
      };
    }
    const canvasMatch = /^(?:new|create) (?:canvas|whiteboard)(?: called (.+))?$/.exec(normalized);
    if (canvasMatch) {
      return {
        id: "natural-canvas",
        label: "Create whiteboard",
        description: normalized,
        group: "Quick action",
        icon: <Frame className="size-3.5" />,
        onSelect: () => void createCanvas(canvasMatch[1]),
      };
    }
    const notebookMatch = /^(?:new|create) notebook(?: called | named )?(.+)$/.exec(normalized);
    if (notebookMatch) {
      return {
        id: "natural-notebook",
        label: `Create notebook “${notebookMatch[1]}”`,
        description: normalized,
        group: "Quick action",
        icon: <NotebookPen className="size-3.5" />,
        onSelect: () => void createNotebook(notebookMatch[1]),
      };
    }
    const openMatch = /^open (graph|inbox|learning|home|settings)$/.exec(normalized);
    if (openMatch) {
      const view = openMatch[1] === "learning" ? "learn" : openMatch[1];
      if (view === "graph" || view === "inbox" || view === "learn" || view === "home" || view === "settings") {
        return {
          id: "natural-open",
          label: `Open ${openMatch[1]}`,
          description: normalized,
          group: "Quick action",
          icon: <ArrowRight className="size-3.5" />,
          onSelect: () => navigate({ view }),
        };
      }
    }
    if (/^(review|study)( cards| flashcards)?$/.test(normalized)) {
      return {
        id: "natural-review",
        label: "Start review session",
        description: normalized,
        group: "Quick action",
        icon: <GraduationCap className="size-3.5" />,
        onSelect: () => navigate({ view: "learn" }),
      };
    }
    return null;
  }, [query, notebooks]);

  const groups = useMemo(() => {
    const combined = [
      ...(naturalAction ? [naturalAction] : []),
      ...pageItems,
      ...filteredCommands,
    ];
    const seen = new Set<string>();
    const unique = combined.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    const map = new Map<string, PaletteItem[]>();
    for (const item of unique) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [naturalAction, pageItems, filteredCommands]);

  const flat = useMemo(() => groups.flatMap(([, items]) => items), [groups]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((current) => Math.min(flat.length - 1, current + 1));
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((current) => Math.max(0, current - 1));
      }
      if (event.key === "Enter") {
        const item = flat[selected];
        if (item) {
          event.preventDefault();
          void item.onSelect();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, flat, selected, onClose]);

  if (!open) return null;

  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center bg-foreground/25 p-4 pt-[10vh] backdrop-blur-[2px]">
      <button type="button" aria-label="Close command palette" onClick={onClose} className="fixed inset-0 cursor-default" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-[0_30px_100px_-20px_color-mix(in_oklch,var(--foreground)_50%,transparent)]"
      >
        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, run a command, or type “new page in Research”…"
            className="h-12 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
          />
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            ESC
          </span>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-1.5">
          {flat.length ? (
            groups.map(([group, items]) => (
              <div key={group} className="mb-1">
                <div className="px-2 pb-1 pt-2 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground/55">
                  {group}
                </div>
                {items.map((item) => {
                  runningIndex += 1;
                  const current = runningIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setSelected(current)}
                      onClick={() => void item.onSelect()}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                        selected === current ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border/60 bg-background/60 text-muted-foreground">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11.5px] font-medium text-foreground">
                          {item.label}
                        </span>
                        {item.description ? (
                          <span className="mt-0.5 block truncate text-[9.5px] text-muted-foreground">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      <Command className="size-3 shrink-0 text-muted-foreground/30" />
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
              <Search className="size-5 text-muted-foreground/40" />
              <p className="mt-3 text-[12px] font-medium">No matches</p>
              <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-muted-foreground">
                Try a page title, a command, or a phrase like “new page in Research”.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-[9px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="kbd">↑</span>
              <span className="kbd">↓</span> navigate
            </span>
            <span className="flex items-center gap-1">
              <span className="kbd">↵</span> open
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Sparkles className="size-2.5 text-saffron" /> local search
          </span>
        </div>
      </div>
    </div>
  );
}
