import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Spinner, useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { useAiStatus } from "@/hooks/use-workspace-data";
import { route } from "@/lib/navigation";
import { client } from "@/utils/orpc";

interface Message {
  id: string;
  role: string;
  content: string;
  citations: Array<{ pageId: string; title: string; excerpt: string }>;
  provider: string | null;
}

export default function AssistantScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);

  const status = useAiStatus();
  const threads = useQuery({
    queryKey: ["native-ai-threads", workspace?.id],
    queryFn: async () => client.ai.threads(),
    enabled: Boolean(workspace),
  });
  const thread = useQuery({
    queryKey: ["native-ai-thread", workspace?.id, threadId],
    queryFn: async () => client.ai.thread({ threadId: threadId ?? "" }),
    enabled: Boolean(workspace && threadId),
  });

  const openThread = async (id: string) => {
    setThreadId(id);
    setThreadsOpen(false);
    const result = await client.ai.thread({ threadId: id });
    setMessages(
      result.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: Array.isArray(message.citations)
          ? (message.citations as Message["citations"])
          : [],
        provider: message.provider,
      })),
    );
  };

  const ask = async () => {
    const value = question.trim();
    if (value.length < 2 || asking) return;
    setQuestion("");
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content: value,
      citations: [],
      provider: null,
    };
    setMessages((current) => [...current, optimistic]);
    setAsking(true);
    try {
      const result = await client.ai.ask({ question: value, threadId });
      setThreadId(result.threadId);
      setMessages((current) => [
        ...current,
        {
          id: `answer-${Date.now()}`,
          role: "assistant",
          content: result.answer,
          citations: result.citations as Message["citations"],
          provider: result.provider,
        },
      ]);
      await queryClient.invalidateQueries({ queryKey: ["native-ai-threads", workspace?.id] });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "The assistant is unavailable",
      });
    } finally {
      setAsking(false);
    }
  };

  const reindex = async () => {
    try {
      const result = await client.ai.reindex();
      toast.show({
        variant: result.ok ? "success" : "default",
        label: result.ok
          ? `Indexed ${result.indexed} pages`
          : result.reason ?? "Semantic index unavailable",
      });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Reindex failed",
      });
    }
  };

  return (
    <Container isScrollable={false}>
      <ScreenHeader
        title="Assistant"
        subtitle={
          status.data?.enabled
            ? `Provider mode · ${status.data.model ?? "configured"}`
            : "Local retrieval mode · answers cite your notes"
        }
        large
        right={
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New conversation"
              onPress={() => {
                setThreadId(null);
                setMessages([]);
              }}
              className="h-9 w-9 items-center justify-center rounded-full border border-border"
            >
              <Ionicons name="add" size={18} color={muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Conversation history"
              onPress={() => setThreadsOpen(true)}
              className="h-9 w-9 items-center justify-center rounded-full border border-border"
            >
              <Ionicons name="time-outline" size={17} color={muted} />
            </Pressable>
          </>
        }
      />

      <View className="flex-row gap-1.5 px-4 py-2">
        <Pressable
          onPress={() => setHistoryOpen(true)}
          className="rounded-full border border-border bg-surface px-3 py-1"
        >
          <Text className="text-[10px] text-foreground">Index status</Text>
        </Pressable>
        <Pressable
          onPress={() => void reindex()}
          className="rounded-full border border-border bg-surface px-3 py-1"
        >
          <Text className="text-[10px] text-foreground">Reindex</Text>
        </Pressable>
        {status.data?.enabled ? null : (
          <Text className="ml-auto self-center text-[9px] text-amber-600">Local fallback</Text>
        )}
      </View>

      <View className="flex-1 px-4">
        <View className="flex-1 gap-2.5 pt-1">
          {!messages.length ? (
            <View className="mt-6 rounded-2xl border border-dashed border-border p-6">
              <Ionicons
                name="sparkles-outline"
                size={26}
                color={accent}
                style={{ alignSelf: "center" }}
              />
              <Text className="mt-3 text-center text-sm font-medium text-foreground">
                Ask your knowledge
              </Text>
              <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
                “What did I learn about spaced repetition?” Answers cite the notes they came from,
                and work locally without an AI provider.
              </Text>
            </View>
          ) : (
            messages.map((message) => (
              <View
                key={message.id}
                className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${
                  message.role === "user"
                    ? "self-end bg-accent"
                    : "self-start border border-border bg-surface"
                }`}
              >
                <Text
                  className={`text-[12.5px] leading-6 ${
                    message.role === "user" ? "text-neutral-900" : "text-foreground"
                  }`}
                >
                  {message.content}
                </Text>
                {message.citations.length ? (
                  <View className="mt-2 gap-1 border-t border-border/60 pt-2">
                    {message.citations.map((citation) => (
                      <Pressable
                        key={citation.pageId}
                        onPress={() => router.push(route(`/page/${citation.pageId}`))}
                        className="rounded-lg bg-surface-secondary px-2 py-1"
                      >
                        <Text className="text-[10px] font-medium text-foreground">
                          {citation.title}
                        </Text>
                        <Text numberOfLines={1} className="text-[9px] text-muted">
                          {citation.excerpt}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {message.role === "assistant" && message.provider ? (
                  <Text className="mt-1 text-right text-[8px] text-muted">
                    {message.provider}
                  </Text>
                ) : null}
              </View>
            ))
          )}
          {asking ? (
            <View className="self-start rounded-2xl border border-border bg-surface px-3 py-2">
              <Spinner size="sm" color="default" />
            </View>
          ) : null}
          {thread.isLoading ? <Spinner size="sm" color="default" /> : null}
        </View>

        <View className="mb-3 mt-2 flex-row items-end gap-2">
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask about your notes…"
            placeholderTextColor={muted}
            multiline
            className="min-h-11 max-h-32 min-w-0 flex-1 rounded-2xl border border-border bg-surface px-3 py-2.5 text-[13px] text-foreground"
          />
          <Pressable
            onPress={() => void ask()}
            disabled={asking || question.trim().length < 2}
            className="h-11 w-11 items-center justify-center rounded-full bg-accent"
          >
            <Ionicons name="arrow-up" size={18} color="#1d1d1a" />
          </Pressable>
        </View>
      </View>

      <Sheet open={threadsOpen} onOpenChange={setThreadsOpen} title="Conversations" snapPoints={["65%"]}>
        <View className="mt-2 gap-1">
          {(threads.data ?? []).map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => void openThread(entry.id)}
              className="rounded-xl border border-border bg-surface px-3 py-2.5"
            >
              <Text className="text-[12px] text-foreground">{entry.title}</Text>
              <Text className="text-[9px] text-muted">
                {new Date(entry.updatedAt).toLocaleString()}
              </Text>
            </Pressable>
          ))}
          {!threads.data?.length ? (
            <Text className="py-6 text-center text-[11px] text-muted">
              No conversations yet. Ask the first question.
            </Text>
          ) : null}
        </View>
      </Sheet>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen} title="Semantic index">
        <View className="mt-2 gap-2">
          <Text className="text-[12px] leading-5 text-foreground/80">
            {status.data?.enabled
              ? "Semantic retrieval is enabled. Reindex after large imports so Ask uses embeddings as well as lexical matching."
              : "No AI provider is configured. Ask still retrieves notes locally and labels every citation."}
          </Text>
          <Pressable
            onPress={() => {
              setHistoryOpen(false);
              void reindex();
            }}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Rebuild index</Text>
          </Pressable>
        </View>
      </Sheet>
    </Container>
  );
}
