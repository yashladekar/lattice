import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useNavigation } from "expo-router";
import { useThemeColor } from "heroui-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

function targetedPage(href: string | null): string | null {
  if (!href) return null;
  const match = /[?&]id=([^&]+)/.exec(href);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export default function NotificationsScreen() {
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const notifications = useQuery({
    queryKey: ["native-notifications", workspace?.id],
    queryFn: async () => client.notification.list({ limit: 60 }),
    enabled: Boolean(workspace),
  });
  const unread = useQuery({
    queryKey: ["native-notifications-unread", workspace?.id],
    queryFn: async () => client.notification.unreadCount(),
    enabled: Boolean(workspace),
  });

  const refresh = async () => {
    await Promise.all([
      notifications.refetch(),
      unread.refetch(),
      queryClient.invalidateQueries({ queryKey: ["native-notifications-unread"] }),
    ]);
  };

  const openNotification = async (notification: {
    id: string;
    href: string | null;
    readAt: Date | string | null;
  }) => {
    if (!notification.readAt) await client.notification.markRead({ notificationId: notification.id });
    await refresh();
    const pageId = targetedPage(notification.href);
    if (pageId) router.push(route(`/page/${pageId}`));
  };

  const markAll = async () => {
    await client.notification.markAllRead();
    await refresh();
  };

  return (
    <Container>
      <ScreenHeader
        title="Notifications"
        subtitle={`${unread.data ?? 0} unread`}
        large
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => navigation.goBack()}
            className="h-9 w-9 items-center justify-center rounded-full border border-border"
          >
            <Ionicons name="close" size={18} color={muted} />
          </Pressable>
        }
      />
      <View className="px-5 pb-10">
        {(unread.data ?? 0) > 0 ? (
          <Pressable
            onPress={() => void markAll()}
            className="mt-3 self-start rounded-xl border border-border px-3 py-1.5"
          >
            <Text className="text-[11px] text-foreground">Mark all read</Text>
          </Pressable>
        ) : null}

        {notifications.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : notifications.data?.length ? (
          <View className="mt-3 gap-2">
            {notifications.data.map((notification) => (
              <Pressable
                key={notification.id}
                onPress={() => void openNotification(notification)}
                className={`rounded-2xl border p-3 ${
                  notification.readAt
                    ? "border-border bg-surface"
                    : "border-amber-300/60 bg-amber-50"
                }`}
              >
                <View className="flex-row items-start gap-2">
                  <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-surface-secondary">
                    <Ionicons
                      name={
                        notification.type === "comment"
                          ? "chatbubble-outline"
                          : "notifications-outline"
                      }
                      size={12}
                      color={muted}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[12px] font-medium text-foreground">
                      {notification.title}
                    </Text>
                    {notification.body ? (
                      <Text numberOfLines={2} className="mt-0.5 text-[11px] text-muted">
                        {notification.body}
                      </Text>
                    ) : null}
                    <Text className="mt-1 text-[9px] text-muted">
                      {new Date(notification.createdAt).toLocaleString()}
                    </Text>
                  </View>
                  {!notification.readAt ? (
                    <View className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="mt-6 rounded-2xl border border-dashed border-border p-8">
            <Text className="text-center text-sm font-medium text-foreground">No notifications</Text>
            <Text className="mt-1 text-center text-[11px] text-muted">
              Mentions and comment activity show up here.
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}
