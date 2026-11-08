import { Ionicons } from "@expo/vector-icons";
import { useDrawerStatus, type DrawerContentComponentProps } from "expo-router/drawer";
import { usePathname, useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOutbox } from "@/contexts/outbox-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { useNotifications } from "@/hooks/use-workspace-data";
import { route } from "@/lib/navigation";

const GROUPS: Array<{
  title: string;
  items: Array<{ href: string; label: string; icon: keyof typeof Ionicons.glyphMap }>;
}> = [
  {
    title: "Workspace",
    items: [
      { href: "/", label: "Home", icon: "home-outline" },
      { href: "/inbox", label: "Inbox", icon: "mail-unread-outline" },
      { href: "/notebooks", label: "Notebooks", icon: "library-outline" },
      { href: "/canvases", label: "Canvases", icon: "grid-outline" },
      { href: "/graph", label: "Knowledge graph", icon: "git-network-outline" },
    ],
  },
  {
    title: "Learning",
    items: [
      { href: "/learn", label: "Review & learn", icon: "school-outline" },
      { href: "/assistant", label: "Assistant", icon: "sparkles-outline" },
      { href: "/search", label: "Search", icon: "search-outline" },
    ],
  },
  {
    title: "Library",
    items: [
      { href: "/timeline", label: "Timeline", icon: "time-outline" },
      { href: "/templates", label: "Templates", icon: "copy-outline" },
      { href: "/trash", label: "Trash", icon: "trash-outline" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: "notifications-outline" },
      { href: "/settings", label: "Settings", icon: "settings-outline" },
    ],
  },
];

export function Sidebar({ navigation }: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const isOpen = useDrawerStatus() === "open";
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const { workspace, memberships, switchWorkspace, signOut } = useWorkspace();
  const { pending, online } = useOutbox();
  const { unread } = useNotifications();

  const go = (href: string) => {
    router.push(route(href));
    if (isOpen) navigation.closeDrawer();
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/" || pathname === "/index";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <View className="flex-1 bg-surface">
      <View style={{ paddingTop: insets.top + 16 }} className="px-4 pb-3">
        <View className="flex-row items-center gap-2.5">
          <View className="h-10 w-10 items-center justify-center rounded-xl bg-neutral-900">
            <Text className="text-lg text-amber-50">✦</Text>
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold tracking-tight text-foreground">lattice</Text>
            <Text numberOfLines={1} className="text-[10px] text-muted">
              {workspace?.name ?? "Workspace"}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
            hitSlop={10}
            onPress={() => navigation.closeDrawer()}
            className="h-8 w-8 items-center justify-center rounded-full"
          >
            <Ionicons name="close" size={18} color={muted} />
          </Pressable>
        </View>

        {memberships.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
            <View className="flex-row gap-1.5">
              {memberships.map((membership) => {
                const active = membership.workspace.id === workspace?.id;
                return (
                  <Pressable
                    key={membership.workspace.id}
                    onPress={() => void switchWorkspace(membership.workspace.id)}
                    className={`flex-row items-center gap-1 rounded-full border px-2.5 py-1 ${
                      active ? "border-amber-500/50 bg-amber-100" : "border-border bg-surface"
                    }`}
                  >
                    <Text className="text-[10px]">{membership.workspace.icon ?? "◇"}</Text>
                    <Text
                      numberOfLines={1}
                      className={`max-w-[110px] text-[10px] font-medium ${
                        active ? "text-neutral-900" : "text-muted"
                      }`}
                    >
                      {membership.workspace.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : null}
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 16 }}>
        {GROUPS.map((group) => (
          <View key={group.title} className="mt-2 px-2">
            <Text className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-widest text-muted">
              {group.title}
            </Text>
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Pressable
                  key={item.href}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => go(item.href)}
                  className={`mb-0.5 flex-row items-center gap-2.5 rounded-xl px-2.5 py-2.5 ${
                    active ? "bg-surface-secondary" : ""
                  }`}
                >
                  <Ionicons name={item.icon} size={17} color={active ? accent : muted} />
                  <Text
                    className={`min-w-0 flex-1 text-[13px] ${
                      active ? "font-semibold text-foreground" : "text-foreground/80"
                    }`}
                  >
                    {item.label}
                  </Text>
                  {item.href === "/notifications" && (unread.data ?? 0) > 0 ? (
                    <View className="rounded-full bg-rose-500 px-1.5 py-0.5">
                      <Text className="text-[8px] font-bold text-white">{unread.data}</Text>
                    </View>
                  ) : null}
                  {active ? (
                    <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View
        style={{ paddingBottom: insets.bottom + 12 }}
        className="border-t border-border px-4 pt-3"
      >
        <View className="flex-row items-center gap-2">
          <View
            className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          <Text className="flex-1 text-[10px] text-muted">
            {online ? "Synced" : "Offline — edits are queued"}
            {pending > 0 ? ` · ${pending} pending` : ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            hitSlop={10}
            onPress={() => void signOut()}
            className="h-8 w-8 items-center justify-center rounded-full border border-border"
          >
            <Ionicons name="log-out-outline" size={15} color={muted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
