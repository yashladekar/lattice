import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useThemeColor } from "heroui-native";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/container";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export default function NotebooksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { workspace } = useWorkspace();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const notebooks = useQuery({
    queryKey: ["native-notebook-list", workspace?.id],
    queryFn: async () => client.notebook.list(),
    enabled: Boolean(workspace),
  });
  const pages = useQuery({
    queryKey: ["native-page-list", workspace?.id],
    queryFn: async () => client.page.list(),
    enabled: Boolean(workspace),
  });

  const pageCount = (notebookId: string) =>
    pages.data?.filter((page) => page.notebookId === notebookId).length ?? 0;
  const pagesOf = (notebookId: string) =>
    pages.data
      ?.filter((page) => page.notebookId === notebookId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()) ?? [];

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={notebooks.isFetching || pages.isFetching}
            tintColor={accent}
            onRefresh={() => {
              void notebooks.refetch();
              void pages.refetch();
            }}
          />
        ),
      }}
    >
      <View style={{ paddingTop: insets.top + 18 }} className="px-5 pb-8">
        <Text className="text-3xl font-semibold tracking-tight text-foreground">Notebooks</Text>
        <Text className="mt-1 text-xs text-muted">{workspace?.name}</Text>

        {notebooks.isLoading || pages.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : notebooks.data?.length ? (
          <View className="mt-5 gap-4">
            {notebooks.data.map((notebook) => {
              const notebookPages = pagesOf(notebook.id);
              return (
                <View key={notebook.id}>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-base">{notebook.icon ?? "◫"}</Text>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-foreground">{notebook.name}</Text>
                      <Text className="text-xs text-muted">
                        {pageCount(notebook.id)} pages
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
              accessibilityLabel="New page"
              hitSlop={12}
              className="h-8 w-8 items-center justify-center rounded-full border border-border bg-surface"
                      onPress={async () => {
                        const created = await client.page.create({
                          notebookId: notebook.id,
                          title: "Untitled",
                        });
                        router.push({ pathname: "/page/[id]", params: { id: created.id } });
                      }}
                    >
                      <Ionicons name="add-outline" size={18} color={foreground} />
                    </Pressable>
                  </View>

                  <View className="mt-2 overflow-hidden rounded-2xl border border-border bg-surface">
                    {notebookPages.length ? (
                      notebookPages.map((page, index) => (
                        <Pressable
                          key={page.id}
                          onPress={() =>
                            router.push({ pathname: "/page/[id]", params: { id: page.id } })
                          }
                          className={`flex-row items-center gap-2 px-3 py-3 ${
                            index > 0 ? "border-t border-border" : ""
                          }`}
                        >
                          <Text className="w-5 text-center text-xs">{page.icon ?? "◇"}</Text>
                          <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground">
                            {page.title}
                          </Text>
                          <Ionicons name="chevron-forward" size={13} color={muted} />
                        </Pressable>
                      ))
                    ) : (
                      <Text className="px-3 py-5 text-center text-[11px] text-muted">
                        No pages in this notebook yet.
                      </Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View className="mt-10 rounded-2xl border border-dashed border-border p-8">
            <Text className="text-center text-sm font-medium text-foreground">No notebooks yet</Text>
            <Text className="mt-1 text-center text-[11px] text-muted">
              Create notebooks in the web or desktop app; they appear here automatically.
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}
