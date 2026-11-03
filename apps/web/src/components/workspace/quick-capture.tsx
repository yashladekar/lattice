"use client";

import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import { FileText, Link2, Loader2, Paperclip, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { createCaptureLocal } from "@/lib/local/repository";
import { uploadFile } from "@/lib/upload";
import { client } from "@/utils/orpc";

export interface CaptureInitial {
  type: "NOTE" | "BOOKMARK";
  title?: string;
  content?: string;
  url?: string;
}

export function QuickCaptureDialog({
  open,
  onClose,
  onSaved,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  initial?: CaptureInitial | null;
}) {
  const { db, user, activeWorkspaceId, online } = useAppData();
  const [kind, setKind] = useState<"NOTE" | "BOOKMARK">(initial?.type ?? "NOTE");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !initial) return;
    setKind(initial.type);
    setTitle(initial.title ?? "");
    setContent(initial.content ?? "");
    setUrl(initial.url ?? "");
  }, [open, initial]);

  const reset = () => {
    setTitle("");
    setContent("");
    setUrl("");
    setKind("NOTE");
  };

  const fetchPreview = async () => {
    if (!activeWorkspaceId || !url || !online) return;
    setPreviewing(true);
    try {
      const preview = await client.capture.preview({
        url,
      });
      if (!title && preview.title) setTitle(preview.title);
      if (!content && preview.description) setContent(preview.description);
    } catch {
      // A bookmark is still useful without metadata.
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    if (kind === "NOTE" && !content.trim() && !title.trim()) return;
    if (kind === "BOOKMARK" && !url.trim()) {
      toast.error("Add a URL to bookmark.");
      return;
    }
    setSaving(true);
    try {
      await createCaptureLocal(db, {
        workspaceId: activeWorkspaceId,
        userId: user.id,
        type: kind,
        title: title.trim() || (kind === "BOOKMARK" ? url : "Quick capture"),
        content: content.trim() || null,
        url: kind === "BOOKMARK" ? url.trim() : null,
        source: "quick-capture",
      });
      toast.success("Captured. It is waiting in your inbox.");
      reset();
      onSaved?.();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Quick capture"
      description="Get it out of your head. Organize it later."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[9px] text-muted-foreground">
            Saved locally first · sync is optional
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 rounded-lg text-[11px]" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-lg text-[11px]"
              disabled={saving}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Capture
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="inline-flex rounded-lg border border-border bg-muted/35 p-0.5">
          {[
            { value: "NOTE" as const, label: "Note", icon: FileText },
            { value: "BOOKMARK" as const, label: "Link", icon: Link2 },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setKind(option.value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] transition-colors",
                kind === option.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <option.icon className="size-3" />
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-muted-foreground">
            Paste text, or attach a file to the inbox.
          </span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUploading(true);
              try {
                const uploaded = await uploadFile(file);
                setKind("BOOKMARK");
                setUrl(uploaded.url);
                if (!title.trim()) setTitle(uploaded.name);
                toast.success("File attached to this capture");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not upload that file");
              } finally {
                setUploading(false);
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-lg text-[9px]"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="size-3 animate-spin" /> : <Paperclip className="size-3" />}
            Attach file
          </Button>
        </div>

        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={kind === "NOTE" ? "A title, if you have one" : "Link title"}
          className="h-9 rounded-lg bg-background text-sm"
          autoFocus
        />

        {kind === "BOOKMARK" ? (
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onBlur={() => void fetchPreview()}
              placeholder="https://…"
              className="h-9 rounded-lg bg-background text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-lg"
              disabled={!url || previewing}
              onClick={() => void fetchPreview()}
            >
              {previewing ? <Loader2 className="size-3.5 animate-spin" /> : "Preview"}
            </Button>
          </div>
        ) : null}

        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
          placeholder={
            kind === "NOTE"
              ? "What is worth keeping? A thought, a quote, a question…"
              : "Why does this matter? Add a note to your future self."
          }
          className="min-h-32 rounded-lg bg-background text-sm leading-relaxed"
        />

        {kind === "BOOKMARK" && url ? (
          <div className="rounded-lg border border-border/60 bg-muted/25 p-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Link2 className="size-3 text-sky" />
              {title || url}
            </div>
            <p className="mt-1 line-clamp-2">{content || "Metadata will be fetched when online."}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
