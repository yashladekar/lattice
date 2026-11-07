"use client";

import {
  CANVAS_TEMPLATES,
  canvasBounds,
  connectorPoint,
  createConceptMap,
  createFlowFromOutline,
  createId,
  createMindMap,
  docFromText,
  docToMarkdown,
  emptyCanvas,
  extractOutline,
  extractPlainText,
  safeDoc,
  snap,
  type CanvasCanvasElement,
  type CanvasConnectorElement,
  type CanvasDocument,
  type CanvasElement,
  type CanvasFrameElement,
  type CanvasFreehandElement,
  type CanvasImageElement,
  type CanvasNoteElement,
  type CanvasPageElement,
  type CanvasShapeElement,
  type CanvasTextElement,
  type StickyColor,
  mergeCanvasDocument,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { Modal } from "@/components/ui/modal";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowRight,
  BringToFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Cylinder,
  Diamond,
  Download,
  FileText,
  Frame,
  GitBranch,
  Grid3X3,
  Group,
  Hand,
  Hexagon,
  History,
  Image as ImageIcon,
  Layers,
  Lock,
  Maximize2,
  MousePointer2,
  PenTool,
  Play,
  Redo2,
  SendToBack,
  Shapes,
  Sparkles,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Ungroup,
  Unlock,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { PagePickerDialog } from "@/components/editor/page-picker";
import { useCanvas, useWorkspaceCanvases, useWorkspacePages } from "@/hooks/use-local-data";
import {
  canvasToSvg,
  downloadSvg,
  exportPng,
  printCanvas,
} from "@/lib/canvas-export";
import { saveCanvasLocal, createCanvasLocal, createPageLocal, updateCanvasLocal } from "@/lib/local/repository";
import { uploadFile } from "@/lib/upload";
import { useCanvasCollaboration } from "@/lib/canvas-collab";
import { appRouteObject } from "@/lib/navigation";
import { markdownToDoc } from "@/lib/github-import";
import { runPluginCommand, useInstalledPlugins } from "@/lib/plugins";
import type { LocalCanvas } from "@/lib/local/types";
import { client } from "@/utils/orpc";
import { usePage, usePageDocument } from "@/hooks/use-local-data";

type Tool =
  | "select"
  | "pan"
  | "note"
  | "rect"
  | "ellipse"
  | "diamond"
  | "parallelogram"
  | "hexagon"
  | "cylinder"
  | "text"
  | "pen"
  | "connector"
  | "frame"
  | "page";

function validateImageUrl(value: string): string | null {
  if (!value) return "Paste a link to the image.";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? null
      : "Use an http or https link.";
  } catch {
    return "Use a full link, starting with https://";
  }
}

const STICKY_COLORS: StickyColor[] = ["saffron", "moss", "sky", "lilac", "rose", "slate", "paper"];

function colorClass(color: StickyColor): string {
  return `sticky-${color}`;
}

function shapeBorder(shape: CanvasShapeElement["shape"]): string {
  switch (shape) {
    case "ellipse":
      return "rounded-full";
    case "diamond":
      return "[clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]";
    case "parallelogram":
      return "[clip-path:polygon(18%_0,100%_0,82%_100%,0_100%)]";
    case "hexagon":
      return "[clip-path:polygon(22%_0,78%_0,100%_50%,78%_100%,22%_100%,0_50%)]";
    case "cylinder":
      return "rounded-[18%]";
    default:
      return "rounded-xl";
  }
}

type ConnectorAnchor = "top" | "right" | "bottom" | "left";

function bestAnchors(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
): { from: ConnectorAnchor; to: ConnectorAnchor } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  }
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

function LivePageCard({
  element,
  selected,
  onOpen,
}: {
  element: CanvasPageElement;
  selected: boolean;
  onOpen: () => void;
}) {
  const page = usePage(element.pageId);
  const document = usePageDocument(element.pageId);
  return (
    <div
      data-element-id={element.id}
      className={cn(
        "canvas-element sticky-paper flex cursor-default flex-col overflow-hidden rounded-xl border border-border/70 bg-card p-3 text-ink",
        selected && "ring-2 ring-primary",
      )}
      style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
    >
      <div className="flex items-center gap-1.5 border-b border-border/50 pb-1.5">
        <span className="text-[12px]">{page?.icon ?? "◇"}</span>
        <span className="truncate text-[10px] font-medium">{page?.title ?? "Missing page"}</span>
      </div>
      <div className="mt-1.5 line-clamp-4 text-[8.5px] leading-relaxed text-muted-foreground">
        {document?.plainText || "This note is empty."}
      </div>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        className="mt-auto flex items-center gap-1 self-start pt-1 text-[8px] text-link hover:underline"
      >
        Open note <ArrowRight className="size-2.5" />
      </button>
    </div>
  );
}

function LiveCanvasCard({
  element,
  selected,
  onOpen,
}: {
  element: CanvasCanvasElement;
  selected: boolean;
  onOpen: () => void;
}) {
  const canvas = useCanvas(element.canvasId);
  return (
    <div
      data-element-id={element.id}
      className={cn(
        "canvas-element flex cursor-default flex-col overflow-hidden rounded-xl border border-moss/30 bg-card p-3",
        selected && "ring-2 ring-primary",
      )}
      style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
    >
      <div className="flex items-center gap-1.5">
        <Frame className="size-3 text-moss" />
        <span className="truncate text-[10px] font-medium">{canvas?.title ?? "Nested canvas"}</span>
      </div>
      <div className="mt-1 text-[8px] text-muted-foreground">Nested whiteboard</div>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        className="mt-auto flex items-center gap-1 self-start text-[8px] text-moss hover:underline"
      >
        Open canvas <ArrowRight className="size-2.5" />
      </button>
    </div>
  );
}

type DragState =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      viewport: { x: number; y: number; zoom: number };
    }
  | {
      kind: "move";
      startX: number;
      startY: number;
      initial: Record<string, { x: number; y: number }>;
    }
  | {
      kind: "resize";
      startX: number;
      startY: number;
      elementId: string;
      handle: "nw" | "ne" | "sw" | "se";
      initial: { x: number; y: number; width: number; height: number };
    }
  | {
      kind: "group-resize";
      startX: number;
      startY: number;
      handle: "nw" | "ne" | "sw" | "se";
      bounds: { x: number; y: number; width: number; height: number };
      initial: Array<{ id: string; x: number; y: number; width: number; height: number }>;
    }
  | {
      kind: "marquee";
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
    }
  | {
      kind: "pen";
      elementId: string;
      absolute: Array<[number, number]>;
    };

export function CanvasView({ canvasId }: { canvasId: string | null }) {
  const router = useRouter();
  const { db, user, activeWorkspaceId, online } = useAppData();
  const canvas = useCanvas(canvasId);
  const pages = useWorkspacePages();
  const canvases = useWorkspaceCanvases();
  const containerRef = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<CanvasDocument>(emptyCanvas());
  const documentRef = useRef(document);
  const loadedRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [history, setHistory] = useState<{ past: CanvasDocument[]; future: CanvasDocument[] }>({
    past: [],
    future: [],
  });
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [grid, setGrid] = useState(true);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [generateIntent, setGenerateIntent] = useState<null | "mindmap" | "flow" | "concept">(null);
  const [pluginTool, setPluginTool] = useState<null | { pluginId: string; toolId: string }>(null);
  const [pendingTemplate, setPendingTemplate] = useState<null | (() => void)>(null);
  const installedPlugins = useInstalledPlugins();
  const canvasPluginTools = useMemo(
    () =>
      installedPlugins
        .filter((plugin) => plugin.enabled)
        .flatMap((plugin) =>
          (plugin.manifest.canvasTools ?? []).map((tool) => ({ plugin, tool })),
        ),
    [installedPlugins],
  );
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Array<{ id: string; version: number; title: string; note: string | null; createdAt: string }>
  >([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(0);
  const [title, setTitle] = useState(canvas?.title ?? "Untitled canvas");
  const [connectorStart, setConnectorStart] = useState<string | null>(null);
  const spaceRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleFocused = useRef(false);
  documentRef.current = document;

  const pagesById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const canvasesById = useMemo(() => new Map(canvases.map((entry) => [entry.id, entry])), [canvases]);
  const elementsById = useMemo(
    () =>
      new Map(
        document.elements
          .filter((element) => element.type !== "connector")
          .map((element) => [element.id, element]),
      ),
    [document.elements],
  );
  const selectedElements = useMemo(
    () => document.elements.filter((element) => selectedIds.includes(element.id)),
    [document.elements, selectedIds],
  );
  const selectedConnector = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    const element = document.elements.find((entry) => entry.id === selectedIds[0]);
    return element?.type === "connector" ? element : null;
  }, [document.elements, selectedIds]);
  const frames = useMemo(
    () => document.elements.filter((element): element is CanvasFrameElement => element.type === "frame"),
    [document.elements],
  );

  useEffect(() => {
    if (!canvas) return;
    if (loadedRef.current) return;
    setDocument(canvas.data);
    documentRef.current = canvas.data;
    setTitle(canvas.title);
    loadedRef.current = true;
    requestAnimationFrame(() => fitDocument(canvas.data));
  }, [canvas?.id]);

  useEffect(() => {
    if (!canvas) return;
    if (!titleFocused.current) setTitle(canvas.title);
  }, [canvas?.title]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (loadedRef.current && db && canvas) {
        void saveCanvasLocal(db, canvas.id, documentRef.current);
      }
    };
  }, [db, canvas?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceRef.current = true;
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (typing) return;
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === "Escape") {
        if (presentation) {
          setPresentation(false);
        } else {
          setSelectedIds([]);
          setConnectorStart(null);
          setEditingId(null);
        }
        return;
      }
      if (presentation) {
        if (event.key === "ArrowRight" || event.key === "PageDown") {
          event.preventDefault();
          changeSlide(1);
        }
        if (event.key === "ArrowLeft" || event.key === "PageUp") {
          event.preventDefault();
          changeSlide(-1);
        }
        return;
      }
      if (!mod && !event.altKey) {
        const shortcuts: Record<string, Tool> = {
          v: "select",
          h: "pan",
          n: "note",
          r: "rect",
          o: "ellipse",
          d: "diamond",
          t: "text",
          p: "pen",
          c: "connector",
          f: "frame",
        };
        const nextTool = shortcuts[event.key.toLowerCase()];
        if (nextTool) {
          event.preventDefault();
          setTool(nextTool);
          setConnectorStart(null);
        }
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelectedIds(document.elements.map((element) => element.id));
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      }
      if (mod && event.key.toLowerCase() === "c") {
        const base = selectedElements.filter((element) => element.type !== "connector");
        if (base.length) {
          window.localStorage.setItem(
            "lattice.canvasClipboard",
            JSON.stringify([...base, ...connectorsWithin(base.map((element) => element.id))]),
          );
          toast.success("Copied");
        }
      }
      if (mod && event.key.toLowerCase() === "v") {
        pasteClipboard();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedIds.length) {
          event.preventDefault();
          deleteSelected();
        }
      }
      if (event.key.startsWith("Arrow") && selectedIds.length) {
        event.preventDefault();
        const dx = event.key === "ArrowRight" ? (event.shiftKey ? 10 : 1) : event.key === "ArrowLeft" ? -(event.shiftKey ? 10 : 1) : 0;
        const dy = event.key === "ArrowDown" ? (event.shiftKey ? 10 : 1) : event.key === "ArrowUp" ? -(event.shiftKey ? 10 : 1) : 0;
        nudgeSelected(dx, dy);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [document, selectedIds, selectedElements, presentation, presentationIndex]);

  const fitDocument = useCallback((doc: CanvasDocument) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const bounds = canvasBounds(doc);
    if (!doc.elements.length) {
      setViewport({ x: rect.width / 2 - 200, y: rect.height / 2 - 150, zoom: 1 });
      return;
    }
    const zoom = Math.min(1.2, Math.max(0.2, Math.min((rect.width - 120) / Math.max(1, bounds.width), (rect.height - 140) / Math.max(1, bounds.height))));
    setViewport({
      zoom,
      x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    });
  }, []);

  const fitBounds = useCallback(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const zoom = Math.min(
        1.8,
        Math.max(0.2, Math.min((rect.width - 80) / Math.max(1, bounds.width), (rect.height - 100) / Math.max(1, bounds.height))),
      );
      setViewport({
        zoom,
        x: rect.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: rect.height / 2 - (bounds.y + bounds.height / 2) * zoom,
      });
    },
    [],
  );

  useEffect(() => {
    if (!loadedRef.current || !db || !canvas) return;
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await saveCanvasLocal(db, canvas.id, document);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 650);
  }, [document, db, canvas?.id]);

  const collab = useCanvasCollaboration({
    canvasId: canvasId ?? "",
    workspaceId: activeWorkspaceId,
    enabled: Boolean(canvasId && activeWorkspaceId) && online,
    userName: user?.name ?? "Someone",
    onRemote: (elements, knownIds) => {
      // The save effect below picks the merged document up and persists it.
      setDocument((current) => mergeCanvasDocument(current, elements, knownIds));
    },
  });

  useEffect(() => {
    collab.publish(document);
  }, [collab, document]);

  const publishCursor = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    collab.setCursor({
      x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
    });
  };

  const mutate = useCallback(
    (updater: (current: CanvasDocument) => CanvasDocument, record = true) => {
      setDocument((current) => {
        const next = updater(current);
        if (record) {
          setHistory((previous) => ({
            past: [...previous.past, current].slice(-60),
            future: [],
          }));
        }
        return next;
      });
    },
    [],
  );

  const pushHistory = useCallback(() => {
    setHistory((previous) => ({
      past: [...previous.past, documentRef.current].slice(-60),
      future: [],
    }));
  }, []);

  const historyRef = useRef(history);
  historyRef.current = history;

  const undo = useCallback(() => {
    const previous = historyRef.current;
    const previousDoc = previous.past[previous.past.length - 1];
    if (!previousDoc) return;
    const current = documentRef.current;
    setHistory({
      past: previous.past.slice(0, -1),
      future: [current, ...previous.future].slice(0, 60),
    });
    setDocument(previousDoc);
    documentRef.current = previousDoc;
  }, []);

  const redo = useCallback(() => {
    const previous = historyRef.current;
    const nextDoc = previous.future[0];
    if (!nextDoc) return;
    const current = documentRef.current;
    setHistory({
      past: [...previous.past, current].slice(-60),
      future: previous.future.slice(1),
    });
    setDocument(nextDoc);
    documentRef.current = nextDoc;
  }, []);

  const getPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.x) / viewport.zoom,
        y: (clientY - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport],
  );

  const updateElement = (id: string, patch: Partial<CanvasElement>, record = false) => {
    if (record) pushHistory();
    setDocument((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === id ? ({ ...element, ...patch } as CanvasElement) : element,
      ),
    }));
  };

  const deleteSelected = () => {
    if (!selectedIds.length) return;
    const removed = new Set(selectedIds);
    mutate((current) => ({
      ...current,
      elements: current.elements.filter((element) => {
        if (removed.has(element.id)) return false;
        if (element.type === "connector") {
          const fromId = element.from.elementId;
          const toId = element.to.elementId;
          if ((fromId && removed.has(fromId)) || (toId && removed.has(toId))) return false;
        }
        return true;
      }),
    }));
    setSelectedIds([]);
  };

  const cloneElementsWithConnectors = (source: CanvasElement[], offset: number): CanvasElement[] => {
    const base = source.filter((element) => element.type !== "connector") as Array<
      Exclude<CanvasElement, CanvasConnectorElement>
    >;
    if (!base.length) return [];
    const mapping = new Map<string, string>();
    for (const element of base) mapping.set(element.id, createId());
    const inside = new Set(base.map((element) => element.id));
    const copies: CanvasElement[] = base.map(
      (element) =>
        ({
          ...element,
          id: mapping.get(element.id) as string,
          x: element.x + offset,
          y: element.y + offset,
        }) as CanvasElement,
    );
    for (const element of source) {
      if (element.type !== "connector") continue;
      const fromId = element.from.elementId;
      const toId = element.to.elementId;
      if (!fromId || !toId || !inside.has(fromId) || !inside.has(toId)) continue;
      copies.push({
        ...element,
        id: createId(),
        from: { ...element.from, elementId: mapping.get(fromId) },
        to: { ...element.to, elementId: mapping.get(toId) },
      });
    }
    return copies;
  };

  const connectorsWithin = (ids: string[]): CanvasConnectorElement[] => {
    const inside = new Set(ids);
    return document.elements.filter(
      (element): element is CanvasConnectorElement =>
        element.type === "connector" &&
        Boolean(
          element.from.elementId &&
            element.to.elementId &&
            inside.has(element.from.elementId) &&
            inside.has(element.to.elementId),
        ),
    );
  };

  const duplicateSelected = () => {
    const base = selectedElements.filter((element) => element.type !== "connector");
    if (!base.length) return;
    const copies = cloneElementsWithConnectors(
      [...base, ...connectorsWithin(base.map((element) => element.id))],
      28,
    );
    if (!copies.length) return;
    mutate((current) => ({ ...current, elements: [...current.elements, ...copies] }));
    setSelectedIds(copies.map((element) => element.id));
  };

  const pasteClipboard = () => {
    const raw = window.localStorage.getItem("lattice.canvasClipboard");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as CanvasElement[];
      const copies = cloneElementsWithConnectors(parsed, 36);
      if (!copies.length) return;
      mutate((current) => ({ ...current, elements: [...current.elements, ...copies] }));
      setSelectedIds(copies.map((element) => element.id));
    } catch {
      toast.error("Could not paste canvas elements");
    }
  };

  const nudgeSelected = (dx: number, dy: number) => {
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) && element.type !== "connector"
          ? { ...element, x: element.x + dx, y: element.y + dy }
          : element,
      ),
    }));
  };

  const createAt = (point: { x: number; y: number }, nextTool: Tool) => {
    const base = { id: createId(), x: snap(point.x, grid ? 8 : 1), y: snap(point.y, grid ? 8 : 1) };
    let element: CanvasElement;
    if (nextTool === "note") {
      element = { ...base, type: "note", width: 220, height: 160, text: "", color: "saffron" };
    } else if (nextTool === "frame") {
      element = { ...base, type: "frame", width: 640, height: 420, title: "Frame", color: "paper" };
    } else if (nextTool === "text") {
      element = {
        ...base,
        type: "text",
        width: 320,
        height: 54,
        text: "",
        fontSize: 22,
        color: "#25251f",
      } satisfies CanvasTextElement;
    } else {
      const shape: CanvasShapeElement["shape"] =
        nextTool === "ellipse" ||
        nextTool === "diamond" ||
        nextTool === "parallelogram" ||
        nextTool === "hexagon" ||
        nextTool === "cylinder"
          ? nextTool
          : "rectangle";
      element = {
        ...base,
        type: "shape",
        width: nextTool === "ellipse" ? 200 : 220,
        height: nextTool === "diamond" ? 140 : 110,
        text: "",
        shape,
        color: "paper",
      } satisfies CanvasShapeElement;
    }
    pushHistory();
    setDocument((current) => ({ ...current, elements: [...current.elements, element] }));
    setSelectedIds([element.id]);
    setTool("select");
    if (element.type === "note" || element.type === "shape" || element.type === "text" || element.type === "frame") {
      setEditingId(element.id);
      setEditText("");
    }
  };

  const startPen = (point: { x: number; y: number }) => {
    const element: CanvasFreehandElement = {
      id: createId(),
      type: "freehand",
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      points: [[0, 0]],
      color: "#25251f",
      strokeWidth: 2,
    };
    pushHistory();
    setDocument((current) => ({ ...current, elements: [...current.elements, element] }));
    setSelectedIds([element.id]);
    const drag: DragState = { kind: "pen", elementId: element.id, absolute: [[point.x, point.y]] };
    dragRef.current = drag;
    setDragState(drag);
  };

  const onContainerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || presentation) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-ui]")) return;
    const point = getPoint(event.clientX, event.clientY);
    const elementTarget = target.closest("[data-element-id]");
    if (elementTarget) return;
    if (tool === "pan" || spaceRef.current || (event.pointerType === "touch" && tool === "select")) {
      const drag: DragState = {
        kind: "pan",
        startX: event.clientX,
        startY: event.clientY,
        viewport,
      };
      dragRef.current = drag;
      setDragState(drag);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (editingId) {
      setEditingId(null);
    }
    if (tool === "note" || tool === "rect" || tool === "ellipse" || tool === "diamond" || tool === "text" || tool === "frame") {
      createAt(point, tool);
      return;
    }
    if (tool === "pen") {
      startPen(point);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === "page") {
      setPagePickerOpen(true);
      return;
    }
    setSelectedIds([]);
    setConnectorStart(null);
    const drag: DragState = {
      kind: "marquee",
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    };
    dragRef.current = drag;
    setDragState(drag);
    setMarquee({ x: point.x, y: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onElementPointerDown = (event: React.PointerEvent, element: CanvasElement) => {
    event.stopPropagation();
    if (presentation) return;
    if (tool === "connector") {
      if (!connectorStart) {
        setConnectorStart(element.id);
        toast.message("Select the target element");
      } else if (connectorStart !== element.id) {
        const source = elementsById.get(connectorStart);
        const anchors =
          source && "x" in source && "x" in element
            ? bestAnchors(source, element)
            : { from: "right" as const, to: "left" as const };
        const connector = {
          id: createId(),
          type: "connector" as const,
          from: { elementId: connectorStart, anchor: anchors.from },
          to: { elementId: element.id, anchor: anchors.to },
          arrowEnd: true,
          style: "solid" as const,
          color: "#8b8b7a",
        };
        mutate((current) => ({
          ...current,
          elements: [...current.elements, connector],
        }));
        setConnectorStart(null);
        setSelectedIds([connector.id]);
      }
      return;
    }
    if (event.button !== 0) return;
    if (element.type === "connector" || ("locked" in element && element.locked)) {
      setSelectedIds([element.id]);
      return;
    }
    const groupId = "groupId" in element ? element.groupId : null;
    const groupMembers = groupId
      ? document.elements.filter((entry) => "groupId" in entry && entry.groupId === groupId)
      : [element];
    let nextSelection = selectedIds;
    if (event.shiftKey) {
      nextSelection = selectedIds.includes(element.id)
        ? selectedIds.filter((id) => id !== element.id)
        : [...selectedIds, ...groupMembers.map((entry) => entry.id)];
    } else if (!selectedIds.includes(element.id)) {
      nextSelection = groupMembers.map((entry) => entry.id);
    }
    if (element.type === "frame" && !event.shiftKey) {
      const contained = document.elements.filter(
        (entry) =>
          entry.type !== "connector" &&
          entry.id !== element.id &&
          entry.x >= element.x &&
          entry.y >= element.y &&
          entry.x + entry.width <= element.x + element.width &&
          entry.y + entry.height <= element.y + element.height,
      );
      nextSelection = [...new Set([...nextSelection, ...contained.map((entry) => entry.id)])];
    }
    setSelectedIds(nextSelection);
    const initial: Record<string, { x: number; y: number }> = {};
    for (const entry of document.elements) {
      if (nextSelection.includes(entry.id) && entry.type !== "connector") {
        initial[entry.id] = { x: entry.x, y: entry.y };
      }
    }
    pushHistory();
    const drag: DragState = {
      kind: "move",
      startX: event.clientX,
      startY: event.clientY,
      initial,
    };
    dragRef.current = drag;
    setDragState(drag);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onResizePointerDown = (
    event: React.PointerEvent,
    element: CanvasElement & { x: number; y: number; width: number; height: number },
    handle: "nw" | "ne" | "sw" | "se",
  ) => {
    event.stopPropagation();
    event.preventDefault();
    pushHistory();
    const drag: DragState = {
      kind: "resize",
      startX: event.clientX,
      startY: event.clientY,
      elementId: element.id,
      handle,
      initial: { x: element.x, y: element.y, width: element.width, height: element.height },
    };
    dragRef.current = drag;
    setDragState(drag);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onGroupResizePointerDown = (
    event: React.PointerEvent,
    handle: "nw" | "ne" | "sw" | "se",
  ) => {
    event.stopPropagation();
    event.preventDefault();
    const elements = selectedElements.filter(
      (element): element is Exclude<CanvasElement, CanvasConnectorElement> =>
        element.type !== "connector",
    );
    if (elements.length < 2) return;
    const box = {
      x: Math.min(...elements.map((element) => element.x)),
      y: Math.min(...elements.map((element) => element.y)),
      width:
        Math.max(...elements.map((element) => element.x + element.width)) -
        Math.min(...elements.map((element) => element.x)),
      height:
        Math.max(...elements.map((element) => element.y + element.height)) -
        Math.min(...elements.map((element) => element.y)),
    };
    pushHistory();
    const drag: DragState = {
      kind: "group-resize",
      startX: event.clientX,
      startY: event.clientY,
      handle,
      bounds: box,
      initial: elements.map((element) => ({
        id: element.id,
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      })),
    };
    dragRef.current = drag;
    setDragState(drag);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + (event.clientX - drag.startX),
        y: drag.viewport.y + (event.clientY - drag.startY),
      });
      return;
    }
    if (drag.kind === "move") {
      const dx = (event.clientX - drag.startX) / viewport.zoom;
      const dy = (event.clientY - drag.startY) / viewport.zoom;
      setDocument((current) => ({
        ...current,
        elements: current.elements.map((element) => {
          const initial = drag.initial[element.id];
          if (!initial || element.type === "connector") return element;
          return {
            ...element,
            x: snap(initial.x + dx, grid ? 8 : 1),
            y: snap(initial.y + dy, grid ? 8 : 1),
          };
        }),
      }));
      return;
    }
    if (drag.kind === "resize") {
      const dx = (event.clientX - drag.startX) / viewport.zoom;
      const dy = (event.clientY - drag.startY) / viewport.zoom;
      const initial = drag.initial;
      let { x, y, width, height } = initial;
      if (drag.handle.includes("e")) width = Math.max(40, initial.width + dx);
      if (drag.handle.includes("s")) height = Math.max(40, initial.height + dy);
      if (drag.handle.includes("w")) {
        width = Math.max(40, initial.width - dx);
        x = initial.x + (initial.width - width);
      }
      if (drag.handle.includes("n")) {
        height = Math.max(40, initial.height - dy);
        y = initial.y + (initial.height - height);
      }
      setDocument((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === drag.elementId && element.type !== "connector"
            ? {
                ...element,
                x: snap(x, grid ? 8 : 1),
                y: snap(y, grid ? 8 : 1),
                width: snap(width, grid ? 8 : 1),
                height: snap(height, grid ? 8 : 1),
              }
            : element,
        ),
      }));
      return;
    }
    if (drag.kind === "group-resize") {
      const dx = (event.clientX - drag.startX) / viewport.zoom;
      const dy = (event.clientY - drag.startY) / viewport.zoom;
      const { bounds, handle } = drag;
      const minScaleX = 20 / Math.max(1, bounds.width);
      const minScaleY = 20 / Math.max(1, bounds.height);
      const scaleX = Math.max(
        minScaleX,
        handle.includes("e") ? (bounds.width + dx) / bounds.width : (bounds.width - dx) / bounds.width,
      );
      const scaleY = Math.max(
        minScaleY,
        handle.includes("s") ? (bounds.height + dy) / bounds.height : (bounds.height - dy) / bounds.height,
      );
      const fixedX = handle.includes("w") ? bounds.x + bounds.width : bounds.x;
      const fixedY = handle.includes("n") ? bounds.y + bounds.height : bounds.y;
      const byId = new Map(drag.initial.map((entry) => [entry.id, entry]));
      setDocument((current) => ({
        ...current,
        elements: current.elements.map((element) => {
          const initial = byId.get(element.id);
          if (!initial) return element;
          return {
            ...element,
            x: snap(fixedX + (initial.x - fixedX) * scaleX, grid ? 8 : 1),
            y: snap(fixedY + (initial.y - fixedY) * scaleY, grid ? 8 : 1),
            width: snap(Math.max(20, initial.width * scaleX), grid ? 8 : 1),
            height: snap(Math.max(20, initial.height * scaleY), grid ? 8 : 1),
          };
        }),
      }));
      return;
    }
    if (drag.kind === "marquee") {
      const point = getPoint(event.clientX, event.clientY);
      const x = Math.min(drag.startX, point.x);
      const y = Math.min(drag.startY, point.y);
      const width = Math.abs(point.x - drag.startX);
      const height = Math.abs(point.y - drag.startY);
      setMarquee({ x, y, width, height });
      return;
    }
    if (drag.kind === "pen") {
      const point = getPoint(event.clientX, event.clientY);
      drag.absolute.push([point.x, point.y]);
      const xs = drag.absolute.map(([x]) => x);
      const ys = drag.absolute.map(([, y]) => y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const width = Math.max(1, Math.max(...xs) - minX);
      const height = Math.max(1, Math.max(...ys) - minY);
      const points = drag.absolute.map(([x, y]) => [x - minX, y - minY] as [number, number]);
      setDocument((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === drag.elementId && element.type === "freehand"
            ? { ...element, x: minX, y: minY, width, height, points }
            : element,
        ),
      }));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "marquee") {
      const point = getPoint(event.clientX, event.clientY);
      const x = Math.min(drag.startX, point.x);
      const y = Math.min(drag.startY, point.y);
      const width = Math.abs(point.x - drag.startX);
      const height = Math.abs(point.y - drag.startY);
      const hits = document.elements
        .filter((element) => element.type !== "connector")
        .filter(
          (element) =>
            element.x < x + width &&
            element.x + element.width > x &&
            element.y < y + height &&
            element.y + element.height > y,
        )
        .map((element) => element.id);
      setSelectedIds(hits);
      setMarquee(null);
    }
    if (drag.kind === "pen") {
      setTool("select");
    }
    dragRef.current = null;
    setDragState(null);
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (presentation) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const worldX = (mouseX - viewport.x) / viewport.zoom;
      const worldY = (mouseY - viewport.y) / viewport.zoom;
      const nextZoom = Math.min(3, Math.max(0.2, viewport.zoom * Math.exp(-event.deltaY * 0.002)));
      setViewport({
        zoom: nextZoom,
        x: mouseX - worldX * nextZoom,
        y: mouseY - worldY * nextZoom,
      });
    } else {
      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaX,
        y: current.y - event.deltaY,
      }));
    }
  };

  const beginEdit = (element: CanvasElement) => {
    if (!("text" in element) && element.type !== "frame") return;
    pushHistory();
    setEditingId(element.id);
    setEditText(element.type === "frame" ? element.title : "text" in element ? element.text : "");
    setSelectedIds([element.id]);
  };

  const commitEdit = () => {
    if (!editingId) return;
    setDocument((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        if (element.id !== editingId) return element;
        if (element.type === "frame") return { ...element, title: editText };
        if (element.type === "note" || element.type === "shape" || element.type === "text" || element.type === "freehand") {
          return { ...element, text: editText } as CanvasElement;
        }
        return element;
      }),
    }));
    setEditingId(null);
  };

  const openPage = (pageId: string) => {
    router.push(appRouteObject({ view: "page", id: pageId }));
  };

  const insertPageCard = (pageId: string, pageTitle: string) => {
    const point = getPoint(
      (containerRef.current?.getBoundingClientRect().left ?? 0) + (containerRef.current?.clientWidth ?? 0) / 2,
      (containerRef.current?.getBoundingClientRect().top ?? 0) + (containerRef.current?.clientHeight ?? 0) / 2,
    );
    const element: CanvasPageElement = {
      id: createId(),
      type: "page",
      pageId,
      variant: "card",
      x: snap(point.x - 130),
      y: snap(point.y - 70),
      width: 260,
      height: 150,
    };
    mutate((current) => ({ ...current, elements: [...current.elements, element] }));
    setSelectedIds([element.id]);
    void pageTitle;
  };

  const insertNestedCanvas = (entry: LocalCanvas) => {
    const element: CanvasCanvasElement = {
      id: createId(),
      type: "canvas",
      canvasId: entry.id,
      x: 0,
      y: 0,
      width: 260,
      height: 150,
    };
    mutate((current) => ({ ...current, elements: [...current.elements, element] }));
    setNestedOpen(false);
    toast.success("Nested canvas added");
  };

  const generateFromPage = async (pageId: string) => {
    const intent = generateIntent;
    const pluginRequest = pluginTool;
    setGenerateIntent(null);
    setPluginTool(null);
    if (!db || !user || !activeWorkspaceId) return;
    if (!intent && !pluginRequest) return;
    const sourcePage = pagesById.get(pageId);
    const sourceDocument = await db.pageDocuments.get(pageId);
    const baseTitle = sourcePage?.title ?? "Untitled";

    if (pluginRequest) {
      const plugin = installedPlugins.find(
        (entry) => entry.manifest.id === pluginRequest.pluginId && entry.enabled,
      );
      const tool = plugin?.manifest.canvasTools?.find((entry) => entry.id === pluginRequest.toolId);
      if (!plugin || !tool) {
        toast.error("That plugin is no longer installed.");
        return;
      }
      const outlineDoc = safeDoc(sourceDocument?.content);
      const outcome = await runPluginCommand({
        plugin,
        tool: { id: tool.id, label: tool.label },
        page: {
          pageId,
          title: baseTitle,
          text: extractPlainText(outlineDoc),
          markdown: docToMarkdown(outlineDoc),
        },
        canvas: {
          title: baseTitle,
          nodes: [
            {
              id: pageId,
              title: baseTitle,
              body: extractPlainText(outlineDoc).slice(0, 4000),
            },
          ],
          edges: [],
        },
      });
      if (!outcome.ok) {
        toast.error(outcome.error ?? `${plugin.manifest.name} failed`);
        return;
      }
      const markdown = typeof outcome.value === "string" ? outcome.value : "";
      if (!markdown.trim()) {
        toast.error(`${tool.label} returned no text to lay out.`);
        return;
      }
      const derivedOutline = extractOutline(safeDoc(markdownToDoc(markdown)));
      if (!derivedOutline.length) {
        toast.error("The plugin's output had no headings or lists to lay out.");
        return;
      }
      const data =
        tool.layout === "flow"
          ? createFlowFromOutline(baseTitle, derivedOutline)
          : tool.layout === "concept"
            ? createConceptMap(baseTitle, derivedOutline)
            : createMindMap(baseTitle, derivedOutline);
      const created = await createCanvasLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        title: `${baseTitle} — ${tool.label}`,
        icon: "◈",
        data,
        notebookId: sourcePage?.notebookId ?? null,
      });
      toast.success(`Generated a canvas with ${plugin.manifest.name}`);
      router.push(appRouteObject({ view: "canvas", id: created.id }));
      return;
    }

    const outline = extractOutline(safeDoc(sourceDocument?.content));
    const data =
      intent === "mindmap"
        ? createMindMap(baseTitle, outline)
        : intent === "flow"
          ? createFlowFromOutline(baseTitle, outline)
          : createConceptMap(baseTitle, outline);
    const created = await createCanvasLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      title:
        intent === "mindmap"
          ? `${baseTitle} — mind map`
          : intent === "flow"
            ? `${baseTitle} — flowchart`
            : `${baseTitle} — concept map`,
      icon: "◈",
      data,
      notebookId: sourcePage?.notebookId ?? null,
    });
    toast.success("Generated a new canvas from the page outline");
    router.push(appRouteObject({ view: "canvas", id: created.id }));
  };

  const convertSelectionToPages = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    const convertible = selectedElements.filter(
      (element) => element.type === "note" || element.type === "shape" || element.type === "text",
    ) as Array<CanvasNoteElement | CanvasShapeElement | CanvasTextElement>;
    if (!convertible.length) return;
    const replacements: CanvasPageElement[] = [];
    for (const element of convertible) {
      const text = element.text.trim();
      const firstLine = text.split("\n")[0]?.trim() || "Untitled idea";
      const created = await createPageLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        notebookId: canvas?.notebookId ?? null,
        title: firstLine.slice(0, 90),
        icon: "◇",
        content: docFromText(text || firstLine),
      });
      replacements.push({
        id: createId(),
        type: "page",
        pageId: created.page.id,
        variant: "card",
        x: element.x,
        y: element.y,
        width: Math.max(220, element.width),
        height: Math.max(140, element.height),
      });
    }
    const replacementByElement = new Map(
      convertible.map((element, index) => [element.id, replacements[index]!]),
    );
    mutate((current) => ({
      ...current,
      elements: [
        ...current.elements
          .filter((element) => !replacementByElement.has(element.id))
          .map((element) => {
            if (element.type !== "connector") return element;
            const from = element.from.elementId
              ? replacementByElement.get(element.from.elementId)
              : undefined;
            const to = element.to.elementId ? replacementByElement.get(element.to.elementId) : undefined;
            if (!from && !to) return element;
            return {
              ...element,
              from: from ? { ...element.from, elementId: from.id } : element.from,
              to: to ? { ...element.to, elementId: to.id } : element.to,
            };
          }),
        ...replacements,
      ],
    }));
    setSelectedIds(replacements.map((element) => element.id));
    toast.success(
      replacements.length === 1
        ? "Page created from the node"
        : `${replacements.length} pages created from the selection`,
    );
  };

  const openSnapshots = async () => {
    if (!canvas) return;
    if (!online) {
      toast.error("Snapshots need a connection to the sync server.");
      return;
    }
    setSnapshotsOpen(true);
    setSnapshotsLoading(true);
    try {
      const result = await client.canvas.versions({ canvasId: canvas.id });
      setSnapshots(result as unknown as typeof snapshots);
    } catch {
      toast.error("Could not load snapshots");
    } finally {
      setSnapshotsLoading(false);
    }
  };

  const saveSnapshot = async () => {
    if (!canvas || !online) return;
    try {
      await client.canvas.saveVersion({ canvasId: canvas.id });
      toast.success("Snapshot saved");
      await openSnapshots();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the snapshot");
    }
  };

  const restoreSnapshot = async (versionId: string) => {
    if (!canvas || !db) return;
    try {
      const result = await client.canvas.restoreVersion({ canvasId: canvas.id, versionId });
      const restored = result.canvas as unknown as LocalCanvas & { data: CanvasDocument };
      const existing = await db.canvases.get(canvas.id);
      if (existing) {
        await db.canvases.put({
          ...existing,
          data: restored.data,
          rev: restored.rev,
          updatedAt: restored.updatedAt,
          localUpdatedAt: new Date().toISOString(),
        } as LocalCanvas);
      }
      pushHistory();
      setDocument(restored.data);
      documentRef.current = restored.data;
      setSelectedIds([]);
      requestAnimationFrame(() => fitDocument(restored.data));
      setSnapshotsOpen(false);
      toast.success("Snapshot restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore the snapshot");
    }
  };

  const addImageElement = (
    src: string,
    at?: { x: number; y: number },
    size?: { width: number; height: number },
  ) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const point =
      at ?? (rect ? getPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 0, y: 0 });
    const width = size?.width ?? 320;
    const height = size?.height ?? 220;
    const element: CanvasImageElement = {
      id: createId(),
      type: "image",
      src,
      alt: "",
      x: snap(point.x - width / 2, grid ? 8 : 1),
      y: snap(point.y - height / 2, grid ? 8 : 1),
      width,
      height,
    };
    pushHistory();
    setDocument((current) => ({ ...current, elements: [...current.elements, element] }));
    setSelectedIds([element.id]);
  };

  const [imagePromptOpen, setImagePromptOpen] = useState(false);

  const insertImageFromUrl = async (src: string) => {
    // Wait for the file to load, so the element takes the image's shape and the
    // confirmation is not claiming something that failed.
    const size = await new Promise<{ width: number; height: number }>((resolve) => {
      const probe = new window.Image();
      probe.onload = () =>
        resolve({ width: probe.naturalWidth || 320, height: probe.naturalHeight || 220 });
      probe.onerror = () => resolve({ width: 320, height: 220 });
      probe.src = src;
    });
    const scale = Math.min(1, 420 / Math.max(1, size.width));
    addImageElement(src, undefined, {
      width: Math.max(80, Math.round(size.width * scale)),
      height: Math.max(60, Math.round(size.height * scale)),
    });
    toast.success("Image added");
  };

  const insertImageFile = async (file: File, at?: { x: number; y: number }) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files can go on the canvas.");
      return;
    }
    try {
      const uploaded = await uploadFile(file);
      const size = await new Promise<{ width: number; height: number }>((resolve) => {
        const probe = new window.Image();
        probe.onload = () =>
          resolve({ width: probe.naturalWidth || 320, height: probe.naturalHeight || 220 });
        probe.onerror = () => resolve({ width: 320, height: 220 });
        probe.src = uploaded.url;
      });
      const scale = Math.min(1, 420 / Math.max(1, size.width));
      addImageElement(uploaded.url, at, {
        width: Math.max(80, Math.round(size.width * scale)),
        height: Math.max(60, Math.round(size.height * scale)),
      });
      toast.success("Image added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the image");
    }
  };

  const applyTemplate = (build: () => CanvasDocument) => {
    const replace = () => {
      const next = build();
      pushHistory();
      setDocument(next);
      setSelectedIds([]);
      setTemplateOpen(false);
      requestAnimationFrame(() => fitDocument(next));
    };
    if (document.elements.length) {
      setPendingTemplate(() => replace);
      return;
    }
    replace();
  };

  const groupSelected = () => {
    if (selectedIds.length < 2) return;
    const groupId = createId();
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) && element.type !== "connector" ? { ...element, groupId } : element,
      ),
    }));
  };

  const ungroupSelected = () => {
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) && "groupId" in element ? { ...element, groupId: null } : element,
      ),
    }));
  };

  const alignSelected = (alignment: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => {
    const elements = selectedElements.filter((element) => element.type !== "connector");
    if (elements.length < 2) return;
    const minX = Math.min(...elements.map((element) => element.x));
    const maxX = Math.max(...elements.map((element) => element.x + element.width));
    const minY = Math.min(...elements.map((element) => element.y));
    const maxY = Math.max(...elements.map((element) => element.y + element.height));
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        if (!selectedIds.includes(element.id) || element.type === "connector") return element;
        if (alignment === "left") return { ...element, x: minX };
        if (alignment === "right") return { ...element, x: maxX - element.width };
        if (alignment === "hcenter") return { ...element, x: (minX + maxX) / 2 - element.width / 2 };
        if (alignment === "top") return { ...element, y: minY };
        if (alignment === "bottom") return { ...element, y: maxY - element.height };
        return { ...element, y: (minY + maxY) / 2 - element.height / 2 };
      }),
    }));
  };

  const bringToFront = () => {
    if (!selectedIds.length) return;
    mutate((current) => {
      const selected = current.elements.filter((element) => selectedIds.includes(element.id));
      const rest = current.elements.filter((element) => !selectedIds.includes(element.id));
      return { ...current, elements: [...rest, ...selected] };
    });
  };

  const sendToBack = () => {
    if (!selectedIds.length) return;
    mutate((current) => {
      const selected = current.elements.filter((element) => selectedIds.includes(element.id));
      const rest = current.elements.filter((element) => !selectedIds.includes(element.id));
      return { ...current, elements: [...selected, ...rest] };
    });
  };

  const layerElements = useMemo(
    () => document.elements.filter((element) => element.type !== "connector").slice().reverse(),
    [document.elements],
  );

  const layerLabel = (element: CanvasElement): string => {
    if (element.type === "frame") return element.title || "Frame";
    if (element.type === "page") return pagesById.get(element.pageId)?.title ?? "Linked page";
    if (element.type === "canvas") return canvasesById.get(element.canvasId)?.title ?? "Canvas card";
    if (element.type === "image") return "Image";
    if ("text" in element && element.text.trim()) return element.text.trim().slice(0, 45);
    const names: Record<string, string> = {
      note: "Sticky note",
      shape: "Shape",
      text: "Text",
      freehand: "Drawing",
    };
    return names[element.type] ?? element.type;
  };

  const moveLayer = (id: string, direction: "up" | "down") => {
    mutate((current) => {
      const elements = [...current.elements];
      const index = elements.findIndex((element) => element.id === id);
      if (index === -1) return current;
      let target = -1;
      if (direction === "up") {
        for (let cursor = index + 1; cursor < elements.length; cursor += 1) {
          if (elements[cursor]!.type !== "connector") {
            target = cursor;
            break;
          }
        }
      } else {
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
          if (elements[cursor]!.type !== "connector") {
            target = cursor;
            break;
          }
        }
      }
      if (target === -1) return current;
      [elements[index], elements[target]] = [elements[target]!, elements[index]!];
      return { ...current, elements };
    });
  };

  const changeSlide = useCallback(
    (delta: number) => {
      if (!frames.length) return;
      const next = (presentationIndex + delta + frames.length) % frames.length;
      setPresentationIndex(next);
      const frame = frames[next];
      if (frame) fitBounds({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
    },
    [frames, presentationIndex, fitBounds],
  );

  const startPresentation = () => {
    if (frames.length) {
      setPresentationIndex(0);
      fitBounds({ x: frames[0]!.x, y: frames[0]!.y, width: frames[0]!.width, height: frames[0]!.height });
    } else {
      fitDocument(document);
    }
    setPresentation(true);
  };

  const exportCanvas = (format: "svg" | "png" | "pdf") => {
    const exported = canvasToSvg(document, {
      pageTitles: new Map(pages.map((page) => [page.id, page.title])),
      canvasTitles: new Map(canvases.map((entry) => [entry.id, entry.title])),
    });
    const filename = `${(canvas?.title ?? "canvas").toLowerCase().replace(/\s+/g, "-")}`;
    if (format === "svg") {
      downloadSvg(exported.svg, `${filename}.svg`);
      toast.success("SVG exported");
    } else if (format === "png") {
      void exportPng(exported.svg, exported.width, exported.height, `${filename}.png`).then(
        () => toast.success("PNG exported"),
        () => toast.error("Could not export PNG"),
      );
    } else {
      printCanvas(exported.svg);
    }
  };

  const setColor = (color: StickyColor) => {
    if (!selectedIds.length) return;
    mutate((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) && element.type !== "connector" && "color" in element
          ? { ...element, color }
          : element,
      ),
    }));
  };

  if (!canvasId) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <Frame className="mx-auto size-8 text-muted-foreground/40" />
          <h2 className="mt-3 font-display text-2xl">No canvas selected</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">Create one from the sidebar.</p>
        </div>
      </div>
    );
  }

  if (!canvas) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <Frame className="mx-auto size-8 text-muted-foreground/40" />
          <h2 className="mt-3 font-display text-2xl">Canvas not available</h2>
        </div>
      </div>
    );
  }

  const selectionBounds = (() => {
    const elements = selectedElements.filter((element) => element.type !== "connector");
    if (!elements.length) return null;
    return {
      x: Math.min(...elements.map((element) => element.x)),
      y: Math.min(...elements.map((element) => element.y)),
      width: Math.max(...elements.map((element) => element.x + element.width)) - Math.min(...elements.map((element) => element.x)),
      height: Math.max(...elements.map((element) => element.y + element.height)) - Math.min(...elements.map((element) => element.y)),
    };
  })();

  const editingElement = editingId ? document.elements.find((element) => element.id === editingId) : null;

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden bg-background", presentation && "bg-[oklch(0.14_0.01_75)]")}>
      {!presentation ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-3">
          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-border/70 bg-popover/95 p-1 shadow-xl backdrop-blur">
            {(
              [
                ["select", MousePointer2, "Select (V)"],
                ["pan", Hand, "Pan (H / Space)"],
                ["note", StickyNote, "Sticky note (N)"],
                ["rect", Square, "Rectangle (R)"],
                ["ellipse", Circle, "Ellipse (O)"],
                ["diamond", Diamond, "Diamond"],
                ["parallelogram", Shapes, "Parallelogram"],
                ["hexagon", Hexagon, "Hexagon"],
                ["cylinder", Cylinder, "Cylinder"],
                ["text", Type, "Text (T)"],
                ["pen", PenTool, "Pen (P)"],
                ["connector", ArrowRight, "Connector (C)"],
                ["frame", Frame, "Frame (F)"],
                ["page", FileText, "Linked note"],
                ["image", ImageIcon, "Image"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                title={label}
                onClick={() => {
                  if (value === "page") {
                    setPagePickerOpen(true);
                    return;
                  }
                  if (value === "image") {
                    imageInputRef.current?.click();
                    return;
                  }
                  setTool(value as Tool);
                  setConnectorStart(null);
                }}
                className={cn(
                  "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target",
                  tool === (value as Tool) && "bg-foreground text-background hover:bg-foreground hover:text-background",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              title="Undo"
              onClick={undo}
              disabled={!history.past.length}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 tap-target"
            >
              <Undo2 className="size-3.5" />
            </button>
            <button
              type="button"
              title="Redo"
              onClick={redo}
              disabled={!history.future.length}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 tap-target"
            >
              <Redo2 className="size-3.5" />
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
            <button
              type="button"
              title="Zoom out"
              onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.2, current.zoom / 1.2) }))}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="w-9 text-center font-mono text-[9px] text-muted-foreground">
              {Math.round(viewport.zoom * 100)}%
            </span>
            <button
              type="button"
              title="Zoom in"
              onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(3, current.zoom * 1.2) }))}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <button
              type="button"
              title="Fit canvas"
              onClick={() => fitDocument(document)}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <button
              type="button"
              title="Toggle grid"
              onClick={() => setGrid((value) => !value)}
              className={cn(
                "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target",
                grid && "bg-muted text-foreground",
              )}
            >
              <Grid3X3 className="size-3.5" />
            </button>
            <span className="mx-1 h-5 w-px bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button type="button" title="More" className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target" />
                }
              >
                <Layers className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-52">
                <DropdownMenuItem onClick={() => setNestedOpen(true)}>
                  <Frame className="size-3.5" /> Insert canvas card
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setTemplateOpen(true)}>
                  <Sparkles className="size-3.5" /> Apply template
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <GitBranch className="size-3.5" /> Generate from outline
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => setGenerateIntent("mindmap")}>
                      Mind map from page outline
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setGenerateIntent("flow")}>
                      Flowchart from page outline
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setGenerateIntent("concept")}>
                      Concept map from page outline
                    </DropdownMenuItem>
                    {canvasPluginTools.length ? <DropdownMenuSeparator /> : null}
                    {canvasPluginTools.map((entry) => (
                      <DropdownMenuItem
                        key={`${entry.plugin.manifest.id}:${entry.tool.id}`}
                        onClick={() =>
                          setPluginTool({
                            pluginId: entry.plugin.manifest.id,
                            toolId: entry.tool.id,
                          })
                        }
                      >
                        {entry.tool.label} · {entry.plugin.manifest.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={() => setLayersOpen(true)}>
                  <Layers className="size-3.5" /> Layers
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void openSnapshots()}>
                  <History className="size-3.5" /> Snapshots
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setImagePromptOpen(true)}>
                  <ImageIcon className="size-3.5" /> Image from URL
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => exportCanvas("svg")}>
                  <Download className="size-3.5" /> Export SVG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportCanvas("png")}>
                  <Download className="size-3.5" /> Export PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportCanvas("pdf")}>
                  <Download className="size-3.5" /> Print / PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={startPresentation} disabled={!document.elements.length}>
                  <Play className="size-3.5" /> Present
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              title="Present"
              onClick={startPresentation}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
            >
              <Play className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {!presentation ? (
        <div className="absolute left-3 top-14 z-20 w-52 rounded-lg border border-border/70 bg-popover/90 p-2.5 shadow-lg backdrop-blur">
          <input
            value={title}
            onFocus={() => {
              titleFocused.current = true;
            }}
            onChange={(event) => {
              const value = event.target.value;
              setTitle(value);
              if (titleTimer.current) clearTimeout(titleTimer.current);
              titleTimer.current = setTimeout(() => {
                if (db) void updateCanvasLocal(db, canvas.id, { title: value });
              }, 500);
            }}
            onBlur={() => {
              titleFocused.current = false;
              if (db) void updateCanvasLocal(db, canvas.id, { title });
            }}
            className="w-full bg-transparent text-[12px] font-semibold outline-none"
          />
          <div className="mt-1 flex items-center gap-1.5 text-[8px] text-muted-foreground">
            <span className={cn("status-dot", saveStatus === "error" ? "bg-destructive" : "bg-moss")} />
            {saveStatus === "saving" ? "Saving locally…" : saveStatus === "error" ? "Save failed" : "Saved locally"}
            <span className="opacity-40">·</span>
            <span>{document.elements.length} elements</span>
            {collab.status !== "disconnected" || collab.peers.length ? (
              <>
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-1">
                  {collab.peers.length ? (
                    <span className="flex -space-x-1">
                      {collab.peers.slice(0, 4).map((peer) => (
                        <span
                          key={peer.clientId}
                          title={peer.name}
                          className="grid size-4 place-items-center rounded-full border border-background text-[7px] font-semibold text-background"
                          style={{ backgroundColor: peer.color }}
                        >
                          {peer.name.slice(0, 1).toUpperCase()}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      collab.status === "connected"
                        ? "bg-moss"
                        : collab.status === "connecting"
                          ? "bg-saffron"
                          : "bg-border",
                    )}
                  />
                  <span>
                    {collab.status === "connected"
                      ? collab.peers.length
                        ? `${collab.peers.length} editing`
                        : "Live"
                      : collab.status === "connecting"
                        ? "Connecting"
                        : "Solo"}
                  </span>
                </span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className={cn(
          "canvas-screen relative h-full w-full overflow-hidden",
          grid ? "dot-grid" : "",
          presentation && "canvas-presentation",
          dragState?.kind === "pan" || tool === "pan" ? "cursor-grab" : "",
          dragState?.kind === "move" && "cursor-move",
        )}
        style={{
          backgroundSize: grid ? `${22 * viewport.zoom}px ${22 * viewport.zoom}px` : undefined,
          backgroundPosition: grid ? `${viewport.x}px ${viewport.y}px` : undefined,
          backgroundColor: presentation ? "oklch(0.14 0.01 75)" : undefined,
        }}
        onPointerDown={onContainerPointerDown}
        onPointerMove={(event) => {
          onPointerMove(event);
          publishCursor(event);
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
            file.type.startsWith("image/"),
          );
          if (!files.length) return;
          event.preventDefault();
          const point = getPoint(event.clientX, event.clientY);
          for (const file of files) void insertImageFile(file, point);
        }}
      >
        <div
          className="absolute origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {collab.peers
            .filter((peer) => peer.cursor)
            .map((peer) => (
              <div
                key={peer.clientId}
                data-peer-cursor
                className="pointer-events-none absolute z-50 flex items-center gap-1"
                style={{ left: peer.cursor!.x, top: peer.cursor!.y }}
              >
                <span
                  className="size-2 shrink-0 rounded-full ring-2 ring-background"
                  style={{ backgroundColor: peer.color }}
                />
                <span
                  className="whitespace-nowrap rounded px-1 text-[9px] text-background"
                  style={{ backgroundColor: peer.color }}
                >
                  {peer.name}
                </span>
              </div>
            ))}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <defs>
              <marker id="canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: "var(--graph-arrow)" }} />
              </marker>
            </defs>
            {document.elements
              .filter((element) => element.type === "connector")
              .map((connector) => {
                const from = connectorPoint(connector.from, elementsById);
                const to = connectorPoint(connector.to, elementsById);
                const selected = selectedIds.includes(connector.id);
                return (
                  <g key={connector.id}>
                    {selected ? (
                      <line
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        className="stroke-primary"
                        strokeWidth={6}
                        strokeOpacity={0.25}
                        strokeLinecap="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={connector.color ?? "var(--relation-related-to)"}
                      strokeWidth={selected ? 2.5 : 1.5}
                      strokeDasharray={connector.style === "dashed" ? "8 6" : connector.style === "dotted" ? "2 5" : undefined}
                      markerEnd={connector.arrowEnd === false ? undefined : "url(#canvas-arrow)"}
                      vectorEffect="non-scaling-stroke"
                    />
                    {connector.label ? (
                      <text
                        x={(from.x + to.x) / 2}
                        y={(from.y + to.y) / 2 - 6}
                        textAnchor="middle"
                        className="fill-muted-foreground"
                        fontSize={11}
                      >
                        {connector.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
          </svg>

          {document.elements
            .filter((element): element is CanvasConnectorElement => element.type === "connector")
            .map((connector) => {
              const from = connectorPoint(connector.from, elementsById);
              const to = connectorPoint(connector.to, elementsById);
              const length = Math.hypot(to.x - from.x, to.y - from.y);
              if (length < 2) return null;
              const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
              return (
                <div
                  key={`hit:${connector.id}`}
                  role="button"
                  aria-label="Connector"
                  title="Click to select · double-click to rename"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (presentation || tool === "connector") return;
                    setSelectedIds([connector.id]);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setSelectedIds([connector.id]);
                  }}
                  className="absolute cursor-pointer"
                  style={{
                    left: (from.x + to.x) / 2,
                    top: (from.y + to.y) / 2,
                    width: Math.max(12, length),
                    height: 14,
                    transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                  }}
                />
              );
            })}

          {document.elements.map((element) => {
            if (element.type === "connector") return null;
            const selected = selectedIds.includes(element.id);
            if (element.type === "page") {
              return (
                <div
                  key={element.id}
                  onPointerDown={(event) => onElementPointerDown(event, element)}
                  onDoubleClick={() => openPage(element.pageId)}
                  style={{ position: "absolute", left: 0, top: 0 }}
                >
                  <LivePageCard element={element} selected={selected} onOpen={() => openPage(element.pageId)} />
                </div>
              );
            }
            if (element.type === "canvas") {
              return (
                <div
                  key={element.id}
                  onPointerDown={(event) => onElementPointerDown(event, element)}
                  onDoubleClick={() => router.push(appRouteObject({ view: "canvas", id: element.canvasId }))}
                  style={{ position: "absolute", left: 0, top: 0 }}
                >
                  <LiveCanvasCard
                    element={element}
                    selected={selected}
                    onOpen={() => router.push(appRouteObject({ view: "canvas", id: element.canvasId }))}
                  />
                </div>
              );
            }
            if (element.type === "frame") {
              return (
                <div
                  key={element.id}
                  data-element-id={element.id}
                  onPointerDown={(event) => onElementPointerDown(event, element)}
                  onDoubleClick={() => beginEdit(element)}
                  className={cn(
                    "canvas-element absolute border border-dashed border-foreground/20 bg-transparent",
                    selected && "ring-1 ring-primary",
                  )}
                  style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
                >
                  <div className="flex h-8 items-center gap-1 border-b border-foreground/10 px-3 text-[10px] text-muted-foreground">
                    <Frame className="size-3 text-moss" />
                    {editingId === element.id ? (
                      <input
                        autoFocus
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={commitEdit}
                        onKeyDown={(event) => event.key === "Enter" && commitEdit()}
                        className="w-full bg-transparent text-[10px] outline-none"
                      />
                    ) : (
                      element.title
                    )}
                  </div>
                </div>
              );
            }
            if (element.type === "freehand") {
              return (
                <div
                  key={element.id}
                  data-element-id={element.id}
                  onPointerDown={(event) => onElementPointerDown(event, element)}
                  className={cn("canvas-element absolute", selected && "ring-1 ring-primary")}
                  style={{ left: element.x, top: element.y, width: element.width, height: element.height, boxShadow: "none", background: "transparent" }}
                >
                  <svg width={element.width} height={element.height} className="overflow-visible">
                    <polyline
                      points={element.points.map(([x, y]) => `${x},${y}`).join(" ")}
                      fill="none"
                      stroke={element.color}
                      strokeWidth={element.strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              );
            }
            if (element.type === "image") {
              return (
                <div
                  key={element.id}
                  data-element-id={element.id}
                  onPointerDown={(event) => onElementPointerDown(event, element)}
                  className={cn("canvas-element absolute overflow-hidden rounded-xl border border-border/60 bg-card", selected && "ring-2 ring-primary")}
                  style={{ left: element.x, top: element.y, width: element.width, height: element.height }}
                >
                  <img src={element.src} alt={element.alt ?? ""} className="h-full w-full object-cover" draggable={false} />
                </div>
              );
            }
            if (element.type === "text") {
              return (
                <div
                  key={element.id}
                  data-element-id={element.id}
                  onPointerDown={(event) => onElementPointerDown(event, element)}
                  onDoubleClick={() => beginEdit(element)}
                  className={cn("canvas-element absolute whitespace-pre-wrap bg-transparent p-1", selected && "ring-1 ring-primary")}
                  style={{
                    left: element.x,
                    top: element.y,
                    width: element.width,
                    minHeight: element.height,
                    color: element.color,
                    fontSize: element.fontSize,
                    boxShadow: "none",
                    textAlign: element.align ?? "left",
                  }}
                >
                  {editingId === element.id ? (
                    <textarea
                      autoFocus
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onBlur={commitEdit}
                      className="h-full w-full resize-none bg-transparent outline-none"
                      style={{ fontSize: element.fontSize, color: element.color }}
                    />
                  ) : (
                    element.text || "Text"
                  )}
                </div>
              );
            }
            const isShape = element.type === "shape";
            return (
              <div
                key={element.id}
                data-element-id={element.id}
                onPointerDown={(event) => onElementPointerDown(event, element)}
                onDoubleClick={() => beginEdit(element)}
                className={cn(
                  "canvas-element absolute flex cursor-default flex-col overflow-hidden border border-foreground/10 p-3 text-ink",
                  colorClass(element.color),
                  isShape ? shapeBorder(element.shape) : "rounded-lg",
                  selected && "ring-2 ring-primary",
                  element.type === "note" && "shadow-sm",
                )}
                style={{
                  left: element.x,
                  top: element.y,
                  width: element.width,
                  height: element.height,
                  ...(isShape && element.shape === "diamond" ? { clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)" } : {}),
                }}
              >
                {editingId === element.id ? (
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onBlur={commitEdit}
                    className="h-full w-full resize-none bg-transparent text-[12px] leading-relaxed outline-none"
                    style={{ textAlign: isShape ? "center" : "left" }}
                  />
                ) : (
                  <div
                    className={cn(
                      "whitespace-pre-wrap text-[12px] leading-relaxed",
                      isShape && "m-auto text-center text-[11px]",
                    )}
                  >
                    {element.text || (isShape ? "Shape" : "Sticky note")}
                  </div>
                )}
              </div>
            );
          })}

          {marquee ? (
            <div
              className="pointer-events-none absolute border border-primary/60 bg-primary/10"
              style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
            />
          ) : null}

          {selectionBounds && selectedElements.length === 1 ? (
            <>
              {(["nw", "ne", "sw", "se"] as const).map((handle) => {
                const element = selectedElements[0];
                if (!element || element.type === "connector") return null;
                const x = handle.includes("w") ? element.x : element.x + element.width;
                const y = handle.includes("n") ? element.y : element.y + element.height;
                return (
                  <button
                    key={handle}
                    type="button"
                    aria-label={`Resize ${handle}`}
                    onPointerDown={(event) => onResizePointerDown(event, element, handle)}
                    className="canvas-handle canvas-resize absolute z-20"
                    style={{ left: x - 4, top: y - 4 }}
                  />
                );
              })}
            </>
          ) : null}

          {selectionBounds && selectedElements.length > 1 ? (
            <>
              <div
                className="pointer-events-none absolute border border-dashed border-primary/50"
                style={{
                  left: selectionBounds.x,
                  top: selectionBounds.y,
                  width: selectionBounds.width,
                  height: selectionBounds.height,
                }}
              />
              {(["nw", "ne", "sw", "se"] as const).map((handle) => {
                const x = handle.includes("w") ? selectionBounds.x : selectionBounds.x + selectionBounds.width;
                const y = handle.includes("n") ? selectionBounds.y : selectionBounds.y + selectionBounds.height;
                return (
                  <button
                    key={`group-${handle}`}
                    type="button"
                    aria-label={`Resize selection ${handle}`}
                    onPointerDown={(event) => onGroupResizePointerDown(event, handle)}
                    className="canvas-handle canvas-resize absolute z-20"
                    style={{ left: x - 4, top: y - 4 }}
                  />
                );
              })}
            </>
          ) : null}
        </div>

        {!document.elements.length ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="pointer-events-auto max-w-sm text-center">
              <span className="mx-auto grid size-10 place-items-center rounded-xl border border-border bg-card">
                <Sparkles className="size-4 text-saffron" />
              </span>
              <h2 className="mt-3 font-display text-2xl">A blank surface for spatial thinking.</h2>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Drop a sticky, link a note, or start from a template. Scroll to pan, ⌘-scroll to zoom.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                <Button size="sm" className="h-7 rounded-md text-[9px]" onClick={() => createAt({ x: 0, y: 0 }, "note")}>
                  <StickyNote className="size-3" /> Sticky note
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => setTemplateOpen(true)}>
                  Template
                </Button>
                <Button variant="outline" size="sm" className="h-7 rounded-md text-[9px]" onClick={() => setPagePickerOpen(true)}>
                  Linked note
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {!presentation && selectedElements.length ? (
        <div className="absolute bottom-4 right-4 z-30 w-60 rounded-xl border border-border/70 bg-popover/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-medium">
              {selectedElements.length === 1
                ? selectedElements[0]?.type === "note"
                  ? "Sticky note"
                  : selectedElements[0]?.type
                : `${selectedElements.length} selected`}
            </div>
            <button type="button" onClick={() => setSelectedIds([])} aria-label="Clear selection">
              <X className="size-3 text-muted-foreground" />
            </button>
          </div>
          {selectedConnector ? (
            <div className="mt-2 space-y-2">
              <label className="block">
                <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                  Label
                </span>
                <input
                  value={selectedConnector.label ?? ""}
                  onChange={(event) =>
                    updateElement(selectedConnector.id, {
                      label: event.target.value,
                    } as Partial<CanvasElement>)
                  }
                  placeholder="Describe the connection"
                  className="h-7 w-full rounded border border-border bg-background px-1.5 text-[9px] outline-none focus:border-primary/40"
                />
              </label>
              <div className="flex items-center gap-1">
                {(["solid", "dashed", "dotted"] as const).map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() =>
                      updateElement(selectedConnector.id, { style } as Partial<CanvasElement>, true)
                    }
                    className={cn(
                      "flex-1 rounded border px-1.5 py-1 text-[8px] capitalize",
                      (selectedConnector.style ?? "solid") === style
                        ? "border-foreground/40 bg-muted"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {style}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  { value: "#8b8b7a", label: "Slate" },
                  { value: "#e07a2e", label: "Saffron" },
                  { value: "#2f6b4f", label: "Moss" },
                  { value: "#3b82f6", label: "Sky" },
                  { value: "#8b5cf6", label: "Lilac" },
                  { value: "#dc2626", label: "Rose" },
                ].map(({ value: color, label }) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Connector colour: ${label}`}
                    aria-pressed={selectedConnector.color === color}
                    onClick={() =>
                      updateElement(selectedConnector.id, { color } as Partial<CanvasElement>, true)
                    }
                    className={cn(
                      "size-5 rounded-full border",
                      selectedConnector.color === color
                        ? "border-foreground ring-2 ring-foreground/40"
                        : "border-transparent",
                    )}
                    style={{ background: color }}
                    title={label}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() =>
                    updateElement(
                      selectedConnector.id,
                      { arrowStart: !selectedConnector.arrowStart } as Partial<CanvasElement>,
                      true,
                    )
                  }
                  className={cn(
                    "flex-1 rounded border px-1.5 py-1 text-[8px]",
                    selectedConnector.arrowStart
                      ? "border-foreground/40 bg-muted"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  Start arrow
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateElement(
                      selectedConnector.id,
                      { arrowEnd: selectedConnector.arrowEnd === false } as Partial<CanvasElement>,
                      true,
                    )
                  }
                  className={cn(
                    "flex-1 rounded border px-1.5 py-1 text-[8px]",
                    selectedConnector.arrowEnd !== false
                      ? "border-foreground/40 bg-muted"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  End arrow
                </button>
              </div>
            </div>
          ) : (
            <>
          <div className="mt-2 flex flex-wrap gap-1">
            {STICKY_COLORS.map((color) => {
              const pressed = selectedElements.some(
                (element) => "color" in element && element.color === color,
              );
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={`Sticky colour: ${color[0]!.toUpperCase()}${color.slice(1)}`}
                  aria-pressed={pressed}
                  onClick={() => setColor(color)}
                  className={cn(
                    "size-5 rounded border border-foreground/10",
                    colorClass(color),
                    pressed && "ring-2 ring-foreground/40",
                  )}
                  title={color}
                />
              );
            })}
          </div>
          {selectedElements.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" onClick={groupSelected} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[8px] hover:bg-muted">
                <Group className="size-2.5" /> Group
              </button>
              <button type="button" onClick={ungroupSelected} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[8px] hover:bg-muted">
                <Ungroup className="size-2.5" /> Ungroup
              </button>
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-3 gap-1">
            {[
              ["left", AlignStartVertical],
              ["hcenter", AlignCenterVertical],
              ["right", AlignEndVertical],
              ["top", AlignStartHorizontal],
              ["vcenter", AlignCenterHorizontal],
              ["bottom", AlignEndHorizontal],
            ].map(([alignment, Icon]) => (
              <button
                key={String(alignment)}
                type="button"
                onClick={() => alignSelected(alignment as "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom")}
                className="grid h-6 place-items-center rounded border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={`Align ${String(alignment)}`}
              >
                <Icon className="size-3" />
              </button>
              ))}
          </div>
            </>
          )}
          <div className="mt-2 flex items-center gap-1">
            {selectedElements.some(
              (element) =>
                element.type === "note" || element.type === "shape" || element.type === "text",
            ) ? (
              <button
                type="button"
                onClick={() => void convertSelectionToPages()}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[8px] hover:bg-muted"
                title="Turn the selected node into a documentation page"
              >
                <FileText className="size-2.5" /> Page
              </button>
            ) : null}
            <button type="button" onClick={bringToFront} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[8px] hover:bg-muted">
              <BringToFront className="size-2.5" /> Front
            </button>
            <button type="button" onClick={sendToBack} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 text-[8px] hover:bg-muted">
              <SendToBack className="size-2.5" /> Back
            </button>
            <button
              type="button"
              onClick={() => {
                const element = selectedElements[0];
                if (!element || element.type === "connector") return;
                updateElement(element.id, { locked: !("locked" in element && element.locked) } as Partial<CanvasElement>, true);
              }}
              className="ml-auto grid size-6 place-items-center rounded border border-border text-muted-foreground hover:bg-muted"
              title="Lock / unlock"
            >
              {selectedElements[0] && "locked" in selectedElements[0] && selectedElements[0].locked ? (
                <Lock className="size-3" />
              ) : (
                <Unlock className="size-3" />
              )}
            </button>
            <button type="button" onClick={deleteSelected} className="grid size-7 place-items-center rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive tap-target" title="Delete">
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>
      ) : null}

      {presentation ? (
        <div className="absolute inset-x-0 bottom-0 z-40 flex items-center justify-center gap-2 p-4">
          <div className="flex items-center gap-1 rounded-full border border-white/15 bg-black/50 px-2 py-1 text-white backdrop-blur">
            <button type="button" onClick={() => changeSlide(-1)} className="grid size-7 place-items-center rounded-full hover:bg-white/10 tap-target" aria-label="Previous slide">
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="min-w-12 text-center text-[9px]">
              {frames.length ? `${presentationIndex + 1} / ${frames.length}` : "Canvas"}
            </span>
            <button type="button" onClick={() => changeSlide(1)} className="grid size-7 place-items-center rounded-full hover:bg-white/10 tap-target" aria-label="Next slide">
              <ChevronRight className="size-3.5" />
            </button>
            <button type="button" onClick={() => setPresentation(false)} className="ml-2 inline-flex items-center gap-1 rounded-full border border-white/20 px-2 py-0.5 text-[8px]">
              Exit <X className="size-2.5" />
            </button>
          </div>
        </div>
      ) : null}

      <Modal
        open={layersOpen}
        onClose={() => setLayersOpen(false)}
        title="Layers"
        description="Front-most first. Select, reorder, or lock an element."
      >
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {layerElements.map((element) => {
            const locked = "locked" in element && Boolean(element.locked);
            return (
              <div
                key={element.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1.5",
                  selectedIds.includes(element.id)
                    ? "border-primary/40 bg-muted/40"
                    : "border-border/60 bg-background/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelectedIds([element.id])}
                  className="min-w-0 flex-1 truncate text-left text-[10px]"
                  title={layerLabel(element)}
                >
                  {layerLabel(element)}
                </button>
                <button
                  type="button"
                  aria-label="Move layer toward front"
                  title="Move toward front"
                  onClick={() => moveLayer(element.id, "up")}
                  className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
                >
                  <ChevronUp className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Move layer toward back"
                  title="Move toward back"
                  onClick={() => moveLayer(element.id, "down")}
                  className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
                >
                  <ChevronDown className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label={locked ? "Unlock element" : "Lock element"}
                  title={locked ? "Unlock" : "Lock"}
                  onClick={() =>
                    updateElement(
                      element.id,
                      { locked: !locked } as Partial<CanvasElement>,
                      true,
                    )
                  }
                  className={cn(
                    "grid size-5 place-items-center rounded hover:bg-muted",
                    locked ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
                </button>
              </div>
            );
          })}
          {!layerElements.length ? (
            <p className="py-6 text-center text-[9px] text-muted-foreground">
              Nothing on the canvas yet.
            </p>
          ) : null}
        </div>
      </Modal>

      <PagePickerDialog
        open={pagePickerOpen}
        mode="link"
        onClose={() => setPagePickerOpen(false)}
        onPick={(pageId, pageTitle) => insertPageCard(pageId, pageTitle)}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertImageFile(file);
        }}
      />

      <Modal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        title="Canvas templates"
        description="Apply a starting structure. You can undo this."
        className="max-w-2xl"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {CANVAS_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => applyTemplate(template.build)}
              className="rounded-lg border border-border/60 bg-background/50 p-3 text-left hover:border-border hover:bg-muted/40"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium">{template.name}</span>
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[7px] uppercase tracking-[0.1em] text-muted-foreground">
                  {template.category}
                </span>
              </div>
              <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">{template.description}</p>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={nestedOpen}
        onClose={() => setNestedOpen(false)}
        title="Insert a nested canvas"
        description="Link another whiteboard into this surface."
      >
        <div className="space-y-1">
          {canvases
            .filter((entry) => entry.id !== canvas.id)
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => insertNestedCanvas(entry)}
                className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-2 text-left hover:bg-muted/50"
              >
                <Frame className="size-3 text-moss" />
                <span className="min-w-0 flex-1 truncate text-[10px]">{entry.title}</span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </button>
            ))}
          {canvases.length <= 1 ? (
            <p className="py-6 text-center text-[9px] text-muted-foreground">
              Create another whiteboard from the sidebar first.
            </p>
          ) : null}
        </div>
      </Modal>

      <PagePickerDialog
        open={Boolean(generateIntent || pluginTool)}
        mode="link"
        onClose={() => {
          setGenerateIntent(null);
          setPluginTool(null);
        }}
        onPick={(pageId) => void generateFromPage(pageId)}
      />

      <PromptDialog
        open={imagePromptOpen}
        title="Add an image"
        description="The file stays where it is; the canvas holds the link."
        label="Image URL"
        placeholder="https://example.com/photo.jpg"
        confirmLabel="Add image"
        validate={validateImageUrl}
        onClose={() => setImagePromptOpen(false)}
        onSubmit={(value) => void insertImageFromUrl(value)}
      />
      <ConfirmDialog
        open={Boolean(pendingTemplate)}
        title="Replace this canvas?"
        description="The template replaces the current elements. Undo and snapshots stay available."
        confirmLabel="Replace"
        onClose={() => setPendingTemplate(null)}
        onConfirm={() => {
          const replace = pendingTemplate;
          setPendingTemplate(null);
          replace?.();
        }}
      />

      <Modal
        open={snapshotsOpen}
        onClose={() => setSnapshotsOpen(false)}
        title="Snapshots"
        description="Whiteboard history stored on the sync server."
      >
        <div className="mb-3 flex justify-end">
          <Button size="sm" className="h-7 rounded-md text-[9px]" onClick={() => void saveSnapshot()}>
            <History className="size-3" /> Save snapshot
          </Button>
        </div>
        {snapshotsLoading ? (
          <p className="py-6 text-center text-[9px] text-muted-foreground">Loading…</p>
        ) : snapshots.length ? (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10px] font-medium">
                    v{snapshot.version} · {snapshot.title}
                  </div>
                  <div className="truncate text-[8px] text-muted-foreground">
                    {new Date(snapshot.createdAt).toLocaleString()}
                    {snapshot.note ? ` · ${snapshot.note}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 rounded-md text-[8px]"
                  onClick={() => void restoreSnapshot(snapshot.id)}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-[9px] text-muted-foreground">
            No snapshots yet. Save one before a big change.
          </p>
        )}
      </Modal>
    </div>
  );
}
