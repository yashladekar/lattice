import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from "react-native";
import { CANVAS_TEMPLATES } from "@notes-learning/domain";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

export default function CanvasesScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const canvases = useQuery({
    queryKey: ["native-canvases", workspace?.id],
    queryFn: async () => client.canvas.list(),
    enabled: Boolean(workspace),
  });

  const create = async (templateId: string) => {
    setCreating(true);
    try {
      const template = CANVAS_TEMPLATES.find((entry) => entry.id === templateId);
      const canvas = await client.canvas.create({
        title: template && template.id !== "blank" ? template.name : "Untitled canvas",
        templateId,
      });
      await queryClient.invalidateQueries({ queryKey: ["native-canvases", workspace?.id] });
      setTemplatesOpen(false);
      router.push(route(`/canvas/${canvas.id}`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the canvas",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Container
      scrollViewProps={{
        refreshControl: (
          <RefreshControl
            refreshing={canvases.isFetching}
            onRefresh={() => void canvases.refetch()}
            tintColor={accent}
          />
        ),
      }}
    >
      <ScreenHeader
        title="Canvases"
        subtitle="Infinite whiteboards with a pressure-aware pen"
        large
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New canvas"
            onPress={() => setTemplatesOpen(true)}
            className="h-9 w-9 items-center justify-center rounded-full bg-accent"
          >
            <Ionicons name="add" size={20} color="#1d1d1a" />
          </Pressable>
        }
      />
      <View className="px-5 pb-10">
        {canvases.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : canvases.data?.length ? (
          <View className="mt-4 gap-2">
            {canvases.data.map((canvas) => (
              <Pressable
                key={canvas.id}
                onPress={() => router.push(route(`/canvas/${canvas.id}`))}
                className="flex-row items-center gap-3 rounded-2xl border border-border bg-surface p-3.5"
              >
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-surface-secondary">
                  <Text className="text-lg">{canvas.icon ?? "▦"}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text numberOfLines={1} className="text-sm font-medium text-foreground">
                    {canvas.title}
                  </Text>
                  <Text className="mt-0.5 text-[10px] text-muted">
                    rev {canvas.rev} · edited{" "}
                    {new Date(canvas.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="mt-6 rounded-2xl border border-dashed border-border p-8">
            <Ionicons name="grid-outline" size={28} color={muted} style={{ alignSelf: "center" }} />
            <Text className="mt-3 text-center text-sm font-medium text-foreground">
              No canvases yet
            </Text>
            <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
              Start blank or pick a thinking, technical, learning, or presentation template.
            </Text>
            <Pressable
              onPress={() => setTemplatesOpen(true)}
              className="mt-4 self-center rounded-xl bg-accent px-4 py-2"
            >
              <Text className="text-xs font-semibold text-neutral-900">Create a canvas</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Sheet open={templatesOpen} onOpenChange={setTemplatesOpen} title="New canvas" snapPoints={["70%"]}>
        <View className="mt-2 gap-1">
          {CANVAS_TEMPLATES.map((template) => (
            <Pressable
              key={template.id}
              onPress={() => void create(template.id)}
              disabled={creating}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-[13px] font-medium text-foreground">{template.name}</Text>
                <Text className="text-[9px] uppercase tracking-wide text-muted">
                  {template.category}
                </Text>
              </View>
              <Text className="mt-0.5 text-[10px] text-muted">{template.description}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </Container>
  );
}
