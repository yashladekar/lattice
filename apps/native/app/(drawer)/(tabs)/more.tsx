import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { authClient } from "@/lib/auth-client";
import { route } from "@/lib/navigation";

const GROUPS = [
  {
    title: "Workspace",
    items: [
      { href: "/search", label: "Search everything", icon: "search-outline", detail: "Notes, canvases, captures, cards" },
      { href: "/inbox", label: "Inbox", icon: "mail-unread-outline", detail: "Captures waiting to be organized" },
      { href: "/canvases", label: "Canvases", icon: "grid-outline", detail: "Infinite whiteboards" },
      { href: "/graph", label: "Knowledge graph", icon: "git-network-outline", detail: "See how ideas connect" },
    ],
  },
  {
    title: "Thinking",
    items: [
      { href: "/assistant", label: "Assistant", icon: "sparkles-outline", detail: "Ask your notes" },
      { href: "/timeline", label: "Timeline", icon: "time-outline", detail: "Versions across the workspace" },
      { href: "/templates", label: "Templates", icon: "copy-outline", detail: "Start from a structure" },
      { href: "/trash", label: "Trash", icon: "trash-outline", detail: "Restore or let retention clear it" },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/notifications", label: "Notifications", icon: "notifications-outline", detail: "Mentions and activity" },
      { href: "/settings", label: "Settings", icon: "settings-outline", detail: "Workspace, members, devices, sync" },
    ],
  },
] as const;

export default function MoreScreen() {
  const router = useRouter();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const { workspace, signOut } = useWorkspace();
  const { data: session } = authClient.useSession();

  return (
    <Container>
      <ScreenHeader title="More" subtitle={workspace?.name} large />
      <View className="px-5 pb-10">
        <View className="mt-4 flex-row items-center gap-3 rounded-2xl border border-border bg-surface p-4">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-surface-secondary">
            <Ionicons name="person-outline" size={20} color={accent} />
          </View>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
              {session?.user?.name ?? "Signed in"}
            </Text>
            <Text numberOfLines={1} className="text-[10px] text-muted">
              {session?.user?.email ?? workspace?.name}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={10}
            onPress={() => void signOut()}
            className="h-9 w-9 items-center justify-center rounded-full border border-border"
          >
            <Ionicons name="log-out-outline" size={17} color={muted} />
          </Pressable>
        </View>

        {GROUPS.map((group) => (
          <View key={group.title} className="mt-6">
            <Text className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
              {group.title}
            </Text>
            <View className="overflow-hidden rounded-2xl border border-border bg-surface">
              {group.items.map((item, index) => (
                <Pressable
                  key={item.href}
                  onPress={() => router.push(route(item.href))}
                  className={`flex-row items-center gap-3 px-3.5 py-3 ${
                    index > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-secondary">
                    <Ionicons name={item.icon} size={17} color={accent} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[13px] font-medium text-foreground">{item.label}</Text>
                    <Text numberOfLines={1} className="mt-0.5 text-[10px] text-muted">
                      {item.detail}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={muted} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text className="mt-8 text-center text-[9px] text-muted">
          Lattice · local-first knowledge OS
        </Text>
      </View>
    </Container>
  );
}
