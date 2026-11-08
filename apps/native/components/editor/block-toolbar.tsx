import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";

type IconName = keyof typeof Ionicons.glyphMap;

const FORMATS: Array<{ key: string; label: string; icon: IconName }> = [
  { key: "bold", label: "Bold", icon: "text-outline" },
  { key: "italic", label: "Italic", icon: "text-outline" },
  { key: "strike", label: "Strike", icon: "remove-outline" },
  { key: "code", label: "Code", icon: "code-slash-outline" },
  { key: "link", label: "Link", icon: "link-outline" },
];

const ACTIONS: Array<{ key: string; label: string; icon: IconName }> = [
  { key: "turn", label: "Turn into", icon: "swap-horizontal-outline" },
  { key: "insert", label: "Insert", icon: "add-circle-outline" },
  { key: "image", label: "Image", icon: "image-outline" },
  { key: "page", label: "Page link", icon: "git-branch-outline" },
  { key: "menu", label: "Block menu", icon: "ellipsis-horizontal" },
];

export function BlockToolbar({
  onFormat,
  onAction,
  disabled,
}: {
  onFormat: (format: string) => void;
  onAction: (action: string) => void;
  disabled?: boolean;
}) {
  const muted = useThemeColor("muted");
  const foreground = useThemeColor("foreground");
  const background = useThemeColor("background");

  const Button = ({
    icon,
    label,
    active,
    onPress,
    text,
  }: {
    icon?: IconName;
    label: string;
    active?: boolean;
    onPress: () => void;
    text?: string;
  }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled), selected: active }}
      disabled={disabled}
      onPress={onPress}
      className={`h-9 min-w-9 items-center justify-center rounded-lg px-2 ${
        active ? "bg-surface-secondary" : ""
      }`}
    >
      {text ? (
        <Text className="text-[13px] font-semibold text-foreground">{text}</Text>
      ) : icon ? (
        <Ionicons name={icon} size={17} color={active ? foreground : muted} />
      ) : null}
    </Pressable>
  );

  return (
    <View style={{ backgroundColor: background }} className="border-t border-border px-2 py-1.5">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        <View className="flex-row items-center gap-0.5">
          {FORMATS.map((format) => (
            <Button
              key={format.key}
              icon={format.icon}
              label={format.label}
              text={
                format.key === "bold"
                  ? "B"
                  : format.key === "italic"
                    ? "I"
                    : format.key === "strike"
                      ? "S"
                      : undefined
              }
              onPress={() => onFormat(format.key)}
            />
          ))}
          <View className="mx-1 h-5 w-px bg-border" />
          {ACTIONS.map((action) => (
            <Button
              key={action.key}
              icon={action.icon}
              label={action.label}
              onPress={() => onAction(action.key)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
