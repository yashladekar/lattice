"use client";

import { formatRelative, isAudioFilename, relatedDocuments, safeDoc, suggestTagNames, appendSection } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Archive,
  ArrowUpRight,
  Check,
  FileText,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Mic,
  Plus,
  ScanText,
  Sparkles,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  useCaptures,
  useWorkspaceNotebooks,
  useWorkspacePages,
  useWorkspaceTags,
} from "@/hooks/use-local-data";
import {
  createCaptureLocal,
  createTagLocal,
  deleteCaptureLocal,
  organizeCaptureLocal,
  savePageContentLocal,
  setPageTagsLocal,
  updateCaptureLocal,
} from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";
import { recognizeImageText, recognizePdfText } from "@/lib/ocr";
import type { LocalCapture } from "@/lib/local/types";
import { getApiBaseUrl } from "@/lib/config";
import { uploadFile } from "@/lib/upload";
import { client } from "@/utils/orpc";

const STATUS_TABS = [
  { id: "INBOX" as const, label: "Inbox" },
  { id: "ORGANIZED" as const, label: "Organized" },
  { id: "ARCHIVED" as const, label: "Archived" },
];

const TYPE_FILTERS = [
  { id: "all", label: "All types", types: [] as string[] },
  { id: "notes", label: "Notes", types: ["NOTE", "TEXT"] },
  { id: "links", label: "Links", types: ["BOOKMARK", "CLIP", "YOUTUBE", "EMAIL"] },
  { id: "files", label: "Files", types: ["FILE", "PDF", "IMAGE", "AUDIO", "VIDEO"] },
] as const;

type TypeFilter = (typeof TYPE_FILTERS)[number]["id"];

function mediaUrl(url: string): string {
  return url.startsWith("http") ? url : `${getApiBaseUrl()}${url}`;
}

function CaptureCard({
  capture,
  onOrganized,
}: {
  capture: LocalCapture;
  onOrganized: (pageId: string) => void;
}) {
  const { db, user, activeWorkspaceId, online, retrySync } = useAppData();
  const notebooks = useWorkspaceNotebooks();
  const workspaceTags = useWorkspaceTags();
  const pages = useWorkspacePages();
  const documents =
    useLiveQuery(async () => (db ? db.pageDocuments.toArray() : []), [db], []) ?? [];
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [ocrStage, setOcrStage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLinks, setSelectedLinks] = useState<string[]>([]);
  const tags = suggestTagNames(
    `${capture.title} ${capture.content ?? ""}`,
    workspaceTags.map((tag) => tag.name),
  );
  const related = useMemo(() => {
    const byPage = new Map(documents.map((document) => [document.pageId, document]));
    const candidates = pages
      .filter((page) => !page.deletedAt)
      .map((page) => ({
        id: page.id,
        title: page.title,
        body: byPage.get(page.id)?.plainText ?? "",
      }));
    return relatedDocuments(
      { id: capture.id, title: capture.title, body: capture.content ?? "" },
      candidates,
      3,
    ).filter((entry) => entry.score > 0.08);
  }, [documents, pages, capture.id, capture.title, capture.content]);
  const pageId =
    typeof capture.metadata === "object" && capture.metadata
      ? (capture.metadata as Record<string, unknown>).pageId
      : null;

  const toggleValue = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const transcribe = async () => {
    if (!online) {
      toast.error("Transcription needs a connection to the sync server.");
      return;
    }
    setTranscribing(true);
    try {
      await client.ai.transcribe({ captureId: capture.id });
      await retrySync();
      toast.success("Transcript added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not transcribe the recording");
    } finally {
      setTranscribing(false);
    }
  };

  const runOcr = async (mode: "pdf" | "image") => {
    const sourceUrl = capture.url;
    if (!db || !sourceUrl) return;
    setExtracting(true);
    setOcrStage("preparing");
    try {
      const response = await fetch(mediaUrl(sourceUrl), { credentials: "include" });
      if (!response.ok) throw new Error("The file could not be downloaded for OCR.");
      const blob = await response.blob();
      const progress = (update: { stage: string; page?: number; pages?: number }) =>
        setOcrStage(
          update.page && update.pages
            ? `page ${update.page}/${update.pages} · ${update.stage}`
            : update.stage,
        );
      const result =
        mode === "pdf"
          ? await recognizePdfText(blob, progress)
          : { text: await recognizeImageText(blob, progress), pages: 1, ocrPages: 1 };
      if (!result.text) {
        toast.error("No text was recognized in this file.");
        return;
      }
      await updateCaptureLocal(db, capture.id, {
        content: appendSection(capture.content, "OCR text", result.text),
        metadata: {
          ...(typeof capture.metadata === "object" && capture.metadata ? capture.metadata : {}),
          ocr: {
            pages: result.pages,
            ocrPages: result.ocrPages,
            at: new Date().toISOString(),
          },
        },
      });
      toast.success(`OCR added ${result.text.length.toLocaleString()} characters`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OCR could not read this file");
    } finally {
      setExtracting(false);
      setOcrStage(null);
    }
  };

  const extractPdf = async () => {
    if (!online) {
      toast.message("Offline — reading the PDF in this browser instead.");
      await runOcr("pdf");
      return;
    }
    setExtracting(true);
    try {
      await retrySync();
      await client.capture.extractText({ captureId: capture.id });
      await retrySync();
      toast.success("PDF text extracted");
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/no selectable text/i.test(message)) {
        toast.error(message || "Could not extract the PDF text");
        return;
      }
    } finally {
      setExtracting(false);
    }
    toast.message("No text layer found — running OCR in this browser…");
    await runOcr("pdf");
  };

  const makePage = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    setBusy(true);
    try {
      const page = await organizeCaptureLocal(db, {
        captureId: capture.id,
        notebookId: notebooks[0]?.id ?? null,
        userId: user.id,
      });
      if (!page) return;
      if (selectedTags.length) {
        const tagIds: string[] = [];
        for (const name of selectedTags) {
          const tag = await createTagLocal(db, activeWorkspaceId, name);
          tagIds.push(tag.id);
        }
        await setPageTagsLocal(db, page.id, tagIds);
      }
      if (selectedLinks.length) {
        const document = await db.pageDocuments.get(page.id);
        const content = safeDoc(document?.content);
        const items = selectedLinks.map((id) => {
          const target = pages.find((entry) => entry.id === id);
          return {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "pageLink",
                    attrs: {
                      pageId: id,
                      title: target?.title ?? "Untitled",
                      icon: target?.icon ?? "◇",
                    },
                  },
                ],
              },
            ],
          };
        });
        content.content = [
          ...(content.content ?? []),
          { type: "paragraph", content: [{ type: "text", text: "Related notes" }] },
          { type: "bulletList", content: items },
        ] as NonNullable<typeof content.content>;
        await savePageContentLocal(db, { pageId: page.id, content, userId: user.id });
      }
      toast.success("Capture turned into a page");
      onOrganized(page.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-border/60 bg-card/40 p-3 transition-colors hover:border-border">
      <div className="flex items-start gap-2.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-background text-[11px] text-saffron">
          {capture.type === "BOOKMARK" ? (
            <Link2 className="size-3.5" />
          ) : capture.type === "EMAIL" ? (
            <Mail className="size-3.5" />
          ) : (
            <FileText className="size-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
              {capture.title || capture.url || "Untitled capture"}
            </h3>
            <span className="shrink-0 text-[8px] text-muted-foreground">
              {formatRelative(capture.createdAt)}
            </span>
          </div>
          {capture.content ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
              {capture.content}
            </p>
          ) : null}
          {capture.url ? (
            <a
              href={capture.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-flex items-center gap-1 text-[9px] text-sky hover:underline"
            >
              {capture.url.replace(/^https?:\/\//, "").slice(0, 60)}
              <ArrowUpRight className="size-2.5" />
            </a>
          ) : null}
          {capture.type === "AUDIO" && capture.url ? (
            <audio controls preload="none" src={mediaUrl(capture.url)} className="mt-1.5 h-8 w-full" />
          ) : null}
          {capture.type === "EMAIL" && capture.source ? (
            <p className="mt-1 truncate text-[8px] text-muted-foreground">From {capture.source}</p>
          ) : null}
          {capture.status === "INBOX" && (tags.length || related.length) ? (
            <div className="mt-2 space-y-1.5">
              {tags.length ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Sparkles className="size-2.5 text-saffron" />
                  {tags.slice(0, 5).map((tag) => {
                    const active = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setSelectedTags((current) => toggleValue(current, tag))}
                        className={cn(
                          "rounded-full border px-1.5 py-0.5 text-[7px] transition-colors",
                          active
                            ? "border-moss/60 bg-moss/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-moss/40",
                        )}
                        title={active ? "Approved — click to remove" : "Approve this tag"}
                      >
                        {active ? "✓ " : "+ "}
                        {tag}
                      </button>
                    );
                  })}
                  <span className="text-[7px] text-muted-foreground/60">tags</span>
                </div>
              ) : null}
              {related.length ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Link2 className="size-2.5 text-sky" />
                  {related.map((entry) => {
                    const active = selectedLinks.includes(entry.id);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedLinks((current) => toggleValue(current, entry.id))}
                        className={cn(
                          "max-w-40 truncate rounded-full border px-1.5 py-0.5 text-[7px] transition-colors",
                          active
                            ? "border-sky/60 bg-sky/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-sky/40",
                        )}
                        title={
                          active
                            ? "Will be linked — click to remove"
                            : "Link this note when the capture becomes a page"
                        }
                      >
                        {active ? "✓ " : "+ "}
                        {entry.title}
                      </button>
                    );
                  })}
                  <span className="text-[7px] text-muted-foreground/60">related notes</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-1 border-t border-border/40 pt-2">
        {capture.status === "INBOX" ? (
          <Button
            size="sm"
            className="h-6 rounded-md text-[8px]"
            disabled={busy || !db || !user || !activeWorkspaceId}
            onClick={() => void makePage()}
          >
            <Plus className="size-2.5" /> Make page
          </Button>
        ) : null}
        {capture.status === "ORGANIZED" && typeof pageId === "string" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-md text-[8px]"
            onClick={() => onOrganized(pageId)}
          >
            <ArrowUpRight className="size-2.5" /> Open page
          </Button>
        ) : null}
        {capture.status !== "ARCHIVED" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-md text-[8px] text-muted-foreground"
            disabled={!db}
            onClick={() => db && void updateCaptureLocal(db, capture.id, { status: "ARCHIVED" })}
          >
            <Archive className="size-2.5" /> Archive
          </Button>
        ) : null}
        {capture.type === "AUDIO" && capture.url ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-md text-[8px] text-muted-foreground"
            disabled={transcribing || !online}
            onClick={() => void transcribe()}
            title={online ? "Transcribe with the server's AI provider" : "Needs a sync server"}
          >
            {transcribing ? (
              <Loader2 className="size-2.5 animate-spin" />
            ) : (
              <Mic className="size-2.5" />
            )}{" "}
            Transcribe
          </Button>
        ) : null}
        {capture.type === "PDF" && capture.url ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-md text-[8px] text-muted-foreground"
            disabled={extracting}
            onClick={() => void extractPdf()}
            title="Read the text layer, or run OCR in this browser for scanned pages"
          >
            {extracting ? (
              <Loader2 className="size-2.5 animate-spin" />
            ) : (
              <FileText className="size-2.5" />
            )}{" "}
            Extract text
          </Button>
        ) : null}
        {capture.type === "IMAGE" && capture.url ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-md text-[8px] text-muted-foreground"
            disabled={extracting}
            onClick={() => void runOcr("image")}
            title="Read the text in this image with in-browser OCR"
          >
            {extracting ? (
              <Loader2 className="size-2.5 animate-spin" />
            ) : (
              <ScanText className="size-2.5" />
            )}{" "}
            OCR text
          </Button>
        ) : null}
        {ocrStage && extracting ? (
          <span className="text-[8px] text-muted-foreground">OCR · {ocrStage}</span>
        ) : null}
        {capture.status === "ARCHIVED" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-md text-[8px] text-muted-foreground"
            disabled={!db}
            onClick={() => db && void updateCaptureLocal(db, capture.id, { status: "INBOX" })}
          >
            <Inbox className="size-2.5" /> Return to inbox
          </Button>
        ) : null}
        <button
          type="button"
          aria-label="Delete capture"
          disabled={!db}
          onClick={() => setConfirmOpen(true)}
          className="ml-auto grid size-6 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this capture?"
        description="It leaves the inbox on every device."
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          if (db) await deleteCaptureLocal(db, capture.id);
          setConfirmOpen(false);
        }}
      />
    </article>
  );
}

export function InboxView({ onQuickCapture }: { onQuickCapture: () => void }) {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const [status, setStatus] = useState<"INBOX" | "ORGANIZED" | "ARCHIVED">("INBOX");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const captures = useCaptures(status);
  const visibleCaptures =
    typeFilter === "all"
      ? captures
      : captures.filter((capture) => {
          const filter = TYPE_FILTERS.find((entry) => entry.id === typeFilter);
          return filter ? (filter.types as readonly string[]).includes(capture.type) : true;
        });
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const uploadCaptureFile = async (file: File) => {
    if (!db || !user || !activeWorkspaceId) return;
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    const isAudio = file.type.startsWith("audio/") || isAudioFilename(file.name);
    const isImage = file.type.startsWith("image/");
    if (!isAudio && !isPdf && !isImage) {
      toast.error("Choose an audio file, a PDF, or an image.");
      return;
    }
    try {
      const uploaded = await uploadFile(file);
      await createCaptureLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        type: isAudio ? "AUDIO" : isPdf ? "PDF" : "IMAGE",
        title: file.name.slice(0, 120),
        content: "",
        url: uploaded.url,
        source: isAudio ? "audio upload" : isPdf ? "pdf upload" : "image upload",
        metadata: {
          mime: file.type || (isPdf ? "application/pdf" : ""),
          size: file.size,
        },
      });
      toast.success(
        isAudio
          ? "Audio added to the inbox"
          : isPdf
            ? "PDF added to the inbox"
            : "Image added to the inbox — use OCR text to read it",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not upload the file");
    }
  };

  const save = async () => {
    if (!db || !user || !activeWorkspaceId || !text.trim()) return;
    setSaving(true);
    try {
      await createCaptureLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        type: "NOTE",
        title: text.trim().slice(0, 90),
        content: text.trim(),
        source: "inbox",
      });
      setText("");
      toast.success("Added to your inbox");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-border/70 bg-card">
            <Inbox className="size-4 text-saffron" />
          </span>
          <div>
            <h1 className="font-display text-3xl tracking-[-0.03em]">Knowledge inbox</h1>
            <p className="text-[10px] text-muted-foreground">
              Capture first. Decide where it belongs when you are ready.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 rounded-lg text-[10px]" onClick={onQuickCapture}>
            <Link2 className="size-3" /> Capture a link
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-lg text-[10px]"
            onClick={() => uploadInputRef.current?.click()}
          >
            <Upload className="size-3" /> Upload file
          </Button>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="audio/*,application/pdf,image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadCaptureFile(file);
        }}
      />

      <div className="mt-5 rounded-xl border border-saffron/25 bg-saffron/[0.04] p-2.5">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder="Drop a thought, a quote, a question…"
          className="min-h-16 resize-none border-0 bg-transparent px-1 py-0.5 text-[11px] shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between pt-1">
          <span className="text-[8px] text-muted-foreground">Saved locally · process later</span>
          <Button size="sm" className="h-6 rounded-md text-[9px]" disabled={saving || !text.trim()} onClick={() => void save()}>
            {saving ? "Saving…" : "Capture"}
          </Button>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-1 border-b border-border/60 pb-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatus(tab.id)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[9px] transition-colors",
              status === tab.id
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[9px] text-muted-foreground">
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
            aria-label="Filter by capture type"
            className="h-6 rounded-full border border-border bg-background px-2 text-[9px]"
          >
            {TYPE_FILTERS.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.label}
              </option>
            ))}
          </select>
          {visibleCaptures.length} items
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {visibleCaptures.length ? (
          visibleCaptures.map((capture) => (
            <CaptureCard
              key={capture.id}
              capture={capture}
              onOrganized={(pageId) => router.push(appRouteObject({ view: "page", id: pageId }))}
            />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border py-16 text-center">
            {status === "INBOX" ? (
              <>
                <Check className="mx-auto size-6 text-moss" />
                <p className="mt-3 text-[12px] font-medium">Inbox zero</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Nothing waiting. Capture something new when inspiration arrives.
                </p>
              </>
            ) : (
              <>
                <Archive className="mx-auto size-6 text-muted-foreground/40" />
                <p className="mt-3 text-[12px] font-medium">Nothing here yet</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Captures you {status === "ORGANIZED" ? "turn into pages" : "archive"} will appear here.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
        <Sparkles className="mt-0.5 size-3.5 text-saffron" />
        <div className="text-[9px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">A note about suggestions.</span> Tags and related
          notes are proposed from your own content. Approve them in the capture card; Lattice never
          silently rewrites your knowledge.
        </div>
        <Tag className="ml-auto size-3 text-muted-foreground/40" />
      </div>
    </div>
  );
}
