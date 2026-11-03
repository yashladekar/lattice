"use client";

import {
  docFromText,
  rankRecords,
  type SearchableRecord,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  ArrowUpRight,
  BookOpen,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useWorkspaceSearchIndex } from "@/hooks/use-local-data";
import { createPageLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";
import { client } from "@/utils/orpc";

interface Citation {
  pageId: string;
  title: string;
  excerpt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  provider?: string;
  local?: boolean;
}

const SUGGESTIONS = [
  "What are the open questions across my research?",
  "Connect the ideas I have about knowledge graphs",
  "Summarize what I know about local-first architecture",
  "What should I learn next?",
];

export function AiPanel({
  open,
  onClose,
  pageId,
}: {
  open: boolean;
  onClose: () => void;
  pageId?: string | null;
}) {
  const router = useRouter();
  const { db, user, activeWorkspaceId, online } = useAppData();
  const index = useWorkspaceSearchIndex();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "provider" | "unknown">("unknown");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && online) {
      void client.ai
        .status()
        .then((status) => setMode(status.enabled ? "provider" : "local"))
        .catch(() => setMode("local"));
    }
  }, [open, online]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const ask = async (value?: string) => {
    const prompt = (value ?? question).trim();
    if (!prompt || busy) return;
    setQuestion("");
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      citations: [],
    };
    setMessages((current) => [...current, userMessage]);
    setBusy(true);
    try {
      if (online && activeWorkspaceId) {
        const result = await client.ai.ask({
          question: prompt,
          ...(pageId ? { scope: { pageIds: [pageId] } } : {}),
          threadId,
        });
        setThreadId(result.threadId);
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: result.answer,
            citations: result.citations as Citation[],
            provider: result.provider,
            local: result.local,
          },
        ]);
        setMode(result.local ? "local" : "provider");
      } else {
        const records: SearchableRecord[] = [
          ...index.pages.map((page) => ({
            type: "page" as const,
            id: page.id,
            workspaceId: page.workspaceId,
            title: page.title,
            body: index.documents.find((document) => document.pageId === page.id)?.plainText ?? "",
            icon: page.icon,
            updatedAt: page.updatedAt,
          })),
          ...index.canvases.map((canvas) => ({
            type: "canvas" as const,
            id: canvas.id,
            workspaceId: canvas.workspaceId,
            title: canvas.title,
            body: canvas.data.elements
              .map((element) => ("text" in element ? element.text : ""))
              .join(" "),
            icon: canvas.icon,
            updatedAt: canvas.updatedAt,
          })),
        ];
        const results = rankRecords(records, prompt, 5);
        const content = results.length
          ? `**Local mode** — offline retrieval from your device.\n\n${results
              .map(
                (result, index) =>
                  `${index + 1}. **${result.title}** — ${result.snippet || "Open the page for context."}`,
              )
              .join("\n\n")}`
          : "I could not find anything matching that in your local workspace. Try different words, or reconnect for a synthesized answer.";
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content,
            citations: results.map((result) => ({
              pageId: result.type === "page" ? result.id : "",
              title: result.title,
              excerpt: result.snippet,
            })),
            provider: "local",
            local: true,
          },
        ]);
        setMode("local");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ask failed");
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          content:
            "I could not reach the intelligence layer. Your notes are safe and still available locally; try again when online.",
          citations: [],
          local: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const createPageFromAnswer = async (message: ChatMessage) => {
    if (!db || !user || !activeWorkspaceId) return;
    const page = await createPageLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId: null,
      title: "Lattice answer",
      content: docFromText(message.content.replace(/\*\*/g, "")),
    });
    toast.success("Answer saved as a page");
    onClose();
    router.push(appRouteObject({ view: "page", id: page.page.id }));
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex justify-end">
      <button
        type="button"
        aria-label="Close Ask Lattice"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/20 backdrop-blur-[1px]"
      />
      <aside className="relative flex h-full w-full max-w-[420px] flex-col border-l border-border bg-background shadow-[-24px_0_60px_-30px_color-mix(in_oklch,var(--foreground)_40%,transparent)]">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-saffron/15 text-saffron">
              <Sparkles className="size-3.5" />
            </span>
            <div>
              <div className="text-[12px] font-semibold">Ask Lattice</div>
              <div className="flex items-center gap-1 text-[8px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1 rounded-full",
                    mode === "provider" ? "bg-moss" : "bg-saffron",
                  )}
                />
                {mode === "provider" ? "AI provider connected" : "Local mode · retrieval only"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setThreadId(null);
              }}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              title="New conversation"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {!messages.length ? (
            <div className="flex h-full flex-col justify-center">
              <div className="mx-auto max-w-xs text-center">
                <span className="mx-auto grid size-10 place-items-center rounded-xl border border-border/70 bg-card">
                  <Sparkles className="size-4 text-saffron" />
                </span>
                <h2 className="mt-4 font-display text-2xl tracking-[-0.02em]">Ask your second brain.</h2>
                <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                  Every answer cites the notes it used. Nothing is rewritten without your approval.
                </p>
              </div>
              <div className="mt-6 space-y-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void ask(suggestion)}
                    className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-left text-[10px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    <Sparkles className="size-3 text-saffron/70" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3 py-2 text-[11px] text-background">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <span className="grid size-4 place-items-center rounded-full bg-saffron/15 text-[8px] text-saffron">
                        ✦
                      </span>
                      <span className="text-[8px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {message.local ? "Local mode" : message.provider ?? "Lattice"}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap rounded-xl border border-border/60 bg-card/45 px-3 py-2.5 text-[11px] leading-relaxed">
                      {message.content}
                    </div>
                    {message.citations.length ? (
                      <div className="space-y-1">
                        <div className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                          Sources
                        </div>
                        {message.citations.map((citation, index) =>
                          citation.pageId ? (
                            <button
                              key={`${citationKey(citation, index)}`}
                              type="button"
                              onClick={() => {
                                onClose();
                                router.push(appRouteObject({ view: "page", id: citation.pageId }));
                              }}
                              className="flex w-full items-start gap-2 rounded-md border border-border/50 bg-background/60 px-2 py-1.5 text-left hover:bg-muted/50"
                            >
                              <span className="mt-0.5 text-[8px] text-saffron">[{index + 1}]</span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[9px] font-medium">{citation.title}</span>
                                <span className="mt-0.5 line-clamp-2 block text-[8px] text-muted-foreground">
                                  {citation.excerpt}
                                </span>
                              </span>
                              <ArrowUpRight className="size-2.5 shrink-0 text-muted-foreground/50" />
                            </button>
                          ) : null,
                        )}
                      </div>
                    ) : null}
                    {!message.local && message.content ? (
                      <button
                        type="button"
                        onClick={() => void createPageFromAnswer(message)}
                        className="inline-flex items-center gap-1 text-[8px] text-primary hover:underline"
                      >
                        <BookOpen className="size-2.5" /> Save answer as a page
                      </button>
                    ) : null}
                  </div>
                ),
              )}
              {busy ? (
                <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/45 px-3 py-2.5 text-[10px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Reading your workspace…
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-t border-border/60 p-3">
          <div className="rounded-xl border border-border/70 bg-card/45 p-2 focus-within:border-ring">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              placeholder={pageId ? "Ask about this page or across the workspace…" : "Ask across your knowledge…"}
              className="min-h-14 resize-none border-0 bg-transparent px-1 py-0.5 text-[11px] shadow-none focus-visible:ring-0"
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[8px] text-muted-foreground">
                {online ? "Citations always included" : "Offline · local retrieval only"}
              </span>
              <Button
                size="sm"
                className="h-6 rounded-md px-2 text-[9px]"
                disabled={busy || !question.trim()}
                onClick={() => void ask()}
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                Ask
              </Button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function citationKey(citation: Citation, index: number): string {
  return `${citation.pageId}-${index}`;
}
