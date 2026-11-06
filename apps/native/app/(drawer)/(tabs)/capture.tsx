import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  Button,
  Input,
  Label,
  Spinner,
  TextField,
  useThemeColor,
  useToast,
} from "heroui-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Container } from "@/components/container";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const foreground = useThemeColor("foreground");
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");
  const [mode, setMode] = useState<"NOTE" | "BOOKMARK">("NOTE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const captures = useQuery({
    queryKey: ["native-captures", workspace?.id],
    queryFn: async () => client.capture.list({ status: "INBOX" }),
    enabled: Boolean(workspace),
  });

  const save = async () => {
    if (mode === "NOTE" ? !content.trim() && !title.trim() : !url.trim()) return;
    setSaving(true);
    try {
      await client.capture.create({
        type: mode,
        title: title.trim() || (mode === "BOOKMARK" ? url.trim() : content.trim().slice(0, 80)),
        content: content.trim() || null,
        url: mode === "BOOKMARK" ? url.trim() : null,
        source: "mobile-capture",
      });
      setTitle("");
      setContent("");
      setUrl("");
      await queryClient.invalidateQueries({ queryKey: ["native-captures"] });
      toast.show({ variant: "success", label: "Captured to your inbox" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save capture",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container>
      <View style={{ paddingTop: insets.top + 18 }} className="px-5 pb-8">
        <Text className="text-3xl font-semibold tracking-tight text-foreground">Capture</Text>
        <Text className="mt-1 text-xs leading-5 text-muted">
          Get it out of your head. It lands in the workspace inbox for later.
        </Text>

        <View className="mt-5 flex-row rounded-xl border border-border bg-surface-secondary p-1">
          {(
            [
              ["NOTE", "Note"],
              ["BOOKMARK", "Link"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              className={`flex-1 items-center rounded-lg py-2 ${
                mode === value ? "bg-surface" : ""
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  mode === value ? "text-foreground" : "text-muted"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="mt-4 gap-3">
          <TextField>
            <Label>Title</Label>
            <Input value={title} onChangeText={setTitle} placeholder="Optional title" />
          </TextField>

          {mode === "BOOKMARK" ? (
            <TextField>
              <Label>URL</Label>
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="https://…"
                keyboardType="url"
                autoCapitalize="none"
              />
            </TextField>
          ) : null}

          <TextField>
            <Label>{mode === "NOTE" ? "Thought" : "Why does this matter?"}</Label>
            <Input
              value={content}
              onChangeText={setContent}
              placeholder={
                mode === "NOTE"
                  ? "A thought, a quote, a question…"
                  : "A note to future-you"
              }
              multiline
              numberOfLines={5}
              className="min-h-28 py-3"
              textAlignVertical="top"
            />
          </TextField>

          <Button onPress={() => void save()} isDisabled={saving}>
            {saving ? <Spinner size="sm" color="default" /> : <Button.Label>Capture to inbox</Button.Label>}
          </Button>
        </View>

        <View className="mt-7 flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted">
            Waiting in inbox
          </Text>
          <Text className="text-xs text-muted">{captures.data?.length ?? 0}</Text>
        </View>

        <View className="mt-3 gap-2">
          {captures.data?.length ? (
            captures.data.slice(0, 10).map((capture) => (
              <View
                key={capture.id}
                className="rounded-2xl border border-border bg-surface p-3"
              >
                <View className="flex-row items-center gap-2">
                  <Ionicons
                    name={capture.type === "BOOKMARK" ? "link-outline" : "document-text-outline"}
                    size={14}
                    color={accent}
                  />
                  <Text numberOfLines={1} className="min-w-0 flex-1 text-xs font-medium text-foreground">
                    {capture.title || capture.url || "Capture"}
                  </Text>
                  <Text className="text-xs text-muted">
                    {new Date(capture.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </View>
                {capture.content ? (
                  <Text numberOfLines={2} className="mt-1.5 text-[11px] leading-5 text-muted">
                    {capture.content}
                  </Text>
                ) : null}
              </View>
            ))
          ) : (
            <View className="rounded-2xl border border-dashed border-border p-6">
              <Text className="text-center text-[11px] text-muted">
                Inbox zero. Anything you capture here appears on every device.
              </Text>
            </View>
          )}
        </View>

        <View className="mt-6 flex-row items-center gap-2 rounded-2xl border border-border bg-surface p-3">
          <Ionicons name="cloud-done-outline" size={16} color={muted} />
          <Text className="flex-1 text-xs leading-4 text-muted">
            Saves to {workspace?.name ?? "your workspace"} · processed later in the web inbox.
          </Text>
        </View>
      </View>
    </Container>
  );
}
