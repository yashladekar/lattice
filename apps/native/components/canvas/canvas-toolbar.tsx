import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";

type IconName = keyof typeof Ionicons.glyphMap;

export type CanvasTool =
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
  | "page"
  | "image";

const TOOLS: Array<{ value: CanvasTool; icon: IconName; label: string }> = [
  { value: "select", icon: "navigate-outline", label: "Select" },
  { value: "pan", icon: "hand-left-outline", label: "Pan" },
  { value: "note", icon: "albums-outline", label: "Sticky note" },
  { value: "rect", icon: "square-outline", label: "Rectangle" },
  { value: "ellipse", icon: "ellipse-outline", label: "Ellipse" },
  { value: "diamond", icon: "diamond-outline", label: "Diamond" },
  { value: "hexagon", icon: "shapes-outline", label: "Hexagon" },
  { value: "cylinder", icon: "server-outline", label: "Cylinder" },
  { value: "text", icon: "text-outline", label: "Text" },
  { value: "pen", icon: "brush-outline", label: "Pen" },
  { value: "connector", icon: "git-commit-outline", label: "Connector" },
  { value: "frame", icon: "scan-outline", label: "Frame" },
  { value: "page", icon: "document-text-outline", label: "Linked note" },
  { value: "image", icon: "image-outline", label: "Image" },
];

export function CanvasToolbar({
  tool,
  onTool,
  onAction,
  canUndo,
  canRedo,
  stylusMode,
}: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  onAction: (action: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  stylusMode: boolean;
}) {
  const background = useThemeColor("background");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const IconButton = ({
    icon,
    label,
    active,
    disabled,
    onPress,
  }: {
    icon: IconName;
    label: string;
    active?: boolean;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`h-9 w-9 items-center justify-center rounded-lg ${
        active ? "bg-surface-secondary" : ""
      }`}
    >
      <Ionicons name={icon} size={18} color={active ? accent : disabled ? `${muted}66` : muted} />
    </Pressable>
  );

  return (
    <View className="px-2">
      <View
        style={{ backgroundColor: background }}
        className="rounded-2xl border border-border bg-surface p-1"
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="flex-row items-center gap-0.5">
            {TOOLS.map((entry) => (
              <IconButton
                key={entry.value}
                icon={entry.icon}
                label={entry.label}
                active={tool === entry.value}
                onPress={() => onTool(entry.value)}
              />
            ))}
            <View className="mx-1 h-6 w-px bg-border" />
            <IconButton
              icon="arrow-undo-outline"
              label="Undo"
              disabled={!canUndo}
              onPress={() => onAction("undo")}
            />
            <IconButton
              icon="arrow-redo-outline"
              label="Redo"
              disabled={!canRedo}
              onPress={() => onAction("redo")}
            />
            <IconButton
              icon="remove-outline"
              label="Zoom out"
              onPress={() => onAction("zoomOut")}
            />
            <IconButton icon="add-outline" label="Zoom in" onPress={() => onAction("zoomIn")} />
            <IconButton
              icon="scan-circle-outline"
              label="Fit canvas"
              onPress={() => onAction("fit")}
            />
            <IconButton icon="ellipsis-horizontal" label="More" onPress={() => onAction("more")} />
          </View>
        </ScrollView>
      </View>
      <View className="mt-1 flex-row items-center justify-between px-1">
        <Text className="text-[9px] uppercase tracking-widest text-muted">
          {tool === "select"
            ? "Tap to select · drag to move · drag corner to resize"
            : tool === "pen"
              ? stylusMode
                ? "Stylus draws · finger pans"
                : "Draw with finger or stylus"
              : `${tool} tool`}
        </Text>
        {tool === "pen" || stylusMode ? (
          <View className="flex-row items-center gap-1">
            <Ionicons name="pencil" size={10} color={muted} />
            <Text className="text-[9px] text-muted">pressure aware</Text>
          </View>
        ) : null}
      </View>
      <Text className="mt-0.5 px-1 text-[9px] text-muted">
        Two-finger tap to undo · three-finger tap to redo
      </Text>
    </View>
  );
}
