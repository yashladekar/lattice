"use client";

import { Button } from "@notes-learning/ui/components/button";
import { AlertTriangle, Check, Loader2, Laptop, Server } from "lucide-react";
import { useState } from "react";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import type { LocalConflict } from "@/lib/local/types";

function preview(data: Record<string, unknown>): string {
  if (typeof data.plainText === "string" && data.plainText.trim()) {
    return data.plainText.slice(0, 800);
  }
  if (typeof data.content === "object" && data.content) {
    return JSON.stringify(data.content).slice(0, 800);
  }
  if (typeof data.data === "object" && data.data) {
    return JSON.stringify(data.data).slice(0, 800);
  }
  return "This version has no readable preview.";
}

export function ConflictResolver({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { conflicts, resolveConflict } = useAppData();
  const [busy, setBusy] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);

  const resolve = async (conflict: LocalConflict, resolution: "KEEP_LOCAL" | "KEEP_REMOTE") => {
    setBusy(conflict.id);
    try {
      await resolveConflict(conflict, resolution);
      setResolved((current) => [...current, conflict.id]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sync conflicts"
      description="Lattice preserved both versions. Nothing was overwritten without telling you."
      className="max-w-3xl"
    >
      {!conflicts.length ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <span className="grid size-10 place-items-center rounded-full border border-border bg-muted/40">
            <Check className="size-4 text-moss" />
          </span>
          <p className="mt-3 text-sm font-medium">No unresolved conflicts</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Your local and synced copies are in agreement.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {conflicts.map((conflict) => {
            const isResolved = resolved.includes(conflict.id);
            return (
              <div key={conflict.id} className="rounded-xl border border-border/80 bg-background/60">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div className="flex items-center gap-2 text-[11px]">
                    <AlertTriangle className="size-3.5 text-saffron" />
                    <span className="font-medium">
                      {conflict.entity === "pageDocument" ? "Page body" : "Canvas"}
                    </span>
                    <span className="text-muted-foreground">
                      local revision {conflict.baseRev} · remote {conflict.remoteRev}
                    </span>
                  </div>
                  <span className="text-[9px] text-muted-foreground">
                    {new Date(conflict.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  <div className="rounded-lg border border-saffron/25 bg-saffron/[0.04] p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium">
                      <Laptop className="size-3 text-saffron" /> This device
                    </div>
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                      {preview(conflict.localData)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-sky/25 bg-sky/[0.04] p-3">
                    <div className="flex items-center gap-1.5 text-[10px] font-medium">
                      <Server className="size-3 text-sky" /> Sync server
                    </div>
                    <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                      {preview(conflict.remoteData)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
                  <span className="mr-auto text-[9px] text-muted-foreground">
                    {isResolved ? "Resolved. Syncing…" : "A remote snapshot is kept in version history."}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 rounded-md text-[10px]"
                    disabled={busy === conflict.id || isResolved}
                    onClick={() => void resolve(conflict, "KEEP_REMOTE")}
                  >
                    Keep server version
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 rounded-md text-[10px]"
                    disabled={busy === conflict.id || isResolved}
                    onClick={() => void resolve(conflict, "KEEP_LOCAL")}
                  >
                    {busy === conflict.id ? <Loader2 className="size-3 animate-spin" /> : null}
                    Keep this device
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
