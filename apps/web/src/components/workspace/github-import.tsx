"use client";

import { Button } from "@notes-learning/ui/components/button";
import { docToMarkdown, hashContent } from "@notes-learning/domain";
import { GitBranch, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { useWorkspaceNotebooks } from "@/hooks/use-local-data";
import { appRouteObject } from "@/lib/navigation";
import { createNotebookLocal, createPageLocal } from "@/lib/local/repository";
import {
  fetchGithubMarkdown,
  markdownToDoc,
  parseRepoInput,
  type GithubImportProgress,
} from "@/lib/github-import";

export function GithubImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const notebooks = useWorkspaceNotebooks();
  const [repo, setRepo] = useState("");
  const [prefix, setPrefix] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GithubImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseRepoInput(repo);

  const run = async () => {
    if (!db || !user || !activeWorkspaceId) return;
    if (!parsed) {
      setError("Use owner/repository, for example vercel/next.js.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const files = await fetchGithubMarkdown(
        { ...parsed, pathPrefix: prefix || undefined, token: token || undefined },
        { onProgress: setProgress },
      );

      setProgress({ phase: "saving", done: 0, total: files.length, label: "Creating pages…" });

      const notebookName = parsed.repo;
      const existing = notebooks.find(
        (notebook) => notebook.name.toLowerCase() === notebookName.toLowerCase(),
      );
      const notebook =
        existing ??
        (await createNotebookLocal(db, {
          workspaceId: activeWorkspaceId,
          userId: user.id,
          name: notebookName,
          icon: "⌘",
          description: `Imported from github.com/${parsed.owner}/${parsed.repo}`,
        }));

      let firstPageId: string | null = null;
      for (const [index, file] of files.entries()) {
        setProgress({
          phase: "saving",
          done: index,
          total: files.length,
          label: file.path,
        });
        const doc = markdownToDoc(file.markdown);
        const created = await createPageLocal(db, {
          workspaceId: activeWorkspaceId,
          userId: user.id,
          notebookId: notebook.id,
          title: file.title,
          icon: "⌘",
          content: doc,
          properties: {
            source: "github",
            repo: `${parsed.owner}/${parsed.repo}`,
            branch: file.branch,
            path: file.path,
            remoteSha: file.sha,
            // Hashing the round-tripped body, not the source file: sync will
            // compare against the same serialisation, so an untouched page
            // reads as unchanged instead of as a pending edit.
            localHash: hashContent(docToMarkdown(doc)),
          },
        });
        firstPageId ??= created.page.id;
      }

      onClose();
      setRepo("");
      setPrefix("");
      setToken("");
      toast.success(`Imported ${files.length} pages into ${notebook.name}`);
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
        onClose();
      }}
      title="Import from GitHub"
      description="Pull a repository's Markdown into a notebook. One-way: GitHub is not updated."
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {progress ? `${progress.done}/${progress.total} · ${progress.label}` : "Up to 40 files."}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy || !parsed}
              onClick={() => void run()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
              Import
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Repository
          </span>
          <input
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            placeholder="owner/repository"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-primary/40"
            autoFocus
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {parsed ? `github.com/${parsed.owner}/${parsed.repo}` : "A public repository works without a token."}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Folder (optional)
          </span>
          <input
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            placeholder="docs"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-primary/40"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Token (optional)
          </span>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ghp_… for private repos or higher limits"
            type="password"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs outline-none focus:border-primary/40"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Used for this request only and never stored.
          </span>
        </label>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}

        <p className="text-xs leading-relaxed text-muted-foreground">
          Markdown files become pages in a notebook named after the repository. Each page records its
          repo and path as properties, and images stay linked by their original URL.
        </p>
      </div>
    </Modal>
  );
}
