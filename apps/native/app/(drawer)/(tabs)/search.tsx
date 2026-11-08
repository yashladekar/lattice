import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Input, useThemeColor } from "heroui-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

type ResultType = "page" | "canvas" | "capture" | "flashcard";

const TYPES: Array<{ id: ResultType; label: string }> = [
  { id: "page", label: "Notes" },
  { id: "canvas", label: "Canvases" },
  { id: "capture", label: "Captures" },
  { id: "flashcard", label: "Cards" },
];

export default function SearchScreen() {
  const { workspace } = useWorkspace();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [types, setTypes] = useState<Set<ResultType>>(new Set(TYPES.map((entry) => entry.id)));
  const [recent, setRecent] = useState<string[]>([]);

  const results = useQuery({
    queryKey: ["native-search", workspace?.id, submitted, [...types].sort().join(",")],
    queryFn: async () =>
      client.search.query({
        query: submitted,
        limit: 40,
        types: [...types],
      }),
    enabled: Boolean(workspace) && submitted.trim().length > 1 && types.size > 0,
  });

  const run = (value: string) => {
    const next = value.trim();
    if (next.length < 2) return;
    setSubmitted(next);
    setRecent((current) => [next, ...current.filter((entry) => entry !== next)].slice(0, 6));
  };

  const visible = useMemo(
    () => (results.data ?? []).filter((result) => types.has(result.type as ResultType)),
    [results.data, types],
  );

  const open = (result: { type: string; id: string }) => {
    if (result.type === "page") router.push(route(`/page/${result.id}`));
    else if (result.type === "canvas") router.push(route(`/canvas/${result.id}`));
    else if (result.type === "capture") router.push(route("/inbox"));
    else router.push(route("/learn"));
  };

  return (
    <Container>
      <ScreenHeader title="Search" subtitle="Across notes, canvases, captures, and cards" large />
      <View className="px-5 pb-10">
        <View className="mt-3 flex-row items-center gap-2">
          <View className="flex-1">
            <Input
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => run(query)}
              placeholder="Search your knowledge…"
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search"
            onPress={() => run(query)}
            className="h-10 w-10 items-center justify-center rounded-xl bg-accent"
          >
            <Ionicons name="search" size={17} color="#1d1d1a" />
          </Pressable>
        </View>

        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {TYPES.map((entry) => {
            const active = types.has(entry.id);
            return (
              <Pressable
                key={entry.id}
                onPress={() =>
                  setTypes((current) => {
                    const next = new Set(current);
                    if (next.has(entry.id)) next.delete(entry.id);
                    else next.add(entry.id);
                    return next;
                  })
                }
                className={`rounded-full border px-2.5 py-1 ${
                  active ? "border-amber-500/50 bg-amber-100" : "border-border bg-surface"
                }`}
              >
                <Text className={`text-[10px] ${active ? "text-neutral-900" : "text-muted"}`}>
                  {entry.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {recent.length && !submitted ? (
          <View className="mt-4">
            <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              Recent
            </Text>
            <View className="mt-1 flex-row flex-wrap gap-1.5">
              {recent.map((entry) => (
                <Pressable
                  key={entry}
                  onPress={() => {
                    setQuery(entry);
                    run(entry);
                  }}
                  className="rounded-full border border-border bg-surface px-2.5 py-1"
                >
                  <Text className="text-[10px] text-foreground">{entry}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {submitted ? (
          <View className="mt-4">
            {results.isLoading ? (
              <ActivityIndicator color={accent} className="py-10" />
            ) : visible.length ? (
              <View className="gap-2">
                <Text className="text-[10px] text-muted">
                  {visible.length} results for “{submitted}”
                </Text>
                {visible.map((result) => (
                  <Pressable
                    key={`${result.type}-${result.id}`}
                    onPress={() => open(result)}
                    className="rounded-2xl border border-border bg-surface p-3.5"
                  >
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm">{result.icon ?? "◇"}</Text>
                      <Text
                        numberOfLines={1}
                        className="min-w-0 flex-1 text-sm font-medium text-foreground"
                      >
                        {result.title}
                      </Text>
                      <Text className="rounded-full border border-border px-1.5 py-0.5 text-[8px] uppercase text-muted">
                        {result.type}
                      </Text>
                    </View>
                    {result.snippet ? (
                      <Text numberOfLines={2} className="mt-1.5 text-[11px] leading-5 text-muted">
                        {result.snippet}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : (
              <View className="rounded-2xl border border-dashed border-border p-8">
                <Text className="text-center text-sm font-medium text-foreground">
                  No results for “{submitted}”
                </Text>
                <Text className="mt-1 text-center text-[11px] text-muted">
                  Try fewer words or enable more types.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View className="mt-10 rounded-2xl border border-dashed border-border p-8">
            <Ionicons
              name="search-outline"
              size={26}
              color={muted}
              style={{ alignSelf: "center" }}
            />
            <Text className="mt-3 text-center text-sm font-medium text-foreground">
              Find a thought again
            </Text>
            <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
              Search runs against the full workspace index. Try a phrase, a tag, or a concept.
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}
