import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export default function TrashScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [tab, setTab] = useState<"pages" | "canvases">("pages");
  const [busy, setBusy] = useState<string | null>(null);

  const pages = useQuery({
    queryKey: ["native-trash-pages", workspace?.id],
    queryFn: async () => client.page.trash(),
    enabled: Boolean(workspace),
  });
  const canvases = useQuery({
    queryKey: ["native-trash-canvases", workspace?.id],
    queryFn: async () => client.canvas.trash(),
    enabled: Boolean(workspace),
  });

  const restorePage = async (pageId: string) => {
    setBusy(pageId);
    try {
      await client.page.restore({ pageId });
      await Promise.all([
        pages.refetch(),
        queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] }),
        queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] }),
      ]);
      toast.show({ variant: "success", label: "Page restored" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not restore the page",
      });
    } finally {
      setBusy(null);
    }
  };

  const restoreCanvas = async (canvasId: string) => {
    setBusy(canvasId);
    try {
      await client.canvas.restore({ canvasId });
      await Promise.all([
        canvases.refetch(),
        queryClient.invalidateQueries({ queryKey: ["native-canvases", workspace?.id] }),
      ]);
      toast.show({ variant: "success", label: "Canvas restored" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not restore the canvas",
      });
    } finally {
      setBusy(null);
    }
  };

  const data = tab === "pages" ? pages : canvases;

  return (
    <Container>
      <ScreenHeader
        title="Trash"
        subtitle="Retention clears items automatically; restore anything you still need"
        large
      />
      <View className="px-5 pb-10">
        <View className="mt-3 flex-row rounded-xl border border-border bg-surface-secondary p-1">
          {(
            [
              ["pages", `Pages · ${pages.data?.length ?? 0}`],
              ["canvases", `Canvases · ${canvases.data?.length ?? 0}`],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setTab(value)}
              className={`flex-1 items-center rounded-lg py-1.5 ${
                tab === value ? "bg-surface" : ""
              }`}
            >
              <Text
                className={`text-[11px] font-medium ${
                  tab === value ? "text-foreground" : "text-muted"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {data.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : tab === "pages" && pages.data?.length ? (
          <View className="mt-4 gap-2">
            {pages.data.map((page) => (
              <View
                key={page.id}
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface p-3"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-secondary">
                  <Text className="text-sm">{page.icon ?? "◇"}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[12px] font-medium text-foreground">
                    {page.title}
                  </Text>
                  <Text className="text-[9px] text-muted">
                    deleted{" "}
                    {page.deletedAt
                      ? new Date(page.deletedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      : "recently"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => void restorePage(page.id)}
                  disabled={busy === page.id}
                  className="rounded-lg border border-border px-2 py-1"
                >
                  <Text className="text-[10px] text-foreground">
                    {busy === page.id ? "…" : "Restore"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : tab === "canvases" && canvases.data?.length ? (
          <View className="mt-4 gap-2">
            {canvases.data.map((canvas) => (
              <View
                key={canvas.id}
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface p-3"
              >
                <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-secondary">
                  <Text className="text-sm">{canvas.icon ?? "▦"}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-[12px] font-medium text-foreground">
                    {canvas.title}
                  </Text>
                  <Text className="text-[9px] text-muted">rev {canvas.rev}</Text>
                </View>
                <Pressable
                  onPress={() => void restoreCanvas(canvas.id)}
                  disabled={busy === canvas.id}
                  className="rounded-lg border border-border px-2 py-1"
                >
                  <Text className="text-[10px] text-foreground">
                    {busy === canvas.id ? "…" : "Restore"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View className="mt-6 rounded-2xl border border-dashed border-border p-8">
            <Ionicons name="trash-outline" size={26} color={muted} style={{ alignSelf: "center" }} />
            <Text className="mt-3 text-center text-sm font-medium text-foreground">
              Trash is empty
            </Text>
            <Text className="mt-1 text-center text-[11px] text-muted">
              Deleted {tab === "pages" ? "pages" : "canvases"} wait here until retention clears
              them.
            </Text>
          </View>
        )}
      </View>
    </Container>
  );
}
