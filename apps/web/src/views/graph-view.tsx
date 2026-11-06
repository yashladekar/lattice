"use client";

import {
  NODE_META,
  RELATION_META,
  connectedComponents,
  degreeMap,
  linkActiveAt,
  orphanNodes,
  sortVersionTimeline,
  versionEntryAt,
  versionLinksAt,
  type KnowledgeEdge,
  type KnowledgeNode,
  type NodeKind,
  type RelationType,
  type VersionTimelineEntry,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  ArrowUpRight,
  BookOpen,
  CircleDot,
  Clock,
  Filter,
  Focus,
  Frame,
  Layers,
  Lightbulb,
  Link2,
  Maximize2,
  Network,
  Palette,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  User,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import {
  useGraph,
  useWorkspaceCanvases,
  useWorkspaceNotebooks,
  useWorkspacePages,
  useWorkspaceTags,
} from "@/hooks/use-local-data";
import {
  deleteNodeLocal,
  updateNodePositionLocal,
  upsertEdgeLocal,
  upsertNodeLocal,
} from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";
import { client } from "@/utils/orpc";

const KIND_ORDER: NodeKind[] = [
  "PAGE",
  "CANVAS",
  "TOPIC",
  "CONCEPT",
  "PROJECT",
  "PERSON",
  "RESOURCE",
  "FLASHCARD",
];

const RELATIONS: RelationType[] = [
  "RELATED_TO",
  "DEPENDS_ON",
  "PART_OF",
  "EXPLAINS",
  "EXAMPLE_OF",
  "CONTRADICTS",
  "PREREQUISITE_OF",
  "REFERENCES",
  "CREATED_FROM",
  "CONNECTED_THROUGH",
];

const CLUSTER_COLORS = [
  "#e07a2e",
  "#2f6b4f",
  "#3b82f6",
  "#8b5cf6",
  "#dc2626",
  "#0891b2",
  "#db2777",
  "#a16207",
];

const RECENCY_OPTIONS = [
  { value: "all", label: "Any time", days: 0 },
  { value: "7", label: "Past 7 days", days: 7 },
  { value: "30", label: "Past 30 days", days: 30 },
  { value: "90", label: "Past 90 days", days: 90 },
] as const;

type Recency = (typeof RECENCY_OPTIONS)[number]["value"];

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

interface GraphPosition {
  x: number;
  y: number;
}

function computeLayout(nodes: KnowledgeNode[], edges: KnowledgeEdge[]): Map<string, GraphPosition> {
  const positions = new Map<string, GraphPosition>();
  const velocities = new Map<string, GraphPosition>();
  const radius = Math.max(120, nodes.length * 18);
  for (const [index, node] of nodes.entries()) {
    const angle = (index / Math.max(1, nodes.length)) * Math.PI * 2;
    const seed = hashString(node.id);
    const offset = ((seed % 100) / 100 - 0.5) * 60;
    positions.set(node.id, {
      x: node.x ?? Math.cos(angle) * (radius + offset),
      y: node.y ?? Math.sin(angle) * (radius + offset),
    });
    velocities.set(node.id, { x: 0, y: 0 });
  }

  for (let iteration = 0; iteration < 240; iteration += 1) {
    const list = [...positions.entries()];
    for (let i = 0; i < list.length; i += 1) {
      const [idA, a] = list[i]!;
      for (let j = i + 1; j < list.length; j += 1) {
        const [idB, b] = list[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        if (dx === 0 && dy === 0) {
          dx = (hashString(idA) % 10) - 5;
          dy = (hashString(idB) % 10) - 5;
        }
        const dist2 = Math.max(100, dx * dx + dy * dy);
        const force = 7000 / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const va = velocities.get(idA)!;
        const vb = velocities.get(idB)!;
        va.x += fx;
        va.y += fy;
        vb.x -= fx;
        vb.y -= fy;
      }
    }
    for (const edge of edges) {
      const a = positions.get(edge.sourceNodeId);
      const b = positions.get(edge.targetNodeId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const ideal = 125;
      const force = (dist - ideal) * 0.009;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const va = velocities.get(edge.sourceNodeId)!;
      const vb = velocities.get(edge.targetNodeId)!;
      va.x += fx;
      va.y += fy;
      vb.x -= fx;
      vb.y -= fy;
    }
    for (const node of nodes) {
      const position = positions.get(node.id);
      const velocity = velocities.get(node.id);
      if (!position || !velocity) continue;
      const pinned = node.x !== null && node.y !== null;
      if (pinned) {
        velocity.x = 0;
        velocity.y = 0;
        continue;
      }
      velocity.x -= position.x * 0.0012;
      velocity.y -= position.y * 0.0012;
      velocity.x *= 0.82;
      velocity.y *= 0.82;
      position.x += velocity.x;
      position.y += velocity.y;
    }
  }
  return positions;
}

function kindIcon(kind: NodeKind) {
  if (kind === "CANVAS") return <Frame className="size-3" />;
  if (kind === "PAGE") return <BookOpen className="size-3" />;
  if (kind === "TOPIC" || kind === "CONCEPT") return <Lightbulb className="size-3" />;
  if (kind === "PROJECT") return <Layers className="size-3" />;
  if (kind === "PERSON") return <User className="size-3" />;
  if (kind === "RESOURCE") return <Link2 className="size-3" />;
  return <CircleDot className="size-3" />;
}

export function GraphView({ onShare }: { onShare?: () => void }) {
  const router = useRouter();
  const { db, user, activeWorkspaceId, online } = useAppData();
  const graph = useGraph();
  const pages = useWorkspacePages();
  const canvases = useWorkspaceCanvases();
  const notebooks = useWorkspaceNotebooks();
  const tags = useWorkspaceTags();
  const pageTags =
    useLiveQuery(async () => (db ? db.pageTags.toArray() : []), [db], []) ?? [];
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<Set<NodeKind>>(new Set(KIND_ORDER));
  const [notebookFilter, setNotebookFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [relationFilter, setRelationFilter] = useState<RelationType | "all">("all");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [recency, setRecency] = useState<Recency>("all");
  const [playbackAt, setPlaybackAt] = useState<number | null>(null);
  const [clusterColors, setClusterColors] = useState(false);
  const [focusDepth, setFocusDepth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, GraphPosition>>(new Map());
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [suggestions, setSuggestions] = useState<
    Array<{ sourceNodeId: string; targetNodeId: string; sourceTitle: string; targetTitle: string; score: number; reason: string }>
  >([]);
  const [suggesting, setSuggesting] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [targetNode, setTargetNode] = useState("");
  const [relationType, setRelationType] = useState<RelationType>("RELATED_TO");
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    kind: "pan" | "node";
    startX: number;
    startY: number;
    viewport?: { x: number; y: number; zoom: number };
    nodeId?: string;
    nodeStart?: GraphPosition;
  } | null>(null);

  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const canvasById = useMemo(() => new Map(canvases.map((canvas) => [canvas.id, canvas])), [canvases]);
  const notebookById = useMemo(
    () => new Map(notebooks.map((notebook) => [notebook.id, notebook])),
    [notebooks],
  );
  const tagById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const tagsByPage = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of pageTags) {
      const list = map.get(link.pageId) ?? [];
      list.push(link.tagId);
      map.set(link.pageId, list);
    }
    return map;
  }, [pageTags]);

  const degree = useMemo(() => degreeMap(graph.edges), [graph.edges]);
  const orphans = useMemo(() => new Set(orphanNodes(graph.nodes, graph.edges).map((node) => node.id)), [graph.nodes, graph.edges]);
  const components = useMemo(() => connectedComponents(graph.nodes, graph.edges), [graph.nodes, graph.edges]);
  const componentIndex = useMemo(() => {
    const map = new Map<string, number>();
    components.forEach((component, index) => {
      for (const id of component) map.set(id, index);
    });
    return map;
  }, [components]);

  const timeline = useMemo(() => {
    const stamps: number[] = [];
    for (const node of graph.nodes) {
      const created = new Date(node.createdAt).getTime();
      if (Number.isFinite(created)) stamps.push(created);
      if (node.deletedAt) {
        const deleted = new Date(node.deletedAt).getTime();
        if (Number.isFinite(deleted)) stamps.push(deleted);
      }
    }
    if (!stamps.length) return null;
    return { min: Math.min(...stamps), max: Math.max(Date.now(), ...stamps) };
  }, [graph.nodes]);

  /**
   * Version history drives link playback: a reference that existed only in the
   * middle versions of a note should appear and disappear as the slider moves.
   */
  const versionTimeline = useQuery({
    queryKey: ["graph-version-timeline", activeWorkspaceId],
    queryFn: async () => client.page.versionTimeline({ limit: 200 }),
    enabled: online && Boolean(activeWorkspaceId) && playbackAt !== null,
  });
  const versionEntries = useMemo<VersionTimelineEntry[]>(
    () =>
      sortVersionTimeline(
        (versionTimeline.data ?? []).map((entry) => ({
          pageId: entry.pageId,
          version: entry.version,
          title: entry.title,
          createdAt: new Date(entry.createdAt).toISOString(),
          links: entry.links,
        })),
      ),
    [versionTimeline.data],
  );
  const playbackLinks = useMemo(
    () => (playbackAt !== null && versionEntries.length ? versionLinksAt(versionEntries, playbackAt) : null),
    [playbackAt, versionEntries],
  );
  const playbackCaption = useMemo(
    () => (playbackAt !== null ? versionEntryAt(versionEntries, playbackAt) : null),
    [playbackAt, versionEntries],
  );
  const nodePageId = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.pageId ?? null])),
    [graph.nodes],
  );

  useEffect(() => {
    if (!selectedId) setFocusDepth(0);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const days = RECENCY_OPTIONS.find((option) => option.value === recency)?.days ?? 0;
    const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
    let focusSet: Set<string> | null = null;
    if (focusDepth > 0 && selectedId) {
      focusSet = new Set([selectedId]);
      let frontier = [selectedId];
      for (let depth = 0; depth < focusDepth && frontier.length; depth += 1) {
        const next: string[] = [];
        for (const edge of graph.edges) {
          if (frontier.includes(edge.sourceNodeId) && !focusSet.has(edge.targetNodeId)) {
            focusSet.add(edge.targetNodeId);
            next.push(edge.targetNodeId);
          }
          if (frontier.includes(edge.targetNodeId) && !focusSet.has(edge.sourceNodeId)) {
            focusSet.add(edge.sourceNodeId);
            next.push(edge.sourceNodeId);
          }
        }
        frontier = next;
      }
    }
    let nodeSet = new Set<string>(
      graph.nodes
        .filter((node) => {
          if (!kindFilter.has(node.kind)) return false;
          if (normalized && !node.title.toLowerCase().includes(normalized)) return false;
          if (orphansOnly && !orphans.has(node.id)) return false;
          if (focusSet && !focusSet.has(node.id)) return false;
          if (cutoff && new Date(node.updatedAt).getTime() < cutoff) return false;
          if (playbackAt !== null) {
            const created = new Date(node.createdAt).getTime();
            if (!Number.isFinite(created) || created > playbackAt) return false;
            if (node.deletedAt) {
              const deleted = new Date(node.deletedAt).getTime();
              if (Number.isFinite(deleted) && deleted <= playbackAt) return false;
            }
          }
          if (notebookFilter !== "all") {
            const notebookId = node.pageId
              ? pageById.get(node.pageId)?.notebookId
              : node.canvasId
                ? canvasById.get(node.canvasId)?.notebookId
                : null;
            if (notebookId !== notebookFilter) return false;
          }
          if (tagFilter !== "all" && node.pageId) {
            const pageTagIds = tagsByPage.get(node.pageId) ?? [];
            if (!pageTagIds.includes(tagFilter)) return false;
          }
          return true;
        })
        .map((node) => node.id),
    );
    let edgeSet = graph.edges.filter(
      (edge) =>
        nodeSet.has(edge.sourceNodeId) &&
        nodeSet.has(edge.targetNodeId) &&
        (relationFilter === "all" || edge.relationType === relationFilter) &&
        (playbackLinks === null ||
          edge.origin !== "PAGE_LINK" ||
          linkActiveAt(
            playbackLinks,
            nodePageId.get(edge.sourceNodeId) ?? "",
            nodePageId.get(edge.targetNodeId) ?? "",
          )),
    );
    if (normalized) {
      const matched = new Set(nodeSet);
      for (const edge of edgeSet) {
        matched.add(edge.sourceNodeId);
        matched.add(edge.targetNodeId);
      }
      nodeSet = new Set(graph.nodes.filter((node) => matched.has(node.id)).map((node) => node.id));
      edgeSet = graph.edges.filter(
        (edge) => nodeSet.has(edge.sourceNodeId) && nodeSet.has(edge.targetNodeId),
      );
    }
    return { nodes: graph.nodes.filter((node) => nodeSet.has(node.id)), edges: edgeSet };
  }, [
    graph.nodes,
    graph.edges,
    kindFilter,
    query,
    orphansOnly,
    recency,
    playbackAt,
    focusDepth,
    selectedId,
    orphans,
    notebookFilter,
    tagFilter,
    relationFilter,
    pageById,
    canvasById,
    tagsByPage,
    playbackLinks,
    nodePageId,
  ]);

  useEffect(() => {
    const layout = computeLayout(filtered.nodes, filtered.edges);
    setPositions(layout);
    const container = containerRef.current;
    if (!container) return;
    const values = [...layout.values()];
    if (!values.length) return;
    const minX = Math.min(...values.map((point) => point.x)) - 80;
    const maxX = Math.max(...values.map((point) => point.x)) + 80;
    const minY = Math.min(...values.map((point) => point.y)) - 80;
    const maxY = Math.max(...values.map((point) => point.y)) + 80;
    const rect = container.getBoundingClientRect();
    const zoom = Math.min(
      1.4,
      Math.max(0.2, Math.min(rect.width / Math.max(1, maxX - minX), rect.height / Math.max(1, maxY - minY))),
    );
    setViewport({
      zoom,
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
    });
  }, [filtered.nodes, filtered.edges]);

  const selectedNode = useMemo(
    () => graph.nodes.find((node) => node.id === selectedId) ?? null,
    [graph.nodes, selectedId],
  );
  const selectedEdges = useMemo(
    () =>
      selectedId
        ? graph.edges.filter(
            (edge) => edge.sourceNodeId === selectedId || edge.targetNodeId === selectedId,
          )
        : [],
    [graph.edges, selectedId],
  );

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () =>
      setContainerSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const minimap = useMemo(() => {
    const points = [...positions.values()];
    if (!points.length) return null;
    const minX = Math.min(...points.map((point) => point.x)) - 60;
    const maxX = Math.max(...points.map((point) => point.x)) + 60;
    const minY = Math.min(...points.map((point) => point.y)) - 60;
    const maxY = Math.max(...points.map((point) => point.y)) + 60;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    return {
      minX,
      minY,
      width,
      height,
      scale: Math.min(150 / width, 80 / height),
    };
  }, [positions]);

  const zoomToNode = (nodeId: string) => {
    const point = positions.get(nodeId);
    const container = containerRef.current;
    if (!point || !container) return;
    const zoom = 1.4;
    setViewport({
      zoom,
      x: container.clientWidth / 2 - point.x * zoom,
      y: container.clientHeight / 2 - point.y * zoom,
    });
  };

  const fit = () => {
    const values = [...positions.values()];
    const container = containerRef.current;
    if (!values.length || !container) return;
    const minX = Math.min(...values.map((point) => point.x)) - 80;
    const maxX = Math.max(...values.map((point) => point.x)) + 80;
    const minY = Math.min(...values.map((point) => point.y)) - 80;
    const maxY = Math.max(...values.map((point) => point.y)) + 80;
    const rect = container.getBoundingClientRect();
    const zoom = Math.min(
      1.4,
      Math.max(0.2, Math.min(rect.width / Math.max(1, maxX - minX), rect.height / Math.max(1, maxY - minY))),
    );
    setViewport({
      zoom,
      x: rect.width / 2 - ((minX + maxX) / 2) * zoom,
      y: rect.height / 2 - ((minY + maxY) / 2) * zoom,
    });
  };

  const getPoint = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - viewport.x) / viewport.zoom,
      y: (clientY - rect.top - viewport.y) / viewport.zoom,
    };
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
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

  const createTopic = async () => {
    if (!db || !user || !activeWorkspaceId || !topicTitle.trim()) return;
    const node = await upsertNodeLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      kind: "TOPIC",
      title: topicTitle.trim(),
    });
    setTopicTitle("");
    setCreatingTopic(false);
    setSelectedId(node.id);
    toast.success("Topic created");
  };

  const addRelation = async () => {
    if (!db || !user || !activeWorkspaceId || !selectedNode || !targetNode) return;
    await upsertEdgeLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      sourceNodeId: selectedNode.id,
      targetNodeId: targetNode,
      relationType,
    });
    setTargetNode("");
    toast.success("Relation added");
  };

  const suggestConnections = async () => {
    if (!online) {
      toast.error("Suggestions need the sync server.");
      return;
    }
    setSuggesting(true);
    try {
      const result = await client.graph.suggestions();
      setSuggestions(result);
      if (!result.length) toast.message("No obvious missing connections right now.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not suggest connections");
    } finally {
      setSuggesting(false);
    }
  };

  const acceptSuggestion = async (sourceNodeId: string, targetNodeId: string) => {
    if (!db || !user || !activeWorkspaceId) return;
    await upsertEdgeLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      sourceNodeId,
      targetNodeId,
      relationType: "RELATED_TO",
      origin: "AI",
      aiGenerated: true,
    });
    setSuggestions((current) =>
      current.filter(
        (entry) => entry.sourceNodeId !== sourceNodeId || entry.targetNodeId !== targetNodeId,
      ),
    );
    toast.success("Suggestion accepted");
  };

  const removeNode = async (node: KnowledgeNode) => {
    if (!db || (node.pageId && pageById.has(node.pageId))) {
      toast.error("Open the source page to delete it.");
      return;
    }
    await deleteNodeLocal(db, node.id);
    setSelectedId(null);
    toast.success("Topic removed");
  };

  const onNodePointerDown = (event: React.PointerEvent, node: KnowledgeNode) => {
    event.stopPropagation();
    setSelectedId(node.id);
    const point = positions.get(node.id);
    if (!point) return;
    dragRef.current = {
      kind: "node",
      startX: event.clientX,
      startY: event.clientY,
      nodeId: node.id,
      nodeStart: point,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan" && drag.viewport) {
      setViewport({
        ...drag.viewport,
        x: drag.viewport.x + (event.clientX - drag.startX),
        y: drag.viewport.y + (event.clientY - drag.startY),
      });
      return;
    }
    if (drag.kind === "node" && drag.nodeId && drag.nodeStart) {
      const dx = (event.clientX - drag.startX) / viewport.zoom;
      const dy = (event.clientY - drag.startY) / viewport.zoom;
      setPositions((current) => {
        const next = new Map(current);
        next.set(drag.nodeId as string, {
          x: drag.nodeStart!.x + dx,
          y: drag.nodeStart!.y + dy,
        });
        return next;
      });
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === "node" && drag.nodeId && db) {
      const position = positions.get(drag.nodeId);
      if (position) void updateNodePositionLocal(db, drag.nodeId, position.x, position.y);
    }
  };

  const degreeCount = (nodeId: string) => degree.get(nodeId) ?? 0;

  return (
    <div className="relative flex h-full min-w-0">
      <div
        ref={containerRef}
        className="relative min-w-0 flex-1 overflow-hidden bg-background"
        onWheel={onWheel}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if ((event.target as HTMLElement).closest("[data-graph-ui]")) return;
          if ((event.target as HTMLElement).closest("[data-graph-node]")) return;
          dragRef.current = {
            kind: "pan",
            startX: event.clientX,
            startY: event.clientY,
            viewport,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="pointer-events-none absolute inset-0 dot-grid opacity-70" />

        <div data-graph-ui className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a node…"
              className="h-8 w-44 rounded-md bg-popover/90 pl-7 text-xs backdrop-blur"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md bg-popover/90 px-2 text-xs backdrop-blur"
                />
              }
            >
              <Filter className="size-3" /> {notebookFilter === "all" ? "All notebooks" : notebookById.get(notebookFilter)?.name ?? "Notebook"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setNotebookFilter("all")}>All notebooks</DropdownMenuItem>
              {notebooks.map((notebook) => (
                <DropdownMenuItem key={notebook.id} onClick={() => setNotebookFilter(notebook.id)}>
                  {notebook.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md bg-popover/90 px-2 text-xs backdrop-blur"
                />
              }
            >
              {relationFilter === "all" ? "All relations" : RELATION_META[relationFilter].label}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72">
              <DropdownMenuItem onClick={() => setRelationFilter("all")}>All relations</DropdownMenuItem>
              {RELATIONS.map((relation) => (
                <DropdownMenuItem key={relation} onClick={() => setRelationFilter(relation)}>
                  <span className="size-1.5 rounded-full" style={{ background: RELATION_META[relation].color }} />
                  {RELATION_META[relation].label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md bg-popover/90 px-2 text-xs backdrop-blur"
                />
              }
            >
              <Tag className="size-3" /> {tagFilter === "all" ? "All tags" : tagById.get(tagFilter)?.name ?? "Tag"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72">
              <DropdownMenuItem onClick={() => setTagFilter("all")}>All tags</DropdownMenuItem>
              {tags.map((tag) => (
                <DropdownMenuItem key={tag.id} onClick={() => setTagFilter(tag.id)}>
                  <span className="size-2 rounded-full" style={{ background: tag.color }} />
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md bg-popover/90 px-2 text-xs backdrop-blur"
                />
              }
            >
              <Clock className="size-3" /> {RECENCY_OPTIONS.find((option) => option.value === recency)?.label ?? "Any time"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {RECENCY_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.value} onClick={() => setRecency(option.value)}>
                  {option.value === recency ? "• " : ""}
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <label className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-popover/90 px-2 text-xs text-muted-foreground backdrop-blur">
            <input
              type="checkbox"
              checked={orphansOnly}
              onChange={(event) => setOrphansOnly(event.target.checked)}
              className="size-3 accent-[var(--saffron)]"
            />
            Orphans only
          </label>
          <button
            type="button"
            onClick={() => setClusterColors((current) => !current)}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs backdrop-blur",
              clusterColors
                ? "border-border bg-card text-foreground"
                : "border-border bg-popover/90 text-muted-foreground",
            )}
            title="Color nodes by connected cluster"
          >
            <Palette className="size-3" /> Clusters
          </button>
          <button
            type="button"
            onClick={() =>
              setPlaybackAt((current) => (current === null ? (timeline?.max ?? null) : null))
            }
            disabled={!timeline}
            title="Play the graph back through time"
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs backdrop-blur disabled:opacity-40",
              playbackAt !== null
                ? "border-border bg-card text-foreground"
                : "border-border bg-popover/90 text-muted-foreground",
            )}
          >
            <Clock className="size-3" /> Playback
          </button>
          {focusDepth > 0 && selectedNode ? (
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-saffron/40 bg-saffron/[0.08] px-2 text-xs backdrop-blur">
              <Focus className="size-3 text-saffron" />
              Local · depth {focusDepth} · {selectedNode.title}
              <button type="button" onClick={() => setFocusDepth(0)} aria-label="Exit local view">
                <X className="size-3 text-muted-foreground" />
              </button>
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1 rounded-md border border-border bg-popover/90 p-0.5 backdrop-blur">
            <button type="button" onClick={() => setViewport((current) => ({ ...current, zoom: Math.max(0.2, current.zoom / 1.2) }))} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted">
              <ZoomOut className="size-3" />
            </button>
            <span className="w-8 text-center font-mono text-xs text-muted-foreground">{Math.round(viewport.zoom * 100)}%</span>
            <button type="button" onClick={() => setViewport((current) => ({ ...current, zoom: Math.min(3, current.zoom * 1.2) }))} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted">
              <ZoomIn className="size-3" />
            </button>
            <button type="button" onClick={fit} className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted">
              <Maximize2 className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => selectedId && zoomToNode(selectedId)}
              disabled={!selectedId}
              title="Zoom to selected node"
              className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-30"
            >
              <Focus className="size-3" />
            </button>
          </div>
        </div>

        {minimap ? (
          <div
            data-graph-ui
            role="button"
            aria-label="Minimap — click to jump"
            title="Minimap — click to jump"
            className="absolute right-3 top-12 z-20 h-[96px] w-[166px] cursor-crosshair rounded-lg border border-border/70 bg-popover/90 p-2 shadow-lg backdrop-blur"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const padding = 8;
              const worldX = (event.clientX - rect.left - padding) / minimap.scale + minimap.minX;
              const worldY = (event.clientY - rect.top - padding) / minimap.scale + minimap.minY;
              const container = containerRef.current;
              if (!container) return;
              setViewport({
                ...viewport,
                x: container.clientWidth / 2 - worldX * viewport.zoom,
                y: container.clientHeight / 2 - worldY * viewport.zoom,
              });
            }}
          >
            <svg width="150" height="80" className="overflow-visible">
              {[...positions.entries()].map(([id, point]) => (
                <circle
                  key={id}
                  cx={(point.x - minimap.minX) * minimap.scale}
                  cy={(point.y - minimap.minY) * minimap.scale}
                  r={selectedId === id ? 3 : 2}
                  className={selectedId === id ? "fill-primary" : "fill-muted-foreground/60"}
                />
              ))}
              {containerSize.width ? (
                <rect
                  x={(-viewport.x / viewport.zoom - minimap.minX) * minimap.scale}
                  y={(-viewport.y / viewport.zoom - minimap.minY) * minimap.scale}
                  width={(containerSize.width / viewport.zoom) * minimap.scale}
                  height={(containerSize.height / viewport.zoom) * minimap.scale}
                  className="fill-primary/5 stroke-primary/50"
                  strokeWidth={1}
                />
              ) : null}
            </svg>
          </div>
        ) : null}

        {playbackAt !== null && timeline ? (
          <div
            data-graph-ui
            className="absolute bottom-14 left-1/2 z-20 flex w-[min(520px,90%)] -translate-x-1/2 items-center gap-2 rounded-xl border border-border/70 bg-popover/95 px-3 py-2 shadow-xl backdrop-blur"
          >
            <span className="shrink-0 text-xs text-muted-foreground">Graph at</span>
            <input
              type="range"
              min={timeline.min}
              max={timeline.max}
              step={24 * 60 * 60 * 1000}
              value={playbackAt}
              onChange={(event) => setPlaybackAt(Number(event.target.value))}
              className="min-w-0 flex-1 accent-[var(--saffron)]"
              aria-label="Graph playback date"
            />
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">
              {new Date(playbackAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">
              {versionTimeline.isFetching
                ? "loading history…"
                : playbackCaption
                  ? `v${playbackCaption.version} · ${playbackCaption.title}`
                  : "no saved versions"}
            </span>
            <button
              type="button"
              onClick={() => setPlaybackAt(null)}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-xs hover:bg-muted"
            >
              Live
            </button>
          </div>
        ) : null}

        <div data-graph-ui className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 rounded-md bg-popover/90 text-xs backdrop-blur" onClick={() => void suggestConnections()} disabled={suggesting}>
            <Sparkles className="size-3 text-saffron" /> {suggesting ? "Thinking…" : "Suggest"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 rounded-md bg-popover/90 text-xs backdrop-blur" onClick={() => setCreatingTopic(true)}>
            <Plus className="size-3" /> Topic
          </Button>
          {onShare ? (
            <Button variant="outline" size="sm" className="h-8 rounded-md bg-popover/90 text-xs backdrop-blur" onClick={onShare}>
              Share
            </Button>
          ) : null}
        </div>

        <div data-graph-ui className="absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-1">
          {KIND_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() =>
                setKindFilter((current) => {
                  const next = new Set(current);
                  if (next.has(kind)) next.delete(kind);
                  else next.add(kind);
                  return next;
                })
              }
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors",
                kindFilter.has(kind)
                  ? "border-border bg-card text-foreground"
                  : "border-transparent bg-muted/40 text-muted-foreground opacity-50",
              )}
            >
              <span className="size-1.5 rounded-full" style={{ background: NODE_META[kind].color }} />
              {NODE_META[kind].label}
            </button>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">
            {filtered.nodes.length} nodes · {filtered.edges.length} edges · {orphans.size} orphan{orphans.size === 1 ? "" : "s"} · {components.length} cluster{components.length === 1 ? "" : "s"}
          </span>
        </div>

        <div
          className="absolute origin-top-left"
          style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
        >
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <defs>
              <marker id="graph-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8b7a" />
              </marker>
            </defs>
            {filtered.edges.map((edge) => {
              const source = positions.get(edge.sourceNodeId);
              const target = positions.get(edge.targetNodeId);
              if (!source || !target) return null;
              const sourceNode = filtered.nodes.find((node) => node.id === edge.sourceNodeId);
              const targetNode = filtered.nodes.find((node) => node.id === edge.targetNodeId);
              const radiusA = 16 + Math.min(14, degreeCount(edge.sourceNodeId) * 2);
              const radiusB = 16 + Math.min(14, degreeCount(edge.targetNodeId) * 2);
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
              const x1 = source.x + (dx / dist) * radiusA;
              const y1 = source.y + (dy / dist) * radiusA;
              const x2 = target.x - (dx / dist) * (radiusB + 4);
              const y2 = target.y - (dy / dist) * (radiusB + 4);
              const highlighted = selectedId === edge.sourceNodeId || selectedId === edge.targetNodeId;
              const color = RELATION_META[edge.relationType as RelationType]?.color ?? "#8b8b7a";
              return (
                <g key={edge.id} className="graph-edge" opacity={selectedId && !highlighted ? 0.18 : 1}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={color}
                    strokeWidth={highlighted ? 2 : 1}
                    strokeOpacity={highlighted ? 0.85 : 0.32}
                    markerEnd={edge.relationType === "REFERENCES" || edge.relationType === "DEPENDS_ON" || edge.relationType === "PREREQUISITE_OF" ? "url(#graph-arrow)" : undefined}
                    vectorEffect="non-scaling-stroke"
                  />
                  {highlighted && sourceNode && targetNode ? (
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2 - 5}
                      textAnchor="middle"
                      fill={color}
                      fontSize={8}
                      fontFamily="Inter, sans-serif"
                    >
                      {RELATION_META[edge.relationType as RelationType]?.label ?? edge.relationType}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {suggestions.map((entry) => {
              const source = positions.get(entry.sourceNodeId);
              const target = positions.get(entry.targetNodeId);
              if (!source || !target) return null;
              return (
                <line
                  key={`suggestion:${entry.sourceNodeId}:${entry.targetNodeId}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="#e07a2e"
                  strokeWidth={1.5}
                  strokeOpacity={0.55}
                  strokeDasharray="6 5"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {filtered.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const selected = selectedId === node.id;
            const size = 16 + Math.min(14, degreeCount(node.id) * 2);
            const color =
              clusterColors && components.length > 1
                ? CLUSTER_COLORS[(componentIndex.get(node.id) ?? 0) % CLUSTER_COLORS.length]!
                : NODE_META[node.kind].color;
            const page = node.pageId ? pageById.get(node.pageId) : null;
            const canvas = node.canvasId ? canvasById.get(node.canvasId) : null;
            const sourceTags = page ? tagsByPage.get(page.id) ?? [] : [];
            return (
              <button
                key={node.id}
                data-graph-node
                type="button"
                onPointerDown={(event) => onNodePointerDown(event, node)}
                onDoubleClick={() => {
                  if (page) router.push(appRouteObject({ view: "page", id: page.id }));
                  else if (canvas) router.push(appRouteObject({ view: "canvas", id: canvas.id }));
                }}
                className={cn(
                  "graph-node absolute flex items-center gap-1.5 rounded-full border bg-card px-2 py-1 text-left shadow-sm transition-all",
                  selected ? "z-10 border-primary" : "border-border/70 hover:border-border",
                )}
                style={{
                  left: position.x,
                  top: position.y,
                  transform: "translate(-50%, -50%)",
                  minWidth: size * 2,
                }}
              >
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full text-background"
                  style={{ background: color }}
                >
                  {kindIcon(node.kind)}
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="max-w-40 truncate text-xs font-medium">{node.title}</span>
                  <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
                    {node.kind.toLowerCase()}
                    {page?.notebookId ? ` · ${notebookById.get(page.notebookId)?.name ?? ""}` : ""}
                  </span>
                </span>
                {sourceTags.length ? (
                  <span className="ml-1 size-1.5 rounded-full" style={{ background: tagById.get(sourceTags[0] ?? "")?.color ?? "#8b8b7a" }} />
                ) : null}
              </button>
            );
          })}
        </div>

        {!graph.nodes.length ? (
          <div className="absolute inset-0 grid place-items-center">
            <div className="max-w-sm text-center">
              <Network className="mx-auto size-8 text-muted-foreground/40" />
              <h2 className="mt-3 font-display text-2xl">Your graph is waiting</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Create pages and link them with [[, or add a topic and connect it to what you already know.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {selectedNode ? (
        <aside className="flex h-full w-[300px] shrink-0 flex-col border-l border-border/60 bg-background/50">
          <div className="flex items-start gap-2 border-b border-border/60 p-3">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-full text-background"
              style={{ background: NODE_META[selectedNode.kind].color }}
            >
              {kindIcon(selectedNode.kind)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{selectedNode.title}</div>
              <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                {selectedNode.kind.toLowerCase()} · {degreeCount(selectedNode.id)} connections
              </div>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Close details">
              <X className="size-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="flex flex-wrap gap-1">
              {selectedNode.pageId && pageById.get(selectedNode.pageId) ? (
                <Button
                  size="sm"
                  className="h-8 rounded-md text-xs"
                  onClick={() => router.push(appRouteObject({ view: "page", id: selectedNode.pageId as string }))}
                >
                  Open page <ArrowUpRight className="size-3" />
                </Button>
              ) : null}
              {selectedNode.canvasId && canvasById.get(selectedNode.canvasId) ? (
                <Button
                  size="sm"
                  className="h-8 rounded-md text-xs"
                  onClick={() => router.push(appRouteObject({ view: "canvas", id: selectedNode.canvasId as string }))}
                >
                  Open canvas <ArrowUpRight className="size-3" />
                </Button>
              ) : null}
              {!selectedNode.pageId && !selectedNode.canvasId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-md text-xs"
                  onClick={() => void removeNode(selectedNode)}
                >
                  <Trash2 className="size-3" /> Delete topic
                </Button>
              ) : null}
              <Button
                variant={focusDepth > 0 ? "default" : "outline"}
                size="sm"
                className="h-8 rounded-md text-xs"
                onClick={() => setFocusDepth((current) => (current > 0 ? 0 : 2))}
              >
                <Focus className="size-3" /> {focusDepth > 0 ? "Exit local view" : "Focus neighborhood"}
              </Button>
              {focusDepth > 0 ? (
                <select
                  value={focusDepth}
                  onChange={(event) => setFocusDepth(Number(event.target.value))}
                  className="h-8 rounded-md border border-border bg-background px-1.5 text-xs"
                >
                  <option value={1}>1 hop</option>
                  <option value={2}>2 hops</option>
                  <option value={3}>3 hops</option>
                </select>
              ) : null}
            </div>

            <div className="mt-4 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
              Relations
            </div>
            <div className="mt-1.5 space-y-1">
              {selectedEdges.map((edge) => {
                const outgoing = edge.sourceNodeId === selectedNode.id;
                const otherId = outgoing ? edge.targetNodeId : edge.sourceNodeId;
                const other = graph.nodes.find((node) => node.id === otherId);
                return (
                  <div key={edge.id} className="flex items-center gap-1 rounded-md border border-border/50 bg-card/40 px-2 py-1.5">
                    <span className="size-1.5 rounded-full" style={{ background: RELATION_META[edge.relationType as RelationType]?.color ?? "#8b8b7a" }} />
                    <button type="button" onClick={() => setSelectedId(otherId)} className="min-w-0 flex-1 truncate text-left text-xs">
                      {outgoing ? "" : "← "}{RELATION_META[edge.relationType as RelationType]?.label ?? edge.relationType}
                      {outgoing ? " → " : " "}
                      <span className="text-muted-foreground">{other?.title ?? "Unknown"}</span>
                    </button>
                    {edge.aiGenerated ? (
                      <Sparkles className="size-2.5 shrink-0 text-saffron/70" aria-label="AI suggested" />
                    ) : null}
                    <button
                      type="button"
                      aria-label="Remove relation"
                      onClick={async () => {
                        if (!db || !user || !activeWorkspaceId) return;
                        const { deleteEdgeLocal } = await import("@/lib/local/repository");
                        await deleteEdgeLocal(db, edge.id);
                      }}
                      className="text-muted-foreground/40 hover:text-destructive"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                );
              })}
              {!selectedEdges.length ? (
                <p className="text-xs text-muted-foreground">No relations yet.</p>
              ) : null}
            </div>

            <div className="mt-4 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
              Add a relation
            </div>
            <div className="mt-1.5 space-y-1.5">
              <select
                value={targetNode}
                onChange={(event) => setTargetNode(event.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-1.5 text-xs"
              >
                <option value="">Connect to…</option>
                {graph.nodes
                  .filter((node) => node.id !== selectedNode.id)
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.title}
                    </option>
                  ))}
              </select>
              <select
                value={relationType}
                onChange={(event) => setRelationType(event.target.value as RelationType)}
                className="h-8 w-full rounded-md border border-border bg-background px-1.5 text-xs"
              >
                {RELATIONS.map((relation) => (
                  <option key={relation} value={relation}>
                    {RELATION_META[relation].label}
                  </option>
                ))}
              </select>
              <Button size="sm" className="h-8 w-full rounded-md text-xs" disabled={!targetNode} onClick={() => void addRelation()}>
                <Link2 className="size-3" /> Add relation
              </Button>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
              AI suggestions
              <Sparkles className="size-3 text-saffron/60" />
            </div>
            <div className="mt-1.5 space-y-1">
              {suggestions
                .filter((entry) => entry.sourceNodeId === selectedNode.id || entry.targetNodeId === selectedNode.id)
                .slice(0, 4)
                .map((entry) => (
                  <div key={`${entry.sourceNodeId}-${entry.targetNodeId}`} className="rounded-md border border-saffron/20 bg-saffron/[0.04] px-2 py-1.5">
                    <div className="text-xs">
                      {entry.sourceNodeId === selectedNode.id ? entry.targetTitle : entry.sourceTitle}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{entry.reason} · {entry.score}</div>
                    <button
                      type="button"
                      onClick={() => void acceptSuggestion(entry.sourceNodeId, entry.targetNodeId)}
                      className="mt-1 text-xs text-primary hover:underline"
                    >
                      Add connection
                    </button>
                  </div>
                ))}
              {!suggestions.length ? (
                <p className="text-xs text-muted-foreground">
                  Use Suggest above to find missing connections from shared vocabulary.
                </p>
              ) : null}
            </div>
          </div>
        </aside>
      ) : null}

      {suggestions.length ? (
        <div className="absolute bottom-14 right-4 z-30 w-64 rounded-xl border border-border bg-popover p-2 shadow-xl">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Sparkles className="size-3 text-saffron" /> Suggested connections
            <button type="button" onClick={() => setSuggestions([])} className="ml-auto">
              <X className="size-3 text-muted-foreground" />
            </button>
          </div>
          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
            {suggestions.slice(0, 6).map((entry) => (
              <div key={`${entry.sourceNodeId}-${entry.targetNodeId}`} className="rounded border border-border/50 bg-background/50 px-2 py-1.5">
                <div className="text-xs leading-snug">
                  {entry.sourceTitle} ↔ {entry.targetTitle}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{entry.reason}</div>
                <button
                  type="button"
                  onClick={() => void acceptSuggestion(entry.sourceNodeId, entry.targetNodeId)}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {creatingTopic ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/25 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold">Create a topic</div>
              <button type="button" onClick={() => setCreatingTopic(false)} aria-label="Close">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Topics are first-class graph nodes that can connect pages, people, and resources.
            </p>
            <Input
              value={topicTitle}
              onChange={(event) => setTopicTitle(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void createTopic()}
              placeholder="e.g. Embodied cognition"
              className="mt-3 h-9 rounded-lg text-xs"
              autoFocus
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setCreatingTopic(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-8" onClick={() => void createTopic()}>
                Create topic
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
