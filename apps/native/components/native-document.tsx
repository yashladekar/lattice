import {
  diagramTypeOf,
  type TipTapDoc,
  type TipTapNode,
} from "@notes-learning/domain";
import { Image, ScrollView, Text, View } from "react-native";

function textStyleForMarks(marks: TipTapNode["marks"]): {
  fontWeight?: "700";
  fontStyle?: "italic";
  textDecorationLine?: "underline" | "line-through";
  fontFamily?: string;
} {
  const style: ReturnType<typeof textStyleForMarks> = {};
  for (const mark of marks ?? []) {
    if (mark.type === "bold") style.fontWeight = "700";
    if (mark.type === "italic") style.fontStyle = "italic";
    if (mark.type === "strike") style.textDecorationLine = "line-through";
    if (mark.type === "code") style.fontFamily = "Menlo";
  }
  return style;
}

function Inline({
  nodes,
  onOpenPage,
  color,
}: {
  nodes: TipTapNode[] | undefined;
  onOpenPage?: (pageId: string) => void;
  color?: string;
}) {
  return (
    <>
      {(nodes ?? []).map((node, index) => {
        if (node.type === "hardBreak") return <Text key={index}>{"\n"}</Text>;
        if (node.type === "pageLink") {
          const pageId = typeof node.attrs?.pageId === "string" ? node.attrs.pageId : "";
          const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Untitled";
          const icon = typeof node.attrs?.icon === "string" ? node.attrs.icon : "◇";
          return (
            <Text
              key={index}
              onPress={() => (pageId && onOpenPage ? onOpenPage(pageId) : undefined)}
              style={{ color: "#b45309", textDecorationLine: "underline" }}
            >
              {`${icon} ${title}`}
            </Text>
          );
        }
        if (node.type === "text") {
          const link = (node.marks ?? []).find((mark) => mark.type === "link");
          const href = typeof link?.attrs?.href === "string" ? link.attrs.href : null;
          return (
            <Text
              key={index}
              style={{
                ...textStyleForMarks(node.marks),
                ...(href ? { textDecorationLine: "underline", color: "#b45309" } : {}),
                ...(color ? { color } : {}),
              }}
            >
              {node.text ?? ""}
            </Text>
          );
        }
        if (node.content?.length) {
          return <Inline key={index} nodes={node.content} onOpenPage={onOpenPage} />;
        }
        return null;
      })}
    </>
  );
}

function plainInline(node: TipTapNode | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "pageLink") {
    return typeof node.attrs?.title === "string" ? `◇ ${node.attrs.title}` : "◇ Untitled";
  }
  return (node.content ?? []).map((child) => plainInline(child)).join("");
}

function DiagramFallback({ source, caption }: { source: string; caption: string }) {
  const trimmed = source.trim();
  if (!trimmed) return null;
  return (
    <View className="rounded-xl border border-border bg-surface-secondary p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-[10px] uppercase tracking-widest text-muted">
          {diagramTypeOf(trimmed)} diagram
        </Text>
        <Text className="text-[9px] text-muted">renders on web</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-2">
        <Text className="font-mono text-[11px] leading-5 text-foreground/80">{trimmed}</Text>
      </ScrollView>
      {caption ? <Text className="mt-2 text-[10px] text-muted">{caption}</Text> : null}
    </View>
  );
}

function Cell({ node, header }: { node: TipTapNode; header?: boolean }) {
  return (
    <View className={`min-w-[100px] flex-1 border border-border px-2 py-1.5 ${header ? "bg-surface-secondary" : ""}`}>
      {header ? (
        <Text className="text-[11px] font-semibold text-foreground">{plainInline(node)}</Text>
      ) : (
        <Text className="text-[11px] leading-5 text-foreground/80">{plainInline(node)}</Text>
      )}
    </View>
  );
}

function NodeView({
  node,
  index,
  onOpenPage,
}: {
  node: TipTapNode;
  index: number;
  onOpenPage?: (pageId: string) => void;
}) {
  switch (node.type) {
    case "paragraph":
      return (
        <Text key={index} className="text-[15px] leading-7 text-foreground">
          <Inline nodes={node.content} onOpenPage={onOpenPage} />
        </Text>
      );
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      const style = level === 1 ? "text-3xl mt-5" : level === 2 ? "text-2xl mt-4" : "text-xl mt-3";
      return (
        <Text key={index} className={`${style} mb-1 font-semibold text-foreground`}>
          <Inline nodes={node.content} onOpenPage={onOpenPage} />
        </Text>
      );
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (
        <View key={index} className="gap-1">
          {(node.content ?? []).map((item, itemIndex) => (
            <View key={itemIndex} className="flex-row items-start gap-1.5">
              <Text className="mt-0.5 text-[15px] leading-7 text-foreground/60">
                {node.type === "taskList"
                  ? item.attrs?.checked === true
                    ? "☑"
                    : "☐"
                  : node.type === "orderedList"
                    ? `${itemIndex + 1}.`
                    : "•"}
              </Text>
              <Text className="min-w-0 flex-1 text-[15px] leading-7 text-foreground">
                <Inline
                  nodes={(item.content ?? []).flatMap((child) => child.content ?? [])}
                  onOpenPage={onOpenPage}
                />
              </Text>
            </View>
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
          <View className="mt-1 gap-1">
            {(node.content ?? []).map((child, childIndex) => (
              <Text key={childIndex} className="text-[13px] leading-6 text-foreground/80">
                <Inline nodes={child.content} onOpenPage={onOpenPage} />
              </Text>
            ))}
          </View>
        </View>
      );
    case "blockquote":
      return (
        <View key={index} className="border-l-2 border-amber-500/60 pl-3">
          {(node.content ?? []).map((child, childIndex) => (
            <Text key={childIndex} className="text-[15px] italic leading-7 text-foreground/75">
              <Inline nodes={child.content} onOpenPage={onOpenPage} />
            </Text>
          ))}
        </View>
      );
    case "codeBlock": {
      const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      const source = plainInline(node);
      if (language.toLowerCase() === "mermaid") {
        return <DiagramFallback key={index} source={source} caption="" />;
      }
      return (
        <View key={index} className="rounded-xl bg-neutral-900 p-3">
          {language ? (
            <Text className="mb-1 font-mono text-[9px] uppercase tracking-wider text-neutral-500">
              {language}
            </Text>
          ) : null}
          <Text className="font-mono text-[12px] leading-5 text-neutral-100">{source}</Text>
        </View>
      );
    }
    case "diagram": {
      const source = typeof node.attrs?.source === "string" ? node.attrs.source : "";
      const caption = typeof node.attrs?.caption === "string" ? node.attrs.caption : "";
      return <DiagramFallback key={index} source={source} caption={caption} />;
    }
    case "blockMath":
    case "mathBlock": {
      const latex = typeof node.attrs?.latex === "string" ? node.attrs.latex : plainInline(node);
      return (
        <View key={index} className="rounded-xl border border-border bg-surface p-3">
          <Text className="text-[9px] uppercase tracking-widest text-muted">Equation</Text>
          <Text className="mt-1 font-mono text-[13px] leading-6 text-foreground">{latex}</Text>
        </View>
      );
    }
    case "bookmark": {
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : url;
      const description =
        typeof node.attrs?.description === "string" ? node.attrs.description : "";
      return (
        <View key={index} className="rounded-xl border border-border bg-surface p-3">
          <Text className="text-[9px] uppercase tracking-widest text-muted">Bookmark</Text>
          <Text className="mt-1 text-sm font-medium text-foreground">{title}</Text>
          {description ? (
            <Text numberOfLines={2} className="mt-1 text-[11px] leading-5 text-muted">
              {description}
            </Text>
          ) : null}
          <Text numberOfLines={1} className="mt-1 text-[10px] text-amber-600">
            {url}
          </Text>
        </View>
      );
    }
    case "youtube": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      return (
        <View key={index} className="rounded-xl border border-border bg-surface p-3">
          <Text className="text-[9px] uppercase tracking-widest text-muted">YouTube</Text>
          <Text numberOfLines={1} className="mt-1 text-[11px] text-foreground/80">
            {src || "No video"}
          </Text>
          <Text className="mt-1 text-[9px] text-muted">Plays in the web and desktop app.</Text>
        </View>
      );
    }
    case "request": {
      const method = typeof node.attrs?.method === "string" ? node.attrs.method : "GET";
      const url = typeof node.attrs?.url === "string" ? node.attrs.url : "";
      const label = typeof node.attrs?.label === "string" ? node.attrs.label : "";
      return (
        <View key={index} className="rounded-xl border border-border bg-surface-secondary p-3">
          <View className="flex-row items-center gap-2">
            <Text className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-foreground">
              {method}
            </Text>
            <Text numberOfLines={1} className="min-w-0 flex-1 font-mono text-[10px] text-foreground/80">
              {url || "No URL"}
            </Text>
          </View>
          {label ? <Text className="mt-1.5 text-[10px] text-muted">{label}</Text> : null}
          <Text className="mt-1.5 text-[9px] text-muted">Open in Lattice to run this request.</Text>
        </View>
      );
    }
    case "horizontalRule":
      return <View key={index} className="my-2 h-px bg-border" />;
    case "image": {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
      const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      return src ? (
        <View key={index}>
          <Image
            source={{ uri: src }}
            style={{ width: "100%", height: 220, borderRadius: 12 }}
            resizeMode="cover"
          />
          {alt ? <Text className="mt-1 text-center text-[10px] text-muted">{alt}</Text> : null}
        </View>
      ) : null;
    }
    case "table":
      return (
        <View key={index} className="overflow-hidden rounded-xl border border-border">
          {(node.content ?? []).map((row, rowIndex) => (
            <View key={rowIndex} className="flex-row">
              {(row.content ?? []).map((cell, cellIndex) => (
                <Cell
                  key={cellIndex}
                  node={cell}
                  header={rowIndex === 0 || cell.type === "tableHeader"}
                />
              ))}
            </View>
          ))}
        </View>
      );
    case "details": {
      const summary = node.content?.find((child) => child.type === "detailsSummary");
      const content = node.content?.find((child) => child.type === "detailsContent");
      return (
        <View key={index} className="rounded-xl border border-border p-3">
          <Text className="text-sm font-medium text-foreground">
            ▸ <Inline nodes={summary?.content} onOpenPage={onOpenPage} />
          </Text>
          <View className="mt-2 gap-1">
            {(content?.content ?? []).map((child, childIndex) => (
              <Text key={childIndex} className="text-[13px] leading-6 text-foreground/80">
                <Inline nodes={child.content} onOpenPage={onOpenPage} />
              </Text>
            ))}
          </View>
        </View>
      );
    }
    case "pageEmbed":
    case "liveBlock":
      return (
        <View key={index} className="rounded-xl border border-dashed border-border bg-surface-secondary p-3">
          <Text className="text-[10px] uppercase tracking-widest text-muted">
            {node.type === "pageEmbed" ? "Embedded page" : "Synced block"}
          </Text>
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
          <Text className="mt-1 text-[11px] text-muted">
            Structured content is editable on web and desktop.
          </Text>
        </View>
      );
    default:
      return (
        <Text key={index} className="text-[13px] leading-6 text-muted">
          {plainInline(node)}
        </Text>
      );
  }
}

export function NativeDocument({
  doc,
  onOpenPage,
}: {
  doc: TipTapDoc | null | undefined;
  onOpenPage?: (pageId: string) => void;
}) {
  if (!doc?.content?.length) {
    return <Text className="text-xs text-muted">This note is empty.</Text>;
  }
  return (
    <View className="gap-2">
      {doc.content.map((node, index) => (
        <NodeView key={index} node={node} index={index} onOpenPage={onOpenPage} />
      ))}
    </View>
  );
}
