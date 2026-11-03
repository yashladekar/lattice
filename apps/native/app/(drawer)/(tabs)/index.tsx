import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/container";
import { useWorkspace } from "@/contexts/workspace-context";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function relative(value: string | Date): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NativeHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { workspace, memberships, switchWorkspace, signOut } = useWorkspace();
  const { data: session } = authClient.useSession();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const recent = useQuery({
    queryKey: ["native-recent", workspace?.id],
    queryFn: async () => client.page.recent(),
    enabled: Boolean(workspace),
  });
  const stats = useQuery({
    queryKey: ["native-learning-stats", workspace?.id],
    queryFn: async () => client.learning.stats(),
    enabled: Boolean(workspace),
  });
  const notebooks = useQuery({
    queryKey: ["native-notebooks", workspace?.id],
    queryFn: async () => client.notebook.list(),
    enabled: Boolean(workspace),
  });

  const refreshing = recent.isFetching || stats.isFetching;

  return (
    <Container
      className="bg-background"
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            tintColor={accent}
            onRefresh={() => {
              void recent.refetch();
              void stats.refetch();
              void notebooks.refetch();
            }}
          />
        ),
      }}
    >
      <View style={{ paddingTop: insets.top + 18 }} className="px-5 pb-8">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-xl bg-neutral-900">
              <Text className="text-lg text-amber-50">✦</Text>
            </View>
            <View>
              <Text className="text-lg font-semibold tracking-tight text-foreground">lattice</Text>
              <Text className="text-[10px] text-muted">{workspace?.name ?? "Workspace"}</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-1">
            <Pressable
              className="h-9 w-9 items-center justify-center rounded-full border border-border bg-surface"
              onPress={() => router.push("/search")}
            >
              <Ionicons name="search-outline" size={17} color={foreground} />
            </Pressable>
            <Pressable
              className="h-9 w-9 items-center justify-center rounded-full border border-border bg-surface"
              onPress={() => void signOut()}
            >
              <Ionicons name="log-out-outline" size={17} color={muted} />
            </Pressable>
          </View>
        </View>

        {memberships.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-4">
            <View className="flex-row gap-2">
              {memberships.map((membership) => {
                const active = membership.workspace.id === workspace?.id;
                return (
                  <Pressable
                    key={membership.workspace.id}
                    onPress={() => void switchWorkspace(membership.workspace.id)}
                    className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                      active ? "border-amber-500/40 bg-amber-100" : "border-border bg-surface"
                    }`}
                  >
                    <Text className="text-[11px]">{membership.workspace.icon ?? "◇"}</Text>
                    <Text
                      className={`text-[10px] font-medium ${active ? "text-neutral-900" : "text-muted"}`}
                    >
                      {membership.workspace.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : null}

        <Text className="mt-7 text-xs text-muted">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </Text>
        <Text className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
          {greeting()}, {session?.user?.name?.split(" ")[0] ?? "there"}.
        </Text>
        <Text className="mt-2 text-sm leading-6 text-muted">
          Capture a thought, continue reading, or review what is due.
        </Text>

        <View className="mt-5 flex-row gap-2">
          <Pressable
            onPress={() => router.push("/capture")}
            className="flex-1 rounded-2xl bg-amber-500 p-4"
          >
            <Ionicons name="add-circle-outline" size={20} color="#1d1d1a" />
            <Text className="mt-2 text-sm font-semibold text-neutral-900">Quick capture</Text>
            <Text className="mt-0.5 text-[10px] text-neutral-800/70">Inbox first, organize later</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/learn")}
            className="flex-1 rounded-2xl border border-border bg-surface p-4"
          >
            <Ionicons name="school-outline" size={20} color={accent} />
            <Text className="mt-2 text-sm font-semibold text-foreground">
              {stats.data?.dueCount ?? 0} cards due
            </Text>
            <Text className="mt-0.5 text-[10px] text-muted">
              {stats.data?.streak ?? 0} day streak
            </Text>
          </Pressable>
        </View>

        <View className="mt-6 flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted">
            Continue
          </Text>
          <Text className="text-[10px] text-muted">{recent.data?.length ?? 0} notes</Text>
        </View>

        <View className="mt-3 gap-2">
          {recent.isLoading ? (
            <ActivityIndicator color={accent} className="py-6" />
          ) : recent.data?.length ? (
            recent.data.slice(0, 6).map((page) => (
              <Pressable
                key={page.id}
                onPress={() =>
                  router.push({ pathname: "/page/[id]", params: { id: page.id } })
                }
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface p-3.5"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-secondary">
                  <Text className="text-sm">{page.icon ?? "◇"}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                    {page.title}
                  </Text>
                  <Text className="mt-0.5 text-[10px] text-muted">
                    Edited {relative(page.updatedAt)}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={muted} />
              </Pressable>
            ))
          ) : (
            <View className="rounded-2xl border border-dashed border-border p-6">
              <Text className="text-center text-sm font-medium text-foreground">
                Your workspace is waiting
              </Text>
              <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
                Capture a thought or open the web app to write your first full page.
              </Text>
            </View>
          )}
        </View>

        <View className="mt-6 flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted">
            Notebooks
          </Text>
          <Pressable onPress={() => router.push("/notebooks")}>
            <Text className="text-[10px] text-amber-500">View all</Text>
          </Pressable>
        </View>
        <View className="mt-3 gap-2">
          {notebooks.data?.slice(0, 4).map((notebook) => (
            <Pressable
              key={notebook.id}
              onPress={() => router.push("/notebooks")}
              className="flex-row items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-sm">{notebook.icon ?? "◫"}</Text>
              <Text className="min-w-0 flex-1 text-xs text-foreground">{notebook.name}</Text>
              <Text className="text-[9px] text-muted">{notebook.pageCount ?? 0}</Text>
            </Pressable>
          ))}
        </View>

        <View className="mt-7 rounded-2xl border border-border bg-surface p-4">
          <Text className="text-[10px] uppercase tracking-widest text-muted">Workspace</Text>
          <Text className="mt-1 text-sm font-medium text-foreground">{workspace?.name}</Text>
          <Text className="mt-1 text-[10px] leading-5 text-muted">
            Mobile is the capture, reading, and review companion. The full editor, whiteboard, and graph
            live in the web and desktop app, sharing the same synced knowledge model.
          </Text>
        </View>
      </View>
    </Container>
  );
}
