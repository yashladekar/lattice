import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

function dayLabel(value: string | Date): string {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default function TimelineScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [selected, setSelected] = useState<{
    id: string;
    pageId: string;
    version: number;
    title: string;
    createdAt: string | Date;
    links: string[];
  } | null>(null);

  const timeline = useQuery({
    queryKey: ["native-timeline", workspace?.id],
    queryFn: async () => client.page.versionTimeline({ limit: 250 }),
    enabled: Boolean(workspace),
  });

  const groups = new Map<string, typeof timeline.data>();
  for (const entry of timeline.data ?? []) {
    const label = dayLabel(entry.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }

  const restore = async (entry: NonNullable<typeof selected>) => {
    try {
      await client.page.restoreVersion({ pageId: entry.pageId, versionId: entry.id });
      setSelected(null);
      await timeline.refetch();
      toast.show({ variant: "success", label: "Version restored" });
      router.push(route(`/page/${entry.pageId}`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not restore the version",
      });
    }
  };

  return (
    <Container>
      <ScreenHeader
        title="Timeline"
        subtitle="Every saved version across the workspace"
        large
      />
      <View className="px-5 pb-10">
        {timeline.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : timeline.data?.length ? (
          [...groups.entries()].map(([label, entries]) => (
            <View key={label} className="mt-5">
              <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                {label}
              </Text>
              <View className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
                {(entries ?? []).map((entry, index) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => setSelected(entry)}
                    className={`flex-row items-center gap-3 px-3 py-2.5 ${
                      index > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <View className="h-7 w-7 items-center justify-center rounded-full bg-surface-secondary">
                      <Ionicons name="git-commit-outline" size={13} color={muted} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-[12px] text-foreground">
                        {entry.title}
                      </Text>
                      <Text className="text-[9px] text-muted">
                        v{entry.version} ·{" "}
                        {new Date(entry.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {entry.links.length ? ` · ${entry.links.length} links` : ""}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={13} color={muted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ))
        ) : (
          <View className="mt-6 rounded-2xl border border-dashed border-border p-8">
            <Text className="text-center text-sm font-medium text-foreground">No versions yet</Text>
            <Text className="mt-1 text-center text-[11px] text-muted">
              Versions appear when you save a snapshot or when a sync conflict creates one.
            </Text>
          </View>
        )}
      </View>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={selected ? `${selected.title} · v${selected.version}` : "Version"}
      >
        {selected ? (
          <View className="mt-2 gap-2">
            <Text className="text-[11px] text-muted">
              Saved {new Date(selected.createdAt).toLocaleString()} ·{" "}
              {selected.links.length} outgoing links
            </Text>
            <Pressable
              onPress={() => {
                setSelected(null);
                router.push(route(`/page/${selected.pageId}`));
              }}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-[12px] text-foreground">Open current note</Text>
            </Pressable>
            <Pressable
              onPress={() => void restore(selected)}
              className="rounded-xl bg-accent px-3 py-2.5"
            >
              <Text className="text-[12px] font-semibold text-neutral-900">
                Restore this version
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Sheet>
    </Container>
  );
}
