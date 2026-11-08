import { Ionicons } from "@expo/vector-icons";
import {
  CANVAS_TEMPLATES,
  canvasBounds,
  canvasDocument,
  connectorPoint,
  createConceptMap,
  createFlowFromOutline,
  createId,
  createMindMap,
  emptyCanvas,
  extractOutline,
  makeCanvasCard,
  makeConnector,
  makeFrame,
  makeNote,
  makePageCard,
  makeShape,
  makeText,
  safeDoc,
  snap,
  type CanvasDocument,
  type CanvasElement,
  type CanvasFreehandElement,
  type CanvasShapeElement,
  type StickyColor,
} from "@notes-learning/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Spinner, Switch, useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { G } from "react-native-svg";

import { CanvasElements, STICKY_HEX } from "@/components/canvas/canvas-elements";
import { CanvasToolbar, type CanvasTool } from "@/components/canvas/canvas-toolbar";
import { PageLinkPicker } from "@/components/editor/page-link-picker";
import { Sheet } from "@/components/ui/sheet";
import { useWorkspace } from "@/contexts/workspace-context";
import { canvasToSvg, shareCanvasPdf, shareCanvasSvg, shareViewPng } from "@/lib/canvas-export";
import { pickImage } from "@/lib/files";
import { route } from "@/lib/navigation";
import { saveCanvas } from "@/lib/outbox";
import { uploadFile } from "@/lib/upload";
import { client } from "@/utils/orpc";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const STICKY_COLORS: StickyColor[] = ["saffron", "moss", "sky", "lilac", "rose", "slate", "paper"];
const PEN_COLORS = ["#25251f", "#e07a2e", "#2f6b4f", "#3b82f6", "#8b5cf6", "#dc2626", "#ffffff"];

type Mode = "idle" | "pan" | "move" | "resize" | "pen" | "create";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFreehand(element: CanvasElement): element is CanvasFreehandElement {
  return element.type === "freehand";
}

function elementBounds(element: CanvasElement): { x: number; y: number; width: number; height: number } {
  if (isFreehand(element)) {
    const xs = element.points.map(([px]) => element.x + px);
    const ys = element.points.map(([, py]) => element.y + py);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    };
  }
  if (element.type === "connector") {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

function bestAnchors(
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
) {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { from: "right" as const, to: "left" as const }
      : { from: "left" as const, to: "right" as const };
  }
  return dy >= 0
    ? { from: "bottom" as const, to: "top" as const }
    : { from: "top" as const, to: "bottom" as const };
}

export default function CanvasScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const canvasId = String(id);
  const insets = useSafeAreaInsets();
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const background = useThemeColor("background");

  const [doc, setDoc] = useState<CanvasDocument>(emptyCanvas());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [title, setTitle] = useState("Canvas");
  const [titleDraft, setTitleDraft] = useState("Canvas");
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [colorIndex, setColorIndex] = useState(0);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]!);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);
  const [zoomLabel, setZoomLabel] = useState(100);
  const [stylusOnly, setStylusOnly] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [presentationIndex, setPresentationIndex] = useState(0);

  const [moreOpen, setMoreOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [generatePickerOpen, setGeneratePickerOpen] = useState(false);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [canvasPickerOpen, setCanvasPickerOpen] = useState(false);
  const [editing, setEditing] = useState<CanvasElement | null>(null);
  const [editingText, setEditingText] = useState("");
  const [pendingConnector, setPendingConnector] = useState<string | null>(null);
  const [connectorLabel, setConnectorLabel] = useState("");
  const [connectorStartId, setConnectorStartId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [view, setView] = useState({ cx: 0, cy: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const docRef = useRef(doc);
  docRef.current = doc;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const revRef = useRef(0);
  const viewportRef = viewRef;
  const sizeRef = useRef({ width: 0, height: 0 });
  const modeRef = useRef<Mode>("idle");
  const panStartRef = useRef({ cx: 0, cy: 0, zoom: 1 });
  const moveStartRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const moveGroupRef = useRef<Array<{ id: string; x: number; y: number }>>([]);
  const resizeRef = useRef<{
    id: string;
    handle: "nw" | "ne" | "sw" | "se";
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const createRef = useRef<{
    id: string;
    start: { x: number; y: number };
    kind: string;
    defaults: { width: number; height: number };
  } | null>(null);
  const penRef = useRef<{ id: string; last: { x: number; y: number } } | null>(null);
  const movedRef = useRef(0);
  const lastMoveAtRef = useRef(0);
  const lastTapRef = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const snapshotRef = useRef<CanvasDocument | null>(null);
  const pastRef = useRef<CanvasDocument[]>([]);
  const futureRef = useRef<CanvasDocument[]>([]);
  const captureRef = useRef<View>(null);
  const fittedRef = useRef(false);

  const canvas = useQuery({
    queryKey: ["native-canvas", workspace?.id, canvasId],
    queryFn: async () => client.canvas.get({ canvasId }),
    enabled: Boolean(workspace && canvasId),
  });
  const pages = useQuery({
    queryKey: ["native-pages", workspace?.id],
    queryFn: async () => client.page.list(),
    enabled: Boolean(workspace),
  });
  const canvases = useQuery({
    queryKey: ["native-canvases", workspace?.id],
    queryFn: async () => client.canvas.list(),
    enabled: Boolean(workspace),
  });

  const pageTitles = useMemo(
    () => new Map((pages.data ?? []).map((page) => [page.id, page.title])),
    [pages.data],
  );
  const canvasTitles = useMemo(
    () => new Map((canvases.data ?? []).map((entry) => [entry.id, entry.title])),
    [canvases.data],
  );

  const selected = useMemo(
    () => doc.elements.filter((element) => selectedIds.includes(element.id)),
    [doc.elements, selectedIds],
  );
  const selectedElement = selected.length === 1 ? selected[0] : null;
  const frames = useMemo(
    () =>
      doc.elements
        .filter((element) => element.type === "frame")
        .sort((a, b) => a.x - b.x || a.y - b.y),
    [doc.elements],
  );

  const markDirty = useCallback(() => {
    setDirty(true);
    dirtyRef.current = true;
  }, []);

  const commitViewport = useCallback(() => {
    setZoomLabel(Math.round(viewRef.current.zoom * 100));
  }, []);

  const applyDoc = useCallback(
    (next: CanvasDocument, record = true) => {
      if (record) {
        pastRef.current = [...pastRef.current.slice(-49), docRef.current];
        futureRef.current = [];
      }
      setDoc(next);
      docRef.current = next;
      markDirty();
    },
    [markDirty],
  );

  const patchElement = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const next: CanvasDocument = {
        ...docRef.current,
        elements: docRef.current.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as CanvasElement) : element,
        ),
      };
      docRef.current = next;
      setDoc(next);
      markDirty();
    },
    [markDirty],
  );

  const removeSelected = useCallback(() => {
    if (!selectedIds.length) return;
    applyDoc({
      ...docRef.current,
      elements: docRef.current.elements.filter((element) => !selectedIds.includes(element.id)),
    });
    setSelectedIds([]);
  }, [applyDoc, selectedIds]);

  const duplicateSelected = useCallback(() => {
    const copies = selected
      .filter((element) => element.type !== "connector")
      .map((element) => ({
        ...element,
        id: createId(),
        x: element.type === "freehand" ? element.x : element.x + 28,
        y: element.type === "freehand" ? element.y : element.y + 28,
      }));
    if (!copies.length) return;
    applyDoc({ ...docRef.current, elements: [...docRef.current.elements, ...copies] });
    setSelectedIds(copies.map((element) => element.id));
  }, [applyDoc, selected]);

  const layer = useCallback(
    (direction: "front" | "back") => {
      if (!selectedIds.length) return;
      const rest = docRef.current.elements.filter((element) => !selectedIds.includes(element.id));
      const picked = docRef.current.elements.filter((element) => selectedIds.includes(element.id));
      applyDoc({
        ...docRef.current,
        elements: direction === "front" ? [...rest, ...picked] : [...picked, ...rest],
      });
    },
    [applyDoc, selectedIds],
  );

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current = [docRef.current, ...futureRef.current.slice(0, 49)];
    setDoc(previous);
    docRef.current = previous;
    markDirty();
    setSelectedIds([]);
  }, [markDirty]);

  const redo = useCallback(() => {
    const next = futureRef.current.shift();
    if (!next) return;
    pastRef.current = [...pastRef.current.slice(-49), docRef.current];
    setDoc(next);
    docRef.current = next;
    markDirty();
    setSelectedIds([]);
  }, [markDirty]);

  const screenToWorld = useCallback((x: number, y: number) => {
    const current = viewRef.current;
    const size = sizeRef.current;
    return {
      x: current.cx + (x - size.width / 2) / current.zoom,
      y: current.cy + (y - size.height / 2) / current.zoom,
    };
  }, []);

  const focusRect = useCallback(
    (
      rect: { x: number; y: number; width: number; height: number },
      padding = 100,
      animate = true,
    ) => {
      const size = sizeRef.current;
      if (!size.width || !size.height) return;
      const zoom = clamp(
        Math.min(
          (size.width - padding * 2) / Math.max(1, rect.width),
          (size.height - padding * 2) / Math.max(1, rect.height),
        ),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const cx = rect.x + rect.width / 2;
      const cy = rect.y + rect.height / 2;
      void animate;
      setView({ cx, cy, zoom });
      setZoomLabel(Math.round(zoom * 100));
    },
    [],
  );

  const fit = useCallback(() => {
    focusRect(canvasBounds(docRef.current), 90);
  }, [focusRect]);

  const zoomBy = useCallback((factor: number) => {
    setView((current) => {
      const next = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      setZoomLabel(Math.round(next * 100));
      return { ...current, zoom: next };
    });
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await saveCanvas({
        canvasId,
        baseRev: revRef.current,
        data: docRef.current as unknown as Record<string, unknown>,
      });
      if (result.conflict) {
        Alert.alert(
          "This canvas changed elsewhere",
          "Another device saved a newer version. Reload it, or keep your local drawing.",
          [
            {
              text: "Reload",
              onPress: () => {
                void queryClient.invalidateQueries({
                  queryKey: ["native-canvas", workspace?.id, canvasId],
                });
                void canvas.refetch().then((fresh) => {
                  if (fresh.data) {
                    setDoc(canvasDocument(fresh.data.data));
                    revRef.current = fresh.data.rev;
                    fittedRef.current = false;
                  }
                });
              },
            },
            {
              text: "Overwrite",
              style: "destructive",
              onPress: () => {
                void (async () => {
                  const fresh = await client.canvas.get({ canvasId });
                  revRef.current = fresh.rev;
                  const retry = await saveCanvas({
                    canvasId,
                    baseRev: fresh.rev,
                    data: docRef.current as unknown as Record<string, unknown>,
                  });
                  if (!retry.conflict) {
                    revRef.current = retry.rev;
                    setDirty(false);
                    dirtyRef.current = false;
                    setQueued(retry.queued);
                  }
                })();
              },
            },
          ],
        );
        return;
      }
      revRef.current = result.rev;
      setQueued(result.queued);
      setDirty(false);
      dirtyRef.current = false;
      await queryClient.invalidateQueries({ queryKey: ["native-canvases", workspace?.id] });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save the canvas",
      });
    } finally {
      setSaving(false);
    }
  }, [canvas, canvasId, queryClient, saving, toast, workspace?.id]);

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (canvas.data) {
      setDoc(canvasDocument(canvas.data.data));
      docRef.current = canvasDocument(canvas.data.data);
      revRef.current = canvas.data.rev;
      setTitle(canvas.data.title);
      setTitleDraft(canvas.data.title);
    }
  }, [canvas.data]);

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void save(), 1600);
    return () => clearTimeout(timer);
  }, [dirty, doc, save]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) void saveRef.current();
    };
  }, []);

  useEffect(() => {
    setZoomLabel(Math.round(view.zoom * 100));
  }, [view.zoom]);

  useEffect(() => {
    if (!fittedRef.current && canvas.data && sizeRef.current.width > 0) {
      fittedRef.current = true;
      focusRect(canvasBounds(docRef.current), 90, false);
    }
  }, [canvas.data, focusRect, sizeRef.current.width]);

  const elementAt = useCallback(
    (point: { x: number; y: number }): CanvasElement | null => {
      const elements = docRef.current.elements;
      for (let index = elements.length - 1; index >= 0; index -= 1) {
        const element = elements[index];
        if (!element || element.type === "connector" || element.locked) continue;
        const bounds = elementBounds(element);
        const pad = element.type === "freehand" ? 10 / viewportRef.current.zoom : 0;
        if (
          point.x >= bounds.x - pad &&
          point.x <= bounds.x + bounds.width + pad &&
          point.y >= bounds.y - pad &&
          point.y <= bounds.y + bounds.height + pad
        ) {
          return element;
        }
      }
      const positions = new Map(
        elements
          .filter((element) => element.type !== "connector")
          .map((element) => {
            const bounds = elementBounds(element);
            return [
              element.id,
              {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
              },
            ] as const;
          }),
      );
      for (const element of elements) {
        if (element.type !== "connector") continue;
        const from = connectorPoint(element.from, positions);
        const to = connectorPoint(element.to, positions);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared === 0) continue;
        const t = Math.max(
          0,
          Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
        );
        const closestX = from.x + t * dx;
        const closestY = from.y + t * dy;
        if (
          Math.hypot(point.x - closestX, point.y - closestY) <
          12 / viewportRef.current.zoom
        ) {
          return element;
        }
      }
      return null;
    },
    [],
  );

  const handleAt = useCallback(
    (point: { x: number; y: number }): "nw" | "ne" | "sw" | "se" | null => {
      if (!selectedElement || selectedElement.type === "connector" || isFreehand(selectedElement)) {
        return null;
      }
      const bounds = elementBounds(selectedElement);
      const radius = 14 / viewportRef.current.zoom;
      const corners: Array<["nw" | "ne" | "sw" | "se", number, number]> = [
        ["nw", bounds.x, bounds.y],
        ["ne", bounds.x + bounds.width, bounds.y],
        ["sw", bounds.x, bounds.y + bounds.height],
        ["se", bounds.x + bounds.width, bounds.y + bounds.height],
      ];
      for (const [handle, cx, cy] of corners) {
        if (Math.abs(point.x - cx) <= radius && Math.abs(point.y - cy) <= radius) return handle;
      }
      return null;
    },
    [selectedElement],
  );

  const openEditor = useCallback((element: CanvasElement) => {
    setEditing(element);
    setEditingText(
      element.type === "note" || element.type === "shape" || element.type === "text"
        ? element.text
        : element.type === "frame"
          ? element.title
          : element.type === "connector"
            ? element.label ?? ""
            : "",
    );
  }, []);

  const createAt = useCallback(
    (kind: CanvasTool, point: { x: number; y: number }, pressure: number, stylus: boolean) => {
      const color = STICKY_COLORS[colorIndex] ?? "saffron";
      let element: CanvasElement;
      let defaults = { width: 220, height: 160 };
      switch (kind) {
        case "note":
          element = makeNote(snap(point.x), snap(point.y), "", color);
          defaults = { width: element.width, height: element.height };
          break;
        case "rect":
        case "ellipse":
        case "diamond":
        case "parallelogram":
        case "hexagon":
        case "cylinder":
          element = makeShape(
            kind === "rect" ? "rectangle" : kind,
            snap(point.x),
            snap(point.y),
            "",
            color,
          );
          defaults = { width: element.width, height: element.height };
          break;
        case "text":
          element = makeText(snap(point.x), snap(point.y), "", 20);
          defaults = { width: 320, height: 56 };
          break;
        case "frame":
          element = makeFrame(snap(point.x), snap(point.y), "Frame");
          defaults = { width: element.width, height: element.height };
          break;
        case "pen":
          element = {
            id: createId(),
            type: "freehand",
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            points: [[point.x, point.y]],
            pressures: [clamp(pressure, 0, 1) || 0.5],
            stylus,
            color: penColor,
            strokeWidth: 3,
          };
          defaults = { width: 1, height: 1 };
          break;
        default:
          return;
      }
      applyDoc({ ...docRef.current, elements: [...docRef.current.elements, element] });
      if (kind === "pen") {
        penRef.current = { id: element.id, last: point };
        modeRef.current = "pen";
        setSelectedIds([element.id]);
        return;
      }
      createRef.current = {
        id: element.id,
        start: { x: element.x, y: element.y },
        kind,
        defaults,
      };
      modeRef.current = "create";
      setSelectedIds([element.id]);
    },
    [applyDoc, colorIndex, penColor],
  );

  const onGestureBegin = useCallback(
    (screenX: number, screenY: number, pressure: number, stylus: boolean) => {
      if (presentation) return;
      modeRef.current = "idle";
      movedRef.current = 0;
      const point = screenToWorld(screenX, screenY);
      snapshotRef.current = docRef.current;

      if (tool === "pan" || (stylusOnly && !stylus)) {
        modeRef.current = "pan";
        panStartRef.current = { ...viewRef.current };
        return;
      }
      if (tool === "pen") {
        createAt("pen", point, pressure, stylus);
        return;
      }
      if (tool === "connector") {
        const hit = elementAt(point);
        if (!hit || hit.type === "connector") return;
        if (!connectorStartId) {
          setConnectorStartId(hit.id);
          setSelectedIds([hit.id]);
          return;
        }
        if (connectorStartId === hit.id) {
          setConnectorStartId(null);
          return;
        }
        const fromElement = docRef.current.elements.find(
          (element) => element.id === connectorStartId,
        );
        if (!fromElement) {
          setConnectorStartId(null);
          return;
        }
        const from = elementBounds(fromElement);
        const to = elementBounds(hit);
        const anchors = bestAnchors(from, to);
        const connector = makeConnector(
          { elementId: fromElement.id, anchor: anchors.from },
          { elementId: hit.id, anchor: anchors.to },
        );
        applyDoc({
          ...docRef.current,
          elements: [...docRef.current.elements, connector],
        });
        setConnectorStartId(null);
        setSelectedIds([hit.id]);
        setPendingConnector(connector.id);
        setConnectorLabel("");
        return;
      }
      if (tool === "select") {
        const handle = handleAt(point);
        if (handle && selectedElement) {
          modeRef.current = "resize";
          resizeRef.current = {
            id: selectedElement.id,
            handle,
            bounds: elementBounds(selectedElement),
          };
          return;
        }
        const hit = elementAt(point);
        if (hit) {
          setSelectedIds([hit.id]);
          movedRef.current = 0;
          moveStartRef.current =
            hit.type === "connector" ? null : { id: hit.id, x: hit.x, y: hit.y };
          moveGroupRef.current = [];
          if (hit.type === "frame") {
            const frame = elementBounds(hit);
            moveGroupRef.current = docRef.current.elements
              .filter((element) => {
                if (element.id === hit.id || element.type === "connector") return false;
                const bounds = elementBounds(element);
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                return (
                  centerX >= frame.x &&
                  centerX <= frame.x + frame.width &&
                  centerY >= frame.y &&
                  centerY <= frame.y + frame.height
                );
              })
              .flatMap((element) =>
                element.type === "connector" ? [] : [{ id: element.id, x: element.x, y: element.y }],
              );
          }
          modeRef.current = "move";
          return;
        }
        setSelectedIds([]);
        modeRef.current = "pan";
        panStartRef.current = { ...viewRef.current };
        return;
      }
      // Creation tools
      if (
        tool === "note" ||
        tool === "rect" ||
        tool === "ellipse" ||
        tool === "diamond" ||
        tool === "parallelogram" ||
        tool === "hexagon" ||
        tool === "cylinder" ||
        tool === "text" ||
        tool === "frame"
      ) {
        createAt(tool, point, pressure, stylus);
      }
    },
    [
      applyDoc,
      connectorStartId,
      createAt,
      elementAt,
      handleAt,
      presentation,
      screenToWorld,
      selectedElement,
      stylusOnly,
      tool,
    ],
  );

  const onGestureMove = useCallback(
    (
      screenX: number,
      screenY: number,
      translationX: number,
      translationY: number,
      pressure: number,
    ) => {
      movedRef.current = Math.max(
        movedRef.current,
        Math.abs(translationX) + Math.abs(translationY),
      );
      const zoom = viewRef.current.zoom;
      if (modeRef.current === "pan") {
        setView({
          cx: panStartRef.current.cx - translationX / zoom,
          cy: panStartRef.current.cy - translationY / zoom,
          zoom,
        });
        return;
      }
      if (modeRef.current === "pen" && penRef.current) {
        const point = screenToWorld(screenX, screenY);
        const last = penRef.current.last;
        if (Math.hypot(point.x - last.x, point.y - last.y) < 1.6) return;
        penRef.current.last = point;
        const id = penRef.current.id;
        const lastPoints = (() => {
          const current = docRef.current.elements.find((element) => element.id === id);
          return current && current.type === "freehand" ? current : null;
        })();
        if (!lastPoints) return;
        const nextElement: CanvasFreehandElement = {
          ...lastPoints,
          points: [...lastPoints.points, [point.x, point.y]],
          pressures: [...(lastPoints.pressures ?? []), clamp(pressure, 0, 1) || 0.5],
        };
        const nextDocument: CanvasDocument = {
          ...docRef.current,
          elements: docRef.current.elements.map((element) =>
            element.id === id ? nextElement : element,
          ),
        };
        docRef.current = nextDocument;
        setDoc(nextDocument);
        markDirty();
        return;
      }
      if (modeRef.current === "move" && moveStartRef.current) {
        const start = moveStartRef.current;
        const dx = translationX / zoom;
        const dy = translationY / zoom;
        patchElement(start.id, {
          x: snap(start.x + dx),
          y: snap(start.y + dy),
        } as never);
        for (const child of moveGroupRef.current) {
          patchElement(child.id, {
            x: snap(child.x + dx),
            y: snap(child.y + dy),
          });
        }
        return;
      }
      if (modeRef.current === "resize" && resizeRef.current) {
        const { id, handle, bounds } = resizeRef.current;
        const dx = translationX / zoom;
        const dy = translationY / zoom;
        const minWidth = 40;
        const minHeight = 30;
        let x = bounds.x;
        let y = bounds.y;
        let width = bounds.width;
        let height = bounds.height;
        if (handle === "nw") {
          x = bounds.x + dx;
          y = bounds.y + dy;
          width = bounds.width - dx;
          height = bounds.height - dy;
        } else if (handle === "ne") {
          y = bounds.y + dy;
          width = bounds.width + dx;
          height = bounds.height - dy;
        } else if (handle === "sw") {
          x = bounds.x + dx;
          width = bounds.width - dx;
          height = bounds.height + dy;
        } else {
          width = bounds.width + dx;
          height = bounds.height + dy;
        }
        if (width < minWidth) {
          if (handle === "nw" || handle === "sw") x = bounds.x + bounds.width - minWidth;
          width = minWidth;
        }
        if (height < minHeight) {
          if (handle === "nw" || handle === "ne") y = bounds.y + bounds.height - minHeight;
          height = minHeight;
        }
        patchElement(id, {
          x: snap(x),
          y: snap(y),
          width: snap(width),
          height: snap(height),
        } as never);
        return;
      }
      if (modeRef.current === "create" && createRef.current) {
        const point = screenToWorld(screenX, screenY);
        const { id, start, defaults } = createRef.current;
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        const x = Math.min(start.x, start.x + dx);
        const y = Math.min(start.y, start.y + dy);
        const width = snap(Math.max(defaults.width * 0.35, Math.abs(dx)));
        const height = snap(Math.max(defaults.height * 0.35, Math.abs(dy)));
        patchElement(id, { x: snap(x), y: snap(y), width, height } as never);
      }
    },
    [elementAt, markDirty, patchElement, screenToWorld],
  );

  const onGestureEnd = useCallback(() => {
    const mode = modeRef.current;
    if (mode === "pan") {
      commitViewport();
    }
    const tappedId = moveStartRef.current?.id ?? selectedIds[0];
    if (mode === "pen") {
      const strokeId = penRef.current?.id;
      penRef.current = null;
      if (strokeId) {
        const stroke = docRef.current.elements.find((entry) => entry.id === strokeId);
        if (stroke && stroke.type === "freehand" && stroke.points.length) {
          const xs = stroke.points.map(([px]) => px);
          const ys = stroke.points.map(([, py]) => py);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);
          patchElement(strokeId, {
            x: minX,
            y: minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY),
            points: stroke.points.map(([px, py]) => [px - minX, py - minY]),
          });
        }
      }
    }
    if (mode === "move" && tappedId) {
      if (movedRef.current < 6) {
        const element = docRef.current.elements.find((entry) => entry.id === tappedId);
        if (element) {
          const now = Date.now();
          if (
            lastTapRef.current.id === tappedId &&
            now - lastTapRef.current.at < 420
          ) {
            if (element.type === "page" && element.pageId) {
              lastTapRef.current = { id: "", at: 0 };
              router.push(route(`/page/${element.pageId}`));
              return;
            }
            if (element.type === "canvas" && element.canvasId) {
              lastTapRef.current = { id: "", at: 0 };
              router.push(route(`/canvas/${element.canvasId}`));
              return;
            }
            if (
              element.type === "note" ||
              element.type === "shape" ||
              element.type === "text" ||
              element.type === "frame" ||
              element.type === "connector"
            ) {
              openEditor(element);
              lastTapRef.current = { id: "", at: 0 };
              return;
            }
          }
          if (lastTapRef.current.id !== tappedId) {
            lastTapRef.current = { id: tappedId, at: now };
          }
        }
      }
    }
    if (
      (mode === "move" || mode === "resize") &&
      snapshotRef.current &&
      snapshotRef.current !== docRef.current
    ) {
      pastRef.current = [...pastRef.current.slice(-49), snapshotRef.current];
      futureRef.current = [];
    }
    modeRef.current = "idle";
    moveStartRef.current = null;
    moveGroupRef.current = [];
    resizeRef.current = null;
    createRef.current = null;
  }, [commitViewport, docRef, openEditor, selectedIds]);

  const pinchStartRef = useRef({ cx: 0, cy: 0, zoom: 1 });

  const pinchBegin = useCallback(() => {
    pinchStartRef.current = { ...viewRef.current };
  }, []);

  const pinchUpdate = useCallback((focalX: number, focalY: number, scaleFactor: number) => {
    const start = pinchStartRef.current;
    const currentSize = sizeRef.current;
    const zoom = clamp(start.zoom * scaleFactor, MIN_ZOOM, MAX_ZOOM);
    const worldX = start.cx + (focalX - currentSize.width / 2) / start.zoom;
    const worldY = start.cy + (focalY - currentSize.height / 2) / start.zoom;
    setView({
      cx: worldX - (focalX - currentSize.width / 2) / zoom,
      cy: worldY - (focalY - currentSize.height / 2) / zoom,
      zoom,
    });
  }, []);

  const panGesture = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .averageTouches(true)
    .onBegin((event) => {
      const pressure = event.stylusData?.pressure ?? 0;
      const stylus = Boolean(event.stylusData);
      runOnJS(onGestureBegin)(event.x, event.y, pressure, stylus);
    })
    .onUpdate((event) => {
      runOnJS(onGestureMove)(
        event.x,
        event.y,
        event.translationX,
        event.translationY,
        event.stylusData?.pressure ?? 0,
      );
    })
    .onFinalize(() => {
      runOnJS(onGestureEnd)();
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      runOnJS(pinchBegin)();
    })
    .onUpdate((event) => {
      runOnJS(pinchUpdate)(event.focalX, event.focalY, event.scale);
    })
    .onEnd(() => {
      runOnJS(commitViewport)();
    });

  const gesture = Gesture.Simultaneous(panGesture, pinchGesture);

  const insertPageCard = (pageId: string, pageTitle: string) => {
    const element = makePageCard(pageId, 0, 0);
    const bounds = canvasBounds(docRef.current);
    element.x = bounds.x + bounds.width / 2;
    element.y = bounds.y + bounds.height / 2;
    applyDoc({ ...docRef.current, elements: [...docRef.current.elements, element] });
    setSelectedIds([element.id]);
    setTool("select");
    toast.show({ variant: "success", label: `Linked ${pageTitle}` });
  };

  const insertCanvasCard = (targetCanvasId: string, targetTitle: string) => {
    const element = makeCanvasCard(targetCanvasId, 0, 0);
    const bounds = canvasBounds(docRef.current);
    element.x = bounds.x + bounds.width / 2;
    element.y = bounds.y + bounds.height / 2;
    applyDoc({ ...docRef.current, elements: [...docRef.current.elements, element] });
    setSelectedIds([element.id]);
    setTool("select");
    toast.show({ variant: "success", label: `Inserted ${targetTitle}` });
  };

  const insertImage = async () => {
    try {
      const file = await pickImage();
      if (!file) return;
      setUploading(true);
      const uploaded = await uploadFile(file);
      const element: CanvasElement = {
        id: createId(),
        type: "image",
        x: 0,
        y: 0,
        width: 280,
        height: 200,
        src: uploaded.url,
        alt: file.name,
      };
      const bounds = canvasBounds(docRef.current);
      element.x = bounds.x + bounds.width / 2;
      element.y = bounds.y + bounds.height / 2;
      applyDoc({ ...docRef.current, elements: [...docRef.current.elements, element] });
      setSelectedIds([element.id]);
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not add the image",
      });
    } finally {
      setUploading(false);
      setTool("select");
    }
  };

  const applyTemplate = (templateId: string) => {
    const template = CANVAS_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;
    const next = template.build();
    applyDoc(next);
    setSelectedIds([]);
    fittedRef.current = false;
    setTimeout(() => focusRect(canvasBounds(next), 90), 50);
    setTemplatesOpen(false);
  };

  const generateFromPage = async (pageId: string, intent: "mindmap" | "flow" | "concept") => {
    try {
      const page = await client.page.get({ pageId });
      const outline = extractOutline(safeDoc(page.document?.content));
      const next =
        intent === "mindmap"
          ? createMindMap(page.title, outline)
          : intent === "flow"
            ? createFlowFromOutline(page.title, outline)
            : createConceptMap(page.title, outline);
      applyDoc(next);
      setSelectedIds([]);
      fittedRef.current = false;
      setTimeout(() => focusRect(canvasBounds(next), 90), 50);
      setGeneratePickerOpen(false);
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not generate the canvas",
      });
    }
  };

  const exportAs = async (format: "svg" | "png" | "pdf") => {
    try {
      const result = canvasToSvg(docRef.current, { pageTitles, canvasTitles });
      const name = `${title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "canvas"}`;
      if (format === "svg") {
        await shareCanvasSvg(result.svg, `${name}.svg`);
      } else if (format === "pdf") {
        await shareCanvasPdf(result.svg, result.width, result.height, `${name}.pdf`);
      } else {
        await shareViewPng(captureRef, `${name}.png`);
      }
      setMoreOpen(false);
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Export failed",
      });
    }
  };

  const rename = async () => {
    const name = titleDraft.trim();
    if (!name) return;
    try {
      await client.canvas.update({ canvasId, title: name });
      setTitle(name);
      await queryClient.invalidateQueries({ queryKey: ["native-canvases", workspace?.id] });
      toast.show({ variant: "success", label: "Canvas renamed" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not rename",
      });
    }
  };

  const deleteCanvas = () => {
    Alert.alert("Move this canvas to trash?", "You can restore it from Trash.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Move to trash",
        style: "destructive",
        onPress: async () => {
          try {
            await client.canvas.remove({ canvasId });
            await queryClient.invalidateQueries({ queryKey: ["native-canvases", workspace?.id] });
            router.back();
          } catch (error) {
            toast.show({
              variant: "danger",
              label: error instanceof Error ? error.message : "Could not delete",
            });
          }
        },
      },
    ]);
  };

  const focusFrame = (index: number) => {
    const frame = frames[index];
    if (!frame) return;
    setPresentationIndex(index);
    focusRect({ x: frame.x, y: frame.y, width: frame.width, height: frame.height }, 24);
  };

  const status = saving ? "Saving…" : queued ? "Queued offline" : dirty ? "Unsaved" : "Saved";

  return (
    <View style={{ flex: 1, backgroundColor: background, paddingTop: presentation ? 0 : insets.top }}>
      {!presentation ? (
        <View className="flex-row items-center gap-2 border-b border-border px-3 pb-2 pt-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => {
              void save();
              router.back();
            }}
            className="h-9 w-9 items-center justify-center rounded-full"
          >
            <Ionicons name="chevron-back" size={22} color={foreground} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
              {title}
            </Text>
            <Text className="text-[9px] text-muted">
              {status} · {zoomLabel}% {uploading ? "· uploading" : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save canvas"
            onPress={() => void save()}
            className="rounded-lg bg-accent px-3 py-1.5"
          >
            <Text className="text-[11px] font-semibold text-neutral-900">Save</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Present"
            onPress={() => {
              setPresentation(true);
              focusFrame(0);
            }}
            className="h-8 w-8 items-center justify-center rounded-full border border-border"
          >
            <Ionicons name="play-outline" size={16} color={muted} />
          </Pressable>
        </View>
      ) : null}

      <View
        style={{ flex: 1, overflow: "hidden" }}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          sizeRef.current = { width, height };
          setSize({ width, height });
          if (!fittedRef.current && canvas.data) {
            fittedRef.current = true;
            focusRect(canvasBounds(docRef.current), 90, false);
          }
        }}
      >
        <GestureDetector gesture={gesture}>
          <View ref={captureRef} collapsable={false} style={{ flex: 1, overflow: "hidden" }}>
            <Svg width={size.width} height={size.height}>
              <G
                transform={`translate(${size.width / 2} ${size.height / 2}) scale(${view.zoom}) translate(${-view.cx} ${-view.cy})`}
              >
                <CanvasElements
                  document={doc}
                  selectedIds={presentation ? [] : selectedIds}
                  scale={view.zoom}
                  pageTitles={pageTitles}
                  canvasTitles={canvasTitles}
                />
              </G>
            </Svg>
          </View>
        </GestureDetector>

        {presentation ? (
          <View className="absolute inset-0">
            <Pressable
              className="absolute inset-y-0 left-0 w-1/2"
              onPress={() => focusFrame(Math.max(0, presentationIndex - 1))}
            />
            <Pressable
              className="absolute inset-y-0 right-0 w-1/2"
              onPress={() =>
                focusFrame(Math.min(frames.length - 1, presentationIndex + 1))
              }
            />
            <View className="absolute bottom-6 left-0 right-0 flex-row items-center justify-center gap-3">
              <Pressable
                onPress={() => setPresentation(false)}
                className="rounded-full bg-neutral-900/80 px-4 py-2"
              >
                <Text className="text-[11px] font-medium text-white">Exit presentation</Text>
              </Pressable>
              <Text className="text-[11px] text-white/80">
                {frames.length ? `${presentationIndex + 1} / ${frames.length}` : "No frames"}
              </Text>
            </View>
          </View>
        ) : null}

        {!presentation ? (
          <View className="absolute left-0 right-0 top-0">
            <CanvasToolbar
              tool={tool}
              stylusMode={stylusOnly}
              canUndo={pastRef.current.length > 0}
              canRedo={futureRef.current.length > 0}
              onTool={(next) => {
                setTool(next);
                if (next === "page") setPagePickerOpen(true);
                else if (next === "image") void insertImage();
                else setSelectedIds([]);
              }}
              onAction={(action) => {
                if (action === "undo") undo();
                else if (action === "redo") redo();
                else if (action === "zoomIn") zoomBy(1.25);
                else if (action === "zoomOut") zoomBy(0.8);
                else if (action === "fit") fit();
                else if (action === "more") setMoreOpen(true);
              }}
            />
            {connectorStartId ? (
              <View className="mx-4 mt-2 rounded-xl border border-amber-400/50 bg-amber-100/90 px-3 py-2">
                <Text className="text-[11px] text-neutral-900">
                  Tap the second shape to connect it.
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {!presentation && selectedElement ? (
          <View
            className="absolute left-3 right-3 rounded-2xl border border-border bg-surface/95 p-2"
            style={{ bottom: insets.bottom + 12 }}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row items-center gap-1.5">
                {selectedElement.type === "note" ||
                selectedElement.type === "shape" ||
                selectedElement.type === "freehand" ||
                selectedElement.type === "text"
                  ? (selectedElement.type === "freehand"
                      ? PEN_COLORS
                      : Object.keys(STICKY_HEX)
                    ).map((value) => {
                    const isPen = selectedElement.type === "freehand";
                    const hex = STICKY_HEX[value as StickyColor] ?? value;
                    const active =
                      selectedElement.type === "text"
                        ? selectedElement.color === hex
                        : selectedElement.color === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        accessibilityLabel={`Color ${value}`}
                        onPress={() => {
                          if (isPen) {
                            patchElement(selectedElement.id, { color: value });
                            setPenColor(value);
                            return;
                          }
                          patchElement(selectedElement.id, {
                            color: selectedElement.type === "text" ? hex : value,
                          });
                        }}
                        className={`h-7 w-7 rounded-full border ${
                          active ? "border-foreground" : "border-border"
                        }`}
                        style={{ backgroundColor: isPen ? value : hex }}
                      />
                    );
                  })
                  : null}
                <View className="mx-1 h-6 w-px bg-border" />
                <Pressable
                  onPress={() => {
                    if (
                      selectedElement.type === "note" ||
                      selectedElement.type === "shape" ||
                      selectedElement.type === "text" ||
                      selectedElement.type === "frame" ||
                      selectedElement.type === "connector"
                    ) {
                      openEditor(selectedElement);
                    }
                  }}
                  className="rounded-lg border border-border px-2 py-1"
                >
                  <Text className="text-[10px] text-foreground">Edit text</Text>
                </Pressable>
                <Pressable
                  onPress={duplicateSelected}
                  className="rounded-lg border border-border px-2 py-1"
                >
                  <Text className="text-[10px] text-foreground">Duplicate</Text>
                </Pressable>
                <Pressable onPress={() => layer("front")} className="rounded-lg border border-border px-2 py-1">
                  <Text className="text-[10px] text-foreground">Front</Text>
                </Pressable>
                <Pressable onPress={() => layer("back")} className="rounded-lg border border-border px-2 py-1">
                  <Text className="text-[10px] text-foreground">Back</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    patchElement(selectedElement.id, {
                      locked: !("locked" in selectedElement ? selectedElement.locked : false),
                    } as never)
                  }
                  className="rounded-lg border border-border px-2 py-1"
                >
                  <Text className="text-[10px] text-foreground">
                    {"locked" in selectedElement && selectedElement.locked ? "Unlock" : "Lock"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={removeSelected}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1"
                >
                  <Text className="text-[10px] text-rose-600">Delete</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        ) : null}
      </View>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="Canvas">
        <View className="mt-2 gap-2">
          <View className="flex-row gap-2">
            <TextInput
              value={titleDraft}
              onChangeText={setTitleDraft}
              placeholder="Canvas title"
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
            />
            <Pressable
              onPress={() => void rename()}
              className="items-center justify-center rounded-xl bg-accent px-3"
            >
              <Text className="text-[11px] font-semibold text-neutral-900">Rename</Text>
            </Pressable>
          </View>

          <View className="flex-row items-center justify-between rounded-xl border border-border bg-surface px-3 py-2.5">
            <View className="min-w-0 flex-1 pr-2">
              <Text className="text-[12px] text-foreground">Stylus only drawing</Text>
              <Text className="text-[10px] text-muted">
                Finger pans · Apple Pencil or stylus draws with pressure
              </Text>
            </View>
            <Switch isSelected={stylusOnly} onSelectedChange={setStylusOnly} />
          </View>

          <View className="flex-row flex-wrap gap-1.5">
            {[
              ["templates", "Templates"],
              ["nested", "Nested canvas"],
              ["generate", "From page outline"],
              ["page", "Linked note"],
              ["image", "Image"],
            ].map(([action, label]) => (
              <Pressable
                key={action}
                onPress={() => {
                  setMoreOpen(false);
                  if (action === "templates") setTemplatesOpen(true);
                  else if (action === "nested") setCanvasPickerOpen(true);
                  else if (action === "generate") setGeneratePickerOpen(true);
                  else if (action === "page") setPagePickerOpen(true);
                  else if (action === "image") void insertImage();
                }}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              >
                <Text className="text-[11px] text-foreground">{label}</Text>
              </Pressable>
            ))}
          </View>

          <View className="flex-row flex-wrap gap-1.5">
            {[
              ["svg", "Export SVG"],
              ["png", "Export PNG"],
              ["pdf", "Export PDF"],
            ].map(([format, label]) => (
              <Pressable
                key={format}
                onPress={() => void exportAs(format as "svg" | "png" | "pdf")}
                className="rounded-xl border border-border bg-surface px-3 py-2"
              >
                <Text className="text-[11px] text-foreground">{label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={() => {
              setMoreOpen(false);
              setPresentation(true);
              focusFrame(0);
            }}
            className="rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            <Text className="text-[12px] text-foreground">Present frames</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setMoreOpen(false);
              deleteCanvas();
            }}
            className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5"
          >
            <Text className="text-[12px] text-rose-600">Move canvas to trash</Text>
          </Pressable>
        </View>
      </Sheet>

      <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen} title="Apply a template">
        <Text className="mt-1 text-[11px] text-muted">
          Applying a template replaces the current elements. Save a version first if you need it.
        </Text>
        <View className="mt-3 gap-1">
          {CANVAS_TEMPLATES.map((template) => (
            <Pressable
              key={template.id}
              onPress={() =>
                Alert.alert(`Apply “${template.name}”?`, "This replaces the current canvas.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Apply", onPress: () => applyTemplate(template.id) },
                ])
              }
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-[13px] font-medium text-foreground">{template.name}</Text>
              <Text className="text-[10px] text-muted">
                {template.category} · {template.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet open={canvasPickerOpen} onOpenChange={setCanvasPickerOpen} title="Insert nested canvas">
        <View className="mt-2 gap-1">
          {(canvases.data ?? [])
            .filter((entry) => entry.id !== canvasId)
            .map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => {
                  insertCanvasCard(entry.id, entry.title);
                  setCanvasPickerOpen(false);
                }}
                className="rounded-xl border border-border bg-surface px-3 py-2.5"
              >
                <Text className="text-[12px] text-foreground">
                  {entry.icon ?? "▦"} {entry.title}
                </Text>
              </Pressable>
            ))}
          {!canvases.data?.length ? (
            <Text className="py-6 text-center text-[11px] text-muted">No other canvases yet.</Text>
          ) : null}
        </View>
      </Sheet>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="Edit text"
      >
        <View className="mt-2 gap-2">
          <TextInput
            value={editingText}
            onChangeText={setEditingText}
            multiline
            autoFocus
            placeholder="Write something…"
            className="min-h-[120px] rounded-xl border border-border bg-surface px-3 py-2 text-[13px] leading-6 text-foreground"
            textAlignVertical="top"
          />
          <Pressable
            onPress={() => {
              if (!editing) return;
              if (editing.type === "frame") {
                patchElement(editing.id, { title: editingText });
              } else if (editing.type === "connector") {
                patchElement(editing.id, { label: editingText || undefined });
              } else {
                patchElement(editing.id, { text: editingText });
              }
              setEditing(null);
            }}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Save text</Text>
          </Pressable>
        </View>
      </Sheet>

      <Sheet
        open={pendingConnector !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConnector(null);
        }}
        title="Connector label"
      >
        <View className="mt-2 gap-2">
          <TextInput
            value={connectorLabel}
            onChangeText={setConnectorLabel}
            placeholder="Optional label"
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] text-foreground"
          />
          <Pressable
            onPress={() => {
              if (pendingConnector) {
                patchElement(pendingConnector, { label: connectorLabel || undefined } as never);
              }
              setPendingConnector(null);
            }}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Done</Text>
          </Pressable>
        </View>
      </Sheet>

      <PageLinkPicker
        open={pagePickerOpen}
        onOpenChange={(open) => {
          setPagePickerOpen(open);
          if (!open) setTool("select");
        }}
        onSelect={(pageId, pageTitle) => insertPageCard(pageId, pageTitle)}
      />
      <PageLinkPicker
        open={generatePickerOpen}
        onOpenChange={(open) => {
          setGeneratePickerOpen(open);
          if (!open) setTool("select");
        }}
        title="Generate from a page outline"
        onSelect={(pageId) =>
          Alert.alert("What should the canvas show?", "Generated from the page outline.", [
            { text: "Cancel", style: "cancel" },
            { text: "Mind map", onPress: () => void generateFromPage(pageId, "mindmap") },
            { text: "Flowchart", onPress: () => void generateFromPage(pageId, "flow") },
            {
              text: "Concept map",
              onPress: () => void generateFromPage(pageId, "concept"),
            },
          ])
        }
      />
    </View>
  );
}
