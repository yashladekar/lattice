"use client";

import { emptyCanvas, type PageTreeNode as PageTreeNodeType } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { Input } from "@notes-learning/ui/components/input";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Frame,
  GraduationCap,
  Home,
  Inbox,
  Network,
  Plus,
  Search,
  Settings,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { LatticeLogo } from "@/components/brand/logo";
import { Modal } from "@/components/ui/modal";
import { usePageTree, useWorkspaceCanvases, useWorkspaceNotebooks, useWorkspaceTags } from "@/hooks/use-local-data";
import { createCanvasLocal, createNotebookLocal, createPageLocal } from "@/lib/local/repository";
import { appRouteObject, type AppRoute } from "@/lib/navigation";
import { client } from "@/utils/orpc";

import { SyncBadge } from "./sync-badge";

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PageRow({
  node,
  depth,
  activePageId,
  onNavigate,
}: {
  node: PageTreeNodeType;
  depth: number;
  activePageId: string | null;
  onNavigate: (pageId: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const active = node.page.id === activePageId;
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div
        className={cn(
          "group flex h-7 items-center gap-0.5 rounded-md pr-1 text-[11.5px] transition-colors",
          active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        <button
          type="button"
          aria-label={open ? "Collapse page" : "Expand page"}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded text-muted-foreground/60 hover:bg-muted",
            !hasChildren && "pointer-events-none opacity-0",
          )}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <button
          type="button"
          onClick={() => {
            onNavigate(node.page.id);
            if (hasChildren) setOpen(true);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left"
        >
          <span className="w-4 shrink-0 text-center text-[11px] text-muted-foreground">
            {node.page.icon ?? "◇"}
          </span>
          <span className="truncate">{node.page.title || "Untitled"}</span>
        </button>
      </div>
      {open && hasChildren ? (
        <div>
          {node.children.map((child) => (
            <PageRow
              key={child.page.id}
              node={child}
              depth={depth + 1}
              activePageId={activePageId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkspaceSidebar({
  route,
  onOpenPalette,
  onQuickCapture,
  onOpenConflicts,
  onClose,
  mobile = false,
}: {
  route: AppRoute;
  onOpenPalette: () => void;
  onQuickCapture: () => void;
  onOpenConflicts: () => void;
  onClose?: () => void;
  mobile?: boolean;
}) {
  const router = useRouter();
  const {
    db,
    user,
    activeWorkspace,
    activeWorkspaceId,
    workspaces,
    setActiveWorkspace,
    refreshWorkspaces,
    refreshWorkspace,
  } = useAppData();
  const notebooks = useWorkspaceNotebooks();
  const pageTree = usePageTree();
  const canvases = useWorkspaceCanvases();
  const tags = useWorkspaceTags();
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [notebookDialog, setNotebookDialog] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [notebookName, setNotebookName] = useState("");
  const [creating, setCreating] = useState(false);

  const go = (next: Partial<AppRoute> & { view: AppRoute["view"] }) => {
    router.push(appRouteObject(next));
    onClose?.();
  };

  const rootsByNotebook = useMemo(() => {
    const map = new Map<string | null, PageTreeNodeType[]>();
    for (const node of pageTree) {
      const key = node.page.notebookId;
      const list = map.get(key) ?? [];
      list.push(node);
      map.set(key, list);
    }
    return map;
  }, [pageTree]);

  const activePageId = route.view === "page" ? route.id : null;

  const createPage = async (notebookId: string | null) => {
    if (!db || !user || !activeWorkspaceId) return;
    const created = await createPageLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId,
    });
    go({ view: "page", id: created.page.id });
    toast.success("Page created");
  };

  const createNotebook = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const notebook = await createNotebookLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      name: notebookName.trim() || "New notebook",
    });
    setExpandedNotebooks((current) => new Set(current).add(notebook.id));
    setNotebookDialog(false);
    setNotebookName("");
    toast.success("Notebook created");
  };

  const createWorkspace = async () => {
    if (!workspaceName.trim()) return;
    setCreating(true);
    try {
      const result = await client.workspace.create({
        name: workspaceName.trim(),
        type: "ORGANIZATION",
      });
      await refreshWorkspaces();
      setActiveWorkspace(result.workspace.id);
      await refreshWorkspace(result.workspace.id);
      setWorkspaceDialog(false);
      setWorkspaceName("");
      go({ view: "home" });
      toast.success("Organization created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create workspace");
    } finally {
      setCreating(false);
    }
  };

  const createCanvas = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const canvas = await createCanvasLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      title: "Untitled canvas",
      notebookId: route.notebook ?? null,
      data: emptyCanvas(),
    });
    go({ view: "canvas", id: canvas.id });
  };

  const navItems = [
    { view: "home" as const, label: "Home", icon: Home },
    { view: "graph" as const, label: "Knowledge graph", icon: Network },
    { view: "inbox" as const, label: "Inbox", icon: Inbox },
    { view: "learn" as const, label: "Learning", icon: GraduationCap },
  ];

  return (
    <aside
      className={cn(
        "flex h-full w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
        mobile && "w-[286px] shadow-2xl",
      )}
    >
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <LatticeLogo href="/app" />
        {mobile ? (
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent"
            aria-label="Close sidebar"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      <div className="px-2 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background/55 px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent"
              />
            }
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-saffron/15 text-[12px] text-saffron">
              {activeWorkspace?.icon ?? "✦"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-medium">
                {activeWorkspace?.name ?? "Loading workspace…"}
              </span>
              <span className="block text-[9px] text-muted-foreground">
                {activeWorkspace?.type === "ORGANIZATION" ? "Organization" : "Personal workspace"}
              </span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[244px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => {
                    setActiveWorkspace(workspace.id);
                    go({ view: "home" });
                  }}
                  className="gap-2"
                >
                  <span className="text-[11px]">{workspace.icon ?? "◇"}</span>
                  <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                  {workspace.id === activeWorkspaceId ? <Check className="size-3 text-moss" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setWorkspaceDialog(true)} className="gap-2">
              <Plus className="size-3.5" /> New organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={onOpenPalette}
          className="flex h-7 flex-1 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <Search className="size-3.5" />
          Search or ask
          <span className="ml-auto font-mono text-[9px] text-muted-foreground/60">⌘K</span>
        </button>
        <Button
          variant="outline"
          size="icon-sm"
          className="h-7 w-7 rounded-md border-sidebar-border bg-background/50"
          onClick={onQuickCapture}
          title="Quick capture"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <nav className="space-y-0.5 px-2">
        {navItems.map((item) => (
          <button
            key={item.view}
            type="button"
            onClick={() => go({ view: item.view })}
            className={cn(
              "flex h-7 w-full items-center gap-2 rounded-md px-2 text-[11.5px] transition-colors",
              route.view === item.view
                ? "bg-sidebar-accent text-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
            )}
          >
            <item.icon className="size-3.5" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.view === "inbox" ? null : null}
          </button>
        ))}
      </nav>

      <div className="mx-2 my-2 border-t border-sidebar-border" />

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
            Notebooks
          </span>
          <button
            type="button"
            onClick={() => setNotebookDialog(true)}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="New notebook"
          >
            <Plus className="size-3" />
          </button>
        </div>

        {notebooks.length === 0 ? (
          <button
            type="button"
            onClick={() => setNotebookDialog(true)}
            className="w-full rounded-lg border border-dashed border-sidebar-border px-3 py-3 text-left text-[10px] text-muted-foreground hover:bg-sidebar-accent/50"
          >
            Create your first notebook
          </button>
        ) : (
          <div className="space-y-0.5">
            {notebooks.map((notebook) => {
              const expanded = expandedNotebooks.has(notebook.id);
              const notebookPages = rootsByNotebook.get(notebook.id) ?? [];
              return (
                <div key={notebook.id}>
                  <div
                    className={cn(
                      "group flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors",
                      route.notebook === notebook.id
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedNotebooks((current) => {
                          const next = new Set(current);
                          if (next.has(notebook.id)) next.delete(notebook.id);
                          else next.add(notebook.id);
                          return next;
                        })
                      }
                      className="grid size-4 place-items-center rounded text-muted-foreground/60"
                      aria-label={expanded ? "Collapse notebook" : "Expand notebook"}
                    >
                      {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                    </button>
                    <span className="w-4 text-center text-[11px]">{notebook.icon ?? "◫"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedNotebooks((current) => new Set(current).add(notebook.id));
                        go({ view: "home", notebook: notebook.id });
                      }}
                      className="min-w-0 flex-1 truncate text-left"
                    >
                      {notebook.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => void createPage(notebook.id)}
                      className="grid size-4 place-items-center rounded opacity-0 hover:bg-muted group-hover:opacity-100"
                      aria-label={`New page in ${notebook.name}`}
                    >
                      <Plus className="size-3" />
                    </button>
                  </div>
                  {expanded ? (
                    <div className="mt-0.5">
                      {notebookPages.length ? (
                        notebookPages.map((node) => (
                          <PageRow
                            key={node.page.id}
                            node={node}
                            depth={1}
                            activePageId={activePageId}
                            onNavigate={(pageId) => go({ view: "page", id: pageId })}
                          />
                        ))
                      ) : (
                        <button
                          type="button"
                          onClick={() => void createPage(notebook.id)}
                          className="ml-7 flex h-6 items-center gap-1 rounded px-2 text-[10px] text-muted-foreground/60 hover:bg-sidebar-accent hover:text-foreground"
                        >
                          <Plus className="size-2.5" /> New page
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {(rootsByNotebook.get(null) ?? []).length ? (
          <div className="mt-2">
            <div className="px-1.5 pb-1 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50">
              Unfiled
            </div>
            {(rootsByNotebook.get(null) ?? []).map((node) => (
              <PageRow
                key={node.page.id}
                node={node}
                depth={0}
                activePageId={activePageId}
                onNavigate={(pageId) => go({ view: "page", id: pageId })}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between px-1.5 pb-1.5">
          <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
            Canvases
          </span>
          <button
            type="button"
            onClick={() => void createCanvas()}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="New canvas"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <div className="space-y-0.5">
          {canvases.length ? (
            canvases.slice(0, 8).map((canvas) => (
              <button
                key={canvas.id}
                type="button"
                onClick={() => go({ view: "canvas", id: canvas.id })}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-md px-2 text-[11.5px] transition-colors",
                  route.view === "canvas" && route.id === canvas.id
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
              >
                <Frame className="size-3.5 shrink-0 text-moss" />
                <span className="truncate">{canvas.title}</span>
              </button>
            ))
          ) : (
            <button
              type="button"
              onClick={() => void createCanvas()}
              className="w-full rounded-md px-2 py-1.5 text-left text-[10px] text-muted-foreground/60 hover:bg-sidebar-accent"
            >
              + Start a whiteboard
            </button>
          )}
        </div>

        {tags.length ? (
          <>
            <div className="mt-4 px-1.5 pb-1.5 text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
              Tags
            </div>
            <div className="flex flex-wrap gap-1 px-1.5">
              {tags.slice(0, 10).map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => go({ view: "search", query: `#${tag.name}` })}
                  className="inline-flex items-center gap-1 rounded-full border border-sidebar-border px-2 py-0.5 text-[9px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                >
                  <Tag className="size-2.5" />
                  {tag.name}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="border-t border-sidebar-border px-2 py-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => go({ view: "settings" })}
            className={cn(
              "flex h-7 flex-1 items-center gap-2 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              route.view === "settings" && "bg-sidebar-accent text-foreground",
            )}
          >
            <Settings className="size-3.5" />
            Settings
          </button>
          <button
            type="button"
            onClick={() => go({ view: "trash" })}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Trash"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between px-1">
          <SyncBadge onConflicts={onOpenConflicts} />
          <button
            type="button"
            onClick={onOpenPalette}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent"
            aria-label="Command palette"
          >
            <Sparkles className="size-3" />
          </button>
        </div>
        {user ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg px-1 py-1">
            <span className="grid size-6 place-items-center rounded-full bg-moss/20 text-[9px] font-medium text-moss">
              {initials(user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] font-medium">{user.name}</span>
              <span className="block truncate text-[8px] text-muted-foreground">{user.email}</span>
            </span>
            <BookOpen className="size-3 text-muted-foreground/50" />
          </div>
        ) : null}
      </div>

      <Modal
        open={workspaceDialog}
        onClose={() => setWorkspaceDialog(false)}
        title="New organization"
        description="A shared workspace for a team."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setWorkspaceDialog(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={creating || !workspaceName.trim()}
              onClick={() => void createWorkspace()}
            >
              Create organization
            </Button>
          </div>
        }
      >
        <Input
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          placeholder="Organization name"
          className="h-9 rounded-lg"
          autoFocus
        />
        <p className="mt-2 text-[10px] text-muted-foreground">
          You will be the owner. Invite members and set roles after creating it.
        </p>
      </Modal>

      <Modal
        open={notebookDialog}
        onClose={() => setNotebookDialog(false)}
        title="New notebook"
        description="Notebooks group pages and whiteboards."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setNotebookDialog(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8" onClick={() => void createNotebook()}>
              Create notebook
            </Button>
          </div>
        }
      >
        <Input
          value={notebookName}
          onChange={(event) => setNotebookName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createNotebook();
          }}
          placeholder="Notebook name"
          className="h-9 rounded-lg"
          autoFocus
        />
      </Modal>
    </aside>
  );
}
