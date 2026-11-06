"use client";

import type { OutlineItem, PropertyValue, Visibility } from "@notes-learning/domain";
import {
  coercePropertyValue,
  commentStats,
  filterCommentThreads,
  formatRelative,
  groupThreadsByBlock,
  parsePropertyDefinitions,
  threadReplies,
  type CommentStatusFilter,
} from "@notes-learning/domain";
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
import { useLiveQuery } from "dexie-react-hooks";
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
import { PromptDialog } from "@/components/ui/prompt-dialog";
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
import type { LocalComment, LocalPage } from "@/lib/local/types";
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
        className="w-16 shrink-0 truncate text-xs text-muted-foreground"
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
        className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-xs outline-none hover:border-border focus:border-primary/40 focus:bg-background"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground/30 transition-opacity hover:bg-destructive/10 hover:text-destructive hover-reveal tap-target"
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
  onClose,
}: {
  page: LocalPage;
  outline: OutlineItem[];
  focusBlockId: string | null;
  onClearBlock: () => void;
  onClose?: () => void;
}) {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const [tab, setTab] = useState<Tab>("info");
  const [commentText, setCommentText] = useState("");
  const [statusFilter, setStatusFilter] = useState<CommentStatusFilter>("open");
  const [search, setSearch] = useState("");
  const [anchoredOnly, setAnchoredOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [tagText, setTagText] = useState("");
  const [propertyKey, setPropertyKey] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const comments = usePageComments(page.id);
  const backlinks = useBacklinks(page.id);
  const outgoing = useOutgoingLinks(page.id);
  const tags = usePageTags(page.id);
  const workspaceTags = useWorkspaceTags();
  const cards = usePageFlashcards(page.id);
  const objectTypes =
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        return db.objectTypes.where("workspaceId").equals(activeWorkspaceId).toArray();
      },
      [db, activeWorkspaceId],
      [],
    ) ?? [];

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

  const stats = commentStats(comments);
  const threads = filterCommentThreads(comments, {
    status: statusFilter,
    query: search,
    blockId: focusBlockId ?? undefined,
    anchoredOnly,
  });
  const visibleThreads = threads.slice(0, visibleCount);
  const threadGroups = grouped
    ? groupThreadsByBlock(visibleThreads)
    : [{ blockId: null, threads: visibleThreads }];
  const authorName = (authorId: string) =>
    authorId === user?.id ? "You" : (memberNames.get(authorId) ?? "Teammate");

  useEffect(() => {
    setVisibleCount(20);
  }, [statusFilter, search, anchoredOnly, grouped, focusBlockId]);

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

  const [replyTo, setReplyTo] = useState<{ threadId: string; authorName: string } | null>(null);

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
  const objectTypeId = typeof properties.__type === "string" ? properties.__type : null;
  const assignedType =
    objectTypes.find((type) => type.id === objectTypeId && !type.deletedAt) ?? null;
  const typedProperties = assignedType ? parsePropertyDefinitions(assignedType.properties) : [];
  const typedKeys = new Set(typedProperties.map((definition) => definition.key));
  // Keys the assigned schema renders are not repeated as freeform properties,
  // where they could be edited or removed as if they were plain text.
  const propertyEntries = Object.entries(properties).filter(
    ([key]) => key.trim() && key !== "__type" && !typedKeys.has(key),
  );

  const setObjectType = async (nextId: string) => {
    if (!db) return;
    const next = { ...properties };
    if (nextId) next.__type = nextId;
    else delete next.__type;
    await updatePagePropertiesLocal(db, page.id, next);
    toast.success(nextId ? "Object type assigned" : "Object type cleared");
  };

  const setTypedValue = async (key: string, value: PropertyValue) => {
    if (!db) return;
    await updatePagePropertiesLocal(db, page.id, { ...properties, [key]: value });
  };

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

  const jumpToBlock = (blockId: string) => {
    window.dispatchEvent(
      new CustomEvent("lattice:scroll-to-block", { detail: { blockId } }),
    );
  };

  const renderThread = (thread: LocalComment) => {
    const replies = threadReplies(comments, thread.id);
    const expanded = expandedReplies.has(thread.id);
    const shown = expanded ? replies : replies.slice(0, 2);
    return (
      <div
        key={thread.id}
        className={cn(
          "rounded-lg border p-2.5",
          thread.resolvedAt ? "border-border/50 bg-background/40" : "border-border/60 bg-card/45",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="grid size-5 place-items-center rounded-full bg-moss/20 text-xs font-semibold text-moss">
            {authorName(thread.authorId).slice(0, 1)}
          </span>
          <span
            className={cn("text-xs font-medium", thread.resolvedAt && "text-muted-foreground")}
          >
            {authorName(thread.authorId)}
          </span>
          {thread.resolvedAt ? (
            <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-xs text-muted-foreground">
              resolved
            </span>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatRelative(thread.createdAt)}
          </span>
        </div>
        <p
          className={cn(
            "mt-1.5 whitespace-pre-wrap text-xs leading-relaxed",
            thread.resolvedAt && "text-muted-foreground",
          )}
        >
          {thread.body}
        </p>
        {thread.blockId ? (
          <button
            type="button"
            onClick={() => jumpToBlock(thread.blockId!)}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-saffron/30 px-1.5 py-0.5 text-xs text-saffron hover:bg-saffron/10"
          >
            <CircleDot className="size-2" /> Jump to block
          </button>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
          {thread.resolvedAt ? (
            <button
              type="button"
              onClick={() =>
                db &&
                void resolveCommentLocal(db, thread.id, false).then(() =>
                  toast.success("Thread reopened"),
                )
              }
              className="inline-flex items-center gap-0.5 hover:text-foreground"
            >
              <RotateCcw className="size-2.5" /> Reopen
            </button>
          ) : (
            <>
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
                onClick={() => setReplyTo({ threadId: thread.id, authorName: authorName(thread.authorId) })}
                className="hover:text-foreground"
              >
                Reply
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => db && void deleteCommentLocal(db, thread.id)}
            className="ml-auto hover:text-destructive"
          >
            <Trash2 className="size-2.5" />
          </button>
        </div>
        {shown.map((reply) => (
          <div key={reply.id} className="mt-2 border-l border-border/70 pl-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium">{authorName(reply.authorId)}</span>
              <span className="text-xs text-muted-foreground">
                {formatRelative(reply.createdAt)}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {reply.body}
            </p>
          </div>
        ))}
        {replies.length > 2 ? (
          <button
            type="button"
            onClick={() =>
              setExpandedReplies((current) => {
                const next = new Set(current);
                if (next.has(thread.id)) next.delete(thread.id);
                else next.add(thread.id);
                return next;
              })
            }
            className="mt-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Show fewer replies" : `Show ${replies.length - 2} more replies`}
          </button>
        ) : null}
      </div>
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
              "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
              tab === value && "bg-muted text-foreground",
            )}
          >
            <Icon className="size-3" />
            {label}
            {value === "comments" && stats.open ? (
              <span className="rounded-full bg-saffron/20 px-1 text-xs text-saffron">{stats.open}</span>
            ) : null}
          </button>
        ))}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close page context"
            className="ml-auto grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground tap-target"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {tab === "info" ? (
          <div className="space-y-5">
            <section>
              <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                Page
              </div>
              <div className="mt-2 space-y-1.5 text-xs">
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
                          className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-xs capitalize hover:bg-muted"
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
                            <span className="text-xs">{option.label}</span>
                            <span className="text-xs text-muted-foreground">{option.hint}</span>
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
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Object type</span>
                  <select
                    value={assignedType?.id ?? ""}
                    disabled={!db || !objectTypes.length}
                    onChange={(event) => void setObjectType(event.target.value)}
                    className="h-7 max-w-[140px] rounded-md border border-border/60 bg-background px-1 text-xs outline-none focus:border-primary/40 disabled:opacity-50"
                  >
                    <option value="">None</option>
                    {objectTypes
                      .filter((type) => !type.deletedAt)
                      .map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </section>

            {assignedType ? (
              <section>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                    {assignedType.name}
                  </div>
                  <span
                    className="grid size-5 place-items-center rounded text-xs"
                    style={{ backgroundColor: `${assignedType.color}22`, color: assignedType.color }}
                  >
                    {assignedType.icon ?? "◈"}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {typedProperties.map((definition) => {
                    const value = coercePropertyValue(
                      definition.type,
                      properties[definition.key],
                    );
                    if (definition.type === "checkbox") {
                      return (
                        <label
                          key={definition.key}
                          className="flex items-center justify-between text-xs"
                        >
                          <span className="text-muted-foreground">{definition.label}</span>
                          <input
                            type="checkbox"
                            checked={value === true}
                            onChange={(event) =>
                              void setTypedValue(definition.key, event.target.checked)
                            }
                            className="size-3.5 accent-[var(--moss,#2f6b4f)]"
                          />
                        </label>
                      );
                    }
                    if (definition.type === "select") {
                      return (
                        <label key={definition.key} className="block">
                          <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
                            {definition.label}
                          </span>
                          <select
                            value={typeof value === "string" ? value : ""}
                            onChange={(event) => void setTypedValue(definition.key, event.target.value)}
                            className="h-8 w-full rounded-md border border-border/60 bg-background px-1.5 text-xs outline-none focus:border-primary/40"
                          >
                            <option value="">—</option>
                            {(definition.options ?? []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }
                    return (
                      <label key={definition.key} className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          {definition.label}
                        </span>
                        <input
                          type={
                            definition.type === "number"
                              ? "number"
                              : definition.type === "date"
                                ? "date"
                                : "text"
                          }
                          value={value === null || value === undefined ? "" : String(value)}
                          onChange={(event) => {
                            const raw = event.target.value;
                            if (definition.type === "number") {
                              void setTypedValue(definition.key, raw === "" ? null : Number(raw));
                              return;
                            }
                            void setTypedValue(definition.key, raw);
                          }}
                          className="h-8 w-full rounded-md border border-border/60 bg-background px-1.5 text-xs outline-none focus:border-primary/40"
                        />
                      </label>
                    );
                  })}
                  {!typedProperties.length ? (
                    <p className="text-xs text-muted-foreground">
                      This type has no fields yet — add some in Settings → Object types.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Properties
                </div>
                <span className="text-xs text-muted-foreground">{propertyEntries.length}</span>
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
                  <p className="text-xs text-muted-foreground">No properties yet.</p>
                ) : null}
              </div>
              <div className="mt-2 flex gap-1">
                <input
                  value={propertyKey}
                  onChange={(event) => setPropertyKey(event.target.value)}
                  placeholder="Property"
                  className="h-7 w-16 shrink-0 rounded border border-border bg-background px-1 text-xs outline-none focus:border-primary/40"
                />
                <input
                  value={propertyValue}
                  onChange={(event) => setPropertyValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void addProperty();
                  }}
                  placeholder="Value"
                  className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-1 text-xs outline-none focus:border-primary/40"
                />
                <Button
                  size="sm"
                  className="h-7 rounded px-1.5 text-xs"
                  disabled={!propertyKey.trim()}
                  onClick={() => void addProperty()}
                >
                  <Plus className="size-2.5" />
                </Button>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Outline
                </div>
                <span className="text-xs text-muted-foreground">{outline.length} items</span>
              </div>
              <div className="mt-2 space-y-0.5">
                {outline.length ? (
                  outline.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("lattice:scroll-to-block", {
                            detail: { blockId: item.id },
                          }),
                        )
                      }
                      className="block w-full truncate rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      style={{ paddingLeft: `${(item.level - 1) * 8 + 4}px` }}
                      title="Jump to heading"
                    >
                      {item.text || "Untitled heading"}
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">Add headings to build an outline.</p>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
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
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-destructive/30 hover:text-destructive"
                    title="Remove tag"
                  >
                    <TagIcon className="size-2" /> {tag.name}
                    <X className="size-2" />
                  </button>
                ))}
                {!tags.length ? (
                  <span className="text-xs text-muted-foreground">No tags yet.</span>
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
                  className="h-8 rounded-md text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 rounded-md px-2 text-xs"
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
                        className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                      >
                        + {tag.name}
                      </button>
                    ))}
                </div>
              ) : null}
            </section>

            <section>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Learning
                </div>
                <span className="text-xs text-muted-foreground">{cards.length} cards</span>
              </div>
              <div className="mt-2 space-y-1">
                {cards.slice(0, 3).map((card) => (
                  <div key={card.id} className="group flex items-start gap-1.5 rounded-md border border-border/60 bg-card/50 px-2 py-1.5">
                    <span className="mt-0.5">◒</span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-snug">{card.front}</span>
                    <button
                      type="button"
                      aria-label="Delete card"
                      onClick={() => db && void deleteFlashcardLocal(db, card.id)}
                      className="hover:text-destructive hover-reveal"
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 h-8 w-full rounded-md text-xs"
                onClick={() => void generateCards()}
              >
                <Brain className="size-3" /> Generate cards from this page
              </Button>
            </section>

            <section className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Sparkles className="size-3 text-saffron" /> Ask about this page
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Use the Ask button in the top bar to summarize, find connections, or explain this page.
              </p>
            </section>
          </div>
        ) : null}

        {tab === "backlinks" ? (
          <div className="space-y-5">
            <section>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Backlinks
                </div>
                <span className="text-xs text-muted-foreground">{backlinks.length}</span>
              </div>
              <div className="mt-2 space-y-1">
                {backlinks.map((backlink) => (
                  <button
                    key={backlink.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "page", id: backlink.id }))}
                    className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 text-left hover:bg-muted/50"
                  >
                    <span className="text-xs">{backlink.icon ?? "◇"}</span>
                    <span className="min-w-0 flex-1 truncate text-xs">{backlink.title}</span>
                    <ArrowUpRight className="size-2.5 text-muted-foreground/50" />
                  </button>
                ))}
                {!backlinks.length ? (
                  <p className="text-xs text-muted-foreground">
                    No other page links here yet. Use [[ from another note.
                  </p>
                ) : null}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                  Outgoing
                </div>
                <span className="text-xs text-muted-foreground">{outgoing.length}</span>
              </div>
              <div className="mt-2 space-y-1">
                {outgoing.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    onClick={() => router.push(appRouteObject({ view: "page", id: link.id }))}
                    className="flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 text-left hover:bg-muted/50"
                  >
                    <span className="text-xs">{link.icon ?? "◇"}</span>
                    <span className="min-w-0 flex-1 truncate text-xs">{link.title}</span>
                    <ArrowUpRight className="size-2.5 text-muted-foreground/50" />
                  </button>
                ))}
                {!outgoing.length ? (
                  <p className="text-xs text-muted-foreground">
                    This page does not reference others yet.
                  </p>
                ) : null}
              </div>
            </section>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full rounded-md text-xs"
              onClick={() => router.push(appRouteObject({ view: "graph" }))}
            >
              Open in knowledge graph <ArrowUpRight className="size-3" />
            </Button>
          </div>
        ) : null}

        {tab === "comments" ? (
          <div className="space-y-3">
            {focusBlockId ? (
              <div className="flex items-center gap-1.5 rounded-md border border-saffron/30 bg-saffron/[0.06] px-2 py-1.5 text-xs text-muted-foreground">
                <CircleDot className="size-3 text-saffron" />
                Anchored to a block
                <button type="button" onClick={onClearBlock} className="ml-auto text-foreground">
                  <X className="size-2.5" />
                </button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-1">
              {(["open", "resolved", "all"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={cn(
                    "rounded-full border px-1.5 py-0.5 text-xs",
                    statusFilter === value
                      ? "border-moss/40 bg-moss/10 text-moss"
                      : "border-border/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {value === "open"
                    ? `Open ${stats.open}`
                    : value === "resolved"
                      ? `Resolved ${stats.resolved}`
                      : `All ${stats.open + stats.resolved}`}
                </button>
              ))}
              {stats.replies ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {stats.replies} repl{stats.replies === 1 ? "y" : "ies"}
                </span>
              ) : null}
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search discussion…"
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/40"
            />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={anchoredOnly}
                  onChange={(event) => setAnchoredOnly(event.target.checked)}
                  className="size-3 accent-[var(--moss)]"
                />
                Block-anchored ({stats.anchored})
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={grouped}
                  onChange={(event) => setGrouped(event.target.checked)}
                  className="size-3 accent-[var(--moss)]"
                />
                Group by block
              </label>
              {threads.length > visibleThreads.length ? (
                <span className="ml-auto">
                  {visibleThreads.length} of {threads.length}
                </span>
              ) : null}
            </div>
            <div className="space-y-2">
              {threadGroups.map((group) => (
                <div key={group.blockId ?? "page"} className="space-y-2">
                  {grouped ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CircleDot className="size-2.5" />
                      {group.blockId
                        ? `${group.threads.length} on one block`
                        : `${group.threads.length} page-level`}
                      {group.blockId ? (
                        <button
                          type="button"
                          onClick={() => jumpToBlock(group.blockId!)}
                          className="rounded-full border border-saffron/30 px-1.5 py-0.5 text-xs text-saffron hover:bg-saffron/10"
                        >
                          Jump
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {group.threads.map(renderThread)}
                </div>
              ))}
              {!threads.length ? (
                <div className="py-8 text-center">
                  <MessageSquare className="mx-auto size-5 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {search || anchoredOnly || focusBlockId
                      ? "No discussions match these filters."
                      : statusFilter === "resolved"
                        ? "Nothing resolved yet."
                        : "No open discussions."}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Comments sync asynchronously with your team.
                  </p>
                </div>
              ) : null}
              {threads.length > visibleThreads.length ? (
                <button
                  type="button"
                  onClick={() => setVisibleCount((current) => current + 20)}
                  className="w-full rounded-md border border-border/60 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  Show 20 more
                </button>
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
                className="min-h-16 rounded-lg text-xs"
              />
              <div className="mt-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-2.5" /> ⌘↵ to send
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-md px-1.5 text-xs text-muted-foreground"
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
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-moss/20 text-xs font-semibold text-moss">
                            {member.user.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{member.user.name}</span>
                        </DropdownMenuItem>
                      ))}
                      {!membersQuery.data?.length ? (
                        <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                          No teammates to mention yet.
                        </p>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
                <Button
                  size="sm"
                  className="h-8 rounded-md text-xs"
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
      <PromptDialog
        open={Boolean(replyTo)}
        title="Reply to the discussion"
        description={replyTo ? `Replying to ${replyTo.authorName}.` : undefined}
        label="Reply"
        placeholder="Write a reply…"
        confirmLabel="Reply"
        onClose={() => setReplyTo(null)}
        onSubmit={(value) => {
          if (!db || !user || !activeWorkspaceId || !replyTo) return;
          void createCommentLocal(db, {
            workspaceId: activeWorkspaceId,
            userId: user.id,
            pageId: page.id,
            parentId: replyTo.threadId,
            body: value,
          });
        }}
      />
    </aside>
  );
}
