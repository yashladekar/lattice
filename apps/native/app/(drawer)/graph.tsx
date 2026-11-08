import { Ionicons } from "@expo/vector-icons";
import {
  connectedComponents,
  degreeMap,
  orphanNodes,
  RELATION_META,
  type KnowledgeEdge,
  type KnowledgeNode,
  type NodeKind,
  type RelationType,
} from "@notes-learning/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Input, Spinner, Switch, useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { useGraph, useNotebooks, usePages, useCanvases } from "@/hooks/use-workspace-data";
import {
  computeLayout,
  KIND_COLORS,
  KIND_GLYPHS,
  KIND_ORDER,
  RECENCY_OPTIONS,
} from "@/lib/graph-layout";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function GraphScreen() {
  const { workspace, role } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const graph = useGraph();
  const pages = usePages();
  const canvases = useCanvases();
  const notebooks = useNotebooks();

  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<NodeKind>>(new Set(KIND_ORDER));
  const [notebookFilter, setNotebookFilter] = useState("all");
  const [relationFilter, setRelationFilter] = useState<RelationType | "all">("all");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [recency, setRecency] = useState<"all" | "day" | "week" | "month" | "year">("all");
  const [clusterColors, setClusterColors] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkTargetOpen, setLinkTargetOpen] = useState(false);
  const [linkTargetQuery, setLinkTargetQuery] = useState("");
  const [relationType, setRelationType] = useState<RelationType>("RELATED_TO");
  const [createOpen, setCreateOpen] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{
      sourceNodeId: string;
      targetNodeId: string;
      sourceTitle: string;
      targetTitle: string;
      score: number;
      reason: string;
    }>
  >([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ cx: 0, cy: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const panStart = useRef(view);
  const pinchStart = useRef(view);
  const moved = useRef(0);
  const fitted = useRef(false);

  const pageById = useMemo(() => new Map((pages.data ?? []).map((page) => [page.id, page])), [pages.data]);
  const canvasById = useMemo(
    () => new Map((canvases.data ?? []).map((canvas) => [canvas.id, canvas])),
    [canvases.data],
  );

  const degree = useMemo(() => degreeMap(graph.data?.edges ?? []), [graph.data]);
  const orphans = useMemo(
    () => new Set(orphanNodes(graph.data?.nodes ?? [], graph.data?.edges ?? []).map((node) => node.id)),
    [graph.data],
  );
  const componentIndex = useMemo(() => {
    const components = connectedComponents(graph.data?.nodes ?? [], graph.data?.edges ?? []);
    const map = new Map<string, number>();
    components.forEach((component, index) => {
      for (const id of component) map.set(id, index);
    });
    return map;
  }, [graph.data]);

  const filteredNodes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cutoff =
      recency === "all"
        ? 0
        : Date.now() -
          (RECENCY_OPTIONS.find((option) => option.value === recency)?.days ?? 0) * 86_400_000;
    return (graph.data?.nodes ?? []).filter((node) => {
      if (!kinds.has(node.kind)) return false;
      if (needle && !node.title.toLowerCase().includes(needle)) return false;
      if (orphansOnly && !orphans.has(node.id)) return false;
      if (cutoff && new Date(node.updatedAt).getTime() < cutoff) return false;
      if (notebookFilter !== "all") {
        const notebookId = node.pageId
          ? pageById.get(node.pageId)?.notebookId
          : node.canvasId
            ? canvasById.get(node.canvasId)?.notebookId
            : null;
        if (notebookId !== notebookFilter) return false;
      }
      return true;
    });
  }, [
    canvasById,
    graph.data,
    kinds,
    notebookFilter,
    orphans,
    orphansOnly,
    pageById,
    query,
    recency,
  ]);

  const filteredEdges = useMemo(() => {
    const ids = new Set(filteredNodes.map((node) => node.id));
    return (graph.data?.edges ?? []).filter(
      (edge) =>
        ids.has(edge.sourceNodeId) &&
        ids.has(edge.targetNodeId) &&
        (relationFilter === "all" || edge.relationType === relationFilter),
    );
  }, [filteredNodes, graph.data, relationFilter]);

  const positions = useMemo(() => {
    const nodes = filteredNodes.slice(0, 350);
    const ids = new Set(nodes.map((node) => node.id));
    return computeLayout(
      nodes,
      filteredEdges.filter((edge) => ids.has(edge.sourceNodeId) && ids.has(edge.targetNodeId)),
    );
  }, [filteredEdges, filteredNodes]);

  const clusterColor = useCallback(
    (node: KnowledgeNode) => {
      if (!clusterColors) return KIND_COLORS[node.kind];
      const palette = ["#e07a2e", "#2f6b4f", "#3b82f6", "#8b5cf6", "#0891b2", "#dc2626"];
      return palette[(componentIndex.get(node.id) ?? 0) % palette.length] ?? KIND_COLORS[node.kind];
    },
    [clusterColors, componentIndex],
  );

  const nodeAt = useCallback(
    (worldX: number, worldY: number) => {
      let best: { node: KnowledgeNode; distance: number } | null = null;
      for (const node of filteredNodes) {
        const position = positions.get(node.id);
        if (!position) continue;
        const radius = 12 + Math.min(14, (degree.get(node.id) ?? 0) * 2);
        const distance = Math.hypot(position.x - worldX, position.y - worldY);
        if (distance <= radius + 8 / viewRef.current.zoom) {
          if (!best || distance < best.distance) best = { node, distance };
        }
      }
      return best?.node ?? null;
    },
    [degree, filteredNodes, positions],
  );

  const screenToWorld = useCallback((x: number, y: number) => {
    const current = viewRef.current;
    const currentSize = sizeRef.current;
    return {
      x: current.cx + (x - currentSize.width / 2) / current.zoom,
      y: current.cy + (y - currentSize.height / 2) / current.zoom,
    };
  }, []);

  const fit = useCallback(() => {
    const currentSize = sizeRef.current;
    if (!currentSize.width || !positions.size) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const position of positions.values()) {
      minX = Math.min(minX, position.x);
      minY = Math.min(minY, position.y);
      maxX = Math.max(maxX, position.x);
      maxY = Math.max(maxY, position.y);
    }
    const zoom = clamp(
      Math.min(
        (currentSize.width - 80) / Math.max(1, maxX - minX),
        (currentSize.height - 80) / Math.max(1, maxY - minY),
      ),
      0.12,
      2.5,
    );
    setView({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom });
  }, [positions]);

  const begin = useCallback(() => {
    panStart.current = viewRef.current;
    moved.current = 0;
  }, []);

  const move = useCallback((translationX: number, translationY: number) => {
    moved.current = Math.max(moved.current, Math.abs(translationX) + Math.abs(translationY));
    const zoom = panStart.current.zoom;
    setView({
      cx: panStart.current.cx - translationX / zoom,
      cy: panStart.current.cy - translationY / zoom,
      zoom,
    });
  }, []);

  const end = useCallback(
    (x: number, y: number) => {
      if (moved.current < 6) {
        const world = screenToWorld(x, y);
        const node = nodeAt(world.x, world.y);
        setSelectedId(node?.id ?? null);
      }
    },
    [nodeAt, screenToWorld],
  );

  const pinchBegin = useCallback(() => {
    pinchStart.current = viewRef.current;
  }, []);

  const pinchUpdate = useCallback((focalX: number, focalY: number, scaleFactor: number) => {
    const start = pinchStart.current;
    const currentSize = sizeRef.current;
    const zoom = clamp(start.zoom * scaleFactor, 0.1, 4);
    const worldX = start.cx + (focalX - currentSize.width / 2) / start.zoom;
    const worldY = start.cy + (focalY - currentSize.height / 2) / start.zoom;
    setView({
      cx: worldX - (focalX - currentSize.width / 2) / zoom,
      cy: worldY - (focalY - currentSize.height / 2) / zoom,
      zoom,
    });
  }, []);

  const pan = Gesture.Pan()
    .minDistance(0)
    .maxPointers(1)
    .onBegin(() => runOnJS(begin)())
    .onUpdate((event) => runOnJS(move)(event.translationX, event.translationY))
    .onFinalize((event) => runOnJS(end)(event.x, event.y));

  const pinch = Gesture.Pinch()
    .onStart(() => runOnJS(pinchBegin)())
    .onUpdate((event) => runOnJS(pinchUpdate)(event.focalX, event.focalY, event.scale));

  const gesture = Gesture.Simultaneous(pan, pinch);

  const node = useQuery({
    queryKey: ["native-graph-node", workspace?.id, selectedId],
    queryFn: async () => client.graph.node({ nodeId: selectedId ?? "" }),
    enabled: Boolean(workspace && selectedId),
  });

  const selectedNode = graph.data?.nodes.find((entry) => entry.id === selectedId) ?? null;

  const refreshGraph = async () => {
    await queryClient.invalidateQueries({ queryKey: ["native-graph", workspace?.id] });
    await queryClient.invalidateQueries({ queryKey: ["native-graph-node", workspace?.id] });
  };

  const createRelation = async (targetId: string) => {
    if (!selectedNode) return;
    try {
      await client.graph.upsertEdge({
        sourceNodeId: selectedNode.id,
        targetNodeId: targetId,
        relationType,
      });
      await refreshGraph();
      setLinkTargetOpen(false);
      setLinkTargetQuery("");
      toast.show({ variant: "success", label: "Relation created" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the relation",
      });
    }
  };

  const removeRelation = async (edgeId: string) => {
    try {
      await client.graph.removeEdge({ edgeId });
      await refreshGraph();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not remove the relation",
      });
    }
  };

  const createTopic = async () => {
    if (!newTopic.trim()) return;
    try {
      await client.graph.upsertNode({ kind: "TOPIC", title: newTopic.trim() });
      setNewTopic("");
      setCreateOpen(false);
      await refreshGraph();
      toast.show({ variant: "success", label: "Topic created" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the topic",
      });
    }
  };

  const loadSuggestions = async () => {
    setSuggestLoading(true);
    setSuggestionsOpen(true);
    try {
      const result = await client.graph.suggestions();
      setSuggestions(result);
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not load suggestions",
      });
    } finally {
      setSuggestLoading(false);
    }
  };

  const acceptSuggestion = async (entry: (typeof suggestions)[number]) => {
    try {
      await client.graph.upsertEdge({
        sourceNodeId: entry.sourceNodeId,
        targetNodeId: entry.targetNodeId,
        relationType: "RELATED_TO",
      });
      setSuggestions((current) =>
        current.filter(
          (item) =>
            !(
              item.sourceNodeId === entry.sourceNodeId &&
              item.targetNodeId === entry.targetNodeId
            ),
        ),
      );
      await refreshGraph();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not accept the suggestion",
      });
    }
  };

  useEffect(() => {
    if (!fitted.current && positions.size && size.width > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, positions, size.width]);

  const summary = graph.data?.summary;

  return (
    <Container isScrollable={false}>
      <ScreenHeader
        title="Graph"
        subtitle={
          summary
            ? `${summary.nodes} nodes · ${summary.edges} edges${summary.orphans ? ` · ${summary.orphans} orphans` : ""}`
            : "How your ideas connect"
        }
        large
        right={
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Filters"
              onPress={() => setFilterOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-full border border-border"
            >
              <Ionicons name="options-outline" size={17} color={muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create topic"
              onPress={() => setCreateOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-full bg-accent"
            >
              <Ionicons name="add" size={19} color="#1d1d1a" />
            </Pressable>
          </>
        }
      />

      <View className="flex-row gap-1.5 px-4 pb-2">
        <Pressable
          onPress={loadSuggestions}
          className="rounded-full border border-border bg-surface px-3 py-1"
        >
          <Text className="text-[10px] text-foreground">Suggest links</Text>
        </Pressable>
        <Pressable
          onPress={fit}
          className="rounded-full border border-border bg-surface px-3 py-1"
        >
          <Text className="text-[10px] text-foreground">Fit</Text>
        </Pressable>
        <Pressable
          onPress={() => setClusterColors((value) => !value)}
          className={`rounded-full border px-3 py-1 ${
            clusterColors ? "border-amber-500/50 bg-amber-100" : "border-border bg-surface"
          }`}
        >
          <Text className={`text-[10px] ${clusterColors ? "text-neutral-900" : "text-foreground"}`}>
            Clusters
          </Text>
        </Pressable>
        <Text className="ml-auto self-center text-[9px] text-muted">
          {Math.round(view.zoom * 100)}%
        </Text>
      </View>

      <View
        className="flex-1 overflow-hidden"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize({ width, height });
          sizeRef.current = { width, height };
          if (!fitted.current && positions.size) {
            fitted.current = true;
            setTimeout(fit, 0);
          }
        }}
      >
        {graph.isLoading ? (
          <View className="flex-1 items-center justify-center">
            <Spinner size="sm" color="default" />
          </View>
        ) : size.width > 0 ? (
          <GestureDetector gesture={gesture}>
            <View style={{ flex: 1 }}>
              <Svg width={size.width} height={size.height}>
                <G
                  transform={`translate(${size.width / 2} ${size.height / 2}) scale(${view.zoom}) translate(${-view.cx} ${-view.cy})`}
                >
                  {filteredEdges.map((edge) => {
                    const from = positions.get(edge.sourceNodeId);
                    const to = positions.get(edge.targetNodeId);
                    if (!from || !to) return null;
                    const color = RELATION_META[edge.relationType]?.color ?? "#8b8b7a";
                    const highlighted =
                      selectedId &&
                      (edge.sourceNodeId === selectedId || edge.targetNodeId === selectedId);
                    return (
                      <Line
                        key={edge.id}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke={color}
                        strokeWidth={(highlighted ? 2.2 : 1.1) / view.zoom}
                        opacity={highlighted ? 0.9 : 0.35}
                      />
                    );
                  })}

                  {filteredNodes.map((entry) => {
                    const position = positions.get(entry.id);
                    if (!position) return null;
                    const radius = 10 + Math.min(16, (degree.get(entry.id) ?? 0) * 2);
                    const selected = selectedId === entry.id;
                    const color = clusterColor(entry);
                    return (
                      <G key={entry.id} opacity={selectedId && !selected ? 0.55 : 1}>
                        {selected ? (
                          <Circle
                            cx={position.x}
                            cy={position.y}
                            r={radius + 6 / view.zoom}
                            fill="none"
                            stroke="#e07a2e"
                            strokeWidth={2 / view.zoom}
                          />
                        ) : null}
                        <Circle
                          cx={position.x}
                          cy={position.y}
                          r={radius}
                          fill={color}
                          opacity={0.9}
                        />
                        <SvgText
                          x={position.x}
                          y={position.y + 3.5}
                          fill="#ffffff"
                          fontSize={Math.min(13, radius)}
                          textAnchor="middle"
                          fontWeight="600"
                        >
                          {KIND_GLYPHS[entry.kind]}
                        </SvgText>
                        {view.zoom > 0.45 || selected ? (
                          <SvgText
                            x={position.x}
                            y={position.y + radius + 13 / view.zoom}
                            fill={selected ? "#25251f" : "#6b6b60"}
                            fontSize={10 / view.zoom}
                            textAnchor="middle"
                          >
                            {entry.title.length > 20
                              ? `${entry.title.slice(0, 19)}…`
                              : entry.title}
                          </SvgText>
                        ) : null}
                      </G>
                    );
                  })}
                </G>
              </Svg>
            </View>
          </GestureDetector>
        ) : null}

        <Text className="absolute bottom-3 left-4 right-4 text-center text-[9px] text-muted">
          Pinch to zoom · drag to pan · tap a node
        </Text>
      </View>

      <Sheet open={filterOpen} onOpenChange={setFilterOpen} title="Graph filters" snapPoints={["72%"]}>
        <View className="mt-2 gap-3">
          <Input value={query} onChangeText={setQuery} placeholder="Search node titles" />
          <View>
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Kinds
            </Text>
            <View className="flex-row flex-wrap gap-1">
              {KIND_ORDER.map((kind) => {
                const active = kinds.has(kind);
                return (
                  <Pressable
                    key={kind}
                    onPress={() =>
                      setKinds((current) => {
                        const next = new Set(current);
                        if (next.has(kind)) next.delete(kind);
                        else next.add(kind);
                        return next;
                      })
                    }
                    className={`rounded-full border px-2.5 py-1 ${
                      active ? "border-amber-500/50 bg-amber-100" : "border-border bg-surface"
                    }`}
                  >
                    <Text className={`text-[10px] ${active ? "text-neutral-900" : "text-muted"}`}>
                      {kind}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View>
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Notebook
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1">
                {[{ id: "all", name: "All" }, ...(notebooks.data ?? [])].map((notebook) => (
                  <Pressable
                    key={notebook.id}
                    onPress={() => setNotebookFilter(notebook.id)}
                    className={`rounded-full border px-2.5 py-1 ${
                      notebookFilter === notebook.id
                        ? "border-amber-500/50 bg-amber-100"
                        : "border-border bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-[10px] ${
                        notebookFilter === notebook.id ? "text-neutral-900" : "text-muted"
                      }`}
                    >
                      {notebook.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
          <View>
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Relation
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-1">
                {(["all", ...Object.keys(RELATION_META)] as Array<RelationType | "all">).map((relation) => (
                  <Pressable
                    key={relation}
                    onPress={() => setRelationFilter(relation)}
                    className={`rounded-full border px-2.5 py-1 ${
                      relationFilter === relation
                        ? "border-amber-500/50 bg-amber-100"
                        : "border-border bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-[10px] ${
                        relationFilter === relation ? "text-neutral-900" : "text-muted"
                      }`}
                    >
                      {relation === "all" ? "All" : RELATION_META[relation].label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
          <View>
            <Text className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Recency
            </Text>
            <View className="flex-row flex-wrap gap-1">
              {RECENCY_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => setRecency(option.value)}
                  className={`rounded-full border px-2.5 py-1 ${
                    recency === option.value
                      ? "border-amber-500/50 bg-amber-100"
                      : "border-border bg-surface"
                  }`}
                >
                  <Text
                    className={`text-[10px] ${
                      recency === option.value ? "text-neutral-900" : "text-muted"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View className="flex-row items-center justify-between rounded-xl border border-border bg-surface px-3 py-2">
            <Text className="text-[12px] text-foreground">Orphans only</Text>
            <Switch isSelected={orphansOnly} onSelectedChange={setOrphansOnly} />
          </View>
          <Pressable
            onPress={() => {
              setQuery("");
              setKinds(new Set(KIND_ORDER));
              setNotebookFilter("all");
              setRelationFilter("all");
              setRecency("all");
              setOrphansOnly(false);
              setFilterOpen(false);
            }}
            className="items-center rounded-xl border border-border py-2"
          >
            <Text className="text-[11px] text-foreground">Reset filters</Text>
          </Pressable>
        </View>
      </Sheet>

      <Sheet
        open={selectedNode !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
        title={selectedNode?.title ?? "Node"}
        snapPoints={["65%"]}
      >
        {selectedNode ? (
          <View className="mt-2 gap-3">
            <View className="flex-row items-center gap-2">
              <Text style={{ color: KIND_COLORS[selectedNode.kind] }} className="text-base">
                {KIND_GLYPHS[selectedNode.kind]}
              </Text>
              <Text className="text-[11px] uppercase tracking-widest text-muted">
                {selectedNode.kind}
              </Text>
              <Text className="ml-auto text-[10px] text-muted">
                {degree.get(selectedNode.id) ?? 0} links
              </Text>
            </View>
            {selectedNode.description ? (
              <Text className="text-[12px] leading-5 text-foreground/80">
                {selectedNode.description}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-1.5">
              {selectedNode.pageId ? (
                <Pressable
                  onPress={() => {
                    setSelectedId(null);
                    router.push(route(`/page/${selectedNode.pageId}`));
                  }}
                  className="rounded-xl bg-accent px-3 py-2"
                >
                  <Text className="text-[11px] font-semibold text-neutral-900">Open note</Text>
                </Pressable>
              ) : null}
              {selectedNode.canvasId ? (
                <Pressable
                  onPress={() => {
                    setSelectedId(null);
                    router.push(route(`/canvas/${selectedNode.canvasId}`));
                  }}
                  className="rounded-xl bg-accent px-3 py-2"
                >
                  <Text className="text-[11px] font-semibold text-neutral-900">Open canvas</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setLinkTargetOpen(true)}
                className="rounded-xl border border-border px-3 py-2"
              >
                <Text className="text-[11px] text-foreground">Link to…</Text>
              </Pressable>
            </View>

            <View>
              <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Relations
              </Text>
              <View className="mt-1 gap-1">
                {node.data?.outgoing?.length || node.data?.incoming?.length ? (
                  <>
                    {(node.data?.outgoing ?? []).map((edge) => (
                      <View
                        key={edge.id}
                        className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
                      >
                        <Text className="text-[10px] text-muted">→</Text>
                        <Text numberOfLines={1} className="min-w-0 flex-1 text-[11px] text-foreground">
                          {RELATION_META[edge.relationType as RelationType]?.label} ·{" "}
                          {graph.data?.nodes.find((entry) => entry.id === edge.targetNodeId)?.title ??
                            edge.targetNodeId}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove relation"
                          hitSlop={8}
                          onPress={() => void removeRelation(edge.id)}
                        >
                          <Ionicons name="close-circle-outline" size={15} color={muted} />
                        </Pressable>
                      </View>
                    ))}
                    {(node.data?.incoming ?? []).map((edge) => (
                      <View
                        key={edge.id}
                        className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
                      >
                        <Text className="text-[10px] text-muted">←</Text>
                        <Text numberOfLines={1} className="min-w-0 flex-1 text-[11px] text-foreground">
                          {RELATION_META[edge.relationType as RelationType]?.label} ·{" "}
                          {graph.data?.nodes.find((entry) => entry.id === edge.sourceNodeId)?.title ??
                            edge.sourceNodeId}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Remove relation"
                          hitSlop={8}
                          onPress={() => void removeRelation(edge.id)}
                        >
                          <Ionicons name="close-circle-outline" size={15} color={muted} />
                        </Pressable>
                      </View>
                    ))}
                  </>
                ) : (
                  <Text className="py-3 text-[11px] text-muted">
                    No relations yet. Link this node to another concept.
                  </Text>
                )}
              </View>
            </View>
          </View>
        ) : null}
      </Sheet>

      <Sheet open={createOpen} onOpenChange={setCreateOpen} title="New topic">
        <View className="mt-2 gap-2">
          <Input
            value={newTopic}
            onChangeText={setNewTopic}
            placeholder="Topic or concept"
            autoFocus
          />
          <Pressable
            onPress={() => void createTopic()}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Create node</Text>
          </Pressable>
        </View>
      </Sheet>

      <Sheet
        open={linkTargetOpen}
        onOpenChange={(open) => {
          setLinkTargetOpen(open);
          if (!open) setLinkTargetQuery("");
        }}
        title="Link to a node"
        snapPoints={["72%"]}
      >
        <View className="mt-2 gap-2">
          <Input
            value={linkTargetQuery}
            onChangeText={setLinkTargetQuery}
            placeholder="Search nodes"
          />
          <View className="flex-row flex-wrap gap-1">
            {(Object.keys(RELATION_META) as RelationType[]).map((relation) => (
              <Pressable
                key={relation}
                onPress={() => setRelationType(relation)}
                className={`rounded-full border px-2.5 py-1 ${
                  relationType === relation
                    ? "border-amber-500/50 bg-amber-100"
                    : "border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-[10px] ${
                    relationType === relation ? "text-neutral-900" : "text-muted"
                  }`}
                >
                  {RELATION_META[relation].label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="gap-1">
            {(graph.data?.nodes ?? [])
              .filter(
                (entry) =>
                  entry.id !== selectedId &&
                  (!linkTargetQuery.trim() ||
                    entry.title.toLowerCase().includes(linkTargetQuery.trim().toLowerCase())),
              )
              .slice(0, 40)
              .map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => void createRelation(entry.id)}
                  className="rounded-xl border border-border bg-surface px-3 py-2"
                >
                  <Text className="text-[12px] text-foreground">
                    {KIND_GLYPHS[entry.kind]} {entry.title}
                  </Text>
                </Pressable>
              ))}
          </View>
        </View>
      </Sheet>

      <Sheet
        open={suggestionsOpen}
        onOpenChange={setSuggestionsOpen}
        title="Suggested links"
        snapPoints={["60%"]}
      >
        {suggestLoading ? (
          <View className="py-10">
            <Spinner size="sm" color="default" />
          </View>
        ) : (
          <View className="mt-2 gap-1">
            {suggestions.length ? (
              suggestions.map((entry) => (
                <View
                  key={`${entry.sourceNodeId}-${entry.targetNodeId}`}
                  className="rounded-xl border border-border bg-surface px-3 py-2"
                >
                  <Text className="text-[11px] text-foreground">
                    {entry.sourceTitle} → {entry.targetTitle}
                  </Text>
                  <Text className="text-[9px] text-muted">
                    {entry.reason} · {Math.round(entry.score * 100)}%
                  </Text>
                  <Pressable
                    onPress={() => void acceptSuggestion(entry)}
                    className="mt-1 self-start rounded-lg bg-accent px-2 py-1"
                  >
                    <Text className="text-[10px] font-semibold text-neutral-900">Accept</Text>
                  </Pressable>
                </View>
              ))
            ) : (
              <Text className="py-6 text-center text-[11px] text-muted">
                No suggestions right now.
              </Text>
            )}
          </View>
        )}
      </Sheet>
      {role ? null : null}
    </Container>
  );
}
