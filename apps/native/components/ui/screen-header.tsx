import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { Pressable, Text, View, type ViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = ViewProps & {
  title: string;
  subtitle?: string;
  back?: boolean;
  large?: boolean;
  right?: React.ReactNode;
};

export function ScreenHeader({ title, subtitle, back, large, right, ...props }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const foreground = useThemeColor("foreground");

  return (
    <View
      style={{ paddingTop: insets.top + 14 }}
      className="border-b border-border bg-background px-5 pb-3"
      {...props}
    >
      <View className="flex-row items-center gap-2">
        {back ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            onPress={() => router.back()}
            className="-ml-2 h-9 w-9 items-center justify-center rounded-full"
          >
            <Ionicons name="chevron-back" size={22} color={foreground} />
          </Pressable>
        ) : null}
        <View className="min-w-0 flex-1">
          <Text
            numberOfLines={1}
            className={
              large
                ? "text-3xl font-semibold tracking-tight text-foreground"
                : "text-lg font-semibold tracking-tight text-foreground"
            }
          >
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} className="mt-0.5 text-[11px] leading-4 text-muted">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View className="flex-row items-center gap-1">{right}</View> : null}
      </View>
    </View>
  );
}
