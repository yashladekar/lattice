"use client";

import {
  answerGraphQuery,
  docFromText,
  rankRecords,
  type AgentOp,
  type SearchableRecord,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BookOpen,
  History,
  Loader2,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { AgentPlanCard } from "@/components/ai/agent-plan-card";
import { useGraph, useWorkspaceSearchIndex } from "@/hooks/use-local-data";
import { applyAgentPlan } from "@/lib/local/apply-agent-plan";
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
  steps?: string[];
  plan?: { title: string; ops: AgentOp[]; warnings: string[]; appliedAt?: string };
  /** Database id of this turn, once the server has stored it. */
  dbMessageId?: string;
}

const SUGGESTIONS = [
  "What are the most connected notes?",
  "Which notes are orphans?",
  "What are the open questions across my research?",
  "Summarize what I know about local-first architecture",
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
  const graph = useGraph();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "provider" | "chatgpt" | "unknown">("unknown");
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const threads = useQuery({
    queryKey: ["ai-threads", activeWorkspaceId],
    queryFn: async () => client.ai.threads(),
    enabled: open && online && Boolean(activeWorkspaceId),
  });

  useEffect(() => {
    if (open && online) {
      void client.ai
        .status()
        .then((status) => {
          setMode(
            status.mode === "chatgpt" ? "chatgpt" : status.mode === "provider" ? "provider" : "local",
          );
          setAgentEnabled(Boolean(status.agent?.enabled));
        })
        .catch(() => setMode("local"));
    }
  }, [open, online]);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const patchAssistant = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...patch } : message)),
    );
  };

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
      const graphAnswer = answerGraphQuery(prompt, graph.nodes, graph.edges);
      if (graphAnswer) {
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: graphAnswer.answer,
            citations: graphAnswer.citations.map((citation) => ({
              pageId: citation.pageId ?? "",
              title: citation.title,
              excerpt: citation.excerpt,
            })),
            provider: "local",
            local: true,
          },
        ]);
        setMode("local");
        return;
      }
      if (online && activeWorkspaceId) {
        const assistantId = `assistant-${Date.now()}`;
        setMessages((current) => [
          ...current,
          { id: assistantId, role: "assistant", content: "", citations: [] },
        ]);

        const controller = new AbortController();
        abortRef.current = controller;

        let answer = "";
        let citations: Citation[] = [];
        let streamedThread: string | null = null;
        let provider: string | undefined;
        let local = false;
        let dbMessageId: string | undefined;
        const steps: string[] = [];
        let frame: number | null = null;
        const flush = () => {
          frame = null;
          patchAssistant(assistantId, { content: answer });
        };

        if (agentMode) {
          for await (const event of await client.ai.agentStream(
            { question: prompt, pageId: pageId ?? null, threadId },
            { signal: controller.signal },
          )) {
            if (event.type === "step") {
              steps.push(event.label);
              patchAssistant(assistantId, { steps: [...steps] });
            } else if (event.type === "delta") {
              answer += event.text;
              frame ??= requestAnimationFrame(flush);
            } else if (event.type === "plan") {
              patchAssistant(assistantId, {
                plan: {
                  title: event.plan.title,
                  ops: event.plan.ops,
                  warnings: event.warnings,
                },
              });
            } else if (event.type === "error") {
              answer = event.message;
              toast.error(event.message);
            } else {
              streamedThread = event.threadId;
              dbMessageId = event.messageId ?? undefined;
              provider = event.provider;
              local = event.local;
            }
          }
        } else {
          for await (const event of await client.ai.askStream(
            {
              question: prompt,
              ...(pageId ? { scope: { pageIds: [pageId] } } : {}),
              threadId,
            },
            { signal: controller.signal },
          )) {
            if (event.type === "citations") {
              citations = event.citations as Citation[];
            } else if (event.type === "delta") {
              answer += event.text;
              frame ??= requestAnimationFrame(flush);
            } else {
              streamedThread = event.threadId;
              citations = event.citations as Citation[];
              provider = event.provider;
              local = event.local;
              if (event.warning) toast.error(event.warning.message);
            }
          }
        }
        if (frame !== null) cancelAnimationFrame(frame);

        setThreadId(streamedThread);
        void queryClient.invalidateQueries({ queryKey: ["ai-threads", activeWorkspaceId] });
        patchAssistant(assistantId, {
          content: answer,
          citations,
          steps,
          ...(provider ? { provider } : {}),
          ...(dbMessageId ? { dbMessageId } : {}),
          local,
        });
        setMode((current) => (local ? "local" : current === "chatgpt" ? "chatgpt" : "provider"));
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
      if (abortRef.current?.signal.aborted) return;
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
      abortRef.current = null;
      setBusy(false);
    }
  };

  const pageTitles = (() => {
    const map: Record<string, string> = {};
    for (const page of index.pages) map[page.id] = page.title;
    return map;
  })();

  const applyPlan = async (message: ChatMessage) => {
    if (!db || !user || !activeWorkspaceId || !message.plan) {
      return { applied: 0, skipped: [] };
    }
    if (message.plan.appliedAt) {
      return { applied: 0, skipped: ["This plan was already applied."] };
    }
    const notebookId =
      (pageId ? index.pages.find((page) => page.id === pageId)?.notebookId : null) ?? null;
    const result = await applyAgentPlan(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId,
      ops: message.plan.ops,
    });
    if (result.applied) {
      // Mark it applied locally first so a second click has nothing to press,
      // then persist so the state survives a reload and reaches other devices.
      const appliedAt = new Date().toISOString();
      patchAssistant(message.id, { plan: { ...message.plan, appliedAt } });
      if (message.dbMessageId) {
        try {
          await client.ai.markPlanApplied({ messageId: message.dbMessageId });
        } catch {
          // Offline or the row vanished; the local marker still prevents repeats.
        }
      }
      toast.success(`Applied ${result.applied} change${result.applied === 1 ? "" : "s"}`);
    }
    return result;
  };

  const discardPlan = (id: string) => {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, plan: undefined } : message)),
    );
  };

  // A plan can land partially: the pages exist but their bodies never arrived.
  // Matching a blank page by title lets the approved markdown be restored
  // exactly, instead of regenerating an approximation.
  const blankPageIdByTitle = (() => {
    const textByPage = new Map(
      index.documents.map((document) => [document.pageId, document.plainText]),
    );
    const map = new Map<string, string>();
    for (const page of index.pages) {
      if ((textByPage.get(page.id) ?? "").length > 0) continue;
      if (!map.has(page.title)) map.set(page.title, page.id);
    }
    return map;
  })();

  const missingPagesFor = (message: ChatMessage): Array<{ pageId: string; markdown: string }> => {
    if (!message.plan) return [];
    const missing: Array<{ pageId: string; markdown: string }> = [];
    for (const op of message.plan.ops) {
      if (op.kind !== "create_page") continue;
      const blankPageId = blankPageIdByTitle.get(op.title);
      if (blankPageId) missing.push({ pageId: blankPageId, markdown: op.markdown });
    }
    return missing;
  };

  const repairPlan = async (message: ChatMessage) => {
    if (!db || !user || !activeWorkspaceId) return { applied: 0, skipped: [] };
    const missing = missingPagesFor(message);
    if (!missing.length) return { applied: 0, skipped: [] };
    const notebookId =
      (pageId ? index.pages.find((page) => page.id === pageId)?.notebookId : null) ?? null;
    const result = await applyAgentPlan(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      notebookId,
      ops: missing.map((entry) => ({
        kind: "replace_page" as const,
        pageId: entry.pageId,
        markdown: entry.markdown,
      })),
    });
    if (result.applied) {
      toast.success(
        `Restored content on ${result.applied} page${result.applied === 1 ? "" : "s"}`,
      );
    }
    return result;
  };

  const openThread = async (id: string) => {
    try {
      const thread = await client.ai.thread({ threadId: id });
      setMessages(
        thread.messages.map((message) => ({
          id: message.id,
          role: message.role === "user" ? ("user" as const) : ("assistant" as const),
          content: message.content,
          citations: Array.isArray(message.citations)
            ? (message.citations as Citation[])
            : [],
          ...(message.provider ? { provider: message.provider } : {}),
          local: message.provider === "local",
          // Plans survive a reload, so an old proposal can still be reviewed.
          ...(message.plan && typeof message.plan === "object"
            ? { plan: message.plan as NonNullable<ChatMessage["plan"]> }
            : {}),
          dbMessageId: message.id,
        })),
      );
      setThreadId(id);
      setHistoryOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open that conversation");
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
                    mode === "provider" || mode === "chatgpt" ? "bg-moss" : "bg-saffron",
                  )}
                />
                {mode === "chatgpt"
                  ? "ChatGPT plan"
                  : mode === "provider"
                    ? "AI provider connected"
                    : "Local mode · retrieval only"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setHistoryOpen((value) => !value)}
              aria-pressed={historyOpen}
              title="Recent conversations"
              className={cn(
                "grid size-7 place-items-center rounded-md tap-target",
                historyOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <History className="size-3.5" />
            </button>
            {agentEnabled ? (
              <button
                type="button"
                onClick={() => setAgentMode((value) => !value)}
                title="Let the assistant read pages and propose edits"
                aria-pressed={agentMode}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[8px]",
                  agentMode
                    ? "border-saffron/60 bg-saffron/10 text-foreground"
                    : "border-border/60 text-muted-foreground hover:bg-muted/50",
                )}
              >
                Plan
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setThreadId(null);
              }}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
              title="New conversation"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {historyOpen ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                  Recent conversations
                </span>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="text-[8px] text-link hover:underline"
                >
                  Back
                </button>
              </div>
              {(threads.data ?? []).map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => void openThread(thread.id)}
                  className={cn(
                    "block w-full rounded-lg border border-border/60 px-2.5 py-2 text-left hover:bg-muted/50",
                    thread.id === threadId ? "bg-saffron/5" : "bg-card/40",
                  )}
                >
                  <div className="truncate text-[10px] text-foreground">{thread.title}</div>
                  <div className="text-[8px] text-muted-foreground">
                    {new Date(thread.updatedAt).toLocaleString()}
                  </div>
                </button>
              ))}
              {threads.isLoading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                </div>
              ) : null}
              {threads.data && !threads.data.length ? (
                <p className="py-6 text-center text-[10px] text-muted-foreground">
                  No conversations yet. Ask something and it will appear here.
                </p>
              ) : null}
            </div>
          ) : !messages.length ? (
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
              {messages
                .filter(
                  (message) =>
                    message.role === "user" ||
                    message.content.length > 0 ||
                    Boolean(message.plan) ||
                    Boolean(message.steps?.length),
                )
                .map((message) =>
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
                    {message.steps?.length ? (
                      <div className="space-y-0.5">
                        {message.steps.map((step, index) => (
                          <div
                            key={`${step}-${index}`}
                            className="flex items-center gap-1 text-[8px] text-muted-foreground"
                          >
                            <span className="size-1 shrink-0 rounded-full bg-saffron/60" />
                            <span className="truncate">{step}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {message.content ? (
                      <div className="whitespace-pre-wrap rounded-xl border border-border/60 bg-card/45 px-3 py-2.5 text-[11px] leading-relaxed">
                        {message.content}
                      </div>
                    ) : null}
                    {message.plan ? (
                      <AgentPlanCard
                        title={message.plan.title}
                        ops={message.plan.ops}
                        warnings={message.plan.warnings}
                        pageTitles={pageTitles}
                        appliedAt={message.plan.appliedAt}
                        missingPages={missingPagesFor(message).length}
                        onRepair={() => repairPlan(message)}
                        onApply={() => applyPlan(message)}
                        onDiscard={() => discardPlan(message.id)}
                      />
                    ) : null}
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
                        className="inline-flex items-center gap-1 text-[8px] text-link hover:underline"
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
                {agentMode
                  ? "Plan mode · nothing is written until you apply"
                  : online
                    ? "Citations always included"
                    : "Offline · local retrieval only"}
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
