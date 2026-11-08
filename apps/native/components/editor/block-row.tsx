import { Ionicons } from "@expo/vector-icons";
import type { EditorBlock } from "@/lib/editor-blocks";
import { Image } from "expo-image";
import { useThemeColor } from "heroui-native";
import { Text, TextInput, Pressable, View } from "react-native";

export interface EditorSelection {
  start: number;
  end: number;
}

export interface BlockRowProps {
  block: EditorBlock;
  active: boolean;
  selection: EditorSelection | null;
  onChange: (next: EditorBlock) => void;
  onFocus: (selection: EditorSelection) => void;
  onSelectionChange: (selection: EditorSelection) => void;
  onEnter: () => void;
  onBackspaceAtStart: () => void;
  onOpenMenu: () => void;
  onOpenPage: (pageId: string) => void;
  onPickImage: () => void;
}

function paragraphInputClass(block: EditorBlock): string {
  switch (block.kind) {
    case "heading":
      return block.level === 1
        ? "text-3xl font-semibold"
        : block.level === 3
          ? "text-lg font-semibold"
          : "text-2xl font-semibold";
    case "codeBlock":
      return "font-mono text-[12.5px]";
    case "blockquote":
      return "text-[15px] italic";
    case "callout":
      return "text-[14px]";
    case "details":
      return "text-[14px] font-medium";
    default:
      return "text-[15px]";
  }
}

export function BlockRow({
  block,
  active,
  selection,
  onChange,
  onFocus,
  onSelectionChange,
  onEnter,
  onBackspaceAtStart,
  onOpenMenu,
  onOpenPage,
  onPickImage,
}: BlockRowProps) {
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const inputProps = {
    multiline: block.kind !== "heading" && block.kind !== "details",
    placeholderTextColor: muted,
    onFocus: () => onFocus(selection ?? { start: block.text.length, end: block.text.length }),
    onSelectionChange: (event: { nativeEvent: { selection: EditorSelection } }) =>
      onSelectionChange(event.nativeEvent.selection),
    selection: active && selection ? selection : undefined,
    className: `${paragraphInputClass(block)} leading-7 text-foreground`,
  };

  const commonText = (
    placeholder: string,
    extra?: {
      onChangeText?: (value: string) => void;
      submit?: () => void;
      multiline?: boolean;
      mono?: boolean;
    },
  ) => (
    <TextInput
      {...inputProps}
      multiline={extra?.multiline ?? inputProps.multiline}
      value={block.text}
      placeholder={placeholder}
      onChangeText={(value) => {
        const next = value.replace(/\r/g, "");
        if (next.endsWith("\n") && !extra?.multiline) {
          onChange({ ...block, text: next.slice(0, -1) });
          onEnter();
          return;
        }
        onChange({ ...block, text: next });
      }}
      onSubmitEditing={extra?.submit}
      onKeyPress={(event) => {
        if (event.nativeEvent.key === "Backspace" && block.text.length === 0) {
          onBackspaceAtStart();
        }
      }}
      blurOnSubmit={false}
      textAlignVertical={extra?.multiline ? "top" : "center"}
      className={`${paragraphInputClass(block)} leading-7 text-foreground ${
        extra?.mono ? "font-mono" : ""
      }`}
    />
  );

  const handle = active ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Block actions"
      hitSlop={8}
      onPress={onOpenMenu}
      className="mr-1.5 h-7 w-6 items-center justify-center rounded-md"
    >
      <Ionicons name="ellipsis-vertical" size={14} color={muted} />
    </Pressable>
  ) : null;

  const body = (() => {
    switch (block.kind) {
      case "heading":
        return commonText(`Heading ${block.level ?? 2}`, { multiline: false });
      case "blockquote":
        return (
          <View className="border-l-2 border-amber-500/60 pl-3">
            {commonText("Quote", { multiline: true })}
          </View>
        );
      case "codeBlock":
        return (
          <View className="rounded-xl bg-neutral-900 p-3">
            <TextInput
              multiline
              value={block.text}
              onChangeText={(text) => onChange({ ...block, text })}
              placeholder="Code"
              placeholderTextColor="#8a8a80"
              className="min-h-[64px] font-mono text-[12.5px] leading-5 text-neutral-100"
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              value={block.language ?? ""}
              onChangeText={(language) => onChange({ ...block, language })}
              placeholder="language"
              placeholderTextColor="#8a8a80"
              className="mt-2 rounded-md border border-neutral-700 px-2 py-1 font-mono text-[10px] text-neutral-300"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        );
      case "callout":
        return (
          <View className="rounded-xl border border-amber-300/40 bg-amber-100/40 p-3">
            <View className="flex-row items-center gap-2">
              <TextInput
                value={typeof block.attrs?.emoji === "string" ? block.attrs.emoji : "✦"}
                onChangeText={(emoji) =>
                  onChange({ ...block, attrs: { ...block.attrs, emoji } })
                }
                className="w-8 text-center text-lg text-foreground"
                maxLength={4}
              />
              <TextInput
                value={typeof block.attrs?.title === "string" ? block.attrs.title : "Note"}
                onChangeText={(title) =>
                  onChange({ ...block, attrs: { ...block.attrs, title } })
                }
                placeholder="Callout title"
                placeholderTextColor={muted}
                className="flex-1 text-xs font-semibold text-foreground"
              />
            </View>
            {commonText("Callout text", { multiline: true })}
          </View>
        );
      case "details":
        return (
          <View className="rounded-xl border border-border p-3">
            <TextInput
              value={block.text}
              onChangeText={(text) => onChange({ ...block, text })}
              placeholder="Toggle title"
              placeholderTextColor={muted}
              className="text-sm font-medium text-foreground"
            />
            <TextInput
              multiline
              value={block.body ?? ""}
              onChangeText={(body) => onChange({ ...block, body })}
              placeholder="Hidden content"
              placeholderTextColor={muted}
              className="mt-2 text-[14px] leading-6 text-foreground/80"
              textAlignVertical="top"
            />
          </View>
        );
      case "bulletList":
      case "orderedList":
      case "taskList":
        return (
          <View className="gap-1">
            {(block.items ?? []).map((item, index) => (
              <View key={item.id} className="flex-row items-start gap-2">
                {block.kind === "taskList" ? (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: Boolean(item.checked) }}
                    hitSlop={8}
                    onPress={() =>
                      onChange({
                        ...block,
                        items: (block.items ?? []).map((entry) =>
                          entry.id === item.id ? { ...entry, checked: !entry.checked } : entry,
                        ),
                      })
                    }
                    className="mt-1"
                  >
                    <Text className="text-base">{item.checked ? "☑" : "☐"}</Text>
                  </Pressable>
                ) : (
                  <Text className="mt-0.5 w-5 text-center text-[15px] text-foreground/60">
                    {block.kind === "orderedList" ? `${index + 1}.` : "•"}
                  </Text>
                )}
                <TextInput
                  value={item.text}
                  placeholder="List item"
                  placeholderTextColor={muted}
                  className="min-w-0 flex-1 text-[15px] leading-7 text-foreground"
                  onChangeText={(text) =>
                    onChange({
                      ...block,
                      items: (block.items ?? []).map((entry) =>
                        entry.id === item.id ? { ...entry, text } : entry,
                      ),
                    })
                  }
                  onSubmitEditing={() =>
                    onChange({
                      ...block,
                      items: [
                        ...(block.items ?? []),
                        { id: `${item.id}-new-${Date.now()}`, text: "" },
                      ],
                    })
                  }
                  onKeyPress={(event) => {
                    if (
                      event.nativeEvent.key === "Backspace" &&
                      item.text.length === 0 &&
                      (block.items?.length ?? 0) > 1
                    ) {
                      onChange({
                        ...block,
                        items: (block.items ?? []).filter((entry) => entry.id !== item.id),
                      });
                    }
                  }}
                  blurOnSubmit={false}
                  returnKeyType="next"
                />
                {index === (block.items?.length ?? 0) - 1 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add list item"
                    hitSlop={8}
                    onPress={() =>
                      onChange({
                        ...block,
                        items: [
                          ...(block.items ?? []),
                          { id: `${item.id}-add-${Date.now()}`, text: "" },
                        ],
                      })
                    }
                    className="mt-0.5 h-6 w-6 items-center justify-center rounded-md"
                  >
                    <Ionicons name="add" size={15} color={muted} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        );
      case "horizontalRule":
        return <View className="my-2 h-px bg-border" />;
      case "image":
        return (
          <View className="overflow-hidden rounded-xl border border-border bg-surface">
            {block.text ? (
              <Image
                source={{ uri: block.text }}
                style={{ width: "100%", height: 190 }}
                contentFit="cover"
              />
            ) : null}
            <View className="flex-row items-center gap-2 p-2">
              <TextInput
                value={typeof block.attrs?.alt === "string" ? block.attrs.alt : ""}
                onChangeText={(alt) => onChange({ ...block, attrs: { ...block.attrs, alt } })}
                placeholder="Alt text"
                placeholderTextColor={muted}
                className="flex-1 text-[11px] text-foreground"
              />
              <Pressable
                onPress={onPickImage}
                className="rounded-lg border border-border px-2 py-1"
              >
                <Text className="text-[10px] text-muted">Replace</Text>
              </Pressable>
            </View>
          </View>
        );
      case "pageEmbed":
      case "liveBlock": {
        const title =
          typeof block.attrs?.title === "string" ? block.attrs.title : block.text || "Embedded page";
        const pageId = typeof block.attrs?.pageId === "string" ? block.attrs.pageId : "";
        return (
          <Pressable
            onPress={() => (pageId ? onOpenPage(pageId) : undefined)}
            className="rounded-xl border border-dashed border-border bg-surface-secondary p-3"
          >
            <Text className="text-[9px] uppercase tracking-widest text-muted">
              {block.kind === "pageEmbed" ? "Embedded page" : "Synced block"}
            </Text>
            <Text className="mt-1 text-sm text-foreground">{title}</Text>
          </Pressable>
        );
      }
      case "bookmark":
        return (
          <View className="rounded-xl border border-border bg-surface p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">Bookmark</Text>
            <TextInput
              value={block.text}
              onChangeText={(url) => onChange({ ...block, text: url })}
              placeholder="https://…"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              className="mt-1 text-[12px] text-foreground"
            />
            <TextInput
              value={typeof block.attrs?.title === "string" ? block.attrs.title : ""}
              onChangeText={(title) => onChange({ ...block, attrs: { ...block.attrs, title } })}
              placeholder="Title"
              placeholderTextColor={muted}
              className="mt-1 text-[11px] text-muted"
            />
          </View>
        );
      case "youtube":
        return (
          <View className="rounded-xl border border-border bg-surface p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">YouTube</Text>
            <TextInput
              value={block.text}
              onChangeText={(src) => onChange({ ...block, text: src })}
              placeholder="https://youtube.com/watch?v=…"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              className="mt-1 text-[12px] text-foreground"
            />
            <Text className="mt-1 text-[9px] text-muted">Plays in the web and desktop app.</Text>
          </View>
        );
      case "diagram":
        return (
          <View className="rounded-xl border border-border bg-surface p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">Diagram source</Text>
            <TextInput
              multiline
              value={block.text}
              onChangeText={(source) => onChange({ ...block, text: source })}
              placeholder="graph TD; A-->B;"
              placeholderTextColor={muted}
              className="mt-1 min-h-[80px] font-mono text-[11px] leading-5 text-foreground/80"
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              value={typeof block.attrs?.caption === "string" ? block.attrs.caption : ""}
              onChangeText={(caption) => onChange({ ...block, attrs: { ...block.attrs, caption } })}
              placeholder="Caption"
              placeholderTextColor={muted}
              className="mt-1 text-[10px] text-muted"
            />
          </View>
        );
      case "mathBlock":
        return (
          <View className="rounded-xl border border-border bg-surface p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">Equation (LaTeX)</Text>
            <TextInput
              multiline
              value={block.text}
              onChangeText={(latex) => onChange({ ...block, text: latex })}
              placeholder="\\int_0^1 x^2 dx"
              placeholderTextColor={muted}
              className="mt-1 min-h-[56px] font-mono text-[12px] leading-5 text-foreground"
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        );
      case "request":
        return (
          <View className="rounded-xl border border-border bg-surface p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">API request</Text>
            <TextInput
              value={block.text}
              onChangeText={(url) => onChange({ ...block, text: url })}
              placeholder="https://api.example.com"
              placeholderTextColor={muted}
              autoCapitalize="none"
              autoCorrect={false}
              className="mt-1 text-[12px] text-foreground"
            />
          </View>
        );
      case "table":
        return (
          <View className="rounded-xl border border-border bg-surface p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">
              Table · one row per line, cells split by |
            </Text>
            <TextInput
              multiline
              value={block.text}
              onChangeText={(text) => onChange({ ...block, text })}
              placeholder={"Name | Status\nDesign | Active"}
              placeholderTextColor={muted}
              className="mt-1 min-h-[90px] font-mono text-[11.5px] leading-6 text-foreground"
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        );
      case "database":
      case "unknown":
        return (
          <View className="rounded-xl border border-dashed border-border bg-surface-secondary p-3">
            <Text className="text-[9px] uppercase tracking-widest text-muted">
              {block.kind === "database" ? "Database block" : "Web-rendered block"}
            </Text>
            <Text className="mt-1 text-sm text-foreground">
              {typeof block.attrs?.title === "string" ? block.attrs.title : "Open on web to edit"}
            </Text>
            <Text className="mt-1 text-[10px] leading-4 text-muted">
              Kept intact when you save; the phone does not rewrite its structure.
            </Text>
          </View>
        );
      default:
        return commonText("Write something…");
    }
  })();

  return (
    <View
      className={`flex-row items-start rounded-lg px-1 py-0.5 ${
        active ? "bg-surface-secondary/60" : ""
      }`}
    >
      {handle}
      <View className="min-w-0 flex-1">{body}</View>
      {active && block.kind !== "horizontalRule" ? (
        <View className="ml-1 w-1" style={{ backgroundColor: accent }} />
      ) : null}
    </View>
  );
}
