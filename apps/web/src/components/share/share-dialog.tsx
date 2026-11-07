"use client";

import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe2, Link2, Loader2, Lock, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { Modal } from "@/components/ui/modal";
import { client } from "@/utils/orpc";

export type ShareResourceType = "PAGE" | "CANVAS" | "NOTEBOOK" | "GRAPH";

export function ShareDialog({
  open,
  onClose,
  resourceType,
  resourceId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  resourceType: ShareResourceType;
  resourceId: string | null;
  title: string;
}) {
  const { activeWorkspace, online, role } = useAppData();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [expiryDays, setExpiryDays] = useState("30");
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const shares = useQuery({
    queryKey: ["shares", activeWorkspace?.id, resourceType, resourceId],
    queryFn: async () => {
      if (!resourceId) return [];
      const result = await client.share.list({ resourceType, resourceId });
      return result;
    },
    enabled: open && online && Boolean(resourceId),
  });

  const createShare = async () => {
    if (!resourceId) return;
    setCreating(true);
    setCopied(false);
    try {
      const result = await client.share.create({
        resourceType,
        resourceId,
        permission: "VIEW",
        expiresInDays: expiryDays === "never" ? null : Number(expiryDays),
      });
      setToken(result.token);
      await queryClient.invalidateQueries({
        queryKey: ["shares", activeWorkspace?.id, resourceType, resourceId],
      });
      toast.success("Read-only link created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create link");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (shareId: string) => {
    try {
      await client.share.revoke({ shareId });
      await queryClient.invalidateQueries({
        queryKey: ["shares", activeWorkspace?.id, resourceType, resourceId],
      });
      toast.success("Link revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke");
    }
  };

  const publicUrl = token
    ? `${window.location.origin}/share?token=${encodeURIComponent(token)}&type=${resourceType}`
    : null;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share"
      description="Publish a read-only view. Private outbound links stay hidden."
    >
      {!online ? (
        <div className="rounded-lg border border-saffron/30 bg-saffron/[0.06] px-3 py-2 text-[10px] text-muted-foreground">
          Sharing requires a connection to the sync server.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 py-2">
            <span className="grid size-7 place-items-center rounded-md bg-saffron/15 text-saffron">
              {resourceType === "GRAPH" ? <Globe2 className="size-3.5" /> : <Link2 className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-medium">{title}</div>
              <div className="text-[9px] capitalize text-muted-foreground">
                {resourceType.toLowerCase()} · read-only link
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[8px] text-muted-foreground">
              <Lock className="size-2.5" /> {role ?? "viewer"}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-28 flex-1">
              <label className="mb-1 block text-[9px] text-muted-foreground">Link expires</label>
              <select
                value={expiryDays}
                onChange={(event) => setExpiryDays(event.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-[10px] outline-none focus:border-ring"
              >
                <option value="7">In 7 days</option>
                <option value="30">In 30 days</option>
                <option value="365">In one year</option>
                <option value="never">Never</option>
              </select>
            </div>
            <Button
              className="h-8 rounded-lg text-[10px]"
              disabled={creating || !resourceId || !["OWNER", "ADMIN", "MEMBER"].includes(role ?? "")}
              onClick={() => void createShare()}
            >
              {creating ? <Loader2 className="size-3 animate-spin" /> : <Globe2 className="size-3" />}
              Create public link
            </Button>
          </div>

          {publicUrl ? (
            <div className="rounded-lg border border-moss/25 bg-moss/[0.06] p-2.5">
              <div className="mb-1 flex items-center gap-1 text-[9px] text-moss">
                <Check className="size-3" /> Link ready
              </div>
              <div className="flex gap-1.5">
                <Input value={publicUrl} readOnly className="h-8 rounded-md bg-background text-[9px]" />
                <Button
                  variant={copied ? "secondary" : "default"}
                  size="sm"
                  className="h-8 shrink-0 rounded-md px-2 text-[9px]"
                  onClick={() => void copy(publicUrl)}
                >
                  <Copy className="size-3" /> {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-1.5 text-[8px] text-muted-foreground">
                Anyone with this link can read this {resourceType.toLowerCase()}. It can be revoked at any time.
              </p>
            </div>
          ) : null}

          <div>
            <div className="mb-1.5 text-[8px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
              Existing links
            </div>
            {shares.isLoading ? (
              <div className="py-4 text-center text-[10px] text-muted-foreground">Loading…</div>
            ) : shares.data?.length ? (
              <div className="space-y-1">
                {shares.data.map((share) => {
                  const revoked = Boolean(share.revokedAt);
                  const expired = share.expiresAt ? new Date(share.expiresAt).getTime() < Date.now() : false;
                  return (
                    <div key={share.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2 py-1.5">
                      <Globe2 className="size-3 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[9px]">
                          {revoked ? "Revoked" : expired ? "Expired" : "Active"} · {share.permission.toLowerCase()}
                        </div>
                        <div className="text-[8px] text-muted-foreground">
                          Created {new Date(share.createdAt).toLocaleDateString()}
                          {share.expiresAt ? ` · expires ${new Date(share.expiresAt).toLocaleDateString()}` : ""}
                        </div>
                      </div>
                      {!revoked ? (
                        <button
                          type="button"
                          onClick={() => void revoke(share.id)}
                          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive tap-target"
                          aria-label="Revoke link"
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[9px] text-muted-foreground">
                No share links yet.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
