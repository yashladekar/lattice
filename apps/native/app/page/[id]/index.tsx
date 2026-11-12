import { Ionicons } from "@expo/vector-icons";
import { descendantPageIds } from "@notes-learning/domain";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner, useThemeColor, useToast } from "heroui-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { NativeDocument } from "@/components/native-document";
import { Sheet } from "@/components/ui/sheet";
import { useWorkspace } from "@/contexts/workspace-context";
import { shareLink } from "@/lib/config";
import { copyText, shareUrl } from "@/lib/files";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

const AI_ACTIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: "summarize", label: "Summarize", hint: "Five concise bullets" },
  { key: "explain", label: "Explain", hint: "Teach it with an example" },
  { key: "examples", label: "More examples", hint: "Two concrete examples" },
  { key: "connections", label: "Connections", hint: "Related notes you have not linked" },
  { key: "flashcards", label: "Flashcards", hint: "Preview cards from this note" },
  { key: "mindmap", label: "Mind map", hint: "Outline this note" },
  { key: "compare", label: "Compare", hint: "Where related notes agree" },
  { key: "gaps", label: "Knowledge gaps", hint: "What to learn next" },
];

function relative(value: string | Date): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NativePageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pageId = String(id);
  const { workspace, role } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const [actionsOpen, setActionsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState<Record<string, unknown> | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");

  const page = useQuery({
    queryKey: ["native-page", workspace?.id, pageId],
    queryFn: async () => client.page.get({ pageId }),
    enabled: Boolean(workspace && pageId),
  });
  const comments = useQuery({
    queryKey: ["native-comments", workspace?.id, pageId],
    queryFn: async () => client.comment.list({ pageId }),
    enabled: Boolean(workspace && pageId),
  });
  const backlinks = useQuery({
    queryKey: ["native-backlinks", workspace?.id, pageId],
    queryFn: async () => client.page.backlinks({ pageId }),
    enabled: Boolean(workspace && pageId),
  });
  const pages = useQuery({
    queryKey: ["native-pages", workspace?.id],
    queryFn: async () => client.page.list(),
    enabled: Boolean(workspace && pageId),
  });
  const versions = useQuery({
    queryKey: ["native-versions", workspace?.id, pageId],
    queryFn: async () => client.page.versions({ pageId }),
    enabled: Boolean(workspace && pageId && versionsOpen),
  });

  const detail = page.data;
  const document = detail?.document?.content as never;
  const tags = detail?.tags ?? [];
  const childPages = useMemo(
    () =>
      (pages.data ?? [])
        .filter((entry) => entry.parentId === pageId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
    [pages.data, pageId],
  );
  const forbiddenMoveIds = useMemo(
    () => new Set([pageId, ...descendantPageIds(pageId, pages.data ?? [])]),
    [pageId, pages.data],
  );
  const moveTargets = useMemo(
    () =>
      (pages.data ?? [])
        .filter((entry) => !forbiddenMoveIds.has(entry.id))
        .filter((entry) => entry.title.toLowerCase().includes(moveQuery.trim().toLowerCase()))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 80),
    [pages.data, forbiddenMoveIds, moveQuery],
  );
  const siblings = useMemo(() => {
    if (!detail) return [];
    return (pages.data ?? [])
      .filter(
        (entry) =>
          entry.parentId === detail.parentId &&
          (detail.parentId !== null || entry.notebookId === detail.notebookId),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }, [pages.data, detail]);
  const siblingIndex = siblings.findIndex((entry) => entry.id === pageId);

  const revise = () => {
    void queryClient.invalidateQueries({ queryKey: ["native-page", workspace?.id, pageId] });
    void queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] });
    void queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] });
  };

  const saveVersion = async () => {
    try {
      await client.page.saveVersion({ pageId, note: "Snapshot from mobile" });
      toast.show({ variant: "success", label: "Version saved" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save a version",
      });
    }
  };

  const duplicate = async () => {
    try {
      const copy = await client.page.duplicate({ pageId });
      revise();
      toast.show({ variant: "success", label: "Duplicated" });
      router.push(route(`/page/${copy.id}`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not duplicate",
      });
    }
  };

  const newSubPage = async () => {
    try {
      const created = await client.page.create({
        parentId: pageId,
        notebookId: detail?.notebookId ?? null,
        visibility: detail?.visibility === "PRIVATE" ? "PRIVATE" : "WORKSPACE",
        title: "Untitled",
        icon: "◇",
      });
      revise();
      router.push(route(`/page/${created.id}/edit`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the sub-page",
      });
    }
  };

  const movePage = async (input: {
    parentId: string | null;
    notebookId: string | null;
    beforeId?: string;
    afterId?: string;
  }) => {
    try {
      await client.page.move({ pageId, ...input });
      revise();
      setMoveOpen(false);
      setMoveQuery("");
      toast.show({ variant: "success", label: "Page moved" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not move the page",
      });
    }
  };

  const moveTo = (target: { id: string; notebookId: string | null } | null) => {
    void movePage({
      parentId: target?.id ?? null,
      notebookId: target ? target.notebookId : (detail?.notebookId ?? null),
    });
  };

  const moveUp = () => {
    if (siblingIndex <= 0) return;
    const previous = siblings[siblingIndex - 1];
    if (!previous) return;
    void movePage({
      parentId: detail?.parentId ?? null,
      notebookId: detail?.notebookId ?? null,
      beforeId: previous.id,
    });
  };

  const moveDown = () => {
    if (siblingIndex < 0) return;
    const next = siblings[siblingIndex + 1];
    if (!next) return;
    void movePage({
      parentId: detail?.parentId ?? null,
      notebookId: detail?.notebookId ?? null,
      afterId: next.id,
    });
  };

  const createShareLink = async (includeSubPages: boolean) => {
    try {
      const created = await client.share.create({
        resourceType: "PAGE",
        resourceId: pageId,
        permission: "VIEW",
        includeSubPages,
      });
      const url = shareLink(created.token, "PAGE");
      await copyText(url);
      Alert.alert(
        "Read-only link copied",
        includeSubPages ? `${url}\n\nIncludes workspace and public sub-pages.` : url,
        [
          { text: "Close", style: "cancel" },
          { text: "Share…", onPress: () => void shareUrl(url, detail?.title ?? "Lattice page") },
        ],
      );
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create a share link",
      });
    }
  };

  const share = () => {
    Alert.alert("Share this note", "Choose what the read-only link can open.", [
      { text: "Page only", onPress: () => void createShareLink(false) },
      { text: "Include sub-pages", onPress: () => void createShareLink(true) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const remove = () => {
    Alert.alert(
      "Move this note to trash?",
      "You can restore it from Trash until retention clears it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Move to trash",
          style: "destructive",
          onPress: async () => {
            try {
              await client.page.remove({ pageId });
              revise();
              router.back();
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

  const addComment = async () => {
    if (!comment.trim()) return;
    setPosting(true);
    try {
      await client.comment.create({ pageId, body: comment.trim() });
      setComment("");
      await comments.refetch();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not post the comment",
      });
    } finally {
      setPosting(false);
    }
  };

  const runAi = async (action: string) => {
    setAiOpen(false);
    setAiBusy(true);
    setAiResult({ action });
    try {
      const result = await client.ai.pageAction({ pageId, action: action as never });
      setAiResult(result as Record<string, unknown>);
      if (action === "flashcards") {
        await queryClient.invalidateQueries({ queryKey: ["native-due"] });
      }
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "The assistant is unavailable",
      });
      setAiResult(null);
    } finally {
      setAiBusy(false);
    }
  };

  const generateCards = async () => {
    setGenerating(true);
    try {
      const result = await client.learning.generate({ pageId });
      toast.show({
        variant: "success",
        label: result.created ? `${result.created} cards added` : "No new cards found",
      });
      await queryClient.invalidateQueries({ queryKey: ["native-due"] });
      await queryClient.invalidateQueries({ queryKey: ["native-learning-stats"] });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not generate cards",
      });
    } finally {
      setGenerating(false);
    }
  };

  const aiContent = useMemo(() => {
    if (!aiResult) return null;
    const answer = typeof aiResult.answer === "string" ? aiResult.answer : "";
    const citations = Array.isArray(aiResult.citations)
      ? (aiResult.citations as Array<{ pageId: string; title: string; excerpt: string }>)
      : [];
    const suggestions = Array.isArray(aiResult.suggestions)
      ? (aiResult.suggestions as Array<{
          pageId: string;
          title: string;
          score: number;
          reason: string;
        }>)
      : [];
    const cards = Array.isArray(aiResult.cards)
      ? (aiResult.cards as Array<{ front: string; back: string }>)
      : [];
    const outline = Array.isArray(aiResult.outline)
      ? (aiResult.outline as Array<{ id: string; level: number; text: string }>)
      : [];
    const gaps = Array.isArray(aiResult.gaps)
      ? (aiResult.gaps as Array<{ id: string; title: string; kind: string; mastery: number }>)
      : [];
    return { answer, citations, suggestions, cards, outline, gaps };
  }, [aiResult]);

  return (
    <>
      <Stack.Screen
        options={{
          title: detail?.title ?? "Note",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          headerRight: () => (
            <View className="flex-row items-center gap-3">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit note"
                onPress={() => router.push(route(`/page/${pageId}/edit`))}
                hitSlop={12}
              >
                <Ionicons name="create-outline" size={20} color={accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Note actions"
                onPress={() => setActionsOpen(true)}
                hitSlop={12}
              >
                <Ionicons name="ellipsis-horizontal" size={20} color={muted} />
              </Pressable>
            </View>
          ),
        }}
      />
      {page.isLoading ? (
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner size="sm" color="default" />
          <Text className="mt-2 text-xs text-muted">Loading note…</Text>
        </View>
      ) : detail ? (
        <ScrollView
          className="flex-1 bg-background"
          contentContainerStyle={{ paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="px-5 py-5">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-2xl">{detail.icon ?? "◇"}</Text>
              <View className="rounded-full border border-border px-2 py-0.5">
                <Text className="text-[9px] uppercase tracking-wider text-muted">
                  {detail.type?.toLowerCase() ?? "document"}
                </Text>
              </View>
              {tags.map((tag) => (
                <View key={tag.id} className="rounded-full border border-border px-2 py-0.5">
                  <Text className="text-[9px] text-muted">{tag.name}</Text>
                </View>
              ))}
              {detail.visibility !== "WORKSPACE" ? (
                <View className="rounded-full border border-border px-2 py-0.5">
                  <Text className="text-[9px] uppercase text-muted">{detail.visibility}</Text>
                </View>
              ) : null}
            </View>

            <Text className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {detail.title}
            </Text>
            <Text className="mt-1 text-[10px] text-muted">
              Edited {new Date(detail.updatedAt).toLocaleString()} · rev {detail.document?.rev ?? 0}
            </Text>

            <View className="mt-5">
              <NativeDocument
                doc={document}
                onOpenPage={(target) => router.push(route(`/page/${target}`))}
              />
            </View>

            <View className="mt-7 flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => router.push(route(`/page/${pageId}/edit`))}
                className="flex-row items-center gap-1.5 rounded-xl bg-accent px-3 py-2"
              >
                <Ionicons name="create-outline" size={14} color="#1d1d1a" />
                <Text className="text-[11px] font-semibold text-neutral-900">Edit note</Text>
              </Pressable>
              <Pressable
                onPress={() => void generateCards()}
                disabled={generating}
                className="flex-row items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <Ionicons name="school-outline" size={14} color={accent} />
                <Text className="text-[11px] text-foreground">
                  {generating ? "Generating…" : "Generate cards"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setAiOpen(true)}
                className="flex-row items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2"
              >
                <Ionicons name="sparkles-outline" size={14} color={accent} />
                <Text className="text-[11px] text-foreground">Ask about this</Text>
              </Pressable>
            </View>

            <View className="mt-8">
              <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Sub-pages {childPages.length ? `· ${childPages.length}` : ""}
              </Text>
              <View className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
                {childPages.map((child, index) => (
                  <Pressable
                    key={child.id}
                    onPress={() => router.push(route(`/page/${child.id}`))}
                    className={`flex-row items-center gap-2 px-3 py-2.5 ${
                      index > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <Text className="text-sm">{child.icon ?? "◇"}</Text>
                    <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] text-foreground">
                      {child.title || "Untitled"}
                    </Text>
                    <Text className="text-[9px] text-muted">{relative(child.updatedAt)}</Text>
                    <Ionicons name="chevron-forward" size={12} color={muted} />
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => void newSubPage()}
                  className="flex-row items-center gap-2 border-t border-border px-3 py-2.5"
                >
                  <Ionicons name="add" size={15} color={accent} />
                  <Text className="text-[12px] text-foreground">Add a sub-page</Text>
                </Pressable>
              </View>
            </View>

            {backlinks.data?.length ? (
              <View className="mt-8">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Linked from {backlinks.data.length}
                </Text>
                <View className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
                  {backlinks.data.map((entry, index) => (
                    <Pressable
                      key={entry.id}
                      onPress={() => router.push(route(`/page/${entry.id}`))}
                      className={`flex-row items-center gap-2 px-3 py-2.5 ${
                        index > 0 ? "border-t border-border" : ""
                      }`}
                    >
                      <Text className="text-sm">{entry.icon ?? "◇"}</Text>
                      <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] text-foreground">
                        {entry.title}
                      </Text>
                      <Text className="text-[9px] text-muted">{relative(entry.updatedAt)}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View className="mt-8">
              <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                Discussion {comments.data?.length ? `· ${comments.data.length}` : ""}
              </Text>
              <View className="mt-2 gap-2">
                {comments.data?.map((thread) => (
                  <View
                    key={thread.id}
                    className="rounded-2xl border border-border bg-surface p-3"
                  >
                    <View className="flex-row items-center gap-2">
                      <Text className="min-w-0 flex-1 text-[11px] font-medium text-foreground">
                        {thread.author.name}
                      </Text>
                      <Text className="text-[9px] text-muted">{relative(thread.createdAt)}</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Resolve comment"
                        hitSlop={8}
                        onPress={() =>
                          void client.comment
                            .resolve({ commentId: thread.id, resolved: true })
                            .then(() => comments.refetch())
                        }
                      >
                        <Ionicons name="checkmark-circle-outline" size={15} color={muted} />
                      </Pressable>
                    </View>
                    <Text className="mt-1 text-[12px] leading-5 text-foreground/85">
                      {thread.body}
                    </Text>
                    {(thread.replies as Array<{
                      id: string;
                      body: string;
                      author: { name: string };
                    }>).map((reply) => (
                      <View key={reply.id} className="mt-2 border-l border-border pl-2">
                        <Text className="text-[10px] font-medium text-foreground">
                          {reply.author.name}
                        </Text>
                        <Text className="mt-0.5 text-[11px] leading-5 text-foreground/80">
                          {reply.body}
                        </Text>
                      </View>
                    ))}
                  </View>
                ))}
                <View className="flex-row items-end gap-2">
                  <TextInput
                    value={comment}
                    onChangeText={setComment}
                    placeholder="Add a comment…"
                    placeholderTextColor={muted}
                    multiline
                    className="min-h-10 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-[12px] text-foreground"
                  />
                  <Pressable
                    onPress={() => void addComment()}
                    disabled={posting || !comment.trim()}
                    className="h-10 items-center justify-center rounded-xl bg-accent px-3"
                  >
                    <Ionicons name="arrow-up" size={16} color="#1d1d1a" />
                  </Pressable>
                </View>
              </View>
            </View>

            <Text className="mt-8 text-center text-[9px] text-muted">
              Shared knowledge · {workspace?.name} · {role}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="document-outline" size={30} color={muted} />
          <Text className="mt-3 text-sm font-medium text-foreground">Note unavailable</Text>
          <Text className="mt-1 text-center text-[11px] text-muted">
            It may be private, deleted, or not synced to this device.
          </Text>
        </View>
      )}

      <Sheet open={actionsOpen} onOpenChange={setActionsOpen} title="Note actions">
        <View className="mt-2 gap-1">
          {[
            { label: "Edit", onPress: () => router.push(route(`/page/${pageId}/edit`)) },
            { label: "New sub-page", onPress: () => void newSubPage() },
            { label: "Move up", onPress: moveUp },
            { label: "Move down", onPress: moveDown },
            { label: "Move to…", onPress: () => setMoveOpen(true) },
            { label: "Save a version", onPress: () => void saveVersion() },
            { label: "Version history", onPress: () => setVersionsOpen(true) },
            { label: "Share read-only link", onPress: () => void share() },
            { label: "Duplicate", onPress: () => void duplicate() },
            { label: "Delete", onPress: remove, destructive: true },
          ].map((action) => (
            <Pressable
              key={action.label}
              onPress={() => {
                setActionsOpen(false);
                action.onPress();
              }}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text
                className={`text-[13px] ${
                  action.destructive ? "text-rose-600" : "text-foreground"
                }`}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet open={moveOpen} onOpenChange={setMoveOpen} title="Move page" snapPoints={["85%"]}>
        <View className="mt-2 gap-2">
          <TextInput
            value={moveQuery}
            onChangeText={setMoveQuery}
            placeholder="Find a parent page…"
            placeholderTextColor={muted}
            className="h-10 rounded-xl border border-border bg-surface px-3 text-[12px] text-foreground"
          />
          <Pressable
            onPress={() => moveTo(null)}
            className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
          >
            <Ionicons name="arrow-up-circle-outline" size={16} color={accent} />
            <Text className="text-[13px] text-foreground">No parent (top level)</Text>
          </Pressable>
          {moveTargets.map((target) => (
            <Pressable
              key={target.id}
              onPress={() => moveTo(target)}
              className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="w-5 text-center text-sm">{target.icon ?? "◇"}</Text>
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] text-foreground">
                {target.title || "Untitled"}
              </Text>
              <Text className="text-[9px] text-muted">Page</Text>
            </Pressable>
          ))}
          {!moveTargets.length ? (
            <Text className="py-6 text-center text-[11px] text-muted">No other pages match.</Text>
          ) : null}
        </View>
      </Sheet>

      <Sheet
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        title="Version history"
        snapPoints={["70%"]}
      >
        <View className="mt-2 gap-1">
          {versions.isLoading ? (
            <Spinner size="sm" color="default" />
          ) : versions.data?.length ? (
            versions.data.map((version) => (
              <Pressable
                key={version.id}
                onPress={() =>
                  Alert.alert(
                    `Restore version ${version.version}?`,
                    "The current content is saved as a version first.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Restore",
                        onPress: () =>
                          void client.page
                            .restoreVersion({ pageId, versionId: version.id })
                            .then(() => {
                              setVersionsOpen(false);
                              revise();
                            }),
                      },
                    ],
                  )
                }
                className="rounded-xl border border-border bg-surface px-3 py-2.5"
              >
                <View className="flex-row items-center justify-between">
                  <Text className="text-[12px] font-medium text-foreground">
                    v{version.version} · {version.title}
                  </Text>
                  <Text className="text-[9px] text-muted">{relative(version.createdAt)}</Text>
                </View>
                {version.note ? (
                  <Text className="mt-0.5 text-[10px] text-muted">{version.note}</Text>
                ) : null}
              </Pressable>
            ))
          ) : (
            <Text className="py-6 text-center text-[11px] text-muted">
              No saved versions yet. Save one from the actions menu.
            </Text>
          )}
        </View>
      </Sheet>

      <Sheet open={aiOpen} onOpenChange={setAiOpen} title="Ask about this note">
        <View className="mt-2 gap-1">
          {AI_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              onPress={() => void runAi(action.key)}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-[13px] font-medium text-foreground">{action.label}</Text>
              <Text className="text-[10px] text-muted">{action.hint}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet
        open={aiResult !== null}
        onOpenChange={(open) => {
          if (!open) setAiResult(null);
        }}
        title="Assistant"
        snapPoints={["75%"]}
      >
        {aiBusy ? (
          <View className="py-10">
            <Spinner size="sm" color="default" />
            <Text className="mt-2 text-center text-[11px] text-muted">Thinking…</Text>
          </View>
        ) : aiContent ? (
          <View className="mt-2 gap-3">
            {aiContent.answer ? (
              <Text className="text-[13px] leading-6 text-foreground">{aiContent.answer}</Text>
            ) : null}
            {aiContent.cards.length ? (
              <View className="gap-1">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Card preview
                </Text>
                {aiContent.cards.slice(0, 8).map((card, index) => (
                  <View key={index} className="rounded-xl border border-border bg-surface p-2.5">
                    <Text className="text-[11px] font-medium text-foreground">{card.front}</Text>
                    <Text className="mt-0.5 text-[10px] text-muted">{card.back}</Text>
                  </View>
                ))}
                <Pressable
                  onPress={() => void generateCards()}
                  className="mt-1 items-center rounded-xl bg-accent py-2"
                >
                  <Text className="text-[11px] font-semibold text-neutral-900">
                    Add these to Daily review
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {aiContent.suggestions.length ? (
              <View className="gap-1">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Suggested connections
                </Text>
                {aiContent.suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.pageId}
                    onPress={() => router.push(route(`/page/${suggestion.pageId}`))}
                    className="rounded-xl border border-border bg-surface p-2.5"
                  >
                    <Text className="text-[12px] text-foreground">{suggestion.title}</Text>
                    <Text className="text-[9px] text-muted">
                      {suggestion.reason} · {Math.round(suggestion.score * 100)}%
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {aiContent.outline.length ? (
              <View className="gap-0.5">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Outline
                </Text>
                {aiContent.outline.map((item) => (
                  <Text
                    key={item.id}
                    className="text-[11px] text-foreground/80"
                    style={{ paddingLeft: Math.min(24, item.level * 8) }}
                  >
                    · {item.text}
                  </Text>
                ))}
                <Text className="mt-1 text-[10px] text-muted">
                  Generate a mind map from this outline on the Canvases screen.
                </Text>
              </View>
            ) : null}
            {aiContent.gaps.length ? (
              <View className="gap-1">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Knowledge gaps
                </Text>
                {aiContent.gaps.slice(0, 8).map((gap) => (
                  <Text key={gap.id} className="text-[11px] text-foreground/80">
                    · {gap.title} ({gap.kind.toLowerCase()}, {Math.round(gap.mastery * 100)}%)
                  </Text>
                ))}
              </View>
            ) : null}
            {aiContent.citations.length ? (
              <View className="gap-1">
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Citations
                </Text>
                {aiContent.citations.map((citation) => (
                  <Pressable
                    key={citation.pageId}
                    onPress={() => router.push(route(`/page/${citation.pageId}`))}
                    className="rounded-xl border border-border bg-surface p-2.5"
                  >
                    <Text className="text-[11px] font-medium text-foreground">
                      {citation.title}
                    </Text>
                    <Text numberOfLines={2} className="mt-0.5 text-[10px] text-muted">
                      {citation.excerpt}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
    </>
  );
}
