import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner, useThemeColor, useToast } from "heroui-native";
import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";
import { docToMarkdown, extractPlainText, safeDoc, simpleMarkdownToDoc } from "@notes-learning/domain";

/**
 * Markdown editing on the phone. The parser is the DOM-free subset from the
 * domain package, and saving goes through `page.saveDocument`, which is the
 * same revision-aware path the web app uses — a stale `baseRev` comes back as
 * a conflict instead of overwriting someone else's edit.
 */
export default function NativePageEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pageId = String(id);
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const background = useThemeColor("background");
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const [text, setText] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saving, setSaving] = useState(false);

  const page = useQuery({
    queryKey: ["native-page", workspace?.id, pageId],
    queryFn: async () => client.page.get({ pageId }),
    enabled: Boolean(workspace && pageId),
  });

  const detail = page.data;
  const baseRev = detail?.document?.rev ?? null;

  useEffect(() => {
    if (seeded || !detail) return;
    setText(docToMarkdown(safeDoc(detail.document?.content)));
    setSeeded(true);
  }, [detail, seeded]);

  const save = async () => {
    if (!detail || baseRev === null) return;
    setSaving(true);
    try {
      const content = simpleMarkdownToDoc(text);
      const result = await client.page.saveDocument({
        pageId,
        baseRev,
        content: content as unknown as Record<string, unknown>,
        plainText: extractPlainText(content as never),
      });
      if (result.conflict) {
        Alert.alert(
          "This note changed elsewhere",
          "Another device saved a newer version while you were editing. Reload to see it, or keep your text and resolve the conflict in the web app.",
          [
            {
              text: "Reload",
              onPress: async () => {
                const fresh = await page.refetch();
                setText(docToMarkdown(safeDoc(fresh.data?.document?.content)));
              },
            },
            { text: "Keep mine", style: "cancel" },
          ],
        );
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["native-page", workspace?.id, pageId] });
      await queryClient.invalidateQueries({ queryKey: ["native-recent", workspace?.id] });
      toast.show({ variant: "success", label: "Note saved" });
      router.back();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save the note",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: detail ? `Edit · ${detail.title}` : "Edit",
          headerStyle: { backgroundColor: background },
          headerTintColor: foreground,
          headerRight: () => (
            <Pressable onPress={() => void save()} hitSlop={8} disabled={saving || baseRev === null}>
              {saving ? (
                <Spinner size="sm" color="default" />
              ) : (
                <Text className="text-sm font-medium" style={{ color: accent }}>
                  Save
                </Text>
              )}
            </Pressable>
          ),
        }}
      />
      {page.isLoading ? (
        <View className="flex-1 items-center justify-center bg-background">
          <Spinner size="sm" color="default" />
          <Text className="mt-2 text-xs text-muted">Loading note…</Text>
        </View>
      ) : detail ? (
        <KeyboardAvoidingView
          className="flex-1 bg-background"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 40 }}>
            <View className="px-4 py-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="logo-markdown" size={14} color={muted} />
                <Text className="text-[10px] uppercase tracking-widest text-muted">
                  Markdown · saves as a new revision
                </Text>
              </View>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                textAlignVertical="top"
                placeholder="# Heading&#10;&#10;Write in Markdown…"
                placeholderTextColor={muted}
                className="mt-3 min-h-[420px] rounded-2xl border border-border bg-surface p-3 text-[13px] leading-6 text-foreground"
                style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
              />
              <View className="mt-3 flex-row items-center justify-between">
                <Text className="text-[9px] text-muted">
                  {text.length.toLocaleString()} characters · {baseRev === null ? "unknown" : `rev ${baseRev}`}
                </Text>
                <Button size="sm" onPress={() => void save()} isDisabled={saving || baseRev === null}>
                  {saving ? <Spinner size="sm" color="default" /> : <Button.Label>Save note</Button.Label>}
                </Button>
              </View>
              <Text className="mt-3 text-[9px] leading-5 text-muted">
                Headings, lists, task lists, quotes, fenced code, and inline bold/italic/code/links
                round-trip. Anything else is kept as plain text rather than dropped.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
