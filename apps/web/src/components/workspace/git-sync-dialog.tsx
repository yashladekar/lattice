"use client";

import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { ArrowDownToLine, ArrowUpFromLine, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { parseRepoInput } from "@/lib/github-import";
import { planSync, pullRow, pushRow, type GitSyncRow, type GitTarget } from "@/lib/git-sync";

const STATE_LABELS: Record<GitSyncRow["action"], string> = {
  "in-sync": "In sync",
  publish: "New here",
  push: "Local ahead",
  pull: "Remote ahead",
  conflict: "Conflict",
  "remote-missing": "Deleted remotely",
};

function stateTone(action: GitSyncRow["action"]): string {
  switch (action) {
    case "in-sync":
      return "text-moss";
    case "conflict":
      return "text-destructive";
    case "remote-missing":
      return "text-saffron";
    default:
      return "text-primary";
  }
}

export function GitSyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, user, activeWorkspaceId } = useAppData();
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [prefix, setPrefix] = useState("");
  const [token, setToken] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [rows, setRows] = useState<GitSyncRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseRepoInput(repo);
  const target: GitTarget | null = parsed
    ? { repo: `${parsed.owner}/${parsed.repo}`, branch, pathPrefix: prefix, token }
    : null;

  const check = async () => {
    if (!db || !activeWorkspaceId || !target) return;
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      setRows(await planSync(db, activeWorkspaceId, target));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not read the repository.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (row: GitSyncRow, action: "push" | "pull") => {
    if (!db || !user || !target) return;
    setWorking(`${row.pageId}:${action}`);
    setError(null);
    try {
      if (action === "push") {
        await pushRow(db, row, target, {
          userId: user.id,
          commitMessage: commitMessage.trim() || `Update ${row.path || row.title} from Lattice`,
        });
      } else {
        await pullRow(db, row, target, { userId: user.id });
      }
      const fresh = await planSync(db, activeWorkspaceId ?? "", target);
      setRows(fresh);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That file did not sync.");
    } finally {
      setWorking(null);
    }
  };

  const syncSafe = async () => {
    if (!db || !user || !target || !rows) return;
    const queue = rows.filter((row) => row.action === "push" || row.action === "pull");
    if (!queue.length) {
      toast.success("Nothing to move — every file matches.");
      return;
    }
    setBusy(true);
    setError(null);
    let pushed = 0;
    let pulled = 0;
    try {
      for (const row of queue) {
        setWorking(`${row.pageId}:${row.action}`);
        if (row.action === "push") {
          await pushRow(db, row, target, {
            userId: user.id,
            commitMessage: commitMessage.trim() || `Update ${row.path || row.title} from Lattice`,
          });
          pushed += 1;
        } else {
          await pullRow(db, row, target, { userId: user.id });
          pulled += 1;
        }
      }
      setRows(await planSync(db, activeWorkspaceId ?? "", target));
      toast.success(`Pushed ${pushed}, pulled ${pulled}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sync stopped partway.");
      try {
        setRows(await planSync(db, activeWorkspaceId ?? "", target));
      } catch {
        // Keep the rows we already had.
      }
    } finally {
      setBusy(false);
      setWorking(null);
    }
  };

  const counts = rows
    ? {
        push: rows.filter((row) => row.action === "push" || row.action === "publish").length,
        pull: rows.filter((row) => row.action === "pull").length,
        conflicts: rows.filter((row) => row.action === "conflict").length,
      }
    : null;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      title="Sync with a Git repository"
      description="Two-way: pull remote edits and push yours back. Divergence is reported, never overwritten."
      className="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] text-muted-foreground">
            {counts
              ? `${counts.push} to push · ${counts.pull} to pull · ${counts.conflicts} conflicts`
              : "The token is used for this session only and never stored."}
          </span>
          <div className="flex items-center gap-2">
            {rows?.length ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-[11px]"
                disabled={busy || !counts?.push && !counts?.pull}
                onClick={() => void syncSafe()}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Sync both ways
              </Button>
            ) : null}
            <Button
              size="sm"
              className="h-8 rounded-lg text-[11px]"
              disabled={busy || !target}
              onClick={() => void check()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
              Check repository
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Repository
            </span>
            <input
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder="owner/repository"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-[12px] outline-none focus:border-primary/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Branch (optional)
            </span>
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder="default branch"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-[12px] outline-none focus:border-primary/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Path prefix (optional)
            </span>
            <input
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
              placeholder="docs"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-[12px] outline-none focus:border-primary/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              Token
            </span>
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ghp_… with repo scope"
              type="password"
              spellCheck={false}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-[11px] outline-none focus:border-primary/40"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            Commit message (optional)
          </span>
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Update notes from Lattice"
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-[12px] outline-none focus:border-primary/40"
          />
        </label>

        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[10px] leading-relaxed text-destructive">
            {error}
          </p>
        ) : null}

        {rows ? (
          rows.length ? (
            <div className="max-h-72 overflow-y-auto rounded-xl border border-border/70">
              {rows.map((row) => (
                <div
                  key={row.pageId}
                  className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[11px]">{row.title}</span>
                      <span className={cn("text-[8.5px] uppercase tracking-wide", stateTone(row.action))}>
                        {STATE_LABELS[row.action]}
                      </span>
                    </div>
                    <div className="truncate font-mono text-[8.5px] text-muted-foreground">
                      {row.path || "(new file)"} · {row.reason}
                    </div>
                  </div>
                  {row.action === "pull" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 rounded-md text-[9px]"
                      disabled={busy || Boolean(working)}
                      onClick={() => void apply(row, "pull")}
                    >
                      <ArrowDownToLine className="size-3" /> Pull
                    </Button>
                  ) : null}
                  {row.action === "push" || row.action === "publish" || row.action === "remote-missing" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 rounded-md text-[9px]"
                      disabled={busy || Boolean(working)}
                      onClick={() => void apply(row, "push")}
                    >
                      <ArrowUpFromLine className="size-3" />
                      {row.action === "publish" ? "Publish" : "Push"}
                    </Button>
                  ) : null}
                  {row.action === "conflict" ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 rounded-md text-[9px]"
                        disabled={busy || Boolean(working)}
                        onClick={() => void apply(row, "push")}
                      >
                        Keep mine
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 rounded-md text-[9px]"
                        disabled={busy || Boolean(working)}
                        onClick={() => void apply(row, "pull")}
                      >
                        Take remote
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-border/70 px-2.5 py-3 text-[10px] text-muted-foreground">
              No pages here are bound to this repository yet. Import it from GitHub first — the import
              records each file&apos;s path and blob SHA, which is what makes two-way sync safe.
            </p>
          )
        ) : (
          <p className="text-[9px] leading-relaxed text-muted-foreground">
            Checking reads the repository tree only, so it costs a single request. Pushing sends the
            page body as Markdown with the SHA it expects to replace, so a file that moved on the
            remote comes back as a conflict instead of being overwritten.
          </p>
        )}
      </div>
    </Modal>
  );
}
