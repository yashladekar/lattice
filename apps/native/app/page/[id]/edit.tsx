import { Ionicons } from "@expo/vector-icons";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Spinner, useThemeColor } from "heroui-native";
import { Text, View } from "react-native";

import { BlockEditor } from "@/components/editor/block-editor";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export default function NativePageEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pageId = String(id);
  const { workspace } = useWorkspace();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");

  const page = useQuery({
    queryKey: ["native-page", workspace?.id, pageId],
    queryFn: async () => client.page.get({ pageId }),
    enabled: Boolean(workspace && pageId),
    staleTime: 0,
  });

  const detail = page.data;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {page.isLoading ? (
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner size="sm" color="default" />
          <Text className="mt-2 text-xs text-muted">Loading note…</Text>
        </View>
      ) : detail ? (
        <BlockEditor
          pageId={pageId}
          initialTitle={detail.title}
          initialIcon={detail.icon}
          initialDoc={detail.document?.content}
          initialRev={detail.document?.rev ?? 0}
          onBack={() => router.back()}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ["native-page", workspace?.id, pageId] });
            void queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] });
            void queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] });
          }}
        />
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
