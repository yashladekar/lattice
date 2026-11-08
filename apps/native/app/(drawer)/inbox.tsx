import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Input, Spinner, useThemeColor, useToast } from "heroui-native";
import { RecordingPresets, useAudioRecorder } from "expo-audio";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { useAiStatus } from "@/hooks/use-workspace-data";
import { pickDocument, pickImage } from "@/lib/files";
import { route } from "@/lib/navigation";
import { uploadFile } from "@/lib/upload";
import { client } from "@/utils/orpc";

const STATUS_TABS = [
  { id: "INBOX", label: "Inbox" },
  { id: "ORGANIZED", label: "Organized" },
  { id: "ARCHIVED", label: "Archived" },
] as const;

const TYPE_FILTERS = [
  { id: "all", label: "All" },
  { id: "NOTE", label: "Notes" },
  { id: "BOOKMARK", label: "Links" },
  { id: "IMAGE", label: "Images" },
  { id: "PDF", label: "PDFs" },
  { id: "AUDIO", label: "Audio" },
] as const;

const TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  NOTE: "document-text-outline",
  BOOKMARK: "link-outline",
  CLIP: "cut-outline",
  PDF: "document-outline",
  IMAGE: "image-outline",
  AUDIO: "mic-outline",
  VIDEO: "videocam-outline",
  YOUTUBE: "logo-youtube",
  TEXT: "text-outline",
  EMAIL: "mail-outline",
  FILE: "attach-outline",
};

type Capture = Awaited<ReturnType<typeof client.capture.list>>[number];

export default function InboxScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]["id"]>("INBOX");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]["id"]>("all");
  const [mode, setMode] = useState<"NOTE" | "BOOKMARK">("NOTE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [transcribeOpen, setTranscribeOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    capture: Capture;
    tags: string[];
    pages: Array<{ id: string; title: string; score: number }>;
  } | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const aiStatus = useAiStatus();

  const captures = useQuery({
    queryKey: ["native-inbox", workspace?.id, status],
    queryFn: async () => client.capture.list({ status }),
    enabled: Boolean(workspace),
  });

  const visible = (captures.data ?? []).filter(
    (capture) => typeFilter === "all" || capture.type === typeFilter,
  );

  const refresh = async () => {
    await captures.refetch();
  };

  const saveNote = async () => {
    if (mode === "NOTE" ? !content.trim() && !title.trim() : !url.trim()) return;
    setSaving(true);
    try {
      await client.capture.create({
        type: mode,
        title:
          title.trim() ||
          (mode === "BOOKMARK" ? url.trim() : content.trim().slice(0, 80) || "Quick capture"),
        content: content.trim() || null,
        url: mode === "BOOKMARK" ? url.trim() : null,
        source: "mobile-capture",
        previewUrl: mode === "BOOKMARK",
      });
      setTitle("");
      setContent("");
      setUrl("");
      setStatus("INBOX");
      await refresh();
      toast.show({ variant: "success", label: "Captured to your inbox" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not save the capture",
      });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: "image" | "file") => {
    try {
      const file = kind === "image" ? await pickImage() : await pickDocument();
      if (!file) return;
      setSaving(true);
      const uploaded = await uploadFile(file);
      const type =
        uploaded.mime.startsWith("image/")
          ? "IMAGE"
          : uploaded.mime.startsWith("audio/")
            ? "AUDIO"
            : uploaded.mime === "application/pdf"
              ? "PDF"
              : "FILE";
      await client.capture.create({
        type: type as never,
        title: file.name,
        content: null,
        url: uploaded.url,
        source: "mobile-upload",
        metadata: { mime: uploaded.mime, size: uploaded.size },
      });
      setStatus("INBOX");
      await refresh();
      toast.show({ variant: "success", label: "Uploaded to inbox" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleRecording = async () => {
    try {
      if (!recording) {
        const permission = await requestRecordingPermission();
        if (!permission) return;
        await recorder.prepareToRecordAsync();
        recorder.record();
        setRecording(true);
        return;
      }
      await recorder.stop();
      setRecording(false);
      const uri = recorder.uri;
      if (!uri) throw new Error("No audio was recorded");
      setSaving(true);
      const uploaded = await uploadFile({ uri, name: `voice-${Date.now()}.m4a`, mime: "audio/m4a" });
      await client.capture.create({
        type: "AUDIO",
        title: `Voice note · ${new Date().toLocaleString()}`,
        content: null,
        url: uploaded.url,
        source: "mobile-audio",
        metadata: { mime: uploaded.mime },
      });
      setStatus("INBOX");
      await refresh();
      toast.show({ variant: "success", label: "Voice note captured" });
    } catch (error) {
      setRecording(false);
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Recording failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const organize = async (capture: Capture) => {
    setBusyId(capture.id);
    try {
      const page = await client.capture.organize({ captureId: capture.id, notebookId: null });
      await refresh();
      router.push(route(`/page/${page.id}`));
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not organize",
      });
    } finally {
      setBusyId(null);
    }
  };

  const suggest = async (capture: Capture) => {
    setBusyId(capture.id);
    try {
      const result = await client.capture.suggest({ captureId: capture.id });
      setSuggestion({ capture, tags: result.tags, pages: result.pages });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not suggest connections",
      });
    } finally {
      setBusyId(null);
    }
  };

  const setCaptureStatus = async (capture: Capture, next: "ORGANIZED" | "ARCHIVED") => {
    setBusyId(capture.id);
    try {
      await client.capture.update({ captureId: capture.id, status: next });
      await refresh();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not update",
      });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (capture: Capture) => {
    setBusyId(capture.id);
    try {
      await client.capture.remove({ captureId: capture.id });
      await refresh();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not delete",
      });
    } finally {
      setBusyId(null);
    }
  };

  const extractPdf = async (capture: Capture) => {
    setBusyId(capture.id);
    try {
      const result = await client.capture.extractText({ captureId: capture.id });
      await refresh();
      toast.show({ variant: "success", label: `Extracted ${result.pages} pages` });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not extract text",
      });
    } finally {
      setBusyId(null);
    }
  };

  const transcribe = async (capture: Capture) => {
    setBusyId(capture.id);
    setTranscribeOpen(false);
    try {
      const result = await client.ai.transcribe({ captureId: capture.id });
      await refresh();
      toast.show({
        variant: "success",
        label: result.text ? "Transcribed" : "No text returned",
      });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Transcription failed",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Container>
      <ScreenHeader
        title="Inbox"
        subtitle={`${visible.length} captures · ${workspace?.name ?? ""}`}
        large
      />
      <View className="px-5 pb-10">
        <View className="mt-3 flex-row rounded-xl border border-border bg-surface-secondary p-1">
          {STATUS_TABS.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setStatus(tab.id)}
              className={`flex-1 items-center rounded-lg py-1.5 ${
                status === tab.id ? "bg-surface" : ""
              }`}
            >
              <Text
                className={`text-[11px] font-medium ${
                  status === tab.id ? "text-foreground" : "text-muted"
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="mt-4 rounded-2xl border border-border bg-surface p-3">
          <View className="flex-row rounded-lg bg-surface-secondary p-0.5">
            {(
              [
                ["NOTE", "Note"],
                ["BOOKMARK", "Link"],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => setMode(value)}
                className={`flex-1 items-center rounded-md py-1.5 ${
                  mode === value ? "bg-surface" : ""
                }`}
              >
                <Text
                  className={`text-[10px] font-medium ${
                    mode === value ? "text-foreground" : "text-muted"
                  }`}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>

          <View className="mt-2">
            <Input value={title} onChangeText={setTitle} placeholder="Optional title" />
          </View>
          {mode === "BOOKMARK" ? (
            <View className="mt-2">
              <Input
                value={url}
                onChangeText={setUrl}
                placeholder="https://…"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          ) : null}
          <TextInput
            value={content}
            onChangeText={setContent}
            placeholder={mode === "NOTE" ? "A thought, a quote, a question…" : "Why does this matter?"}
            placeholderTextColor={muted}
            multiline
            className="mt-2 min-h-[80px] rounded-xl border border-border bg-background px-3 py-2 text-[13px] leading-6 text-foreground"
            textAlignVertical="top"
          />

          <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
            <Pressable
              onPress={() => void saveNote()}
              disabled={saving}
              className="flex-row items-center gap-1.5 rounded-xl bg-accent px-3 py-2"
            >
              {saving ? <Spinner size="sm" color="default" /> : <Ionicons name="add" size={14} color="#1d1d1a" />}
              <Text className="text-[11px] font-semibold text-neutral-900">Capture</Text>
            </Pressable>
            <Pressable
              onPress={() => void upload("image")}
              className="flex-row items-center gap-1.5 rounded-xl border border-border px-2.5 py-2"
            >
              <Ionicons name="image-outline" size={14} color={muted} />
              <Text className="text-[10px] text-foreground">Image</Text>
            </Pressable>
            <Pressable
              onPress={() => void upload("file")}
              className="flex-row items-center gap-1.5 rounded-xl border border-border px-2.5 py-2"
            >
              <Ionicons name="attach-outline" size={14} color={muted} />
              <Text className="text-[10px] text-foreground">File</Text>
            </Pressable>
            <Pressable
              onPress={() => void toggleRecording()}
              className={`flex-row items-center gap-1.5 rounded-xl border px-2.5 py-2 ${
                recording ? "border-rose-300 bg-rose-50" : "border-border"
              }`}
            >
              <Ionicons
                name={recording ? "stop-circle-outline" : "mic-outline"}
                size={14}
                color={recording ? "#dc2626" : muted}
              />
              <Text className={`text-[10px] ${recording ? "text-rose-600" : "text-foreground"}`}>
                {recording ? "Stop" : "Voice"}
              </Text>
            </Pressable>
          </View>
        </View>

        <View className="mt-4 flex-row gap-1.5 overflow-hidden">
          {TYPE_FILTERS.map((filter) => (
            <Pressable
              key={filter.id}
              onPress={() => setTypeFilter(filter.id)}
              className={`rounded-full border px-2.5 py-1 ${
                typeFilter === filter.id
                  ? "border-amber-500/50 bg-amber-100"
                  : "border-border bg-surface"
              }`}
            >
              <Text
                className={`text-[10px] ${
                  typeFilter === filter.id ? "text-neutral-900" : "text-muted"
                }`}
              >
                {filter.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="mt-3 gap-2">
          {captures.isLoading ? (
            <Spinner size="sm" color="default" />
          ) : visible.length ? (
            visible.map((capture) => {
              const preview =
                typeof capture.metadata === "object" &&
                capture.metadata !== null &&
                typeof (capture.metadata as Record<string, unknown>).preview === "object"
                  ? ((capture.metadata as Record<string, unknown>).preview as {
                      title?: string;
                      description?: string;
                      image?: string | null;
                    })
                  : null;
              return (
                <View key={capture.id} className="rounded-2xl border border-border bg-surface p-3">
                  <View className="flex-row items-start gap-2">
                    <View className="h-8 w-8 items-center justify-center rounded-lg bg-surface-secondary">
                      <Ionicons
                        name={TYPE_ICONS[capture.type] ?? "document-text-outline"}
                        size={15}
                        color={accent}
                      />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={2} className="text-[12px] font-medium text-foreground">
                        {capture.title || capture.url || "Capture"}
                      </Text>
                      <Text className="text-[9px] text-muted">
                        {capture.type.toLowerCase()} · {relative(capture.createdAt)}
                      </Text>
                      {capture.content ? (
                        <Text numberOfLines={3} className="mt-1 text-[11px] leading-5 text-muted">
                          {capture.content}
                        </Text>
                      ) : null}
                      {preview?.description ? (
                        <Text numberOfLines={2} className="mt-1 text-[10px] text-muted">
                          {preview.description}
                        </Text>
                      ) : null}
                      {capture.url ? (
                        <Text numberOfLines={1} className="mt-1 text-[10px] text-amber-600">
                          {capture.url}
                        </Text>
                      ) : null}
                    </View>
                  </View>

                  <View className="mt-2 flex-row flex-wrap items-center gap-1">
                    {capture.status === "INBOX" ? (
                      <Pressable
                        onPress={() => void organize(capture)}
                        disabled={busyId === capture.id}
                        className="rounded-lg border border-border px-2 py-1"
                      >
                        <Text className="text-[10px] text-foreground">Make page</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => void suggest(capture)}
                      disabled={busyId === capture.id}
                      className="rounded-lg border border-border px-2 py-1"
                    >
                      <Text className="text-[10px] text-foreground">Connect</Text>
                    </Pressable>
                    {capture.type === "PDF" && capture.url ? (
                      <Pressable
                        onPress={() => void extractPdf(capture)}
                        disabled={busyId === capture.id}
                        className="rounded-lg border border-border px-2 py-1"
                      >
                        <Text className="text-[10px] text-foreground">Extract text</Text>
                      </Pressable>
                    ) : null}
                    {capture.type === "AUDIO" && capture.url ? (
                      <Pressable
                        onPress={() => setTranscribeOpen(true)}
                        disabled={busyId === capture.id}
                        className="rounded-lg border border-border px-2 py-1"
                      >
                        <Text className="text-[10px] text-foreground">Transcribe</Text>
                      </Pressable>
                    ) : null}
                    {capture.status !== "ARCHIVED" ? (
                      <Pressable
                        onPress={() => void setCaptureStatus(capture, "ARCHIVED")}
                        className="rounded-lg border border-border px-2 py-1"
                      >
                        <Text className="text-[10px] text-muted">Archive</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => void setCaptureStatus(capture, "ORGANIZED")}
                        className="rounded-lg border border-border px-2 py-1"
                      >
                        <Text className="text-[10px] text-muted">Restore</Text>
                      </Pressable>
                    )}
                    <Pressable
                      onPress={() => void remove(capture)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-2 py-1"
                    >
                      <Text className="text-[10px] text-rose-600">Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          ) : (
            <View className="rounded-2xl border border-dashed border-border p-8">
              <Text className="text-center text-sm font-medium text-foreground">
                {status === "INBOX" ? "Inbox zero" : "Nothing here"}
              </Text>
              <Text className="mt-1 text-center text-[11px] text-muted">
                Capture a thought, link, image, PDF, or voice note above.
              </Text>
            </View>
          )}
        </View>
      </View>

      <Sheet
        open={suggestion !== null}
        onOpenChange={(open) => {
          if (!open) setSuggestion(null);
        }}
        title="Connections"
        scroll
      >
        {suggestion ? (
          <View className="mt-2 gap-3">
            {suggestion.tags.length ? (
              <View>
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Suggested tags
                </Text>
                <View className="mt-1 flex-row flex-wrap gap-1">
                  {suggestion.tags.map((tag) => (
                    <View key={tag} className="rounded-full border border-border px-2 py-0.5">
                      <Text className="text-[10px] text-foreground">#{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            {suggestion.pages.length ? (
              <View>
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Related pages
                </Text>
                <View className="mt-1 gap-1">
                  {suggestion.pages.map((page) => (
                    <Pressable
                      key={page.id}
                      onPress={() => {
                        setSuggestion(null);
                        router.push(route(`/page/${page.id}`));
                      }}
                      className="rounded-xl border border-border bg-surface px-3 py-2"
                    >
                      <Text className="text-[12px] text-foreground">{page.title}</Text>
                      <Text className="text-[9px] text-muted">
                        {Math.round(page.score * 100)}% shared language
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {!suggestion.tags.length && !suggestion.pages.length ? (
              <Text className="py-6 text-center text-[11px] text-muted">
                No suggestions yet. Organize more notes and try again.
              </Text>
            ) : null}
          </View>
        ) : null}
      </Sheet>

      <Sheet open={transcribeOpen} onOpenChange={setTranscribeOpen} title="Transcribe audio">
        <Text className="mt-1 text-[11px] leading-5 text-muted">
          Audio is sent to the workspace AI provider.{" "}
          {aiStatus.data?.enabled ? `Model: ${aiStatus.data.model ?? "configured"}.` : "AI is not configured, so this will fail until a provider is added."}
        </Text>
        <View className="mt-3 gap-1">
          {visible
            .filter((capture) => capture.type === "AUDIO")
            .map((capture) => (
              <Pressable
                key={capture.id}
                onPress={() => void transcribe(capture)}
                className="rounded-xl border border-border bg-surface px-3 py-2.5"
              >
                <Text className="text-[12px] text-foreground">{capture.title}</Text>
              </Pressable>
            ))}
          {!visible.some((capture) => capture.type === "AUDIO") ? (
            <Text className="py-6 text-center text-[11px] text-muted">
              No audio captures in this view.
            </Text>
          ) : null}
        </View>
      </Sheet>
    </Container>
  );
}

function relative(value: string | Date): string {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

async function requestRecordingPermission(): Promise<boolean> {
  const { requestRecordingPermissionsAsync } = await import("expo-audio");
  const permission = await requestRecordingPermissionsAsync();
  return permission.granted;
}
