"use client";

import { formatRelative, safeDoc, suggestionIsStale } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Eye, GitPullRequest, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { ReadOnlyDocument } from "@/components/editor/read-only-document";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { useWorkspacePages } from "@/hooks/use-local-data";
import { resolveSuggestedEditLocal } from "@/lib/local/repository";
import type { LocalSuggestedEdit } from "@/lib/local/types";
import { client } from "@/utils/orpc";

const REVIEW_ROLES = ["OWNER", "ADMIN", "MEMBER", "EDITOR"];

const STATUS_TONE: Record<string, string> = {
  ACCEPTED: "text-moss",
  REJECTED: "text-destructive",
  PENDING: "text-saffron",
};

export function ReviewQueue() {
  const { db, user, activeWorkspaceId, role, online } = useAppData();
  const pages = useWorkspacePages();
  const edits =
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        return db.suggestedEdits.where("workspaceId").equals(activeWorkspaceId).toArray();
      },
      [db, activeWorkspaceId],
      [],
    ) ?? [];
  const documents =
    useLiveQuery(async () => (db ? db.pageDocuments.toArray() : []), [db], []) ?? [];
  const members = useQuery({
    queryKey: ["workspace-members", activeWorkspaceId],
    queryFn: async () => client.workspace.members(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const [preview, setPreview] = useState<LocalSuggestedEdit | null>(null);
  const [pendingAccept, setPendingAccept] = useState<LocalSuggestedEdit | null>(null);

  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const documentByPage = useMemo(
    () => new Map(documents.map((document) => [document.pageId, document])),
    [documents],
  );
  const nameOf = (userId: string) =>
    userId === user?.id
      ? "You"
      : (members.data?.find((member) => member.userId === userId)?.user.name ?? "Teammate");
  const canReview = REVIEW_ROLES.includes(role ?? "");

  const pending = edits
    .filter((edit) => !edit.deletedAt && edit.status === "PENDING")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const reviewed = edits
    .filter((edit) => !edit.deletedAt && edit.status !== "PENDING")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);

  const resolve = async (edit: LocalSuggestedEdit, decision: "ACCEPTED" | "REJECTED") => {
    if (!db || !user) return;
    try {
      await resolveSuggestedEditLocal(db, {
        editId: edit.id,
        userId: user.id,
        decision,
      });
      toast.success(decision === "ACCEPTED" ? "Suggestion accepted" : "Suggestion rejected");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review the suggestion");
    }
  };

  const acceptWarning = (edit: LocalSuggestedEdit) => {
    const page = pageById.get(edit.pageId);
    const document = documentByPage.get(edit.pageId);
    const stale = document ? suggestionIsStale(edit.baseRev, document.rev) : false;
    return stale
      ? `“${page?.title ?? "This page"}” changed after this suggestion was written. Accepting replaces the current body.`
      : `Accepting replaces the body of “${page?.title ?? "this page"}” through the normal document save.`;
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center gap-1.5">
          <GitPullRequest className="size-3.5 text-moss" />
          <h3 className="text-[11px] font-medium">Pending suggestions</h3>
          <span className="ml-auto text-[9px] text-muted-foreground">{pending.length} open</span>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          Suggestions change nothing until an editor accepts them. Accepting writes the proposed
          body through the normal document save; rejecting leaves the page untouched.
        </p>
        {!canReview ? (
          <p className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-[9px] text-muted-foreground">
            Your role can propose edits but not review them.
          </p>
        ) : null}
        <div className="mt-2 space-y-1.5">
          {pending.length ? (
            pending.map((edit) => {
              const page = pageById.get(edit.pageId);
              const document = documentByPage.get(edit.pageId);
              const stale = document ? suggestionIsStale(edit.baseRev, document.rev) : false;
              return (
                <div
                  key={edit.id}
                  className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[10px] font-medium">
                      {page?.title ?? "Missing page"}
                    </span>
                    <span className="text-[8px] text-muted-foreground">
                      {nameOf(edit.authorId)} · {formatRelative(edit.createdAt)}
                    </span>
                    {stale ? (
                      <span className="rounded-full border border-saffron/40 px-1.5 py-0.5 text-[7px] text-saffron">
                        page changed
                      </span>
                    ) : null}
                  </div>
                  {edit.note ? (
                    <p className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-muted-foreground">
                      {edit.note}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 rounded-md text-[8px]"
                      onClick={() => setPreview(edit)}
                    >
                      <Eye className="size-2.5" /> Preview
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 rounded-md text-[8px]"
                      disabled={!canReview || !page}
                      onClick={() => setPendingAccept(edit)}
                    >
                      <Check className="size-2.5" /> Accept
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 rounded-md text-[8px] text-destructive"
                      disabled={!canReview}
                      onClick={() => void resolve(edit, "REJECTED")}
                    >
                      <X className="size-2.5" /> Reject
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-4 text-center text-[9px] text-muted-foreground">
              No open suggestions. Page actions → Suggest an edit creates one.
            </p>
          )}
        </div>
      </div>

      {reviewed.length ? (
        <div className="rounded-xl border border-border/70 bg-card/40 p-4">
          <h3 className="text-[11px] font-medium">Recently reviewed</h3>
          <div className="mt-2 space-y-1">
            {reviewed.map((edit) => (
              <div
                key={edit.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-[9px]"
              >
                <span className="min-w-0 flex-1 truncate">
                  {pageById.get(edit.pageId)?.title ?? "Missing page"}
                </span>
                <span
                  className={cn(
                    "font-medium uppercase tracking-wide",
                    STATUS_TONE[edit.status] ?? "text-muted-foreground",
                  )}
                >
                  {edit.status.toLowerCase()}
                </span>
                <span className="text-muted-foreground">
                  {edit.reviewedById ? nameOf(edit.reviewedById) : "Teammate"} ·{" "}
                  {formatRelative(edit.reviewedAt ?? edit.updatedAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingAccept)}
        title="Accept this suggestion?"
        description={pendingAccept ? acceptWarning(pendingAccept) : ""}
        confirmLabel="Accept"
        onClose={() => setPendingAccept(null)}
        onConfirm={async () => {
          const edit = pendingAccept;
          setPendingAccept(null);
          if (edit) await resolve(edit, "ACCEPTED");
        }}
      />

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview ? `Suggestion for “${pageById.get(preview.pageId)?.title ?? "page"}”` : "Suggestion"}
        description={preview?.note ?? "Proposed page body"}
        className="max-w-2xl"
      >
        {preview ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-[11px] leading-relaxed">
            <ReadOnlyDocument doc={safeDoc(preview.content)} />
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
