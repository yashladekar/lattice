import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner, useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { NativeDocument } from "@/components/native-document";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export default function NativePageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [generating, setGenerating] = useState(false);

  const page = useQuery({
    queryKey: ["native-page", workspace?.id, id],
    queryFn: async () => client.page.get({ pageId: String(id) }),
    enabled: Boolean(workspace && id),
  });

  const detail = page.data;
  const document = detail?.document?.content as never;
  const tags = detail?.tags ?? [];

  const generate = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const result = await client.learning.generate({ pageId: String(id) });
      await queryClient.invalidateQueries({ queryKey: ["native-due"] });
      await queryClient.invalidateQueries({ queryKey: ["native-stats"] });
      toast.show({
        variant: "success",
        label: result.created
          ? `${result.created} cards added to Daily review`
          : "No new cards found",
      });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not generate cards",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: detail?.title ?? "Note",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
        }}
      />
      {page.isLoading ? (
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner size="sm" color="default" />
          <Text className="mt-2 text-xs text-muted">Loading note…</Text>
        </View>
      ) : detail ? (
        <ScrollView className="flex-1 bg-background" contentContainerStyle={{ paddingBottom: 40 }}>
          <View className="px-5 py-5">
            <View className="flex-row items-center gap-2">
              <Text className="text-2xl">{detail.icon ?? "◇"}</Text>
              <View className="rounded-full border border-border px-2 py-0.5">
                <Text className="text-[9px] uppercase tracking-wider text-muted">
                  {detail.type?.toLowerCase() ?? "document"}
                </Text>
              </View>
              {tags.map((tag) => (
                <View key={tag.id} className="rounded-full border border-border px-2 py-0.5">
                  <Text className="text-[9px] text-muted">{tag.name}</Text>
                </View>
              ))}
            </View>

            <Text className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              {detail.title}
            </Text>
            <Text className="mt-1 text-[10px] text-muted">
              Edited {new Date(detail.updatedAt).toLocaleString()}
            </Text>

            <View className="mt-5">
              <NativeDocument doc={document} />
            </View>

            <View className="mt-8 rounded-2xl border border-border bg-surface p-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="school-outline" size={15} color={accent} />
                <Text className="text-xs font-medium text-foreground">Turn this note into recall</Text>
              </View>
              <Text className="mt-1.5 text-[10px] leading-5 text-muted">
                Generate flashcards from the note's structure, then review them on this device or
                anywhere else.
              </Text>
              <Button onPress={() => void generate()} isDisabled={generating} className="mt-3">
                {generating ? (
                  <Spinner size="sm" color="default" />
                ) : (
                  <Button.Label>Generate flashcards</Button.Label>
                )}
              </Button>
            </View>

            <Text className="mt-6 text-center text-[9px] text-muted">
              Shared knowledge · {workspace?.name}
            </Text>
          </View>
        </ScrollView>
      ) : (
        <View className="flex-1 items-center justify-center bg-background px-8">
          <Ionicons name="document-outline" size={30} color={muted} />
          <Text className="mt-3 text-sm font-medium text-foreground">Note unavailable</Text>
          <Text className="mt-1 text-center text-[11px] text-muted">
            It may be private, deleted, or not synced to this device.
          </Text>
        </View>
      )}
    </>
  );
}
