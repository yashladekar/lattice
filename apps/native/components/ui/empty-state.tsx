import { Ionicons } from "@expo/vector-icons";
import { useThemeColor } from "heroui-native";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  icon?: ComponentProps<typeof Ionicons>["name"];
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon = "sparkles-outline", title, body, action }: Props) {
  const muted = useThemeColor("muted");

  return (
    <View className="rounded-3xl border border-dashed border-border px-6 py-8">
      <Ionicons name={icon} size={28} color={muted} style={{ alignSelf: "center" }} />
      <Text className="mt-3 text-center text-sm font-medium text-foreground">{title}</Text>
      {body ? (
        <Text className="mt-1 text-center text-[11px] leading-5 text-muted">{body}</Text>
      ) : null}
      {action ? (
        <Pressable onPress={action.onPress} className="mt-4 self-center rounded-xl bg-accent px-4 py-2">
          <Text className="text-xs font-semibold text-neutral-900">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
