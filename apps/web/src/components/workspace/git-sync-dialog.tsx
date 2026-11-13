"use client";

import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, GitBranch, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { humanizeError } from "@/lib/errors";
import type { GithubAuth } from "@/lib/github-api";
import { parseRepoInput } from "@/lib/github-import";
import { planSync, pullRow, pushRow, type GitSyncRow, type GitTarget } from "@/lib/git-sync";
import { client } from "@/utils/orpc";
import {
  clearGitSyncConfig,
  loadGitSyncConfig,
  saveGitSyncConfig,
  type GitSyncConfig,
} from "@/lib/git-sync-schedule";

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
      return "text-link";
  }
}

export function GitSyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, user, activeWorkspaceId, online } = useAppData();
  const github = useQuery({
    queryKey: ["github-status", user?.id],
    queryFn: async () => client.github.status(),
    enabled: online && Boolean(user),
  });
  const connected = Boolean(github.data?.connected);
  const repos = useQuery({
    queryKey: ["github-repos", user?.id],
    queryFn: async () => client.github.repos(),
    enabled: online && connected,
    staleTime: 5 * 60_000,
  });
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [prefix, setPrefix] = useState("");
  const [token, setToken] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [rows, setRows] = useState<GitSyncRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [savedConfig, setSavedConfig] = useState<GitSyncConfig | null>(null);

  useEffect(() => {
    if (!open || !activeWorkspaceId) return;
    const config = loadGitSyncConfig(activeWorkspaceId);
    setSavedConfig(config);
    if (!config) return;
    setRepo(config.repo);
    setBranch(config.branch);
    setPrefix(config.pathPrefix);
    setToken(config.token);
    setCommitMessage(config.commitMessage);
    setAutoSync(config.enabled);
    setIntervalMinutes(String(config.intervalMinutes));
  }, [open, activeWorkspaceId]);

  const saveSchedule = () => {
    if (!activeWorkspaceId || !parsed) {
      toast.error("Enter the repository first.");
      return;
    }
    const config: GitSyncConfig = {
      repo: `${parsed.owner}/${parsed.repo}`,
      branch,
      pathPrefix: prefix,
      token: connected ? "" : token,
      useConnection: connected,
      commitMessage: commitMessage.trim(),
      intervalMinutes: Number(intervalMinutes) || 60,
      enabled: autoSync,
    };
    saveGitSyncConfig(activeWorkspaceId, config);
    setSavedConfig(config);
    toast.success(
      autoSync
        ? `Scheduled sync saved — every ${config.intervalMinutes} min`
        : "Scheduled sync is off; the saved config stays for manual runs",
    );
  };

  const forgetSchedule = () => {
    if (!activeWorkspaceId) return;
    clearGitSyncConfig(activeWorkspaceId);
    setSavedConfig(null);
    setAutoSync(false);
    setToken("");
    toast.success("Saved sync credentials removed from this browser");
  };

  const parsed = parseRepoInput(repo);
  const auth: GithubAuth = connected ? { kind: "connection" } : { kind: "manual", token };
  const target: GitTarget | null = parsed
    ? { repo: `${parsed.owner}/${parsed.repo}`, branch, pathPrefix: prefix, auth }
    : null;

  const check = async () => {
    if (!db || !activeWorkspaceId || !target) return;
    setBusy(true);
    setError(null);
    setRows(null);
    try {
      setRows(await planSync(db, activeWorkspaceId, target));
    } catch (reason) {
      setError(humanizeError(reason, "Could not read the repository.").message);
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
      setError(humanizeError(reason, "That file did not sync.").message);
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
      setError(humanizeError(reason, "Sync stopped partway.").message);
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
              : savedConfig
                ? savedConfig.enabled
                  ? `Scheduled sync every ${savedConfig.intervalMinutes} min · ${
                      savedConfig.useConnection
                        ? "connected GitHub account"
                        : "token saved in this browser"
                    }`
                  : "Saved config · scheduled sync is off"
                : "The token is used for this session only unless you save it for scheduled sync."}
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
        {connected && repos.data?.repos.length ? (
          <datalist id="github-sync-repos">
            {repos.data.repos.map((entry) => (
              <option key={entry.fullName} value={entry.fullName}>
                {entry.private ? "private" : "public"}
              </option>
            ))}
          </datalist>
        ) : null}
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
              list={connected ? "github-sync-repos" : undefined}
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
          {connected ? (
            <div className="flex h-9 items-center gap-2 self-end rounded-lg border border-moss/25 bg-moss/[0.05] px-2.5">
              <span className="status-dot bg-moss" />
              <span className="truncate text-[10px]">@{github.data?.login}</span>
            </div>
          ) : (
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
          )}
        </div>

        {connected ? (
          <p className="text-[8.5px] leading-relaxed text-muted-foreground">
            Authenticated with the connected GitHub account. The token stays encrypted on the server
            and is never sent to this browser.
          </p>
        ) : null}

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

        <div className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[10px]">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(event) => setAutoSync(event.target.checked)}
                className="size-3 accent-[var(--saffron)]"
              />
              Sync on a schedule
            </label>
            <select
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-[9px]"
            >
              <option value="15">every 15 min</option>
              <option value="30">every 30 min</option>
              <option value="60">every hour</option>
              <option value="240">every 4 hours</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              className="h-7 rounded-md text-[9px]"
              disabled={!target}
              onClick={saveSchedule}
            >
              Save for scheduled sync
            </Button>
            {savedConfig ? (
              <button
                type="button"
                onClick={forgetSchedule}
                className="text-[8px] text-muted-foreground underline underline-offset-2 hover:text-destructive"
              >
                Forget saved credentials
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[8px] leading-relaxed text-muted-foreground">
            Scheduled passes push local edits and pull remote edits; conflicts and unpublished pages
            still wait for you.{" "}
            {connected
              ? "The background run calls the server, so it needs a connection but stores no token here."
              : "The token is stored in this browser so the background run can use it."}
          </p>
        </div>

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
