import type { LatticeDB } from "@/lib/local/db";
import { planSync, pullRow, pushRow, type GitTarget } from "@/lib/git-sync";

export interface GitSyncConfig {
  repo: string;
  branch: string;
  pathPrefix: string;
  token: string;
  commitMessage: string;
  intervalMinutes: number;
  enabled: boolean;
}

const configKey = (workspaceId: string) => `lattice.gitSync.v1:${workspaceId}`;
const lastRunKey = (workspaceId: string) => `lattice.gitSync.last:${workspaceId}`;

export function loadGitSyncConfig(workspaceId: string): GitSyncConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(configKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GitSyncConfig>;
    if (!parsed.repo) return null;
    return {
      repo: parsed.repo,
      branch: parsed.branch ?? "",
      pathPrefix: parsed.pathPrefix ?? "",
      token: parsed.token ?? "",
      commitMessage: parsed.commitMessage ?? "",
      intervalMinutes: Math.max(15, Number(parsed.intervalMinutes) || 60),
      enabled: Boolean(parsed.enabled),
    };
  } catch {
    return null;
  }
}

export function saveGitSyncConfig(workspaceId: string, config: GitSyncConfig): void {
  window.localStorage.setItem(configKey(workspaceId), JSON.stringify(config));
}

export function clearGitSyncConfig(workspaceId: string): void {
  window.localStorage.removeItem(configKey(workspaceId));
  window.localStorage.removeItem(lastRunKey(workspaceId));
}

export function lastGitSyncRun(workspaceId: string): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(lastRunKey(workspaceId)) ?? "0");
  return Number.isFinite(value) ? value : 0;
}

export function markGitSyncRun(workspaceId: string): void {
  window.localStorage.setItem(lastRunKey(workspaceId), String(Date.now()));
}

/**
 * One unattended pass: push local edits and pull remote edits. Conflicts,
 * remote-missing files, and pages that have never been published are left for
 * a person to decide, matching the dialog's "Sync both ways" behavior.
 */
export async function runScheduledGitSync(input: {
  db: LatticeDB;
  userId: string;
  workspaceId: string;
  config: GitSyncConfig;
}): Promise<{ pushed: number; pulled: number; skipped: number }> {
  const target: GitTarget = {
    repo: input.config.repo,
    branch: input.config.branch,
    pathPrefix: input.config.pathPrefix,
    token: input.config.token,
  };
  const rows = await planSync(input.db, input.workspaceId, target);
  let pushed = 0;
  let pulled = 0;
  let skipped = 0;
  for (const row of rows) {
    if (row.action === "push") {
      await pushRow(input.db, row, target, {
        userId: input.userId,
        commitMessage: input.config.commitMessage || "Scheduled sync from Lattice",
      });
      pushed += 1;
    } else if (row.action === "pull") {
      await pullRow(input.db, row, target, { userId: input.userId });
      pulled += 1;
    } else if (row.action !== "in-sync") {
      skipped += 1;
    }
  }
  return { pushed, pulled, skipped };
}
