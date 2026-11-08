import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { PageLinkPicker } from "@/components/editor/page-link-picker";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

export default function TemplatesScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const templates = useQuery({
    queryKey: ["native-templates", workspace?.id],
    queryFn: async () => client.page.templates(),
    enabled: Boolean(workspace),
  });

  const useTemplate = async (templateId: string, name: string) => {
    setBusy(templateId);
    try {
      const page = await client.page.create({
        title: name,
        templateId,
        type: "DOCUMENT",
      });
      await queryClient.invalidateQueries({ queryKey: ["native-pages", workspace?.id] });
      await queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] });
      router.push(route(`/page/${page.id}`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the page",
      });
    } finally {
      setBusy(null);
    }
  };

  const saveAsTemplate = async (pageId: string) => {
    try {
      const page = await client.page.get({ pageId });
      await client.template.createFromPage({
        pageId,
        name: `${page.title} template`,
        category: "Mobile",
        icon: page.icon,
      });
      await templates.refetch();
      setPickerOpen(false);
      toast.show({ variant: "success", label: "Template saved" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save the template",
      });
    }
  };

  const removeTemplate = async (templateId: string) => {
    try {
      await client.template.remove({ templateId });
      await templates.refetch();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not delete the template",
      });
    }
  };

  return (
    <Container>
      <ScreenHeader
        title="Templates"
        subtitle="Start from a structure, not a blank page"
        large
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save a page as a template"
            onPress={() => setPickerOpen(true)}
            className="h-9 w-9 items-center justify-center rounded-full border border-border"
          >
            <Ionicons name="add" size={18} color={muted} />
          </Pressable>
        }
      />
      <View className="px-5 pb-10">
        {templates.isLoading ? (
          <ActivityIndicator color={accent} className="py-12" />
        ) : (
          <>
            <Text className="mt-4 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Built in
            </Text>
            <View className="mt-2 gap-2">
              {(templates.data?.builtIn ?? []).map((template) => (
                <Pressable
                  key={template.id}
                  onPress={() => void useTemplate(template.id, template.name)}
                  disabled={busy === template.id}
                  className="rounded-2xl border border-border bg-surface p-3.5"
                >
                  <View className="flex-row items-center gap-2">
                    <Text className="text-base">{template.icon ?? "◇"}</Text>
                    <Text className="min-w-0 flex-1 text-[13px] font-medium text-foreground">
                      {template.name}
                    </Text>
                    <Text className="text-[9px] uppercase tracking-wide text-muted">
                      {template.category}
                    </Text>
                  </View>
                  <Text className="mt-1 text-[10px] leading-4 text-muted">
                    {template.description}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text className="mt-6 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Your templates
            </Text>
            <View className="mt-2 gap-2">
              {(templates.data?.custom ?? []).length ? (
                templates.data?.custom.map((template) => (
                  <View
                    key={template.id}
                    className="flex-row items-center gap-2 rounded-2xl border border-border bg-surface p-3.5"
                  >
                    <Text className="text-base">{template.icon ?? "◇"}</Text>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[13px] font-medium text-foreground">
                        {template.name}
                      </Text>
                      <Text className="text-[10px] text-muted">
                        {template.category}
                        {template.description ? ` · ${template.description}` : ""}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => void useTemplate(template.id, template.name)}
                      className="rounded-lg border border-border px-2 py-1"
                    >
                      <Text className="text-[10px] text-foreground">Use</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Delete template"
                      hitSlop={8}
                      onPress={() => void removeTemplate(template.id)}
                    >
                      <Ionicons name="trash-outline" size={14} color={muted} />
                    </Pressable>
                  </View>
                ))
              ) : (
                <Text className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
                  Save a page as a template to reuse its structure.
                </Text>
              )}
            </View>
          </>
        )}
      </View>

      <PageLinkPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Save a page as a template"
        onSelect={(pageId) => void saveAsTemplate(pageId)}
      />
    </Container>
  );
}
