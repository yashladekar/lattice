"use client";

import type { OutlineItem, Visibility } from "@notes-learning/domain";
import { formatRelative } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { Input } from "@notes-learning/ui/components/input";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  AtSign,
  RotateCcw,
  ArrowUpRight,
  Brain,
  Check,
  ChevronDown,
  CircleDot,
  Clock,
  FileText,
  Link2,
  MessageSquare,
  Plus,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import {
  useBacklinks,
  useOutgoingLinks,
  usePageComments,
  usePageFlashcards,
  usePageTags,
  useWorkspaceTags,
} from "@/hooks/use-local-data";
import {
  createCommentLocal,
  createTagLocal,
  deleteCommentLocal,
  deleteFlashcardLocal,
  generateCardsFromPageLocal,
  resolveCommentLocal,
  setPageTagsLocal,
  updatePageLocal,
  updatePagePropertiesLocal,
} from "@/lib/local/repository";
import type { LocalPage } from "@/lib/local/types";
import { appRouteObject } from "@/lib/navigation";
import { client } from "@/utils/orpc";

type Tab = "info" | "backlinks" | "comments";

const VISIBILITY_OPTIONS: Array<{ value: Visibility; label: string; hint: string }> = [
  { value: "WORKSPACE", label: "Workspace", hint: "Everyone in this workspace can read it" },
  { value: "PRIVATE", label: "Private", hint: "Only you and workspace admins" },
  { value: "SHARED", label: "Shared", hint: "Only people you share it with" },
  { value: "PUBLIC", label: "Public link", hint: "Anyone with an active share link" },
];

function propertyText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return String(value);
}

function PropertyRow({
  name,
  value,
  onCommit,
  onRemove,
}: {
  name: string;
  value: unknown;
  onCommit: (next: string) => void;
  onRemove: () => void;
}) {
  const initial = propertyText(value);
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  return (
    <div className="group flex items-center gap-1">
      <span
        className="w-16 shrink-0 truncate text-[9px] text-muted-foreground"
        title={name}
      >
        {name}
      </span>
      <input
        value={draft}
        aria-label={`Value for ${name}`}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft !== initial) onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(initial);
            event.currentTarget.blur();
          }
        }}
        className="h-6 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[10px] outline-none hover:border-border focus:border-primary/40 focus:bg-background"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/30 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      >
        <X className="size-2.5" />
      </button>
    </div>
  );
}

export function PageContextPanel({
  page,
  outline,
  focusBlockId,
  onClearBlock,
}: {
  page: LocalPage;
  outline: OutlineItem[];
  focusBlockId: string | null;
  onClearBlock: () => void;
}) {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const [tab, setTab] = useState<Tab>("info");
  const [commentText, setCommentText] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [tagText, setTagText] = useState("");
  const [propertyKey, setPropertyKey] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const comments = usePageComments(page.id);
  const backlinks = useBacklinks(page.id);
  const outgoing = useOutgoingLinks(page.id);
  const tags = usePageTags(page.id);
  const workspaceTags = useWorkspaceTags();
  const cards = usePageFlashcards(page.id);

  const membersQuery = useQuery({
    queryKey: ["workspace-members", activeWorkspaceId],
    queryFn: async () => {
      if (!activeWorkspaceId) return [];
      return client.workspace.members();
    },
    enabled: Boolean(activeWorkspaceId),
  });
  const memberNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of membersQuery.data ?? []) {
      map.set(member.userId, member.user.name);
    }
    return map;
  }, [membersQuery.data]);

  const roots = comments.filter((comment) => !comment.parentId && !comment.resolvedAt);
  const resolvedRoots = comments.filter((comment) => !comment.parentId && comment.resolvedAt);
  const repliesFor = (parentId: string) =>
    comments.filter((comment) => comment.parentId === parentId && !comment.resolvedAt);
  const authorName = (authorId: string) =>
    authorId === user?.id ? "You" : (memberNames.get(authorId) ?? "Teammate");

  const addComment = async () => {
    if (!db || !user || !activeWorkspaceId || !commentText.trim()) return;
    await createCommentLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      pageId: page.id,
      body: commentText.trim(),
      blockId: focusBlockId,
    });
    setCommentText("");
    toast.success("Comment added");
  };

  const insertMention = (name: string) => {
    setCommentText((current) => {
      const separator = current && !current.endsWith(" ") ? " " : "";
      return `${current}${separator}@${name} `;
    });
  };

  const setVisibility = async (visibility: Visibility) => {
    if (!db) return;
    await updatePageLocal(db, { pageId: page.id, visibility });
    toast.success(`Visibility set to ${visibility.toLowerCase()}`);
  };

  const addTag = async (tagId: string) => {
    if (!db) return;
    await setPageTagsLocal(db, page.id, [...tags.map((tag) => tag.id), tagId]);
  };

  const properties = page.properties ?? {};
  const propertyEntries = Object.entries(properties).filter(([key]) => key.trim());

  const setProperty = async (key: string, value: string) => {
    if (!db) return;
    await updatePagePropertiesLocal(db, page.id, { ...properties, [key]: value });
  };

  const removeProperty = async (key: string) => {
    if (!db) return;
    const next = { ...properties };
    delete next[key];
    await updatePagePropertiesLocal(db, page.id, next);
    toast.success(`Removed “${key}”`);
  };

  const addProperty = async () => {
    if (!db || !propertyKey.trim()) return;
    const key = propertyKey.trim();
    await updatePagePropertiesLocal(db, page.id, {
      ...properties,
      [key]: propertyValue.trim(),
    });
    setPropertyKey("");
    setPropertyValue("");
  };

  const createAndAddTag = async () => {
    if (!db || !activeWorkspaceId || !tagText.trim()) return;
    const tag = await createTagLocal(db, activeWorkspaceId, tagText.trim());
    await addTag(tag.id);
    setTagText("");
  };

  const generateCards = async () => {
    if (!db || !activeWorkspaceId) return;
    const created = await generateCardsFromPageLocal(db, {
      workspaceId: activeWorkspaceId,
      pageId: page.id,
    });
    toast.success(
      created.length ? `${created.length} cards added to Daily review` : "No new cards found",
    );
  };

  return (
    <aside className="flex h-full w-[286px] shrink-0 flex-col border-l border-border/60 bg-background/45">
      <div className="flex h-9 items-center gap-0.5 border-b border-border/60 px-2">
        {(
          [
            ["info", "Info", FileText],
            ["backlinks", "Links", Link2],
            ["comments", "Discuss", MessageSquare],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[9px] text-muted-foreground hover:bg-muted hover:text-foreground",
              tab === value && "bg-muted text-foreground",
            )}
          >
            <Icon className="size-3" />
            {label}
            {value === "comments" && roots.length ? (
              <span className="rounded-full bg-saffron/20 px-1 text-[8px] text-saffron">{roots.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {tab === "info" ? (
          <div className="space-y-5">
            <section>
              <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                Page
              </div>
              <div className="mt-2 space-y-1.5 text-[10px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{new Date(page.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span>{formatRelative(page.updatedAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Visibility</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-[9px] capitalize hover:bg-muted"
                        />
                      }
                    >
                      {page.visibility.toLowerCase()}
                      <ChevronDown className="size-2.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      {VISIBILITY_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option.value}
                          disabled={!db || page.visibility === option.value}
                          onClick={() => void setVisibility(option.value)}
                        >
                          <span className="flex flex-col">
                            <span className="text-[10px]">{option.label}</span>
                            <span className="text-[8px] text-muted-foreground">{option.hint}</span>
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span className="capitalize">{page.type.toLowerCase()}</span>
                </div>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Properties
                </div>
                <span className="text-[8px] text-muted-foreground">{propertyEntries.length}</span>
              </div>
              <div className="mt-2 space-y-0.5">
                {propertyEntries.map(([key, value]) => (
                  <PropertyRow
                    key={key}
                    name={key}
                    value={value}
                    onCommit={(next) => void setProperty(key, next)}
                    onRemove={() => void removeProperty(key)}
                  />
                ))}
                {!propertyEntries.length ? (
                  <p className="text-[9px] text-muted-foreground">No properties yet.</p>
                ) : null}
              </div>
              <div className="mt-2 flex gap-1">
                <input
                  value={propertyKey}
                  onChange={(event) => setPropertyKey(event.target.value)}
                  placeholder="Property"
                  className="h-6 w-16 shrink-0 rounded border border-border bg-background px-1 text-[9px] outline-none focus:border-primary/40"
                />
                <input
                  value={propertyValue}
                  onChange={(event) => setPropertyValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addProperty();
                  }}
                  placeholder="Value"
                  className="h-6 min-w-0 flex-1 rounded border border-border bg-background px-1 text-[9px] outline-none focus:border-primary/40"
                />
                <Button
                  size="sm"
                  className="h-6 rounded px-1.5 text-[8px]"
                  disabled={!propertyKey.trim()}
                  onClick={() => void addProperty()}
                >
                  <Plus className="size-2.5" />
                </Button>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Outline
                </div>
                <span className="text-[8px] text-muted-foreground">{outline.length} items</span>
              </div>
              <div className="mt-2 space-y-0.5">
                {outline.length ? (
                  outline.map((item) => (
                    <div
                      key={item.id}
                      className="truncate rounded px-1 py-0.5 text-[10px] text-muted-foreground"
                      style={{ paddingLeft: `${(item.level - 1) * 8 + 4}px` }}
                    >
                      {item.text || "Untitled heading"}
                    </div>
                  ))
                ) : (
                  <p className="text-[9px] text-muted-foreground">Add headings to build an outline.</p>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Tags
                </div>
                <Plus className="size-3 text-muted-foreground/50" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      void setPageTagsLocal(
                        db!,
                        page.id,
                        tags.filter((entry) => entry.id !== tag.id).map((entry) => entry.id),
                      )
                    }
                    disabled={!db}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[8px] text-muted-foreground hover:border-destructive/30 hover:text-destructive"
                    title="Remove tag"
                  >
                    <TagIcon className="size-2" /> {tag.name}
                    <X className="size-2" />
                  </button>
                ))}
                {!tags.length ? (
                  <span className="text-[9px] text-muted-foreground">No tags yet.</span>
                ) : null}
              </div>
              <div className="mt-2 flex gap-1">
                <Input
                  value={tagText}
                  onChange={(event) => setTagText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void createAndAddTag();
                  }}
                  placeholder="New tag"
                  className="h-7 rounded-md text-[10px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 rounded-md px-2 text-[9px]"
                  onClick={() => void createAndAddTag()}
                >
                  Add
                </Button>
              </div>
              {workspaceTags.filter((tag) => !tags.some((t) => t.id === tag.id)).length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {workspaceTags
                    .filter((tag) => !tags.some((t) => t.id === tag.id))
                    .slice(0, 8)
                    .map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => void addTag(tag.id)}
                        className="rounded-full border border-dashed border-border px-2 py-0.5 text-[8px] text-muted-foreground hover:bg-muted"
                      >
                        + {tag.name}
                      </button>
                    ))}
                </div>
              ) : null}
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Learning
                </div>
                <span className="text-[8px] text-muted-foreground">{cards.length} cards</span>
              </div>
              <div className="mt-2 space-y-1">
                {cards.slice(0, 3).map((card) => (
                  <div key={card.id} className="group flex items-start gap-1.5 rounded-md border border-border/60 bg-card/50 px-2 py-1.5">
                    <span className="mt-0.5">◒</span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-[9px] leading-snug">{card.front}</span>
                    <button
                      type="button"
                      aria-label="Delete card"
                      onClick={() => db && void deleteFlashcardLocal(db, card.id)}
                      className="opacity-0 hover:text-destructive group-hover:opacity-100"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-7 w-full rounded-md text-[9px]"
                onClick={() => void generateCards()}
              >
                <Brain className="size-3" /> Generate cards from this page
              </Button>
            </section>

            <section className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="flex items-center gap-1.5 text-[9px] font-medium">
                <Sparkles className="size-3 text-saffron" /> Ask about this page
              </div>
              <p className="mt-1 text-[8.5px] leading-relaxed text-muted-foreground">
                Use the Ask button in the top bar to summarize, find connections, or explain this page.
              </p>
            </section>
          </div>
        ) : null}

        {tab === "backlinks" ? (
          <div className="space-y-5">
            <section>
              <div className="flex items-center justify-between">
                <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Backlinks
                </div>
                <span className="text-[8px] text-muted-foreground">{backlinks.length}</span>
              </div>
              <div className="mt-2 space-y-1">
                {backlinks.map((backlink) => (
                  <button
                    key={backlink.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "page", id: backlink.id }))}
                    className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 text-left hover:bg-muted/50"
                  >
                    <span className="text-[10px]">{backlink.icon ?? "◇"}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px]">{backlink.title}</span>
                    <ArrowUpRight className="size-2.5 text-muted-foreground/50" />
                  </button>
                ))}
                {!backlinks.length ? (
                  <p className="text-[9px] text-muted-foreground">
                    No other page links here yet. Use [[ from another note.
                  </p>
                ) : null}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <div className="text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Outgoing
                </div>
                <span className="text-[8px] text-muted-foreground">{outgoing.length}</span>
              </div>
              <div className="mt-2 space-y-1">
                {outgoing.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "page", id: link.id }))}
                    className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 text-left hover:bg-muted/50"
                  >
                    <span className="text-[10px]">{link.icon ?? "◇"}</span>
                    <span className="min-w-0 flex-1 truncate text-[10px]">{link.title}</span>
                    <ArrowUpRight className="size-2.5 text-muted-foreground/50" />
                  </button>
                ))}
                {!outgoing.length ? (
                  <p className="text-[9px] text-muted-foreground">
                    This page does not reference others yet.
                  </p>
                ) : null}
              </div>
            </section>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full rounded-md text-[9px]"
              onClick={() => router.push(appRouteObject({ view: "graph" }))}
            >
              Open in knowledge graph <ArrowUpRight className="size-3" />
            </Button>
          </div>
        ) : null}

        {tab === "comments" ? (
          <div className="space-y-3">
            {focusBlockId ? (
              <div className="flex items-center gap-1.5 rounded-md border border-saffron/30 bg-saffron/[0.06] px-2 py-1.5 text-[9px] text-muted-foreground">
                <CircleDot className="size-3 text-saffron" />
                Anchored to a block
                <button type="button" onClick={onClearBlock} className="ml-auto text-foreground">
                  <X className="size-2.5" />
                </button>
              </div>
            ) : null}
            <div className="space-y-2">
              {roots.map((thread) => (
                <div key={thread.id} className="rounded-lg border border-border/60 bg-card/45 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="grid size-4 place-items-center rounded-full bg-moss/20 text-[7px] font-semibold text-moss">
                      {authorName(thread.authorId).slice(0, 1)}
                    </span>
                    <span className="text-[9px] font-medium">{authorName(thread.authorId)}</span>
                    <span className="ml-auto text-[8px] text-muted-foreground">
                      {formatRelative(thread.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed">{thread.body}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-[8px] text-muted-foreground">
                    <button
                      type="button"
                      onClick={() =>
                        db &&
                        void resolveCommentLocal(db, thread.id, true).then(() =>
                          toast.success("Thread resolved"),
                        )
                      }
                      className="inline-flex items-center gap-0.5 hover:text-moss"
                    >
                      <Check className="size-2.5" /> Resolve
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!db || !user || !activeWorkspaceId) return;
                        const reply = window.prompt("Reply");
                        if (!reply?.trim()) return;
                        void createCommentLocal(db, {
                          workspaceId: activeWorkspaceId,
                          userId: user.id,
                          pageId: page.id,
                          parentId: thread.id,
                          body: reply.trim(),
                        });
                      }}
                      className="hover:text-foreground"
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => db && void deleteCommentLocal(db, thread.id)}
                      className="ml-auto hover:text-destructive"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>
                  {repliesFor(thread.id).map((reply) => (
                    <div key={reply.id} className="mt-2 border-l border-border/70 pl-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[8px] font-medium">{authorName(reply.authorId)}</span>
                        <span className="text-[7px] text-muted-foreground">
                          {formatRelative(reply.createdAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-[9px] leading-relaxed text-muted-foreground">
                        {reply.body}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
              {resolvedRoots.length ? (
                <div className="mt-2 border-t border-border/60 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowResolved((current) => !current)}
                    className="text-[8.5px] text-muted-foreground hover:text-foreground"
                  >
                    {showResolved ? "Hide" : "Show"} {resolvedRoots.length} resolved
                  </button>
                  {showResolved ? (
                    <div className="mt-2 space-y-2">
                      {resolvedRoots.map((thread) => (
                        <div
                          key={thread.id}
                          className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-medium text-muted-foreground">
                              {authorName(thread.authorId)}
                            </span>
                            <span className="ml-auto text-[8px] text-muted-foreground">
                              {formatRelative(thread.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                            {thread.body}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              db &&
                              void resolveCommentLocal(db, thread.id, false).then(() =>
                                toast.success("Thread reopened"),
                              )
                            }
                            className="mt-1.5 inline-flex items-center gap-0.5 text-[8px] text-muted-foreground hover:text-foreground"
                          >
                            <RotateCcw className="size-2.5" /> Reopen
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!roots.length ? (
                <div className="py-8 text-center">
                  <MessageSquare className="mx-auto size-5 text-muted-foreground/40" />
                  <p className="mt-2 text-[10px] text-muted-foreground">No open discussions.</p>
                  <p className="mt-1 text-[8px] text-muted-foreground">
                    Comments sync asynchronously with your team.
                  </p>
                </div>
              ) : null}
            </div>
            <div className="sticky bottom-0 bg-background/80 pt-2 backdrop-blur">
              <Textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void addComment();
                  }
                }}
                placeholder="Add a comment…"
                className="min-h-16 rounded-lg text-[11px]"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[8px] text-muted-foreground">
                  <Clock className="size-2.5" /> ⌘↵ to send
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 rounded-md px-1.5 text-[8px] text-muted-foreground"
                        />
                      }
                    >
                      <AtSign className="size-3" /> Mention
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 w-52">
                      {(membersQuery.data ?? []).map((member) => (
                        <DropdownMenuItem
                          key={member.userId}
                          onClick={() => insertMention(member.user.name)}
                        >
                          <span className="grid size-4 shrink-0 place-items-center rounded-full bg-moss/20 text-[7px] font-semibold text-moss">
                            {member.user.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{member.user.name}</span>
                        </DropdownMenuItem>
                      ))}
                      {!membersQuery.data?.length ? (
                        <p className="px-2 py-3 text-center text-[9px] text-muted-foreground">
                          No teammates to mention yet.
                        </p>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
                <Button
                  size="sm"
                  className="h-7 rounded-md text-[9px]"
                  disabled={!commentText.trim()}
                  onClick={() => void addComment()}
                >
                  Comment
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
