"use client";

import {
  descendantPageIds,
  emptyCanvas,
  flattenPageTree,
  pageDropPosition,
  type PageDropPosition,
  type PageTreeNode as PageTreeNodeType,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { Input } from "@notes-learning/ui/components/input";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Frame,
  GraduationCap,
  History,
  Home,
  Inbox,
  MoreHorizontal,
  Network,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  Sparkles,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { LatticeLogo } from "@/components/brand/logo";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { usePageTree, useWorkspaceCanvases, useWorkspaceNotebooks, useWorkspaceTags } from "@/hooks/use-local-data";
import {
  createCanvasLocal,
  createNotebookLocal,
  createPageLocal,
  createSubPageLocal,
  deleteCanvasLocal,
  deleteNotebookLocal,
  deletePageLocal,
  duplicatePageLocal,
  movePageLocal,
  updateNotebookLocal,
} from "@/lib/local/repository";
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

function treeContainsPage(node: PageTreeNodeType, pageId: string | null): boolean {
  if (!pageId) return false;
  if (node.page.id === pageId) return true;
  return node.children.some((child) => treeContainsPage(child, pageId));
}

type PageDropTarget =
  | { kind: "page"; pageId: string; position: PageDropPosition }
  | { kind: "notebook"; notebookId: string | null };

interface PageDragHandlers {
  draggingId: string | null;
  forbiddenIds: Set<string>;
  revealParentIds: Set<string>;
  dropTarget: PageDropTarget | null;
  onDragStart: (pageId: string) => void;
  onDragOverPage: (
    pageId: string,
    position: PageDropPosition,
    clientX: number,
    clientY: number,
  ) => void;
  onDragLeavePage: (pageId: string) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function PageRow({
  node,
  depth,
  activePageId,
  onNavigate,
  onCreateChild,
  onDuplicatePage,
  onDeletePage,
  drag,
}: {
  node: PageTreeNodeType;
  depth: number;
  activePageId: string | null;
  onNavigate: (pageId: string) => void;
  onCreateChild: (pageId: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (page: PageTreeNodeType["page"]) => void;
  drag: PageDragHandlers;
}) {
  const [open, setOpen] = useState(depth < 1);
  const active = node.page.id === activePageId;
  const hasChildren = node.children.length > 0;
  const containsActive = useMemo(() => treeContainsPage(node, activePageId), [node, activePageId]);
  const dragging = drag.draggingId === node.page.id;
  const forbidden = Boolean(drag.draggingId && drag.forbiddenIds.has(node.page.id));
  const position =
    drag.dropTarget?.kind === "page" && drag.dropTarget.pageId === node.page.id
      ? drag.dropTarget.position
      : null;
  const reveal = drag.revealParentIds.has(node.page.id);

  useEffect(() => {
    if (containsActive || reveal) setOpen(true);
  }, [containsActive, reveal]);

  return (
    <div>
      <div
        draggable
        data-page-row-id={node.page.id}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.page.id);
          drag.onDragStart(node.page.id);
        }}
        onDragOver={(event) => {
          if (!drag.draggingId) return;
          if (forbidden) {
            event.dataTransfer.dropEffect = "none";
            drag.onDragLeavePage(node.page.id);
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
          drag.onDragOverPage(
            node.page.id,
            pageDropPosition(ratio),
            event.clientX,
            event.clientY,
          );
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          drag.onDragLeavePage(node.page.id);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          drag.onDrop();
        }}
        onDragEnd={(event) => {
          event.stopPropagation();
          drag.onDragEnd();
        }}
        className={cn(
          "group relative flex h-7 cursor-grab items-center gap-0.5 rounded-md pr-1 text-[11.5px] transition-colors active:cursor-grabbing",
          active ? "bg-sidebar-accent text-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
          dragging && "opacity-40",
          forbidden && drag.draggingId ? "cursor-no-drop" : null,
          position === "inside" && "bg-saffron/10 ring-1 ring-inset ring-saffron/60",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {position === "before" ? (
          <span
            className="pointer-events-none absolute top-0 h-0.5 rounded-full bg-saffron"
            style={{ left: 28 + depth * 12, right: 4 }}
          />
        ) : null}
        {position === "after" ? (
          <span
            className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-saffron"
            style={{ left: 28 + depth * 12, right: 4 }}
          />
        ) : null}
        <button
          type="button"
          aria-label={open ? "Collapse page" : "Expand page"}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "grid size-4 shrink-0 place-items-center rounded text-muted-foreground/60 hover:bg-muted tap-target",
            !hasChildren && "pointer-events-none opacity-0",
          )}
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </button>
        <button
          type="button"
          draggable
          onClick={() => {
            onNavigate(node.page.id);
            if (hasChildren) setOpen(true);
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded text-left"
        >
          <span className="w-4 shrink-0 text-center text-[11px] text-muted-foreground">
            {node.page.icon ?? "◇"}
          </span>
          <span className="truncate">{node.page.title || "Untitled"}</span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
          <button
            type="button"
            onClick={() => onCreateChild(node.page.id)}
            aria-label={`New sub-page in ${node.page.title || "Untitled"}`}
            className="hidden size-4 place-items-center rounded text-muted-foreground/70 hover:bg-muted md:grid"
          >
            <Plus className="size-3" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Actions for ${node.page.title || "Untitled"}`}
                  className="grid size-4 place-items-center rounded text-muted-foreground/70 hover:bg-muted"
                />
              }
            >
              <MoreHorizontal className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => onCreateChild(node.page.id)}>
                <Plus className="size-3" /> New sub-page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onDuplicatePage(node.page.id)}>
                <FileText className="size-3" /> Duplicate page
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => onDeletePage(node.page)}>
                <Trash2 className="size-3" /> Move to trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
              onCreateChild={onCreateChild}
              onDuplicatePage={onDuplicatePage}
              onDeletePage={onDeletePage}
              drag={drag}
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
  onShareNotebook,
  onClose,
  mobile = false,
}: {
  route: AppRoute;
  onOpenPalette: () => void;
  onQuickCapture: () => void;
  onOpenConflicts: () => void;
  onShareNotebook: (notebookId: string, name: string) => void;
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
  const pages = useMemo(() => flattenPageTree(pageTree), [pageTree]);
  const canvases = useWorkspaceCanvases();
  const tags = useWorkspaceTags();
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<string>>(new Set());
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [notebookDialog, setNotebookDialog] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [notebookName, setNotebookName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(null);
  const [notebookRenameValue, setNotebookRenameValue] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "notebook"; id: string; name: string }
    | { kind: "canvas"; id: string; title: string }
    | { kind: "page"; id: string; title: string }
    | null
  >(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<PageDropTarget | null>(null);
  const [revealParentIds, setRevealParentIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragPointRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollFrame = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const forbiddenIdsRef = useRef<Set<string>>(new Set());
  const dropTargetRef = useRef<PageDropTarget | null>(null);

  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);

  useEffect(() => {
    return () => {
      if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
    };
  }, []);

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

  useEffect(() => {
    if (!activePageId) return;
    const find = (nodes: PageTreeNodeType[]): PageTreeNodeType["page"] | null => {
      for (const node of nodes) {
        if (node.page.id === activePageId) return node.page;
        const match = find(node.children);
        if (match) return match;
      }
      return null;
    };
    const notebookId = find(pageTree)?.notebookId;
    if (!notebookId) return;
    setExpandedNotebooks((current) =>
      current.has(notebookId) ? current : new Set(current).add(notebookId),
    );
  }, [activePageId, pageTree]);

  const favoritePages = useMemo(() => {
    const flat: Array<{ id: string; title: string; icon: string | null }> = [];
    const walk = (nodes: PageTreeNodeType[]) => {
      for (const node of nodes) {
        if (node.page.properties?.favorite) {
          flat.push({ id: node.page.id, title: node.page.title, icon: node.page.icon });
        }
        if (node.children?.length) walk(node.children);
      }
    };
    walk(pageTree);
    return flat.slice(0, 6);
  }, [pageTree]);

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

  const createChildPage = async (parentId: string) => {
    if (!db || !user) return;
    try {
      const created = await createSubPageLocal(db, { parentId, userId: user.id });
      go({ view: "page", id: created.page.id });
      toast.success("Sub-page created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create a sub-page");
    }
  };

  const duplicatePage = async (pageId: string) => {
    if (!db || !user) return;
    const created = await duplicatePageLocal(db, pageId, user.id);
    if (created) toast.success("Page duplicated");
  };

  const pageRowHandlers = {
    onCreateChild: (pageId: string) => void createChildPage(pageId),
    onDuplicatePage: (pageId: string) => void duplicatePage(pageId),
    onDeletePage: (page: PageTreeNodeType["page"]) =>
      setPendingDelete({ kind: "page", id: page.id, title: page.title || "Untitled" }),
  };

  const forbiddenIds = useMemo(
    () => new Set(draggingId ? [draggingId, ...descendantPageIds(draggingId, pages)] : []),
    [draggingId, pages],
  );

  const stopAutoScroll = () => {
    if (autoScrollFrame.current !== null) {
      cancelAnimationFrame(autoScrollFrame.current);
      autoScrollFrame.current = null;
    }
  };

  const applyDropTarget = (next: PageDropTarget | null) => {
    const current = dropTargetRef.current;
    if (current === next) return;
    if (
      current?.kind === "page" &&
      next?.kind === "page" &&
      current.pageId === next.pageId &&
      current.position === next.position
    ) {
      return;
    }
    if (
      current?.kind === "notebook" &&
      next?.kind === "notebook" &&
      current.notebookId === next.notebookId
    ) {
      return;
    }
    dropTargetRef.current = next;
    setDropTarget(next);
  };

  const updateDropTargetAtPoint = () => {
    const point = dragPointRef.current;
    if (!point || !draggingRef.current) return;
    const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
    const row = element?.closest<HTMLElement>("[data-page-row-id]");
    if (row?.dataset.pageRowId) {
      const pageId = row.dataset.pageRowId;
      if (forbiddenIdsRef.current.has(pageId)) {
        applyDropTarget(null);
        return;
      }
      const rect = row.getBoundingClientRect();
      const ratio = rect.height ? (point.y - rect.top) / rect.height : 0.5;
      applyDropTarget({ kind: "page", pageId, position: pageDropPosition(ratio) });
      return;
    }
    const notebook = element?.closest<HTMLElement>("[data-notebook-drop-id]");
    if (notebook) {
      const value = notebook.dataset.notebookDropId;
      applyDropTarget({
        kind: "notebook",
        notebookId: value === "unfiled" ? null : (value ?? null),
      });
      return;
    }
    applyDropTarget(null);
  };

  const autoScrollTick = () => {
    autoScrollFrame.current = null;
    const container = scrollRef.current;
    const point = dragPointRef.current;
    if (!container || !point || !draggingRef.current) return;
    const rect = container.getBoundingClientRect();
    const edge = 48;
    let delta = 0;
    if (point.y < rect.top + edge) {
      delta = -Math.max(4, Math.ceil((rect.top + edge - point.y) / 4));
    } else if (point.y > rect.bottom - edge) {
      delta = Math.max(4, Math.ceil((point.y - (rect.bottom - edge)) / 4));
    }
    if (!delta) return;
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (
      (delta < 0 && container.scrollTop <= 0) ||
      (delta > 0 && container.scrollTop >= maxScroll)
    ) {
      return;
    }
    container.scrollTop = Math.max(0, Math.min(maxScroll, container.scrollTop + delta));
    updateDropTargetAtPoint();
    autoScrollFrame.current = requestAnimationFrame(autoScrollTick);
  };

  const ensureAutoScroll = () => {
    if (autoScrollFrame.current !== null || !draggingRef.current) return;
    autoScrollFrame.current = requestAnimationFrame(autoScrollTick);
  };

  const handleDragStart = (pageId: string) => {
    draggingRef.current = true;
    dragPointRef.current = null;
    forbiddenIdsRef.current = new Set([pageId, ...descendantPageIds(pageId, pages)]);
    setDraggingId(pageId);
    setDropTarget(null);
    dropTargetRef.current = null;
  };

  const handleDragOverPage = (
    pageId: string,
    position: PageDropPosition,
    clientX: number,
    clientY: number,
  ) => {
    dragPointRef.current = { x: clientX, y: clientY };
    applyDropTarget({ kind: "page", pageId, position });
    ensureAutoScroll();
  };

  const handleDragLeavePage = (pageId: string) => {
    if (dropTargetRef.current?.kind === "page" && dropTargetRef.current.pageId === pageId) {
      applyDropTarget(null);
    }
  };

  const handleDragEnd = () => {
    stopAutoScroll();
    draggingRef.current = false;
    dragPointRef.current = null;
    forbiddenIdsRef.current = new Set();
    setDraggingId(null);
    setDropTarget(null);
    dropTargetRef.current = null;
  };

  const finishDrop = async () => {
    stopAutoScroll();
    draggingRef.current = false;
    dragPointRef.current = null;
    forbiddenIdsRef.current = new Set();
    const draggedId = draggingId;
    const target = dropTarget;
    setDraggingId(null);
    setDropTarget(null);
    dropTargetRef.current = null;
    if (!draggedId || !target || !db) return;
    try {
      if (target.kind === "notebook") {
        await movePageLocal(db, {
          pageId: draggedId,
          parentId: null,
          notebookId: target.notebookId,
        });
        const notebookId = target.notebookId;
        if (notebookId) {
          setExpandedNotebooks((current) => new Set(current).add(notebookId));
        }
        toast.success("Page moved");
        return;
      }
      if (forbiddenIds.has(target.pageId)) return;
      const targetPage = pages.find((page) => page.id === target.pageId);
      if (!targetPage) return;
      if (target.position === "inside") {
        await movePageLocal(db, {
          pageId: draggedId,
          parentId: targetPage.id,
          notebookId: targetPage.notebookId,
        });
        setRevealParentIds(new Set([targetPage.id]));
      } else {
        await movePageLocal(db, {
          pageId: draggedId,
          parentId: targetPage.parentId,
          notebookId: targetPage.notebookId,
          beforeId: target.position === "before" ? targetPage.id : null,
          afterId: target.position === "after" ? targetPage.id : null,
        });
        if (targetPage.parentId) setRevealParentIds(new Set([targetPage.parentId]));
      }
      const notebookId = targetPage.notebookId;
      if (notebookId) {
        setExpandedNotebooks((current) => new Set(current).add(notebookId));
      }
      toast.success("Page moved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move the page");
    }
  };

  const drag: PageDragHandlers = {
    draggingId,
    forbiddenIds,
    revealParentIds,
    dropTarget,
    onDragStart: handleDragStart,
    onDragOverPage: handleDragOverPage,
    onDragLeavePage: handleDragLeavePage,
    onDrop: () => void finishDrop(),
    onDragEnd: handleDragEnd,
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

  const renameNotebook = async () => {
    if (!db || !renamingNotebookId) return;
    const name = notebookRenameValue.trim();
    if (!name) return;
    await updateNotebookLocal(db, renamingNotebookId, { name });
    setRenameOpen(false);
    setRenamingNotebookId(null);
    toast.success("Notebook renamed");
  };

  const confirmDelete = async () => {
    if (!db || !pendingDelete) return;
    if (pendingDelete.kind === "notebook") {
      await deleteNotebookLocal(db, pendingDelete.id);
      toast.success("Notebook deleted");
      if (route.notebook === pendingDelete.id) go({ view: "home" });
    } else if (pendingDelete.kind === "page") {
      await deletePageLocal(db, pendingDelete.id);
      toast.success("Page moved to trash");
      if (route.view === "page" && route.id === pendingDelete.id) go({ view: "home" });
    } else {
      await deleteCanvasLocal(db, pendingDelete.id);
      toast.success("Canvas deleted");
      if (route.view === "canvas" && route.id === pendingDelete.id) go({ view: "home" });
    }
    setPendingDelete(null);
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
    { view: "timeline" as const, label: "Timeline", icon: History },
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
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent tap-target"
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

      {favoritePages.length ? (
        <div className="mt-2 px-2">
          <div className="flex items-center gap-1.5 px-1.5 pb-1 text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
            <Star className="size-2.5" /> Favorites
          </div>
          <div className="space-y-0.5">
            {favoritePages.map((favorite) => (
              <button
                key={favorite.id}
                type="button"
                onClick={() => go({ view: "page", id: favorite.id })}
                className={cn(
                  "flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-[11.5px] transition-colors",
                  activePageId === favorite.id
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
              >
                <span className="w-4 text-center text-[11px]">{favorite.icon ?? "◇"}</span>
                <span className="min-w-0 flex-1 self-stretch truncate text-left">{favorite.title || "Untitled"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mx-2 my-2 border-t border-sidebar-border" />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-2 pb-3"
        onDragOver={(event) => {
          if (!draggingId) return;
          event.preventDefault();
          dragPointRef.current = { x: event.clientX, y: event.clientY };
          applyDropTarget(null);
          ensureAutoScroll();
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          stopAutoScroll();
          applyDropTarget(null);
        }}
      >
        <div className="flex items-center justify-between px-1.5 pb-1.5">
          <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
            Notebooks
          </span>
          <button
            type="button"
            onClick={() => setNotebookDialog(true)}
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground tap-target"
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
                    data-notebook-drop-id={notebook.id}
                    className={cn(
                      "group flex h-7 items-center gap-1 rounded-md px-1.5 text-[11.5px] transition-colors",
                      route.notebook === notebook.id
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                      dropTarget?.kind === "notebook" &&
                        dropTarget.notebookId === notebook.id &&
                        "bg-saffron/10 ring-1 ring-inset ring-saffron/60",
                    )}
                    onDragOver={(event) => {
                      if (!draggingId) return;
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = "move";
                      dragPointRef.current = { x: event.clientX, y: event.clientY };
                      applyDropTarget({ kind: "notebook", notebookId: notebook.id });
                      ensureAutoScroll();
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                      if (
                        dropTargetRef.current?.kind === "notebook" &&
                        dropTargetRef.current.notebookId === notebook.id
                      ) {
                        applyDropTarget(null);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void finishDrop();
                    }}
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
                      className="grid size-4 place-items-center rounded text-muted-foreground/60 tap-target"
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
                      className="min-w-0 flex-1 self-stretch truncate text-left"
                    >
                      {notebook.name}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Options for ${notebook.name}`}
                            className="grid size-4 place-items-center rounded hover:bg-muted hover-quiet tap-target"
                          />
                        }
                      >
                        <MoreHorizontal className="size-3" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-44">
                        <DropdownMenuItem
                          onClick={() => {
                            setNotebookRenameValue(notebook.name);
                            setRenamingNotebookId(notebook.id);
                            setRenameOpen(true);
                          }}
                        >
                          <Pencil className="size-3" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onShareNotebook(notebook.id, notebook.name)}
                        >
                          <Share2 className="size-3" /> Share notebook
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <Eye className="size-3" /> Visibility
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-44">
                            {(
                              [
                                ["WORKSPACE", "Workspace"],
                                ["PRIVATE", "Private"],
                                ["SHARED", "Shared"],
                                ["PUBLIC", "Public link"],
                              ] as const
                            ).map(([value, label]) => (
                              <DropdownMenuItem
                                key={value}
                                disabled={notebook.visibility === value}
                                onClick={async () => {
                                  if (!db) return;
                                  await updateNotebookLocal(db, notebook.id, { visibility: value });
                                  toast.success(`${notebook.name} is now ${label.toLowerCase()}`);
                                }}
                              >
                                {label}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            setPendingDelete({
                              kind: "notebook",
                              id: notebook.id,
                              name: notebook.name,
                            })
                          }
                        >
                          <Trash2 className="size-3" /> Delete notebook
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      type="button"
                      onClick={() => void createPage(notebook.id)}
                      className="grid size-4 place-items-center rounded hover:bg-muted hover-quiet tap-target"
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
                            {...pageRowHandlers}
                            drag={drag}
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
            <div
              data-notebook-drop-id="unfiled"
              className={cn(
                "px-1.5 pb-1 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50",
                dropTarget?.kind === "notebook" &&
                  dropTarget.notebookId === null &&
                  "rounded bg-saffron/10 ring-1 ring-inset ring-saffron/60",
              )}
              onDragOver={(event) => {
                if (!draggingId) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                dragPointRef.current = { x: event.clientX, y: event.clientY };
                applyDropTarget({ kind: "notebook", notebookId: null });
                ensureAutoScroll();
              }}
              onDragLeave={(event) => {
                if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                if (dropTargetRef.current?.kind === "notebook" && dropTargetRef.current.notebookId === null) {
                  applyDropTarget(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void finishDrop();
              }}
            >
              Unfiled
            </div>
            {(rootsByNotebook.get(null) ?? []).map((node) => (
              <PageRow
                key={node.page.id}
                node={node}
                depth={0}
                activePageId={activePageId}
                onNavigate={(pageId) => go({ view: "page", id: pageId })}
                {...pageRowHandlers}
                drag={drag}
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
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground tap-target"
            aria-label="New canvas"
          >
            <Plus className="size-3" />
          </button>
        </div>
        <div className="space-y-0.5">
          {canvases.length ? (
            canvases.slice(0, 8).map((canvas) => (
              <div
                key={canvas.id}
                className={cn(
                  "group flex h-7 items-center rounded-md pr-1 transition-colors",
                  route.view === "canvas" && route.id === canvas.id
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => go({ view: "canvas", id: canvas.id })}
                  className="flex h-7 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11.5px]"
                >
                  <Frame className="size-3.5 shrink-0 text-moss" />
                  <span className="truncate">{canvas.title}</span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`Options for ${canvas.title}`}
                        className="grid size-4 place-items-center rounded hover:bg-muted hover-quiet tap-target"
                      />
                    }
                  >
                    <MoreHorizontal className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-40">
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        setPendingDelete({ kind: "canvas", id: canvas.id, title: canvas.title })
                      }
                    >
                      <Trash2 className="size-3" /> Delete canvas
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground tap-target"
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
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent tap-target"
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

      <Modal
        open={renameOpen}
        onClose={() => {
          setRenameOpen(false);
          setRenamingNotebookId(null);
        }}
        title="Rename notebook"
        description="Pages inside keep their place."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                setRenameOpen(false);
                setRenamingNotebookId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!notebookRenameValue.trim()}
              onClick={() => void renameNotebook()}
            >
              Save name
            </Button>
          </div>
        }
      >
        <Input
          value={notebookRenameValue}
          onChange={(event) => setNotebookRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void renameNotebook();
          }}
          placeholder="Notebook name"
          className="h-9 rounded-lg"
          autoFocus
        />
      </Modal>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={
          pendingDelete?.kind === "notebook"
            ? `Delete “${pendingDelete.name}”?`
            : pendingDelete?.kind === "canvas"
              ? `Delete “${pendingDelete.title}”?`
              : pendingDelete?.kind === "page"
                ? `Move “${pendingDelete.title}” to Trash?`
                : "Delete"
        }
        description={
          pendingDelete?.kind === "notebook"
            ? "Its pages move to Unfiled so nothing is lost."
            : pendingDelete?.kind === "page"
              ? "Its sub-pages move too, and can be restored from Trash."
              : "The canvas is removed from this workspace."
        }
        confirmLabel={pendingDelete?.kind === "page" ? "Move to trash" : "Delete"}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </aside>
  );
}
