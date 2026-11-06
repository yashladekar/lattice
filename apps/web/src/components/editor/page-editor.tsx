"use client";

import {
  collectBlockIds,
  createMindMap as buildMindMap,
  docToMarkdown,
  extractOutline,
  extractPlainText,
  formatRelative,
  liveWriteWouldClobber,
  outlineToMermaid,
  safeDoc,
  type CanvasDocument,
  type OutlineItem,
  type PluginToolDefinition,
  type TipTapDoc,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@notes-learning/ui/components/dropdown-menu";
import { cn } from "@notes-learning/ui/lib/utils";
import DragHandle from "@tiptap/extension-drag-handle-react";
import { getSchema } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { generateJSON } from "@tiptap/html";
import {
  Bold,
  Blocks,
  Check,
  Clock3,
  Code2,
  Copy,
  Download,
  FileText,
  Focus,
  GitBranch,
  GitPullRequest,
  GripVertical,
  Heading1,
  Highlighter,
  Italic,
  LayoutTemplate,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquare,
  MoreHorizontal,
  Network,
  Quote,
  Redo2,
  Share2,
  Sparkles,
  Star,
  Strikethrough,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { marked } from "marked";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { useAppData } from "@/components/app-data-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { usePage, usePageDocument, useWorkspacePages } from "@/hooks/use-local-data";
import { CollabProvider, collaborationUrl, type CollabPeer, type CollabStatus } from "@/lib/collab";
import { downloadTextFile } from "@/lib/download";
import { uploadFile } from "@/lib/upload";
import {
  addAttachmentLocal,
  createCanvasLocal,
  createFlashcardLocal,
  createPageLocal,
  createSuggestedEditLocal,
  createTemplateFromPageLocal,
  deletePageLocal,
  duplicatePageLocal,
  ensureDeckLocal,
  generateCardsFromPageLocal,
  savePageContentLocal,
  updatePageLocal,
  upsertEdgeLocal,
} from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";
import { useInstalledPlugins, type StoredPlugin } from "@/lib/plugins";
import { client } from "@/utils/orpc";

import { EditorMenu } from "./editor-menu";
import { CanvasPlanPreview } from "./canvas-plan-preview";
import { createEditorExtensions } from "./extensions";
import { EditorPageContext } from "./editor-page-context";
import type { EditorMenuItem, EditorMenuKind, EditorMenuState } from "./menu-types";
import { PagePickerDialog } from "./page-picker";
import { createSlashItems } from "./slash-items";

const PAGE_ICONS = ["✦", "◇", "◈", "◫", "◒", "⌘", "⌁", "▦", "◎", "☀", "☾", "❖", "✎", "♧", "⌂", "♢"];

interface SlashRangeState {
  editor: Editor;
  range: Range;
}

interface AiResult {
  title: string;
  answer?: string;
  provider?: string;
  cards?: Array<{ front: string; back: string; blockId?: string }>;
  outline?: OutlineItem[];
  canvas?: CanvasDocument;
  suggestions?: Array<{ pageId: string; title: string; score: number; reason: string }>;
  citations?: Array<{ pageId: string; title: string; excerpt?: string }>;
  pages?: Array<{ id: string; title: string; updatedAt: string; reason: string }>;
}

const pendingCollabTeardown = new WeakMap<object, ReturnType<typeof setTimeout>>();

export function PageEditor({
  pageId,
  onShare,
  onOpenContext,
  onCommentBlock,
  onToggleFocus,
}: {
  pageId: string;
  onShare: () => void;
  onOpenContext: () => void;
  onCommentBlock: (blockId: string) => void;
  onToggleFocus: () => void;
}) {
  "use no memo";
  const router = useRouter();
  const { db, user, activeWorkspaceId, online } = useAppData();
  const page = usePage(pageId);
  const document = usePageDocument(pageId);
  const allPages = useWorkspacePages();
  const [title, setTitle] = useState(page?.title ?? "Untitled");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [menu, setMenu] = useState<EditorMenuState | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [markdownMode, setMarkdownMode] = useState(false);
  const [markdownText, setMarkdownText] = useState("");
  const [pagePicker, setPagePicker] = useState<{
    open: boolean;
    mode: "link" | "embed" | "live";
    editor: Editor;
    range: Range;
  } | null>(null);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [suggestNote, setSuggestNote] = useState("");
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [pluginPickerOpen, setPluginPickerOpen] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [clobberBlocked, setClobberBlocked] = useState(false);
  const lastWrittenRev = useRef<number | null>(null);

  useEffect(() => {
    // Baseline for the clobber guard: the revision this editor started from.
    if (lastWrittenRev.current === null && document) lastWrittenRev.current = document.rev;
  }, [document]);

  useEffect(() => {
    lastWrittenRev.current = null;
    setClobberBlocked(false);
  }, [pageId]);

  const reloadFromDocument = async () => {
    try {
      await client.sync.resetCollab({ pageId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset the live session");
    }
    window.location.reload();
  };
  const installedPlugins = useInstalledPlugins();
  const [versions, setVersions] = useState<Array<{ id: string; version: number; title: string; createdAt: string; note: string | null }>>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [remoteUpdate, setRemoteUpdate] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState<{
    pos: number;
    blockId: string | null;
    type: string;
  } | null>(null);
  const [peers, setPeers] = useState<Array<{ userId: string; name: string; image: string | null }>>([]);
  const [collab] = useState<CollabProvider | null>(() =>
    pageId && activeWorkspaceId && online ? new CollabProvider() : null,
  );
  const [collabStatus, setCollabStatus] = useState<CollabStatus>("disconnected");
  const [collabPeers, setCollabPeers] = useState<CollabPeer[]>([]);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadImageRef = useRef<((file: File, at?: number) => void) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  const loaded = useRef(false);
  const blockTargetRef = useRef<{ pos: number; blockId: string | null } | null>(null);
  const lastRev = useRef<number>(0);
  const menuKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const getItemsRef = useRef<(kind: EditorMenuKind, query: string) => Promise<EditorMenuItem[]>>(
    async () => [],
  );
  const contextRef = useRef({
    db,
    user,
    pageId,
    workspaceId: activeWorkspaceId,
    pages: allPages,
    people: [] as Array<{ id: string; name: string; image: string | null }>,
  });
  contextRef.current = {
    db,
    user,
    pageId,
    workspaceId: activeWorkspaceId,
    pages: allPages,
    people: contextRef.current.people,
  };

  const persist = useCallback(
    async (content: TipTapDoc) => {
      const current = contextRef.current;
      if (!current.db || !current.user || !current.workspaceId) return;
      try {
        setSaveStatus("saving");
        const stored = await current.db.pageDocuments.get(pageId);
        if (
          stored &&
          lastWrittenRev.current !== null &&
          liveWriteWouldClobber({
            lastWrittenRev: lastWrittenRev.current,
            currentRev: stored.rev,
            lastChangeSource: stored.lastChangeSource ?? null,
          })
        ) {
          // A write that did not come from this session landed under the
          // editor; persisting now would put the older body back.
          setSaveStatus("error");
          setClobberBlocked(true);
          return;
        }
        const saved = await savePageContentLocal(current.db, {
          pageId,
          content,
          userId: current.user.id,
          source: "session",
        });
        if (saved) lastWrittenRev.current = saved.rev;
        dirty.current = false;
        setSaveStatus("saved");
      } catch (error) {
        setSaveStatus("error");
        toast.error(error instanceof Error ? error.message : "Could not save locally");
      }
    },
    [pageId],
  );

  const requestPage = useCallback((mode: "link" | "embed" | "live", editor: Editor, range: Range) => {
    editor.chain().focus().deleteRange(range).run();
    setPagePicker({ open: true, mode, editor, range });
  }, []);

  const createPageLink = useCallback(
    async (editor: Editor, range: Range, pageTitle: string) => {
      const current = contextRef.current;
      if (!current.db || !current.user || !current.workspaceId) return;
      editor.chain().focus().deleteRange(range).run();
      const { createPageLocal } = await import("@/lib/local/repository");
      const created = await createPageLocal(current.db, {
        workspaceId: current.workspaceId,
        userId: current.user.id,
        notebookId: null,
        title: pageTitle || "Untitled",
      });
      editor
        .chain()
        .focus()
        .insertContent([
          {
            type: "pageLink",
            attrs: { pageId: created.page.id, title: created.page.title, icon: created.page.icon ?? "◇" },
          },
          { type: "text", text: " " },
        ])
        .run();
      toast.success("Page created and linked");
    },
    [],
  );

  const getItems = useCallback(
    async (kind: EditorMenuKind, query: string): Promise<EditorMenuItem[]> => {
      const normalized = query.trim().toLowerCase();
      if (kind === "slash") {
        return createSlashItems({
          requestPage,
          uploadImage: () => fileInputRef.current?.click(),
        }).filter((item) => {
          if (!normalized) return true;
          return `${item.label} ${item.description ?? ""} ${item.keywords ?? ""}`
            .toLowerCase()
            .includes(normalized);
        });
      }
      const current = contextRef.current;
      const base = current.pages
        .filter((entry) => !entry.deletedAt && entry.title.toLowerCase().includes(normalized))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8);
      const pageItems: EditorMenuItem[] = base.map((entry) => ({
        id: `page-${entry.id}`,
        label: entry.title || "Untitled",
        description: "Page",
        group: kind === "mention" ? "Pages" : "Pages",
        icon: <span className="text-xs">{entry.icon ?? "◇"}</span>,
        select: (editor, range) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              {
                type: "pageLink",
                attrs: { pageId: entry.id, title: entry.title, icon: entry.icon ?? "◇" },
              },
              { type: "text", text: " " },
            ])
            .run();
        },
      }));
      if (kind === "page") {
        if (normalized && !base.some((entry) => entry.title.toLowerCase() === normalized)) {
          pageItems.push({
            id: "create-page-link",
            label: `Create “${query.trim()}”`,
            description: "New page, linked here",
            group: "Create",
            icon: <FileText className="size-3.5" />,
            select: (editor, range) => {
              void createPageLink(editor, range, query.trim());
            },
          });
        }
        return pageItems;
      }

      const today = new Date();
      const tomorrow = new Date(Date.now() + 86_400_000);
      const dateItems: EditorMenuItem[] = [
        {
          id: "today",
          label: `Today · ${today.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
          description: today.toISOString().slice(0, 10),
          group: "Dates",
          icon: <Clock3 className="size-3.5" />,
          select: (editor, range) =>
            editor.chain().focus().deleteRange(range).insertContent(today.toISOString().slice(0, 10)).run(),
        },
        {
          id: "tomorrow",
          label: `Tomorrow · ${tomorrow.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
          description: tomorrow.toISOString().slice(0, 10),
          group: "Dates",
          icon: <Clock3 className="size-3.5" />,
          select: (editor, range) =>
            editor.chain().focus().deleteRange(range).insertContent(tomorrow.toISOString().slice(0, 10)).run(),
        },
      ];
      const peopleItems: EditorMenuItem[] = current.people
        .filter((person) => person.name.toLowerCase().includes(normalized))
        .slice(0, 5)
        .map((person) => ({
          id: `person-${person.id}`,
          label: person.name,
          description: "Mention teammate",
          group: "People",
          icon: <span className="text-xs font-semibold">{person.name.slice(0, 1)}</span>,
          select: (editor, range) =>
            editor.chain().focus().deleteRange(range).insertContent(`@${person.name} `).run(),
        }));
      return [...peopleItems, ...dateItems, ...pageItems];
    },
    [createPageLink, requestPage],
  );
  getItemsRef.current = getItems;

  const extensions = useMemo(
    () =>
      createEditorExtensions({
        getItems: (kind, query) => getItemsRef.current(kind, query),
        collaboration: collab
          ? {
              doc: collab.doc,
              provider: collab,
              user: { name: user?.name ?? "Someone", color: "#e8892f" },
            }
          : null,
        callbacks: {
          onStart: (kind, props) => {
            setMenuIndex(0);
            setMenu({
              kind,
              query: props.query,
              items: props.items,
              rect: props.clientRect?.() ?? null,
              editor: props.editor,
              range: props.range,
            });
          },
          onUpdate: (kind, props) => {
            setMenuIndex(0);
            setMenu({
              kind,
              query: props.query,
              items: props.items,
              rect: props.clientRect?.() ?? null,
              editor: props.editor,
              range: props.range,
            });
          },
          onExit: () => setMenu(null),
          onKeyDown: (event) => menuKeyRef.current(event),
        },
      }),
    [collab, user?.name],
  );

  const editor = useEditor(
    {
      extensions,
    immediatelyRender: false,
    content: undefined as TipTapDoc | undefined,
    editorProps: {
      attributes: {
        class: "tiptap",
        spellcheck: "true",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        for (const file of files) void uploadImageRef.current?.(file);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        const point = view.posAtCoords({ left: event.clientX, top: event.clientY });
        for (const file of files) void uploadImageRef.current?.(file, point?.pos);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      dirty.current = true;
      setSaveStatus("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(safeDoc(instance.getJSON()));
      }, 650);
    },
    onBlur: ({ editor: instance }) => {
      if (!dirty.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void persist(safeDoc(instance.getJSON()));
    },
    },
    [collab],
  );
  editorRef.current = editor;

  const seedFromLocal = useCallback(async () => {
    if (!collab || !db) return;
    if (collab.doc.getXmlFragment("default").length > 0) return;
    const local = await db.pageDocuments.get(pageId);
    const content = local?.content;
    if (!content?.content?.length) return;
    // Seeding an empty body leaves a bare paragraph in the fragment, which the
    // position tracker cannot map. Let the binding initialize those instead.
    const hasBody = content.content.some(
      (node) =>
        node.type !== "paragraph" ||
        (Array.isArray(node.content) && node.content.length > 0),
    );
    if (!hasBody) return;
    const schema = getSchema(extensions);
    const seeded = prosemirrorJSONToYDoc(schema, content as never, "default");
    Y.applyUpdate(collab.doc, Y.encodeStateAsUpdate(seeded), "seed");
    seeded.destroy();
  }, [collab, db, pageId, extensions]);

  useEffect(() => {
    if (!collab) return;
    const pendingTeardown = pendingCollabTeardown.get(collab);
    if (pendingTeardown) {
      clearTimeout(pendingTeardown);
      pendingCollabTeardown.delete(collab);
    }
    if (user) collab.setUser({ name: user.name, color: "#e8892f" });
    collab.onStatus = setCollabStatus;
    collab.onPeers = setCollabPeers;
    collab.onSeedRequest = () => {
      void seedFromLocal();
    };
    collab.connect(collaborationUrl(activeWorkspaceId ?? "", pageId));
    return () => {
      collab.onStatus = undefined;
      collab.onPeers = undefined;
      collab.onSeedRequest = undefined;
      collab.close();
      // React re-runs effects immediately in development; only tear down if the
      // session really stayed closed.
      pendingCollabTeardown.set(
        collab,
        setTimeout(() => {
          pendingCollabTeardown.delete(collab);
          collab.destroy();
        }, 150),
      );
    };
  }, [collab, seedFromLocal, activeWorkspaceId, pageId, user?.name]);

  // If the relay never answers, seed from the local document so a page is
  // never blank just because live sync is unavailable.
  useEffect(() => {
    if (!collab) return;
    const timer = setTimeout(() => {
      if (collab.doc.getXmlFragment("default").length === 0) {
        void seedFromLocal();
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [collab, seedFromLocal]);

  const uploadImageFile = async (file: File, at?: number) => {
    if (!db || !user || !activeWorkspaceId) {
      toast.error("Sign in to upload files.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files can be embedded.");
      return;
    }
    const toastId = toast.loading(`Uploading ${file.name}…`);
    try {
      const uploaded = await uploadFile(file);
      await addAttachmentLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        pageId,
        name: uploaded.name,
        mime: uploaded.mime,
        size: uploaded.size,
        url: uploaded.url,
      });
      const active = editorRef.current;
      if (active && !active.isDestroyed) {
        if (typeof at === "number") {
          active
            .chain()
            .insertContentAt(at, {
              type: "image",
              attrs: { src: uploaded.url, alt: uploaded.name },
            })
            .focus()
            .run();
        } else {
          active.chain().focus().setImage({ src: uploaded.url, alt: uploaded.name }).run();
        }
      }
      toast.success("Image uploaded", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed", { id: toastId });
    }
  };

  useEffect(() => {
    uploadImageRef.current = (file, at) => void uploadImageFile(file, at);
  });

  useEffect(() => {
    if (!editor || !document || loaded.current) return;
    loaded.current = true;
    lastRev.current = document.rev;
    // With a live session, Yjs owns the document body.
    if (collab) return;
    // TipTap's React node views flush synchronously. Deferring to a microtask
    // keeps that flush out of React's own commit phase.
    queueMicrotask(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(document.content, { emitUpdate: false });
      setSaveStatus("saved");
    });
  }, [editor, document, collab]);

  useEffect(() => {
    if (!page) return;
    setTitle(page.title);
  }, [page?.id]);

  useEffect(() => {
    if (!db || !activeWorkspaceId) return;
    let cancelled = false;
    void client.workspace
      .members({ workspaceId: activeWorkspaceId })
      .then((members) => {
        if (cancelled) return;
        contextRef.current.people = members.map((member) => ({
          id: member.userId,
          name: member.user.name,
          image: member.user.image ?? null,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [db, activeWorkspaceId]);

  useEffect(() => {
    if (collab) return;
    if (!document || !editor || dirty.current || document.rev === lastRev.current) return;
    const currentText = extractPlainText(safeDoc(editor.getJSON()));
    if (currentText !== document.plainText) {
      setRemoteUpdate(true);
    } else {
      lastRev.current = document.rev;
    }
  }, [document?.rev, editor, collab]);

  useEffect(() => {
    if (!online || !activeWorkspaceId) return;
    let cancelled = false;
    const ping = async () => {
      try {
        const result = await client.presence.ping({ pageId });
        if (!cancelled) {
          setPeers(
            result.map((peer) => ({
              userId: peer.userId,
              name: peer.name,
              image: peer.image,
            })),
          );
        }
      } catch {
        // Presence is best-effort and never blocks the editor.
      }
    };
    void ping();
    const interval = setInterval(() => void ping(), 18_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [online, activeWorkspaceId, pageId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (dirty.current && editorRef.current && !editorRef.current.isDestroyed) {
        void persist(safeDoc(editorRef.current.getJSON()));
      }
    };
  }, [persist]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const onScrollToBlock = (event: Event) => {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (!blockId) return;
      let target: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (target !== null) return false;
        if (node.attrs?.blockId === blockId) {
          target = pos;
          return false;
        }
        return true;
      });
      if (target === null) return;
      editor.chain().focus().setTextSelection(target + 1).scrollIntoView().run();
    };
    window.addEventListener("lattice:scroll-to-block", onScrollToBlock);
    return () => window.removeEventListener("lattice:scroll-to-block", onScrollToBlock);
  }, [editor]);

  const chooseIcon = async (icon: string) => {
    if (!db) return;
    await updatePageLocal(db, { pageId, icon });
  };

  const onTitleChange = (value: string) => {
    setTitle(value);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      if (!db) return;
      void updatePageLocal(db, { pageId, title: value });
    }, 450);
  };

  const toggleMarkdown = () => {
    if (!editor) return;
    if (!markdownMode) {
      setMarkdownText(docToMarkdown(safeDoc(editor.getJSON())));
      setMarkdownMode(true);
      return;
    }
    try {
      const html = marked.parse(markdownText, { async: false }) as string;
      const doc = generateJSON(html, extensions) as TipTapDoc;
      editor.commands.setContent(doc);
      void persist(doc);
      setMarkdownMode(false);
      toast.success("Markdown applied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not parse Markdown");
    }
  };

  const applyPagePick = async (pickedId: string, pickedTitle: string, icon: string | null) => {
    if (!pagePicker) return;
    const { editor: activeEditor, mode } = pagePicker;
    if (mode === "link") {
      activeEditor
        .chain()
        .focus()
        .insertContent([
          { type: "pageLink", attrs: { pageId: pickedId, title: pickedTitle, icon: icon ?? "◇" } },
          { type: "text", text: " " },
        ])
        .run();
    } else if (mode === "embed") {
      activeEditor
        .chain()
        .focus()
        .insertContent({ type: "pageEmbed", attrs: { pageId: pickedId, title: pickedTitle } })
        .run();
    } else if (db) {
      const pickedDocument = await db.pageDocuments.get(pickedId);
      const blockId = pickedDocument ? (collectBlockIds(pickedDocument.content)[0] ?? "") : "";
      activeEditor
        .chain()
        .focus()
        .insertContent({
          type: "liveBlock",
          attrs: { pageId: pickedId, blockId, title: pickedTitle },
        })
        .run();
    }
    setPagePicker(null);
  };

  const selectMenuItem = (item: EditorMenuItem) => {
    if (!menu) return;
    const current = menu;
    setMenu(null);
    item.select(current.editor, current.range);
  };

  menuKeyRef.current = (event) => {
    if (!menu) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuIndex((current) => Math.min(menu.items.length - 1, current + 1));
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenuIndex((current) => Math.max(0, current - 1));
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = menu.items[menuIndex];
      if (item) selectMenuItem(item);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      return true;
    }
    return false;
  };

  const duplicate = async () => {
    if (!db || !user) return;
    const created = await duplicatePageLocal(db, pageId, user.id);
    if (created) router.push(appRouteObject({ view: "page", id: created.id }));
  };

  const exportMarkdown = async () => {
    if (!editor) return;
    const markdown = docToMarkdown(safeDoc(editor.getJSON()));
    downloadTextFile(`${title || "page"}.md`, markdown, "text/markdown");
  };

  const insertOutlineDiagram = () => {
    if (!editor || editor.isDestroyed) return;
    const doc = safeDoc(editor.getJSON());
    const outline = extractOutline(doc);
    if (!outline.length) {
      toast.error("Add a few headings first — the diagram is built from your outline.");
      return;
    }
    const source = outlineToMermaid(doc, { title: page?.title ?? undefined });
    if (!source) {
      toast.error("Nothing to chart yet.");
      return;
    }
    editor
      .chain()
      .insertContentAt(editor.state.doc.content.size, {
        type: "diagram",
        attrs: { source, caption: "Page outline" },
      })
      .focus("end")
      .run();
    toast.success("Diagram inserted from the page outline");
  };

  const duplicateBlock = () => {
    const target = blockTargetRef.current;
    if (!editor || !target) return;
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node) return;
    editor.view.dispatch(editor.state.tr.insert(target.pos + node.nodeSize, node));
    toast.success("Block duplicated");
  };

  const deleteBlock = () => {
    const target = blockTargetRef.current;
    if (!editor || !target) return;
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node) return;
    editor.view.dispatch(editor.state.tr.delete(target.pos, target.pos + node.nodeSize));
    toast.success("Block deleted");
  };

  const copyBlockLink = async () => {
    const target = blockTargetRef.current;
    if (!target?.blockId) {
      toast.error("This block has no id yet.");
      return;
    }
    const url = `${window.location.origin}${appRouteObject({ view: "page", id: pageId })}&block=${target.blockId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Block link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  const turnBlockInto = (
    kind: "paragraph" | "h1" | "h2" | "h3" | "bullet" | "ordered" | "task" | "quote" | "code",
  ) => {
    const target = blockTargetRef.current;
    if (!editor || !target) return;
    const node = editor.state.doc.nodeAt(target.pos);
    if (!node) return;
    const chain = node.isTextblock
      ? editor.chain().focus().setTextSelection(target.pos + 1)
      : editor.chain().focus().setNodeSelection(target.pos);
    if (kind === "paragraph") chain.setParagraph().run();
    else if (kind === "h1") chain.setParagraph().toggleHeading({ level: 1 }).run();
    else if (kind === "h2") chain.setParagraph().toggleHeading({ level: 2 }).run();
    else if (kind === "h3") chain.setParagraph().toggleHeading({ level: 3 }).run();
    else if (kind === "bullet") chain.toggleBulletList().run();
    else if (kind === "ordered") chain.toggleOrderedList().run();
    else if (kind === "task") chain.toggleTaskList().run();
    else if (kind === "quote") chain.toggleBlockquote().run();
    else chain.setCodeBlock().run();
  };

  const isFavorite = Boolean(page?.properties?.favorite);

  const pluginBlockChoices = useMemo(() => {
    if (!pluginPickerOpen) return [];
    return installedPlugins
      .filter((plugin) => plugin.enabled)
      .flatMap((plugin) =>
        (plugin.manifest.blocks ?? []).map((tool) => ({ plugin, tool })),
      );
  }, [installedPlugins, pluginPickerOpen]);

  const insertPluginBlock = (choice: { plugin: StoredPlugin; tool: PluginToolDefinition }) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent({
        type: "pluginBlock",
        attrs: {
          pluginId: choice.plugin.manifest.id,
          blockId: choice.tool.id,
          pluginName: choice.plugin.manifest.name,
          label: choice.tool.label,
          input: "",
          output: "",
          error: "",
          ranAt: "",
        },
      })
      .run();
    setPluginPickerOpen(false);
    toast.success(`${choice.tool.label} block inserted`);
  };

  const openSuggestion = () => {
    const content =
      editor && !editor.isDestroyed ? editor.getJSON() : (document?.content ?? null);
    setSuggestText(docToMarkdown(safeDoc(content)));
    setSuggestNote("");
    setSuggestOpen(true);
  };

  const submitSuggestion = async () => {
    if (!db || !user || !document || !page) return;
    if (!suggestText.trim()) {
      toast.error("The suggestion is empty.");
      return;
    }
    setSuggestBusy(true);
    try {
      const html = marked.parse(suggestText, { async: false }) as string;
      const content = generateJSON(html, extensions) as TipTapDoc;
      await createSuggestedEditLocal(db, {
        workspaceId: document.workspaceId,
        userId: user.id,
        pageId,
        title: title || page.title || "Untitled",
        content,
        note: suggestNote,
        baseRev: document.rev,
      });
      setSuggestOpen(false);
      toast.success("Suggestion sent for review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the suggestion");
    } finally {
      setSuggestBusy(false);
    }
  };

  const toggleFavorite = async () => {
    if (!db || !page) return;
    await updatePageLocal(db, {
      pageId,
      properties: { ...page.properties, favorite: !isFavorite },
    });
    toast.success(isFavorite ? "Removed from favorites" : "Added to favorites");
  };

  const saveVersion = async () => {
    if (!activeWorkspaceId || !online) {
      toast.error("Version history needs a connection to the sync server.");
      return;
    }
    try {
      await client.page.saveVersion({ pageId });
      toast.success("Version saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save version");
    }
  };

  const openVersions = async () => {
    if (!activeWorkspaceId || !online) {
      toast.error("Version history needs a connection to the sync server.");
      return;
    }
    setVersionOpen(true);
    setVersionsLoading(true);
    try {
      const result = await client.page.versions({ pageId });
      setVersions(result as unknown as typeof versions);
    } catch {
      toast.error("Could not load versions");
    } finally {
      setVersionsLoading(false);
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (!activeWorkspaceId || !db) return;
    try {
      const result = await client.page.restoreVersion({
        pageId,
        versionId,
      });
      if (result.document) {
        const restoredDocument = {
          ...result.document,
          updatedAt: new Date(result.document.updatedAt).toISOString(),
          localUpdatedAt: new Date().toISOString(),
        };
        await db.pageDocuments.put(restoredDocument as never);
        if (editor && !editor.isDestroyed) {
          editor.commands.setContent(restoredDocument.content);
        }
        lastRev.current = restoredDocument.rev;
      }
      setVersionOpen(false);
      toast.success("Version restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not restore");
    }
  };

  const generateCards = async () => {
    if (!db || !activeWorkspaceId) return;
    const created = await generateCardsFromPageLocal(db, {
      workspaceId: activeWorkspaceId,
      pageId,
    });
    toast.success(created.length ? `${created.length} cards added` : "No new cards found");
  };

  const createMindMapCanvas = async () => {
    if (!db || !user || !activeWorkspaceId || !editor) return;
    const outline = extractOutline(safeDoc(editor.getJSON()));
    const canvas = await createCanvasLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      title: `${title} — mind map`,
      notebookId: page?.notebookId ?? null,
      data: buildMindMap(title, outline),
      icon: "◈",
    });
    router.push(appRouteObject({ view: "canvas", id: canvas.id }));
  };

  const runAi = async (
    action: "summarize" | "explain" | "compare" | "connections" | "flashcards" | "mindmap" | "outdated" | "examples",
  ) => {
    if (!activeWorkspaceId || !online) {
      toast.error("Ask Lattice needs a connection to the sync server.");
      return;
    }
    setAiBusy(true);
    try {
      const result = await client.ai.pageAction({
        pageId,
        action,
      });
      if (action === "flashcards" && "cards" in result) {
        setAiResult({
          title: "Generated flashcards",
          cards: result.cards as Array<{ front: string; back: string; blockId?: string }>,
          provider: "local",
        });
      } else if (action === "mindmap" && "outline" in result) {
        const outline = result.outline as OutlineItem[];
        setAiResult({
          title: "Mind map outline",
          outline,
          canvas: buildMindMap(title, outline),
          provider: "local",
        });
      } else if (action === "connections" && "suggestions" in result) {
        setAiResult({
          title: "Suggested connections",
          suggestions: result.suggestions as Array<{
            pageId: string;
            title: string;
            score: number;
            reason: string;
          }>,
          provider: "local",
        });
      } else if (action === "outdated" && "pages" in result) {
        setAiResult({
          title: "Possibly outdated pages",
          pages: result.pages as Array<{
            id: string;
            title: string;
            updatedAt: string;
            reason: string;
          }>,
          provider: "local",
        });
      } else if ("answer" in result) {
        setAiResult({
          title:
            action === "summarize"
              ? "Page summary"
              : action === "explain"
                ? "Explanation"
                : action === "compare"
                  ? "Comparison"
                  : "Lattice",
          answer: result.answer,
          provider: result.provider,
          citations: (result as { citations?: Array<{ pageId: string; title: string; excerpt?: string }> })
            .citations,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI request failed");
    } finally {
      setAiBusy(false);
    }
  };

  const addAiCards = async () => {
    if (!aiResult?.cards || !db || !activeWorkspaceId) return;
    const deck = await ensureDeckLocal(db, activeWorkspaceId);
    for (const card of aiResult.cards) {
      await createFlashcardLocal(db, {
        workspaceId: activeWorkspaceId,
        deckId: deck.id,
        front: card.front,
        back: card.back,
        pageId,
        blockId: card.blockId ?? null,
        source: "NOTE",
      });
    }
    toast.success(`${aiResult.cards.length} cards added`);
    setAiResult(null);
  };

  const addAiMindMap = async () => {
    if (!aiResult?.canvas || !db || !user || !activeWorkspaceId) return;
    const canvas = await createCanvasLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      title: `${title} — mind map`,
      notebookId: page?.notebookId ?? null,
      data: aiResult.canvas,
      icon: "◈",
    });
    setAiResult(null);
    router.push(appRouteObject({ view: "canvas", id: canvas.id }));
  };

  const addAiConnection = async (targetId: string) => {
    if (!db || !user || !activeWorkspaceId) return;
    await upsertEdgeLocal(db, {
      workspaceId: activeWorkspaceId,
      userId: user.id,
      sourceNodeId: pageId,
      targetNodeId: targetId,
      relationType: "RELATED_TO",
    });
    toast.success("Connection added to the graph");
  };

  const removePage = async () => {
    if (!db) return;
    await deletePageLocal(db, pageId);
    router.push(appRouteObject({ view: "home" }));
  };

  if (!page) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-6 space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  const state = editor
    ? {
        words: editor.getText().split(/\s+/).filter(Boolean).length,
      }
    : { words: 0 };

  const livePeers = collab
    ? collabPeers.map((peer) => ({ id: String(peer.clientId), name: peer.name }))
    : peers.map((peer) => ({ id: peer.userId, name: peer.name }));

  return (
    <div className="relative mx-auto w-full max-w-3xl px-5 pb-32 pt-7 md:px-10 md:pt-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="capitalize">{page.type.toLowerCase()}</span>
          <span className="opacity-30">·</span>
          <span>{formatRelative(page.updatedAt)}</span>
          <span className="opacity-30">·</span>
          <span>{state.words} words</span>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 rounded-md text-muted-foreground"
                  title="Page icon"
                />
              }
            >
              {page.icon ?? "◇"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Page icon</DropdownMenuLabel>
                <div className="grid grid-cols-8 gap-0.5 p-1">
                  {PAGE_ICONS.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => void chooseIcon(icon)}
                      className="grid size-6 place-items-center rounded hover:bg-muted"
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "h-7 w-7 rounded-md",
              isFavorite ? "text-saffron" : "text-muted-foreground",
            )}
            onClick={() => void toggleFavorite()}
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Star className={cn("size-3.5", isFavorite && "fill-current")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 rounded-md text-muted-foreground"
            onClick={onShare}
            title="Share"
          >
            <Share2 className="size-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-7 w-7 rounded-md text-muted-foreground"
                  title="Page actions"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => void duplicate()}>
                <FileText className="size-3.5" /> Duplicate page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void exportMarkdown()}>
                <Download className="size-3.5" /> Export Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={insertOutlineDiagram}>
                <GitBranch className="size-3.5" /> Diagram from outline
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTemplateOpen(true)}>
                <LayoutTemplate className="size-3.5" /> Save as template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openSuggestion}>
                <GitPullRequest className="size-3.5" /> Suggest an edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPluginPickerOpen(true)}>
                <Blocks className="size-3.5" /> Insert plugin block
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleMarkdown}>
                <Code2 className="size-3.5" /> {markdownMode ? "Close Markdown mode" : "Markdown mode"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggleFocus}>
                <Focus className="size-3.5" /> Focus mode
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void saveVersion()}>
                <Check className="size-3.5" /> Save version
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void openVersions()}>
                <Clock3 className="size-3.5" /> Version history
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void runAi("summarize")}>
                <Sparkles className="size-3.5" /> Summarize
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAi("explain")}>
                <Sparkles className="size-3.5" /> Explain this page
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAi("compare")}>
                <Sparkles className="size-3.5" /> Compare with related notes
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAi("examples")}>
                <Sparkles className="size-3.5" /> Suggest examples
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAi("outdated")}>
                <Clock3 className="size-3.5" /> Find outdated pages
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void runAi("connections")}>
                <Network className="size-3.5" /> Find connections
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void generateCards()}>
                <ListChecks className="size-3.5" /> Generate flashcards
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void createMindMapCanvas()}>
                <Network className="size-3.5" /> Create mind map
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmTrash(true)}>
                <Trash2 className="size-3.5" /> Move to trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {remoteUpdate ? (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-sky/25 bg-sky/[0.06] px-3 py-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-sky" />
          A newer version arrived from another device.
          <button
            type="button"
            className="ml-auto text-foreground underline underline-offset-2"
            onClick={() => {
              if (editor && document) {
                editor.commands.setContent(document.content);
                lastRev.current = document.rev;
              }
              setRemoteUpdate(false);
            }}
          >
            Reload page
          </button>
        </div>
      ) : null}

      <div className="mt-5 flex items-start gap-3">
        <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-card/60 text-lg">
          {page.icon ?? "◇"}
        </span>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          onBlur={() => {
            if (!db) return;
            void updatePageLocal(db, { pageId, title });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              editor?.chain().focus("start").run();
            }
          }}
          placeholder="Untitled"
          className="w-full bg-transparent font-display text-[2.4rem] leading-[1.08] tracking-[-0.03em] outline-none placeholder:text-muted-foreground/40 md:text-[3rem]"
        />
      </div>

      {clobberBlocked ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-2.5 py-2 text-xs">
          <span className="text-destructive">
            This note was changed from outside this session, so saving here would overwrite the
            newer body. Reload to continue from the newer version.
          </span>
          <Button
            size="sm"
            className="ml-auto h-7 rounded-md text-xs"
            onClick={() => void reloadFromDocument()}
          >
            Reload note
          </Button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5">
          <span className="size-1.5 rounded-full bg-moss" />
          {saveStatus === "saving" ? "Saving locally…" : saveStatus === "error" ? "Local save failed" : "Saved locally"}
        </span>
        <span className="capitalize">{page.visibility.toLowerCase()}</span>
        <button type="button" onClick={onOpenContext} className="hover:text-foreground">
          Page context
        </button>
        {livePeers.length ? (
          <span className="inline-flex items-center gap-1" title={livePeers.map((peer) => peer.name).join(", ")}>
            <span className="flex -space-x-1">
              {livePeers.slice(0, 3).map((peer) => (
                <span
                  key={peer.id}
                  className="grid size-5 place-items-center rounded-full border border-background bg-moss/20 text-xs font-semibold text-moss"
                >
                  {peer.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </span>
            <span className="text-xs">editing</span>
          </span>
        ) : null}
        {collab ? (
          <span
            className="inline-flex items-center gap-1"
            title={
              collabStatus === "connected"
                ? "Live session connected"
                : collabStatus === "connecting"
                  ? "Connecting to a live session"
                  : "Live session offline — edits still save locally"
            }
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                collabStatus === "connected"
                  ? "bg-moss"
                  : collabStatus === "connecting"
                    ? "bg-saffron"
                    : "bg-border",
              )}
            />
            <span className="text-xs">
              {collabStatus === "connected" ? "Live" : collabStatus === "connecting" ? "Connecting" : "Solo"}
            </span>
          </span>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1">
          {online ? <Check className="size-2.5 text-moss" /> : <Clock3 className="size-2.5 text-saffron" />}
          {online ? "Sync available" : "Offline"}
        </span>
      </div>

      {markdownMode ? (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>Markdown mode · edits replace the page when applied</span>
            <Button size="sm" className="h-8 rounded-md text-xs" onClick={toggleMarkdown}>
              Apply Markdown
            </Button>
          </div>
          <textarea
            value={markdownText}
            onChange={(event) => setMarkdownText(event.target.value)}
            className="min-h-[55vh] w-full resize-y rounded-xl border border-border bg-card/40 p-4 font-mono text-xs leading-relaxed outline-none focus:border-ring"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="relative mt-5">
          {editor ? (
            <>
              <DragHandle
                editor={editor}
                onNodeChange={({ node, pos }) =>
                  setHoveredBlock(
                    node
                      ? {
                          pos,
                          blockId: (node.attrs?.blockId as string | undefined) ?? null,
                          type: node.type.name,
                        }
                      : null,
                  )
                }
              >
                <div className="flex items-center">
                  <span className="grid h-6 w-5 cursor-grab place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground">
                    <GripVertical className="size-3.5" />
                  </span>
                  <DropdownMenu
                    onOpenChange={(open) => {
                      blockTargetRef.current = open ? hoveredBlock : null;
                    }}
                  >
                    <DropdownMenuTrigger
                      render={
                        <button
                          type="button"
                          aria-label="Block actions"
                          className="grid h-6 w-4 place-items-center rounded text-muted-foreground/40 hover:bg-muted hover:text-foreground"
                        />
                      }
                    >
                      <MoreHorizontal className="size-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="bottom" className="w-48">
                      <DropdownMenuLabel>Block</DropdownMenuLabel>
                      <DropdownMenuItem onClick={duplicateBlock}>
                        <Copy className="size-3.5" /> Duplicate block
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void copyBlockLink()}>
                        <Link2 className="size-3.5" /> Copy block link
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Type className="size-3.5" /> Turn into
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem onClick={() => turnBlockInto("paragraph")}>
                            Paragraph
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("h1")}>
                            Heading 1
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("h2")}>
                            Heading 2
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("h3")}>
                            Heading 3
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => turnBlockInto("bullet")}>
                            <List className="size-3.5" /> Bullet list
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("ordered")}>
                            <ListOrdered className="size-3.5" /> Numbered list
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("task")}>
                            <ListChecks className="size-3.5" /> Task list
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("quote")}>
                            <Quote className="size-3.5" /> Quote
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => turnBlockInto("code")}>
                            <Code2 className="size-3.5" /> Code block
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={deleteBlock}>
                        <Trash2 className="size-3.5" /> Delete block
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </DragHandle>
              <BubbleMenu editor={editor}>
                <EditorBubbleToolbar
                  editor={editor}
                  onComment={() => {
                    const blockId = currentBlockId(editor);
                    onCommentBlock(blockId ?? "");
                  }}
                />
              </BubbleMenu>
            </>
          ) : null}
          <div className="min-h-[45vh]" onClick={() => editor?.chain().focus().run()}>
            <EditorPageContext.Provider value={{ pageId, title }}>
              {editor ? <EditorContent editor={editor} /> : null}
            </EditorPageContext.Provider>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className={`status-dot ${saveStatus === "error" ? "bg-destructive" : "bg-moss"}`} />
          Local-first · IndexedDB
          <span className="opacity-40">·</span>
          {editor ? <EditorCharacterCount editor={editor} /> : "—"}
        </span>
        <span>Every block has an id for comments and transclusion.</span>
      </div>

      <EditorMenu
        state={menu}
        selected={menuIndex}
        onSelect={selectMenuItem}
        onHover={setMenuIndex}
      />

      <PagePickerDialog
        open={Boolean(pagePicker?.open)}
        mode={pagePicker?.mode ?? "link"}
        onClose={() => setPagePicker(null)}
        onPick={applyPagePick}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          for (const file of files) void uploadImageFile(file);
        }}
      />

      <ConfirmDialog
        open={confirmTrash}
        title="Move this page to trash?"
        description="The page and its subpages move to Trash, where they can be restored until the retention window passes."
        confirmLabel="Move to trash"
        onClose={() => setConfirmTrash(false)}
        onConfirm={async () => {
          setConfirmTrash(false);
          await removePage();
        }}
      />

      <Modal
        open={pluginPickerOpen}
        onClose={() => setPluginPickerOpen(false)}
        title="Insert plugin block"
        description="Blocks come from plugins installed on this device. Running one executes it in a sandboxed worker with only the capabilities you granted."
        className="max-w-lg"
      >
        <div className="space-y-1">
          {pluginBlockChoices.length ? (
            pluginBlockChoices.map((choice) => (
              <button
                key={`${choice.plugin.manifest.id}:${choice.tool.id}`}
                type="button"
                onClick={() => insertPluginBlock(choice)}
                className="w-full rounded-lg border border-border/60 bg-background/40 px-2.5 py-2 text-left hover:bg-muted/40"
              >
                <span className="block text-xs font-medium">{choice.tool.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {choice.plugin.manifest.name}
                  {choice.tool.output === "markdown" ? " · renders Markdown" : ""}
                </span>
                {choice.tool.description ? (
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {choice.tool.description}
                  </span>
                ) : null}
              </button>
            ))
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No plugin blocks installed. Install a plugin with a{" "}
              <span className="font-mono">blocks</span> entry in Settings → Plugins.
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        title="Suggest an edit"
        description="The page stays unchanged until an editor accepts this suggestion."
        className="max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSuggestOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={suggestBusy}
              onClick={() => void submitSuggestion()}
            >
              {suggestBusy ? "Sending…" : "Send suggestion"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Proposed body (Markdown)
            </span>
            <textarea
              value={suggestText}
              onChange={(event) => setSuggestText(event.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-xs leading-relaxed outline-none focus:border-primary/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Note for reviewers
            </span>
            <input
              value={suggestNote}
              onChange={(event) => setSuggestNote(event.target.value)}
              placeholder="Why this change?"
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/40"
            />
          </label>
        </div>
      </Modal>

      <AiResultDialog
        result={aiResult}
        busy={aiBusy}
        onClose={() => setAiResult(null)}
        onAddCards={() => void addAiCards()}
        onAddMindMap={() => void addAiMindMap()}
        onAddConnection={(id) => void addAiConnection(id)}
        onOpenPage={(id) => router.push(appRouteObject({ view: "page", id }))}
      />

      <VersionDialog
        open={versionOpen}
        loading={versionsLoading}
        versions={versions}
        onClose={() => setVersionOpen(false)}
        onRestore={(id) => void restoreVersion(id)}
      />

      <SaveTemplateDialog
        open={templateOpen}
        defaultName={page.title}
        onClose={() => setTemplateOpen(false)}
        onSave={async (name, category) => {
          if (!db || !user || !activeWorkspaceId) return;
          const template = await createTemplateFromPageLocal(db, {
            workspaceId: activeWorkspaceId,
            userId: user.id,
            pageId,
            name,
            category,
            icon: page.icon,
          });
          if (template) {
            toast.success(`Saved “${template.name}” as a template`);
            setTemplateOpen(false);
          } else {
            toast.error("Could not save this page as a template");
          }
        }}
      />
    </div>
  );
}

function SaveTemplateDialog({
  open,
  defaultName,
  onClose,
  onSave,
}: {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onSave: (name: string, category: string) => void | Promise<void>;
}) {
  const [name, setName] = useState(defaultName);
  const [category, setCategory] = useState("Work");

  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save as template"
      description="Reuse this page's structure in any notebook."
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Templates stay in this workspace and sync with it.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={!name.trim()}
              onClick={() => void onSave(name.trim(), category)}
            >
              Save template
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Template name
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none focus:border-primary/40"
            autoFocus
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Category
          </span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary/40"
          >
            {["Work", "Writing", "Research", "Learning", "Engineering", "Personal"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          The page body and properties are copied. Later edits to this page do not change the
          template.
        </p>
      </div>
    </Modal>
  );
}

function currentBlockId(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    const id = node.attrs?.blockId;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

function EditorCharacterCount({ editor }: { editor: Editor }) {
  const count = useEditorState({
    editor,
    selector: ({ editor: current }) => current.storage.characterCount?.characters?.() ?? 0,
  });
  return <>{count} characters</>;
}

function EditorBubbleToolbar({
  editor,
  onComment,
}: {
  editor: Editor;
  onComment: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      highlight: current.isActive("highlight"),
      heading: current.isActive("heading"),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      task: current.isActive("taskList"),
      quote: current.isActive("blockquote"),
    }),
  });

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-xl">
      <BubbleButton
        active={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <UnderlineIcon className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <Strikethrough className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.code}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline code"
      >
        <Code2 className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.highlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        title="Highlight"
      >
        <Highlighter className="size-3.5" />
      </BubbleButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <BubbleButton
        onClick={() => {
          const href = window.prompt("Link URL");
          if (!href) return;
          editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
        }}
        title="Link"
      >
        <Link2 className="size-3.5" />
      </BubbleButton>
      <BubbleButton onClick={onComment} title="Comment on block">
        <MessageSquare className="size-3.5" />
      </BubbleButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <BubbleButton
        active={state.heading}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading"
      >
        <Heading1 className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.bullet}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.task}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        title="Checklist"
      >
        <ListChecks className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        active={state.quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Quote"
      >
        <Quote className="size-3.5" />
      </BubbleButton>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <BubbleButton onClick={() => editor.chain().focus().undo().run()} title="Undo">
        <Undo2 className="size-3.5" />
      </BubbleButton>
      <BubbleButton onClick={() => editor.chain().focus().redo().run()} title="Redo">
        <Redo2 className="size-3.5" />
      </BubbleButton>
    </div>
  );
}

function BubbleButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function VersionDialog({
  open,
  loading,
  versions,
  onClose,
  onRestore,
}: {
  open: boolean;
  loading: boolean;
  versions: Array<{ id: string; version: number; title: string; createdAt: string; note: string | null }>;
  onClose: () => void;
  onRestore: (id: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Version history" description="Restoring creates a new version; nothing is lost.">
      {loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Loading versions…</div>
      ) : versions.length ? (
        <div className="space-y-1.5">
          {versions.map((version) => (
            <div key={version.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/50 px-3 py-2">
              <span className="grid size-6 place-items-center rounded-full border border-border text-xs text-muted-foreground">
                v{version.version}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{version.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(version.createdAt).toLocaleString()} · {version.note ?? "Manual snapshot"}
                </div>
              </div>
              <Button variant="outline" size="sm" className="h-7 rounded text-xs" onClick={() => onRestore(version.id)}>
                Restore
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-8 text-center text-xs text-muted-foreground">
          No versions yet. Save one before a big edit.
        </div>
      )}
    </Modal>
  );
}

function AiResultDialog({
  result,
  busy,
  onClose,
  onAddCards,
  onAddMindMap,
  onAddConnection,
  onOpenPage,
}: {
  result: AiResult | null;
  busy: boolean;
  onClose: () => void;
  onAddCards: () => void;
  onAddMindMap: () => void;
  onAddConnection: (id: string) => void;
  onOpenPage: (id: string) => void;
}) {
  return (
    <Modal
      open={Boolean(result) || busy}
      onClose={onClose}
      title={result?.title ?? "Ask Lattice"}
      description="AI output is a draft. Review it before applying anything."
      className="max-w-2xl"
    >
      {busy ? (
        <div className="flex items-center gap-2 py-10 text-xs text-muted-foreground">
          <span className="size-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
          Retrieving your notes…
        </div>
      ) : result ? (
        <div className="space-y-3">
          {result.provider ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <Sparkles className="size-2.5 text-saffron" /> {result.provider === "local" ? "local mode" : result.provider}
            </span>
          ) : null}
          {result.answer ? (
            <div className="whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/20 p-3 text-xs leading-relaxed">
              {result.answer}
            </div>
          ) : null}
          {result.citations?.length ? (
            <div className="flex flex-wrap gap-1">
              {result.citations.map((citation) => (
                <button
                  key={citation.pageId}
                  type="button"
                  onClick={() => onOpenPage(citation.pageId)}
                  title={citation.excerpt}
                  className="inline-flex max-w-52 items-center gap-1 truncate rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-saffron/50 hover:text-foreground"
                >
                  <Sparkles className="size-2.5 shrink-0 text-saffron/70" />
                  <span className="truncate">{citation.title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {result.pages ? (
            <div className="space-y-1.5">
              {result.pages.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{entry.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.reason} · {formatRelative(entry.updatedAt)}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded text-xs"
                    onClick={() => onOpenPage(entry.id)}
                  >
                    Open
                  </Button>
                </div>
              ))}
              {!result.pages.length ? (
                <p className="text-xs text-muted-foreground">
                  Nothing looks stale. Every page was updated recently and has no open TODOs.
                </p>
              ) : null}
            </div>
          ) : null}
          {result.cards ? (
            <div className="space-y-1.5">
              {result.cards.map((card, index) => (
                <div key={index} className="rounded-lg border border-border/60 bg-card/50 p-2.5">
                  <div className="text-xs font-medium">{card.front}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{card.back}</div>
                </div>
              ))}
              <Button size="sm" className="h-8 rounded-lg text-xs" onClick={onAddCards}>
                Add {result.cards.length} cards
              </Button>
            </div>
          ) : null}
          {result.outline ? (
            <div className="space-y-1">
              {result.canvas ? <CanvasPlanPreview document={result.canvas} /> : null}
              {result.outline.map((item) => (
                <div key={item.id} className="text-xs text-muted-foreground" style={{ paddingLeft: (item.level - 1) * 10 }}>
                  {item.text}
                </div>
              ))}
              <Button size="sm" className="mt-2 h-8 rounded-lg text-xs" onClick={onAddMindMap}>
                Create whiteboard
              </Button>
            </div>
          ) : null}
          {result.suggestions ? (
            <div className="space-y-1.5">
              {result.suggestions.map((suggestion) => (
                <div key={suggestion.pageId} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2">
                  <span className="text-xs">◇</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{suggestion.title}</div>
                    <div className="text-xs text-muted-foreground">{suggestion.reason} · {suggestion.score}</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded text-xs"
                    onClick={() => onAddConnection(suggestion.pageId)}
                  >
                    Link
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
