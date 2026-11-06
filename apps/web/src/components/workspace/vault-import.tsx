"use client";

import { Button } from "@notes-learning/ui/components/button";
import {
  linkWikiLinks,
  planVault,
  resolveVaultLinks,
  type VaultFile,
} from "@notes-learning/domain";
import { FolderUp, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { appRouteObject } from "@/lib/navigation";
import { markdownToDoc } from "@/lib/github-import";
import {
  createNotebookLocal,
  createPageLocal,
  createTagLocal,
  savePageContentLocal,
  setPageTagsLocal,
} from "@/lib/local/repository";

interface ImportProgress {
  done: number;
  total: number;
  label: string;
}

const MAX_FILES = 800;

async function readFiles(files: File[]): Promise<VaultFile[]> {
  const reads = await Promise.all(
    files
      .filter((file) => /\.md$/i.test(file.name))
      .map(async (file) => {
        const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        return {
          path: relative && relative.length ? relative : file.name,
          markdown: await file.text(),
        };
      }),
  );
  return reads;
}

export function VaultImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const folders = new Set<string>();
    for (const file of files) {
      const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const parts = (relative && relative.length ? relative : file.name).split("/");
      parts.pop();
      let path = "";
      for (const segment of parts.filter(Boolean)) {
        path = path ? `${path}/${segment}` : segment;
        folders.add(path);
      }
    }
    return { files: files.filter((file) => /\.md$/i.test(file.name)).length, folders: folders.size };
  }, [files]);

  const reset = () => {
    setFiles([]);
    setProgress(null);
    setError(null);
  };

  const run = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    setBusy(true);
    setError(null);
    try {
      setProgress({ done: 0, total: summary.files, label: "Reading files…" });
      const vaultFiles = await readFiles(files);
      if (!vaultFiles.length) {
        setError("No Markdown files were found in that selection.");
        return;
      }

      const plan = planVault(vaultFiles);
      const linkPlan = resolveVaultLinks(vaultFiles, plan);
      // With a folder picker every path starts with the chosen folder. A loose
      // multi-file upload has no vault root, so name the notebook generically.
      const nested = vaultFiles.every((file) => file.path.split("/").filter(Boolean).length > 1);
      const rootName = nested
        ? (vaultFiles[0]?.path.split("/").filter(Boolean)[0] ?? "Imported vault").replace(/\.md$/i, "")
        : "Imported vault";

      const existingNotebooks = await db.notebooks
        .where("workspaceId")
        .equals(activeWorkspaceId)
        .toArray();
      const notebookIdByPath = new Map<string, string>();
      const rootExisting = existingNotebooks.find(
        (notebook) => notebook.name.toLowerCase() === rootName.toLowerCase(),
      );
      const rootNotebook =
        rootExisting ??
        (await createNotebookLocal(db, {
          workspaceId: activeWorkspaceId,
          userId: user.id,
          name: rootName,
          icon: "⌘",
          description: "Imported from a Markdown vault",
        }));
      notebookIdByPath.set("", rootNotebook.id);

      for (const [index, folder] of plan.folders.entries()) {
        setProgress({ done: index, total: plan.folders.length, label: folder });
        const name = folder.split("/").pop() ?? folder;
        const existing = existingNotebooks.find(
          (notebook) => notebook.name.toLowerCase() === name.toLowerCase(),
        );
        const notebook =
          existing ??
          (await createNotebookLocal(db, {
            workspaceId: activeWorkspaceId,
            userId: user.id,
            name,
            icon: "⌘",
            description: `Imported folder · ${folder}`,
          }));
        notebookIdByPath.set(folder, notebook.id);
      }

      const pageIdByPath = new Map<string, string>();
      const documentByPath = new Map<string, ReturnType<typeof markdownToDoc>>();
      let firstPageId: string | null = null;

      for (const [index, page] of plan.pages.entries()) {
        setProgress({ done: index, total: plan.pages.length, label: page.title });
        const file = vaultFiles.find((entry) => entry.path === page.path);
        const body = file ? file.markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "") : "";
        const doc = markdownToDoc(body);
        documentByPath.set(page.path, doc);
        const created = await createPageLocal(db, {
          workspaceId: activeWorkspaceId,
          userId: user.id,
          notebookId: notebookIdByPath.get(page.folder ?? "") ?? rootNotebook.id,
          title: page.title,
          icon: "⌘",
          content: doc,
          properties: { source: "vault", path: page.path },
        });
        const createdPageId = created.page.id;
        pageIdByPath.set(page.path, createdPageId);
        firstPageId ??= createdPageId;

        if (page.tags.length) {
          const tagIds: string[] = [];
          for (const tag of page.tags) {
            const createdTag = await createTagLocal(db, activeWorkspaceId, tag);
            tagIds.push(createdTag.id);
          }
          await setPageTagsLocal(db, createdPageId, tagIds);
        }
      }

      let linked = 0;
      for (const [index, page] of plan.pages.entries()) {
        const doc = documentByPath.get(page.path);
        const pageId = pageIdByPath.get(page.path);
        if (!doc || !pageId) continue;
        if (!doc.content.some((node) => JSON.stringify(node).includes("[["))) continue;
        setProgress({ done: index, total: plan.pages.length, label: `Linking ${page.title}` });
        const rewritten = linkWikiLinks(doc, (target) => {
          const normalised = target.replace(/\.md$/i, "").toLowerCase();
          const match =
            plan.pages.find((entry) => entry.path.replace(/\.md$/i, "").toLowerCase() === normalised) ??
            plan.pages.find(
              (entry) => entry.path.split("/").pop()?.replace(/\.md$/i, "").toLowerCase() === normalised,
            );
          if (!match) return null;
          const targetId = pageIdByPath.get(match.path);
          return targetId ? { pageId: targetId, title: match.title } : null;
        });
        linked += rewritten.linked;
        if (rewritten.linked) {
          await savePageContentLocal(db, { pageId, content: rewritten.doc, userId: user.id });
        }
      }

      onClose();
      reset();
      const skipped = linkPlan.unresolved.length;
      toast.success(
        `Imported ${plan.pages.length} pages into ${plan.folders.length + 1} notebooks` +
          (linked ? ` · ${linked} links` : "") +
          (skipped ? ` · ${skipped} unresolved link targets` : ""),
      );
      if (firstPageId) router.push(appRouteObject({ view: "page", id: firstPageId }));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Import failed.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title="Import a Markdown vault"
      description="Obsidian vaults and Notion Markdown exports. Folders become notebooks and wiki links become real page links."
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {progress ? `${progress.done}/${progress.total} · ${progress.label}` : `Up to ${MAX_FILES} files.`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy}
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy || !summary.files}
              onClick={() => void run()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderUp className="size-3.5" />}
              Import
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,text/markdown"
          className="sr-only"
          aria-label="Choose a Markdown vault folder"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).slice(0, MAX_FILES);
            setFiles(selected);
            setError(null);
          }}
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        />

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-border bg-card/30 px-4 py-6 text-center transition-colors hover:border-primary/40"
        >
          <FolderUp className="size-4 text-muted-foreground" />
          <span className="text-xs font-medium">
            {summary.files ? `${summary.files} Markdown files selected` : "Choose a vault folder"}
          </span>
          <span className="text-xs text-muted-foreground">
            {summary.files
              ? `${summary.folders} folders · ${files.length} files read`
              : "Pick the folder that holds your notes, not a single file."}
          </span>
        </button>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Frontmatter titles and aliases are read, <span className="font-mono">#tags</span> become workspace
          tags, and <span className="font-mono">[[wiki links]]</span> are matched by path, file name, or
          alias. Unmatched links stay as text so nothing is lost.
        </p>
      </div>
    </Modal>
  );
}
