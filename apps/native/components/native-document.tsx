import type { TipTapDoc, TipTapNode } from "@notes-learning/domain";
import { Text, View, Image } from "react-native";

function inlineText(node: TipTapNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "pageLink") {
    const title = node.attrs?.title;
    return typeof title === "string" ? `◇ ${title}` : "◇ Untitled";
  }
  return (node.content ?? []).map((child) => inlineText(child)).join("");
}

function NodeView({ node, index }: { node: TipTapNode; index: number }) {
  switch (node.type) {
    case "paragraph":
      return (
        <Text className="text-[15px] leading-7 text-foreground" key={index}>
          {inlineText(node)}
        </Text>
      );
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      const style =
        level === 1
          ? "text-3xl mt-5"
          : level === 2
            ? "text-2xl mt-4"
            : "text-xl mt-3";
      return (
        <Text key={index} className={`${style} mb-1 font-semibold text-foreground`}>
          {inlineText(node)}
        </Text>
      );
    }
    case "bulletList":
      return (
        <View key={index} className="gap-1">
          {(node.content ?? []).map((item, itemIndex) => (
            <Text key={itemIndex} className="text-[15px] leading-7 text-foreground">
              • {inlineText(item)}
            </Text>
          ))}
        </View>
      );
    case "orderedList":
      return (
        <View key={index} className="gap-1">
          {(node.content ?? []).map((item, itemIndex) => (
            <Text key={itemIndex} className="text-[15px] leading-7 text-foreground">
              {itemIndex + 1}. {inlineText(item)}
            </Text>
          ))}
        </View>
      );
    case "taskList":
      return (
        <View key={index} className="gap-1">
          {(node.content ?? []).map((item, itemIndex) => (
            <Text key={itemIndex} className="text-[15px] leading-7 text-foreground">
              {item.attrs?.checked === true ? "☑" : "☐"} {inlineText(item)}
            </Text>
          ))}
        </View>
      );
    case "callout":
      return (
        <View key={index} className="rounded-xl border border-amber-300/40 bg-amber-100/40 p-3">
          <Text className="text-xs font-semibold text-foreground">
            {typeof node.attrs?.emoji === "string" ? node.attrs.emoji : "✦"}{" "}
            {typeof node.attrs?.title === "string" ? node.attrs.title : "Note"}
          </Text>
          <Text className="mt-1 text-[13px] leading-6 text-foreground/80">{inlineText(node)}</Text>
        </View>
      );
    case "blockquote":
      return (
        <View key={index} className="border-l-2 border-amber-500/60 pl-3">
          <Text className="text-[15px] italic leading-7 text-foreground/75">{inlineText(node)}</Text>
        </View>
      );
    case "codeBlock":
      return (
        <View key={index} className="rounded-xl bg-neutral-900 p-3">
          <Text className="font-mono text-[12px] leading-5 text-neutral-100">{inlineText(node)}</Text>
        </View>
      );
    case "horizontalRule":
      return <View key={index} className="my-2 h-px bg-border" />;
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      return src ? (
        <Image key={index} source={{ uri: src }} className="h-48 w-full rounded-xl" resizeMode="cover" />
      ) : null;
    }
    case "pageEmbed":
    case "liveBlock":
      return (
        <View key={index} className="rounded-xl border border-dashed border-border bg-surface-secondary p-3">
          <Text className="text-[10px] uppercase tracking-widest text-muted">Embedded page</Text>
          <Text className="mt-1 text-sm text-foreground">
            {typeof node.attrs?.title === "string" ? node.attrs.title : "Open this note"}
          </Text>
        </View>
      );
    case "database":
      return (
        <View key={index} className="rounded-xl border border-border p-3">
          <Text className="text-xs font-semibold text-foreground">
            {typeof node.attrs?.title === "string" ? node.attrs.title : "Database"}
          </Text>
          <Text className="mt-1 text-[11px] text-muted">Structured content is editable on web and desktop.</Text>
        </View>
      );
    case "details": {
      const summary = node.content?.find((child) => child.type === "detailsSummary");
      return (
        <View key={index} className="rounded-xl border border-border p-3">
          <Text className="text-sm font-medium text-foreground">▸ {inlineText(summary)}</Text>
        </View>
      );
    }
    default:
      return (
        <Text key={index} className="text-[13px] leading-6 text-muted">
          {inlineText(node)}
        </Text>
      );
  }
}

export function NativeDocument({ doc }: { doc: TipTapDoc | null | undefined }) {
  if (!doc?.content?.length) {
    return <Text className="text-xs text-muted">This note is empty.</Text>;
  }
  return (
    <View className="gap-2">
      {doc.content.map((node, index) => (
        <NodeView key={index} node={node} index={index} />
      ))}
    </View>
  );
}
