import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Input, useThemeColor } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/container";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { workspace } = useWorkspace();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const results = useQuery({
    queryKey: ["native-search", workspace?.id, submitted],
    queryFn: async () => client.search.query({ query: submitted, limit: 30 }),
    enabled: Boolean(workspace) && submitted.trim().length > 1,
  });

  return (
    <Container>
      <View style={{ paddingTop: insets.top + 18 }} className="px-5 pb-8">
        <Text className="text-3xl font-semibold tracking-tight text-foreground">Search</Text>
        <Text className="mt-1 text-xs text-muted">
          Notes, canvases, captures, and cards in {workspace?.name}.
        </Text>

        <View className="mt-4 flex-row items-center gap-2">
          <View className="flex-1">
            <Input
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => setSubmitted(query.trim())}
              placeholder="Search your knowledge…"
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search"
            hitSlop={12}
            onPress={() => setSubmitted(query.trim())}
            className="h-10 w-10 items-center justify-center rounded-xl bg-amber-500"
          >
            <Ionicons name="search" size={17} color="#1d1d1a" />
          </Pressable>
        </View>

        {submitted ? (
          <View className="mt-4">
            {results.isLoading ? (
              <ActivityIndicator color={accent} className="py-10" />
            ) : results.data?.length ? (
              <View className="gap-2">
                {results.data.map((result) => (
                  <Pressable
                    key={`${result.type}-${result.id}`}
                    onPress={() => {
                      if (result.type === "page") {
                        router.push({ pathname: "/page/[id]", params: { id: result.id } });
                      }
                    }}
                    className="rounded-2xl border border-border bg-surface p-3.5"
                  >
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm">{result.icon ?? "◇"}</Text>
                      <Text className="min-w-0 flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
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
                  Try fewer words or search a different concept.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View className="mt-10 rounded-2xl border border-dashed border-border p-8">
            <Ionicons name="search-outline" size={26} color={muted} style={{ alignSelf: "center" }} />
            <Text className="mt-3 text-center text-sm font-medium text-foreground">
              Find a thought again
            </Text>
            <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
              Search runs against the full workspace index on the server. Page results open in the
              mobile reader.
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}
