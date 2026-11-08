import { Ionicons } from "@expo/vector-icons";
import {
  extractPlainText,
  safeDoc,
  type TipTapDoc,
} from "@notes-learning/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useToast } from "heroui-native";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";

import { BlockRow, type EditorSelection } from "@/components/editor/block-row";
import { BlockToolbar } from "@/components/editor/block-toolbar";
import { PageLinkPicker } from "@/components/editor/page-link-picker";
import { Sheet } from "@/components/ui/sheet";
import { useWorkspace } from "@/contexts/workspace-context";
import { pickImage } from "@/lib/files";
import {
  blocksToDoc,
  docToBlocks,
  duplicateBlock,
  emptyBlock,
  type EditorBlock,
  type EditorBlockKind,
} from "@/lib/editor-blocks";
import { enqueue, isTransient, savePageDocument } from "@/lib/outbox";
import { route } from "@/lib/navigation";
import { uploadFile } from "@/lib/upload";
import { client } from "@/utils/orpc";

const ICONS = ["◇", "✦", "📝", "📚", "💡", "🔬", "🧭", "🎯", "🧠", "🌱", "⚡", "🗂️", "📌", "🔗", "🧩", "🗺️"];

const INSERT_OPTIONS: Array<{ kind: EditorBlockKind; label: string; hint?: string }> = [
  { kind: "paragraph", label: "Text" },
  { kind: "heading", label: "Heading 1", hint: "level 1" },
  { kind: "heading", label: "Heading 2", hint: "level 2" },
  { kind: "heading", label: "Heading 3", hint: "level 3" },
  { kind: "bulletList", label: "Bulleted list" },
  { kind: "orderedList", label: "Numbered list" },
  { kind: "taskList", label: "Checklist" },
  { kind: "blockquote", label: "Quote" },
  { kind: "callout", label: "Callout" },
  { kind: "details", label: "Toggle" },
  { kind: "codeBlock", label: "Code block" },
  { kind: "horizontalRule", label: "Divider" },
  { kind: "image", label: "Image" },
  { kind: "pageEmbed", label: "Embed page" },
  { kind: "liveBlock", label: "Synced block" },
  { kind: "bookmark", label: "Bookmark" },
  { kind: "youtube", label: "YouTube" },
  { kind: "diagram", label: "Diagram" },
  { kind: "mathBlock", label: "Equation" },
  { kind: "table", label: "Table" },
];

function withLevel(kind: EditorBlockKind, label: string): EditorBlock {
  const block = emptyBlock(kind);
  const match = /Heading (\d)/.exec(label);
  if (match) block.level = Number(match[1]);
  return block;
}

export function BlockEditor({
  pageId,
  initialTitle,
  initialIcon,
  initialDoc,
  initialRev,
  onBack,
  onSaved,
}: {
  pageId: string;
  initialTitle: string;
  initialIcon: string | null;
  initialDoc: unknown;
  initialRev: number;
  onBack: () => void;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { workspace } = useWorkspace();
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState(initialIcon ?? "◇");
  const [blocks, setBlocks] = useState<EditorBlock[]>(() =>
    docToBlocks(safeDoc(initialDoc) as TipTapDoc),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<(EditorSelection & { blockId: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [queued, setQueued] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "insert" | "turn" | "menu" | "icon">(null);
  const [pagePicker, setPagePicker] = useState(false);
  const [urlSheet, setUrlSheet] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const [uploading, setUploading] = useState(false);

  const revRef = useRef(initialRev);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const titleRef = useRef(title);
  const iconRef = useRef(icon);
  const blocksRef = useRef(blocks);

  titleRef.current = title;
  iconRef.current = icon;
  blocksRef.current = blocks;
  dirtyRef.current = dirty;

  const activeBlock = useMemo(
    () => blocks.find((block) => block.id === activeId) ?? null,
    [blocks, activeId],
  );

  const markDirty = useCallback(() => {
    setDirty(true);
    dirtyRef.current = true;
  }, []);

  const updateBlock = useCallback(
    (id: string, next: EditorBlock) => {
      setBlocks((current) => current.map((block) => (block.id === id ? next : block)));
      markDirty();
    },
    [markDirty],
  );

  const insertAfter = useCallback(
    (id: string | null, block: EditorBlock) => {
      setBlocks((current) => {
        const index = id ? current.findIndex((entry) => entry.id === id) : current.length - 1;
        const next = [...current];
        next.splice(index + 1, 0, block);
        return next;
      });
      setActiveId(block.id);
      markDirty();
    },
    [markDirty],
  );

  const removeBlock = useCallback(
    (id: string) => {
      setBlocks((current) => {
        const remaining = current.filter((block) => block.id !== id);
        return remaining.length ? remaining : [emptyBlock()];
      });
      setActiveId((current) => (current === id ? null : current));
      markDirty();
    },
    [markDirty],
  );

  const moveBlock = useCallback(
    (id: string, direction: -1 | 1) => {
      setBlocks((current) => {
        const index = current.findIndex((block) => block.id === id);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= current.length) return current;
        const next = [...current];
        const [block] = next.splice(index, 1);
        if (block) next.splice(target, 0, block);
        return next;
      });
      markDirty();
    },
    [markDirty],
  );

  const save = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const doc = blocksToDoc(blocksRef.current);
      const result = await savePageDocument({
        pageId,
        baseRev: revRef.current,
        content: doc as unknown as Record<string, unknown>,
        plainText: extractPlainText(doc),
      });
      if (result.conflict) {
        Alert.alert(
          "This note changed elsewhere",
          "Another device saved a newer version while you were editing. Reload the newer version, or keep your text and replace it.",
          [
            {
              text: "Reload",
              onPress: () => {
                void queryClient.invalidateQueries({
                  queryKey: ["native-page", workspace?.id, pageId],
                });
                onSaved?.();
                onBack();
              },
            },
            { text: "Keep mine", style: "cancel" },
            {
              text: "Overwrite",
              style: "destructive",
              onPress: () => {
                void (async () => {
                  const fresh = await client.page.get({ pageId });
                  revRef.current = fresh.document?.rev ?? revRef.current;
                  await save();
                })();
              },
            },
          ],
        );
        setSaving(false);
        savingRef.current = false;
        return;
      }
      revRef.current = result.rev;
      setQueued(result.queued);
      setDirty(false);
      dirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      await queryClient.invalidateQueries({ queryKey: ["native-page", workspace?.id, pageId] });
      await queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] });
      onSaved?.();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save the note",
      });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }, [onBack, onSaved, pageId, queryClient, toast, workspace?.id]);

  const saveRef = useRef(save);
  saveRef.current = save;

  const saveMeta = useCallback(
    async (patch: { title?: string; icon?: string }) => {
      try {
        await client.page.update({ pageId, ...patch } as never);
      } catch (error) {
        if (!isTransient(error)) throw error;
        await enqueue({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          kind: "pageUpdate",
          pageId,
          patch,
          createdAt: new Date().toISOString(),
        });
        setQueued(true);
      }
    },
    [pageId],
  );

  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void (async () => {
        await save();
        await saveMeta({ title: titleRef.current, icon: iconRef.current });
      })();
    }, 1600);
    return () => clearTimeout(timer);
  }, [dirty, blocks, title, icon, save, saveMeta]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) void saveRef.current();
    };
  }, []);

  const applySelection = useCallback(
    (blockId: string, next: EditorSelection) => {
      setSelection({ blockId, ...next });
      setActiveId(blockId);
    },
    [],
  );

  const format = useCallback(
    (kind: string) => {
      const block = activeBlock;
      if (!block) return;
      if (block.kind === "bulletList" || block.kind === "orderedList" || block.kind === "taskList") {
        toast.show({ variant: "default", label: "Formatting applies to text blocks" });
        return;
      }
      const text = block.text;
      const range =
        selection && selection.blockId === block.id
          ? { start: selection.start, end: selection.end }
          : { start: text.length, end: text.length };

      const markers: Record<string, [string, string]> = {
        bold: ["**", "**"],
        italic: ["*", "*"],
        strike: ["~~", "~~"],
        code: ["`", "`"],
        link: ["[", "](https://)"],
      };
      if (kind === "link") {
        const selected = text.slice(range.start, range.end);
        if (!selected) {
          setLinkUrl("https://");
          setUrlSheet(true);
          return;
        }
        const linked =
          text.slice(0, range.start) + `[${selected}](https://)` + text.slice(range.end);
        updateBlock(block.id, { ...block, text: linked });
        const cursor = range.start + selected.length + 4;
        applySelection(block.id, { start: cursor, end: cursor });
        return;
      }
      const pair = markers[kind];
      if (!pair) return;
      const [open, close] = pair;
      const next =
        text.slice(0, range.start) +
        open +
        text.slice(range.start, range.end) +
        close +
        text.slice(range.end);
      updateBlock(block.id, { ...block, text: next });
      const cursor =
        range.start === range.end ? range.start + open.length : range.end + open.length + close.length;
      applySelection(block.id, { start: cursor, end: cursor });
    },
    [activeBlock, applySelection, selection, toast, updateBlock],
  );

  const insertOption = useCallback(
    (option: { kind: EditorBlockKind; label: string }) => {
      setSheet(null);
      if (option.kind === "image") {
        void (async () => {
          try {
            const file = await pickImage();
            if (!file) return;
            setUploading(true);
            const uploaded = await uploadFile(file);
            const block = emptyBlock("image");
            block.text = uploaded.url;
            block.attrs = { alt: file.name };
            insertAfter(activeId, block);
          } catch (error) {
            toast.show({
              variant: "danger",
              label: error instanceof Error ? error.message : "Could not add the image",
            });
          } finally {
            setUploading(false);
          }
        })();
        return;
      }
      if (option.kind === "pageEmbed" || option.kind === "liveBlock") {
        setPagePicker(true);
        return;
      }
      insertAfter(activeId, withLevel(option.kind, option.label));
    },
    [activeId, insertAfter, toast],
  );

  const turnInto = useCallback(
    (kind: EditorBlockKind) => {
      if (!activeBlock) return;
      setSheet(null);
      const text = activeBlock.text;
      const next: EditorBlock = { ...activeBlock, kind };
      if (kind === "bulletList" || kind === "orderedList" || kind === "taskList") {
        const lines = text.split("\n").filter((line) => line.trim());
        next.items = (lines.length ? lines : [""]).map((line, index) => ({
          id: `${activeBlock.id}-item-${index}`,
          text: line,
        }));
        next.text = "";
      } else if (kind === "paragraph" && activeBlock.items?.length) {
        next.text = activeBlock.items.map((item) => item.text).join("\n");
        next.items = undefined;
      }
      updateBlock(activeBlock.id, next);
    },
    [activeBlock, updateBlock],
  );

  const status = saving
    ? "Saving…"
    : queued
      ? "Queued offline"
      : dirty
        ? "Unsaved changes"
        : savedAt
          ? `Saved ${savedAt}`
          : "All changes saved";

  return (
    <View className="flex-1 bg-background">
      <View className="border-b border-border px-4 pt-2 pb-2">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => {
              void save();
              onBack();
            }}
            className="-ml-2 h-9 w-9 items-center justify-center rounded-full"
          >
            <Ionicons name="chevron-back" size={22} color="#8b8b7a" />
          </Pressable>
          <Text className="min-w-0 flex-1 text-[10px] text-muted" numberOfLines={1}>
            {status}
          </Text>
          {uploading ? (
            <Text className="text-[10px] text-muted">Uploading…</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save note"
            onPress={() => void save()}
            className="rounded-lg bg-accent px-3 py-1.5"
          >
            <Text className="text-[11px] font-semibold text-neutral-900">Save</Text>
          </Pressable>
        </View>

        <View className="mt-2 flex-row items-start gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change note icon"
            onPress={() => setSheet("icon")}
            className="mt-1 h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface"
          >
            <Text className="text-lg">{icon}</Text>
          </Pressable>
          <TextInput
            value={title}
            onChangeText={(value) => {
              setTitle(value);
              markDirty();
            }}
            placeholder="Untitled"
            className="min-w-0 flex-1 text-2xl font-semibold tracking-tight text-foreground"
            multiline
          />
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {blocks.map((block, index) => (
          <View key={block.id} className="mb-1">
            <BlockRow
              block={block}
              active={activeId === block.id}
              selection={
                selection && selection.blockId === block.id
                  ? { start: selection.start, end: selection.end }
                  : null
              }
              onChange={(next) => {
                if (next.text === "/" && next.kind === "paragraph") {
                  updateBlock(block.id, { ...next, text: "" });
                  setSheet("insert");
                  return;
                }
                updateBlock(block.id, next);
              }}
              onFocus={(next) => applySelection(block.id, next)}
              onSelectionChange={(next) => applySelection(block.id, next)}
              onEnter={() => insertAfter(block.id, emptyBlock("paragraph"))}
              onBackspaceAtStart={() => {
                if (index === 0) return;
                const previous = blocks[index - 1];
                if (!previous) return;
                if (!block.text && block.kind === "paragraph") {
                  removeBlock(block.id);
                  setActiveId(previous.id);
                }
              }}
              onOpenMenu={() => {
                setActiveId(block.id);
                setSheet("menu");
              }}
              onOpenPage={(id) => router.push(route(`/page/${id}`))}
              onPickImage={() => {
                setActiveId(block.id);
                void (async () => {
                  try {
                    const file = await pickImage();
                    if (!file) return;
                    setUploading(true);
                    const uploaded = await uploadFile(file);
                    updateBlock(block.id, { ...block, text: uploaded.url });
                  } catch (error) {
                    toast.show({
                      variant: "danger",
                      label: error instanceof Error ? error.message : "Upload failed",
                    });
                  } finally {
                    setUploading(false);
                  }
                })();
              }}
            />
            {activeId === block.id && block.kind !== "horizontalRule" ? (
              <View className="ml-7 mt-1 flex-row items-center gap-3">
                <Pressable
                  onPress={() => insertAfter(block.id, emptyBlock("paragraph"))}
                  hitSlop={8}
                >
                  <Text className="text-[10px] text-muted">+ Add block</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}

        <Pressable
          onPress={() => insertAfter(blocks[blocks.length - 1]?.id ?? null, emptyBlock("paragraph"))}
          className="mt-4 flex-row items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5"
        >
          <Ionicons name="add" size={15} color="#8b8b7a" />
          <Text className="text-[11px] text-muted">Add a block</Text>
        </Pressable>
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
        <BlockToolbar
          disabled={!activeBlock}
          onFormat={format}
          onAction={(action) => {
            if (action === "insert") setSheet("insert");
            else if (action === "turn") setSheet("turn");
            else if (action === "menu") setSheet("menu");
            else if (action === "page") setPagePicker(true);
            else if (action === "image") insertOption({ kind: "image", label: "Image" });
          }}
        />
      </KeyboardStickyView>

      <Sheet
        open={sheet === "insert"}
        onOpenChange={(open) => setSheet(open ? "insert" : null)}
        title="Insert block"
      >
        <View className="mt-2 gap-1">
          {INSERT_OPTIONS.map((option) => (
            <Pressable
              key={option.label}
              onPress={() => insertOption(option)}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-[13px] text-foreground">{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet
        open={sheet === "turn"}
        onOpenChange={(open) => setSheet(open ? "turn" : null)}
        title="Turn into"
      >
        <View className="mt-2 gap-1">
          {INSERT_OPTIONS.filter(
            (option) => option.kind !== "image" && option.kind !== "pageEmbed" && option.kind !== "liveBlock",
          ).map((option) => (
            <Pressable
              key={option.label}
              onPress={() => turnInto(option.kind)}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-[13px] text-foreground">{option.label}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet
        open={sheet === "menu"}
        onOpenChange={(open) => setSheet(open ? "menu" : null)}
        title="Block actions"
      >
        <View className="mt-2 gap-1">
          {[
            {
              label: "Duplicate",
              onPress: () => {
                if (!activeBlock) return;
                insertAfter(activeBlock.id, duplicateBlock(activeBlock));
                setSheet(null);
              },
            },
            {
              label: "Move up",
              onPress: () => {
                if (!activeBlock) return;
                moveBlock(activeBlock.id, -1);
                setSheet(null);
              },
            },
            {
              label: "Move down",
              onPress: () => {
                if (!activeBlock) return;
                moveBlock(activeBlock.id, 1);
                setSheet(null);
              },
            },
            {
              label: "Delete",
              destructive: true,
              onPress: () => {
                if (!activeBlock) return;
                removeBlock(activeBlock.id);
                setSheet(null);
              },
            },
          ].map((action) => (
            <Pressable
              key={action.label}
              onPress={action.onPress}
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

      <Sheet
        open={sheet === "icon"}
        onOpenChange={(open) => setSheet(open ? "icon" : null)}
        title="Note icon"
      >
        <View className="mt-2 flex-row flex-wrap gap-2">
          {ICONS.map((value) => (
            <Pressable
              key={value}
              onPress={() => {
                setIcon(value);
                markDirty();
                setSheet(null);
              }}
              className={`h-11 w-11 items-center justify-center rounded-xl border ${
                value === icon ? "border-accent bg-surface-secondary" : "border-border bg-surface"
              }`}
            >
              <Text className="text-lg">{value}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>

      <Sheet
        open={urlSheet}
        onOpenChange={setUrlSheet}
        title="Link URL"
      >
        <View className="mt-2 gap-2">
          <TextInput
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="https://example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            className="rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px] text-foreground"
          />
          <Pressable
            onPress={() => {
              if (!activeBlock) return;
              const range = selection ?? { start: activeBlock.text.length, end: activeBlock.text.length };
              const text = activeBlock.text;
              const next =
                text.slice(0, range.start) +
                `[${text.slice(range.start, range.end) || linkUrl}](${linkUrl})` +
                text.slice(range.end);
              updateBlock(activeBlock.id, { ...activeBlock, text: next });
              setUrlSheet(false);
            }}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Insert link</Text>
          </Pressable>
        </View>
      </Sheet>

      <PageLinkPicker
        open={pagePicker}
        onOpenChange={setPagePicker}
        onSelect={(page, pageTitle) => {
          if (activeBlock && (activeBlock.kind === "pageEmbed" || activeBlock.kind === "liveBlock")) {
            updateBlock(activeBlock.id, {
              ...activeBlock,
              attrs: { ...activeBlock.attrs, pageId: page, title: pageTitle },
              text: pageTitle,
            });
            return;
          }
          insertAfter(activeId, {
            ...emptyBlock("paragraph"),
            text: `[[${page}|${pageTitle}]]`,
          });
        }}
      />
    </View>
  );
}
