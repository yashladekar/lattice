"use client";

import { findDuplicates, type DuplicateCluster } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { CopyCheck, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { useWorkspacePages } from "@/hooks/use-local-data";
import { deletePageLocal } from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";

const REASON_LABELS: Record<DuplicateCluster["reason"], string> = {
  "same-title": "Same title",
  "similar-title": "Similar title",
  "similar-body": "Same text",
};

function reasonTone(reason: DuplicateCluster["reason"]): string {
  return reason === "similar-title" ? "text-saffron" : "text-moss";
}

export function DuplicateReviewPanel() {
  const router = useRouter();
  const { db, activeWorkspaceId } = useAppData();
  const pages = useWorkspacePages();
  const [clusters, setClusters] = useState<DuplicateCluster[] | null>(null);
  const [keepById, setKeepById] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!db || !activeWorkspaceId) return;
    setScanning(true);
    try {
      const documents = await db.pageDocuments.toArray();
      setClusters(
        findDuplicates(
          pages.map((page) => ({ id: page.id, title: page.title, updatedAt: page.updatedAt })),
          documents.map((document) => ({
            pageId: document.pageId,
            plainText: document.plainText,
          })),
        ),
      );
    } finally {
      setScanning(false);
    }
  }, [db, activeWorkspaceId, pages]);

  useEffect(() => {
    void scan();
  }, [scan]);

  /** The page to keep: the reviewer's choice, else the suggested survivor. */
  const survivorFor = (cluster: DuplicateCluster) => keepById[cluster.id] ?? cluster.survivorId;

  const archiveOthers = async (cluster: DuplicateCluster) => {
    if (!db) return;
    const keep = survivorFor(cluster);
    const others = cluster.members.filter((member) => member.id !== keep);
    setBusy(cluster.id);
    try {
      for (const member of others) {
        await deletePageLocal(db, member.id);
      }
      toast.success(
        `Archived ${others.length} page${others.length === 1 ? "" : "s"}. They are in Trash if you need them back.`,
      );
      await scan();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not archive those pages.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/70 bg-card/35 p-4">
        <div className="flex items-center gap-2">
          <CopyCheck className="size-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-medium">Possible duplicates</h3>
          <span className="ml-auto text-[8.5px] text-muted-foreground">
            {clusters ? `${clusters.length} group${clusters.length === 1 ? "" : "s"}` : "—"}
          </span>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          Notes are paired on a shared title, a title that drifted, or a body that repeats. Nothing is
          merged automatically: you pick which page to keep and the rest move to Trash, where they can
          be restored.
        </p>
        <div className="mt-2 flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-md text-[9px]"
            disabled={scanning}
            onClick={() => void scan()}
          >
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            Scan again
          </Button>
        </div>
      </div>

      {clusters?.length ? (
        clusters.map((cluster) => (
          <div key={cluster.id} className="rounded-xl border border-border/70 bg-card/35 p-4">
            <div className="flex items-center gap-2">
              <span className={cn("text-[9px] uppercase tracking-wide", reasonTone(cluster.reason))}>
                {REASON_LABELS[cluster.reason]}
              </span>
              <span className="text-[8.5px] text-muted-foreground">
                {Math.round(cluster.score * 100)}% match · {cluster.members.length} pages
              </span>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 rounded-md text-[9px]"
                disabled={Boolean(busy)}
                onClick={() => void archiveOthers(cluster)}
              >
                {busy === cluster.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" />
                )}
                Keep one, archive the rest
              </Button>
            </div>

            <div className="mt-2 space-y-1">
              {cluster.members.map((member) => {
                const keeping = member.id === survivorFor(cluster);
                return (
                  <div
                    key={member.id}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-2.5 py-1.5",
                      keeping ? "border-moss/40 bg-moss/5" : "border-border/60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => router.push(appRouteObject({ view: "page", id: member.id }))}
                          className="truncate text-left text-[11px] hover:underline"
                        >
                          {member.title || "Untitled"}
                        </button>
                        {member.id === cluster.survivorId && !keepById[cluster.id] ? (
                          <span className="rounded bg-moss/15 px-1 text-[8px] text-moss">suggested</span>
                        ) : null}
                      </div>
                      <div className="truncate text-[8.5px] text-muted-foreground">
                        {member.excerpt || "No text"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setKeepById((current) => ({ ...current, [cluster.id]: member.id }))
                      }
                      disabled={keeping}
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[8.5px]",
                        keeping
                          ? "text-moss"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {keeping ? "keeping" : "keep this"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-xl border border-border/70 bg-card/35 p-4">
          <p className="text-[10px] text-muted-foreground">
            {clusters === null
              ? "Scanning…"
              : "Nothing looks duplicated. Titles and bodies were both checked."}
          </p>
        </div>
      )}
    </div>
  );
}
