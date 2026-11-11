import { Ionicons } from "@expo/vector-icons";
import {
  buildPageTree,
  type Page as DomainPage,
  type PageTreeNode,
} from "@notes-learning/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

type Notebook = Awaited<ReturnType<typeof client.notebook.list>>[number];
type Page = Awaited<ReturnType<typeof client.page.list>>[number];

const ICONS = ["◫", "📚", "📝", "💡", "🔬", "🧭", "🎯", "🧠", "🌱", "⚡", "🗂️", "📌"];

export default function NotebooksScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Notebook | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("◫");
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const notebooks = useQuery({
    queryKey: ["native-notebooks", workspace?.id],
    queryFn: async () => client.notebook.list(),
    enabled: Boolean(workspace),
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

  const pageByNotebook = useMemo(() => {
    const map = new Map<string, Page[]>();
    for (const page of pages.data ?? []) {
      if (!page.notebookId) continue;
      map.set(page.notebookId, [...(map.get(page.notebookId) ?? []), page]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return map;
  }, [pages.data]);

  const pageTreeByNotebook = useMemo(() => {
    const map = new Map<string, PageTreeNode[]>();
    for (const [notebookId, list] of pageByNotebook) {
      map.set(notebookId, buildPageTree(list as unknown as DomainPage[]));
    }
    return map;
  }, [pageByNotebook]);

  const canvasByNotebook = useMemo(() => {
    const map = new Map<string, typeof canvases.data>();
    for (const canvas of canvases.data ?? []) {
      if (!canvas.notebookId) continue;
      map.set(canvas.notebookId, [...(map.get(canvas.notebookId) ?? []), canvas]);
    }
    return map;
  }, [canvases.data]);

  const children = useMemo(() => {
    const map = new Map<string | null, Notebook[]>();
    for (const notebook of notebooks.data ?? []) {
      const key = notebook.parentId ?? null;
      map.set(key, [...(map.get(key) ?? []), notebook]);
    }
    return map;
  }, [notebooks.data]);

  const refresh = async () => {
    await Promise.all([notebooks.refetch(), pages.refetch(), canvases.refetch()]);
  };

  const openCreate = (parent: string | null = null) => {
    setEditing(null);
    setName("");
    setIcon("◫");
    setParentId(parent);
    setSheetOpen(true);
  };

  const openEdit = (notebook: Notebook) => {
    setEditing(notebook);
    setName(notebook.name);
    setIcon(notebook.icon ?? "◫");
    setParentId(notebook.parentId ?? null);
    setSheetOpen(true);
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await client.notebook.update({
          notebookId: editing.id,
          name: name.trim(),
          icon,
        });
      } else {
        await client.notebook.create({
          name: name.trim(),
          icon,
          parentId,
        });
      }
      setSheetOpen(false);
      await refresh();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save the notebook",
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = (notebook: Notebook) => {
    Alert.alert(
      `Delete “${notebook.name}”?`,
      "The notebook is removed. Pages inside stay in the workspace and can be moved later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await client.notebook.remove({ notebookId: notebook.id });
              await refresh();
            } catch (error) {
              toast.show({
                variant: "danger",
                label: error instanceof Error ? error.message : "Could not delete",
              });
            }
          },
        },
      ],
    );
  };

  const newPage = async (notebook: Notebook) => {
    try {
      const page = await client.page.create({
        notebookId: notebook.id,
        title: "Untitled",
        icon: "◇",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] }),
        queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] }),
      ]);
      router.push(route(`/page/${page.id}/edit`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the page",
      });
    }
  };

  const newSubPage = async (parent: {
    id: string;
    notebookId: string | null;
    visibility: string;
  }) => {
    try {
      const page = await client.page.create({
        parentId: parent.id,
        notebookId: parent.notebookId,
        visibility: parent.visibility === "PRIVATE" ? "PRIVATE" : "WORKSPACE",
        title: "Untitled",
        icon: "◇",
      });
      setExpanded((current) => new Set(current).add(parent.id));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] }),
        queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] }),
      ]);
      router.push(route(`/page/${page.id}/edit`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the sub-page",
      });
    }
  };

  const removePage = (page: { id: string; title: string }) => {
    Alert.alert(
      `Move “${page.title || "Untitled"}” to trash?`,
      "Its sub-pages move too. You can restore them from Trash.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to trash",
          style: "destructive",
          onPress: async () => {
            try {
              await client.page.remove({ pageId: page.id });
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] }),
                queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] }),
              ]);
            } catch (error) {
              toast.show({
                variant: "danger",
                label: error instanceof Error ? error.message : "Could not delete the page",
              });
            }
          },
        },
      ],
    );
  };

  const newCanvas = async (notebook: Notebook) => {
    try {
      const canvas = await client.canvas.create({
        notebookId: notebook.id,
        title: "Untitled canvas",
        templateId: "blank",
      });
      await queryClient.invalidateQueries({ queryKey: ["native-canvases", workspace?.id] });
      router.push(route(`/canvas/${canvas.id}`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the canvas",
      });
    }
  };

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderPage = (node: PageTreeNode, depth: number, index: number): ReactNode => {
    const page = node.page;
    const hasChildren = node.children.length > 0;
    const isOpen = depth === 0 || expanded.has(page.id);
    const showBorder = depth > 0 || index > 0;
    return (
      <View key={page.id}>
        <Pressable
          onPress={() => router.push(route(`/page/${page.id}`))}
          className={`flex-row items-center gap-2 py-2.5 pr-3 ${
            showBorder ? "border-t border-border" : ""
          }`}
          style={{ paddingLeft: 12 + depth * 14 }}
        >
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              toggle(page.id);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={isOpen ? `Collapse ${page.title}` : `Expand ${page.title}`}
            className="h-5 w-5 items-center justify-center"
            style={{ opacity: hasChildren ? 1 : 0 }}
          >
            <Ionicons
              name={isOpen ? "chevron-down" : "chevron-forward"}
              size={12}
              color={muted}
            />
          </Pressable>
          <Text className="w-5 text-center text-xs">{page.icon ?? "◇"}</Text>
          <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] text-foreground">
            {page.title || "Untitled"}
          </Text>
          <Text className="text-[9px] text-muted">
            {new Date(page.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </Text>
          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              Alert.alert(page.title || "Untitled", "Choose an action", [
                { text: "Cancel", style: "cancel" },
                { text: "New sub-page", onPress: () => void newSubPage(page) },
                { text: "Delete", style: "destructive", onPress: () => removePage(page) },
              ]);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${page.title || "Untitled"}`}
            className="h-7 w-7 items-center justify-center rounded-full"
          >
            <Ionicons name="ellipsis-horizontal" size={14} color={muted} />
          </Pressable>
        </Pressable>
        {hasChildren && isOpen
          ? node.children.map((child, childIndex) => renderPage(child, depth + 1, childIndex))
          : null}
      </View>
    );
  };

  const renderNotebook = (notebook: Notebook, depth: number) => {
    const notebookChildren = children.get(notebook.id) ?? [];
    const pagesIn = pageByNotebook.get(notebook.id) ?? [];
    const pageTree = pageTreeByNotebook.get(notebook.id) ?? [];
    const canvasesIn = canvasByNotebook.get(notebook.id) ?? [];
    const isOpen = expanded.has(notebook.id) || depth === 0;

    return (
      <View key={notebook.id} className="mt-3">
        <View className="flex-row items-center gap-2" style={{ paddingLeft: depth * 12 }}>
          <Pressable
            onPress={() => toggle(notebook.id)}
            accessibilityRole="button"
            accessibilityLabel={`Toggle ${notebook.name}`}
            hitSlop={8}
            className="h-6 w-6 items-center justify-center"
          >
            <Ionicons
              name={isOpen ? "chevron-down" : "chevron-forward"}
              size={13}
              color={muted}
            />
          </Pressable>
          <Text className="text-base">{notebook.icon ?? "◫"}</Text>
          <View className="min-w-0 flex-1">
            <Text className="text-[13px] font-semibold text-foreground">{notebook.name}</Text>
            <Text className="text-[9px] text-muted">
              {pagesIn.length} pages · {canvasesIn.length} canvases
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New page in ${notebook.name}`}
            hitSlop={8}
            onPress={() => void newPage(notebook)}
            className="h-7 w-7 items-center justify-center rounded-full border border-border"
          >
            <Ionicons name="add" size={15} color={muted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Notebook actions`}
            hitSlop={8}
            onPress={() =>
              Alert.alert(notebook.name, "Choose an action", [
                { text: "Cancel", style: "cancel" },
                { text: "New page", onPress: () => void newPage(notebook) },
                { text: "New canvas", onPress: () => void newCanvas(notebook) },
                { text: "New sub-notebook", onPress: () => openCreate(notebook.id) },
                { text: "Rename", onPress: () => openEdit(notebook) },
                { text: "Delete", style: "destructive", onPress: () => remove(notebook) },
              ])
            }
            className="h-7 w-7 items-center justify-center rounded-full"
          >
            <Ionicons name="ellipsis-horizontal" size={15} color={muted} />
          </Pressable>
        </View>

        {isOpen ? (
          <View
            className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface"
            style={{ marginLeft: depth * 12 }}
          >
            {pageTree.map((node, index) => renderPage(node, 0, index))}
            {canvasesIn.map((canvas) => (
              <Pressable
                key={canvas.id}
                onPress={() => router.push(route(`/canvas/${canvas.id}`))}
                className="flex-row items-center gap-2 border-t border-border px-3 py-2.5"
              >
                <Text className="w-5 text-center text-xs">{canvas.icon ?? "▦"}</Text>
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] text-indigo-700">
                  {canvas.title}
                </Text>
                <Text className="rounded-full border border-border px-1.5 py-0.5 text-[8px] uppercase text-muted">
                  canvas
                </Text>
              </Pressable>
            ))}
            {!pagesIn.length && !canvasesIn.length ? (
              <Pressable
                onPress={() => void newPage(notebook)}
                className="px-3 py-5"
              >
                <Text className="text-center text-[11px] text-muted">
                  Empty notebook · tap to add the first page
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {notebookChildren.map((child) => renderNotebook(child, depth + 1))}
      </View>
    );
  };

  const roots = children.get(null) ?? [];

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={notebooks.isFetching || pages.isFetching}
            tintColor={accent}
            onRefresh={() => void refresh()}
          />
        ),
      }}
    >
      <ScreenHeader
        title="Notebooks"
        subtitle={workspace?.name}
        large
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New notebook"
            onPress={() => openCreate(null)}
            className="h-9 w-9 items-center justify-center rounded-full bg-accent"
          >
            <Ionicons name="add" size={19} color="#1d1d1a" />
          </Pressable>
        }
      />
      <View className="px-5 pb-10">
        {notebooks.isLoading || pages.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : roots.length ? (
          roots.map((notebook) => renderNotebook(notebook, 0))
        ) : (
          <View className="mt-6 rounded-2xl border border-dashed border-border p-8">
            <Text className="text-center text-sm font-medium text-foreground">No notebooks yet</Text>
            <Text className="mt-1 text-center text-[11px] text-muted">
              Create a notebook to group pages and canvases.
            </Text>
            <Pressable
              onPress={() => openCreate(null)}
              className="mt-4 self-center rounded-xl bg-accent px-4 py-2"
            >
              <Text className="text-xs font-semibold text-neutral-900">Create notebook</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={editing ? "Rename notebook" : "New notebook"}
      >
        <View className="mt-2 gap-2">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Notebook name"
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] text-foreground"
            autoFocus
          />
          <View className="flex-row flex-wrap gap-1.5">
            {ICONS.map((value) => (
              <Pressable
                key={value}
                onPress={() => setIcon(value)}
                className={`h-10 w-10 items-center justify-center rounded-xl border ${
                  icon === value ? "border-accent bg-surface-secondary" : "border-border bg-surface"
                }`}
              >
                <Text className="text-base">{value}</Text>
              </Pressable>
            ))}
          </View>
          {editing ? null : (
            <Text className="text-[10px] text-muted">
              {parentId ? "Creates a nested notebook." : "Creates a top-level notebook."}
            </Text>
          )}
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">
              {saving ? "Saving…" : editing ? "Save" : "Create"}
            </Text>
          </Pressable>
        </View>
      </Sheet>
    </Container>
  );
}
