"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import {
  lastGitSyncRun,
  loadGitSyncConfig,
  markGitSyncRun,
  runScheduledGitSync,
} from "@/lib/git-sync-schedule";

/**
 * Runs the two-way Git sync on the interval chosen in the Git sync dialog.
 * Browsers throttle background timers, so it also checks whenever the window
 * regains focus. Unattended passes never resolve conflicts by themselves.
 */
export function GitSyncScheduler() {
  const { db, user, activeWorkspaceId, online } = useAppData();
  const runningRef = useRef(false);

  useEffect(() => {
    if (!db || !user || !activeWorkspaceId || !online) return;
    const workspaceId = activeWorkspaceId;
    const userId = user.id;
    let stopped = false;

    const tick = async () => {
      if (stopped || runningRef.current) return;
      const config = loadGitSyncConfig(workspaceId);
      if (!config?.enabled || !config.repo) return;
      if (Date.now() - lastGitSyncRun(workspaceId) < config.intervalMinutes * 60_000) return;
      runningRef.current = true;
      try {
        const result = await runScheduledGitSync({ db, userId, workspaceId, config });
        markGitSyncRun(workspaceId);
        if (result.pushed || result.pulled) {
          toast.success(`Scheduled Git sync — pushed ${result.pushed}, pulled ${result.pulled}`);
        }
      } catch (error) {
        markGitSyncRun(workspaceId);
        toast.error(error instanceof Error ? error.message : "Scheduled Git sync failed");
      } finally {
        runningRef.current = false;
      }
    };

    const interval = window.setInterval(() => void tick(), 60_000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    void tick();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [db, user, activeWorkspaceId, online]);

  return null;
}
