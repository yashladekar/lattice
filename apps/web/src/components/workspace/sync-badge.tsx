"use client";

import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";

import { useAppData } from "@/components/app-data-provider";

export function SyncBadge({ onConflicts }: { onConflicts?: () => void }) {
  const { syncState, online, retrySync } = useAppData();
  const conflictCount = syncState.conflicts;
  const pending = syncState.pending;

  if (conflictCount > 0) {
    return (
      <button
        type="button"
        onClick={onConflicts}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/5 px-2.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
      >
        <AlertTriangle className="size-3" />
        {conflictCount} conflict{conflictCount === 1 ? "" : "s"}
      </button>
    );
  }

  if (!online || syncState.status === "offline") {
    return (
      <button
        type="button"
        onClick={() => void retrySync()}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground"
        title="Offline. Everything is saved locally."
      >
        <WifiOff className="size-3 text-saffron" />
        <span className="hidden sm:inline">Offline</span>
        {pending ? <span className="text-xs">{pending} queued</span> : null}
      </button>
    );
  }

  if (syncState.status === "syncing") {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin text-sky" />
        <span className="hidden sm:inline">Syncing</span>
      </span>
    );
  }

  if (syncState.status === "error" || syncState.status === "auth") {
    return (
      <button
        type="button"
        onClick={() => void retrySync()}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-destructive/25 bg-destructive/5 px-2.5 text-xs text-destructive"
        title={syncState.message ?? "Sync paused"}
      >
        <CloudOff className="size-3" />
        <span className="hidden sm:inline">Sync paused</span>
        <RefreshCw className="size-3" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void retrySync()}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted",
        pending > 0 && "text-foreground",
      )}
      title={syncState.lastSyncedAt ? `Synced ${new Date(syncState.lastSyncedAt).toLocaleTimeString()}` : "All local changes saved"}
    >
      {pending > 0 ? (
        <>
          <Cloud className="size-3 text-saffron" />
          <span className="hidden sm:inline">{pending} queued</span>
        </>
      ) : (
        <>
          <Check className="size-3 text-moss" />
          <span className="hidden sm:inline">Synced</span>
        </>
      )}
    </button>
  );
}
