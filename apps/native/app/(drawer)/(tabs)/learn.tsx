import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/container";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

const RATINGS = [
  { rating: 1, label: "Again", color: "#b45309", bg: "bg-amber-100" },
  { rating: 2, label: "Hard", color: "#92400e", bg: "bg-amber-50" },
  { rating: 3, label: "Good", color: "#166534", bg: "bg-emerald-50" },
  { rating: 4, label: "Easy", color: "#065f46", bg: "bg-emerald-100" },
] as const;

export default function LearnScreen() {
  const insets = useSafeAreaInsets();
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);

  const due = useQuery({
    queryKey: ["native-due", workspace?.id],
    queryFn: async () => client.learning.due({ limit: 30 }),
    enabled: Boolean(workspace),
  });
  const stats = useQuery({
    queryKey: ["native-stats", workspace?.id],
    queryFn: async () => client.learning.stats(),
    enabled: Boolean(workspace),
  });

  const current = due.data?.[0] ?? null;
  const total = stats.data?.totalCards ?? 0;
  const mastery = Math.round((stats.data?.mastery ?? 0) * 100);

  const rate = async (rating: 1 | 2 | 3 | 4) => {
    if (!current) return;
    setSaving(true);
    try {
      await client.learning.review({ flashcardId: current.id, rating });
      setRevealed(false);
      await Promise.all([due.refetch(), stats.refetch()]);
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not review card",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container>
      <View style={{ paddingTop: insets.top + 18 }} className="px-5 pb-8">
        <Text className="text-3xl font-semibold tracking-tight text-foreground">Learning</Text>
        <Text className="mt-1 text-xs text-muted">Remember what you chose to keep.</Text>

        <View className="mt-5 flex-row gap-2">
          {[
            ["Due", stats.data?.dueCount ?? 0],
            ["Cards", total],
            ["Streak", stats.data?.streak ?? 0],
            ["Mastery", `${mastery}%`],
          ].map(([label, value]) => (
            <View key={String(label)} className="flex-1 rounded-xl border border-border bg-surface p-2.5">
              <Text className="text-lg font-semibold text-foreground">{value}</Text>
              <Text className="text-[9px] uppercase tracking-wider text-muted">{label}</Text>
            </View>
          ))}
        </View>

        {due.isLoading ? (
          <ActivityIndicator color={accent} className="py-16" />
        ) : current ? (
          <View className="mt-6">
            <View className="flex-row items-center justify-between">
              <Text className="text-[10px] uppercase tracking-widest text-muted">
                Review · {due.data?.length ?? 0} due
              </Text>
              <Text className="text-[10px] text-muted">
                {new Date(current.dueAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </View>

            <View className="mt-3 rounded-3xl border border-border bg-surface p-5">
              <Text className="text-[9px] font-semibold uppercase tracking-widest text-muted">
                Prompt
              </Text>
              <Text className="mt-2 text-xl font-medium leading-8 text-foreground">
                {current.front}
              </Text>

              {revealed ? (
                <View className="mt-6 border-t border-border pt-4">
                  <Text className="text-[9px] font-semibold uppercase tracking-widest text-muted">
                    Answer
                  </Text>
                  <Text className="mt-2 text-[15px] leading-7 text-foreground/80">
                    {current.back}
                  </Text>
                </View>
              ) : null}

              {!revealed ? (
                <Pressable
                  onPress={() => setRevealed(true)}
                  className="mt-6 items-center rounded-xl bg-amber-500 py-3"
                >
                  <Text className="text-sm font-semibold text-neutral-900">Reveal answer</Text>
                </Pressable>
              ) : (
                <View className="mt-5 flex-row gap-2">
                  {RATINGS.map((entry) => (
                    <Pressable
                      key={entry.rating}
                      disabled={saving}
                      onPress={() => void rate(entry.rating)}
                      className={`flex-1 items-center rounded-xl border border-border py-2.5 ${entry.bg}`}
                    >
                      <Text className="text-[11px] font-semibold" style={{ color: entry.color }}>
                        {entry.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        ) : (
          <View className="mt-8 rounded-3xl border border-dashed border-border p-8">
            <Ionicons name="checkmark-circle-outline" size={30} color={accent} style={{ alignSelf: "center" }} />
            <Text className="mt-3 text-center text-sm font-medium text-foreground">
              {total ? "All caught up" : "No cards yet"}
            </Text>
            <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
              {total
                ? "Your next review is scheduled. The mobile app honors the same spaced repetition queue."
                : "Generate cards from a page on web or desktop, then review them here."}
            </Text>
          </View>
        )}

        <View className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <View className="flex-row items-center gap-2">
            <Ionicons name="sparkles-outline" size={15} color={accent} />
            <Text className="text-xs font-medium text-foreground">The learning loop</Text>
          </View>
          <Text className="mt-1.5 text-[10px] leading-5 text-muted">
            Cards generated from notes stay linked to their source. Ratings update the same SM-2
            schedule used on every device.
          </Text>
          <View className="mt-3 flex-row items-center gap-2">
            <View className="h-1 flex-1 overflow-hidden rounded-full bg-surface-secondary">
              <View className="h-full rounded-full bg-emerald-500" style={{ width: `${mastery}%` }} />
            </View>
            <Text className="text-[9px] text-muted">{mastery}% mastery</Text>
          </View>
        </View>
      </View>
    </Container>
  );
}
