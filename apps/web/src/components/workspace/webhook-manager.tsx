"use client";

import {
  isSafeWebhookUrl,
  PAGE_TYPES,
  WEBHOOK_EVENTS,
  type WebhookEvent,
  type WebhookFilters,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { client } from "@/utils/orpc";

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "page.updated": "Page saved or restored",
  "page.deleted": "Page moved to trash or purged",
  "canvas.updated": "Whiteboard saved",
  "canvas.deleted": "Whiteboard deleted",
  "capture.updated": "Capture added or organized",
  "comment.updated": "Comment added or resolved",
};

const STATUS_TONE: Record<string, string> = {
  DELIVERED: "text-moss",
  PENDING: "text-saffron",
  FAILED: "text-destructive",
  CANCELLED: "text-muted-foreground",
};

function describeFilters(filters: WebhookFilters): string {
  const parts: string[] = [];
  if (filters.titleContains) parts.push(`title contains “${filters.titleContains}”`);
  if (filters.notebookIds.length) parts.push(`${filters.notebookIds.length} notebook(s)`);
  if (filters.pageTypes.length) parts.push(filters.pageTypes.join(", ").toLowerCase());
  if (filters.operations.length) {
    parts.push(filters.operations.map((op) => (op === "UPSERT" ? "saved" : "deleted")).join(" / "));
  }
  if (filters.actorIds.length) parts.push(`${filters.actorIds.length} author(s)`);
  return parts.length ? parts.join(" · ") : "all matching events";
}

export function WebhookManager() {
  const { db, online, activeWorkspaceId } = useAppData();
  const queryClient = useQueryClient();
  const endpoints = useQuery({
    queryKey: ["webhooks", activeWorkspaceId],
    queryFn: async () => client.webhook.list(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", activeWorkspaceId],
    queryFn: async () => client.webhook.deliveries(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const members = useQuery({
    queryKey: ["workspace-members", activeWorkspaceId],
    queryFn: async () => client.workspace.members(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const notebooks =
    useLiveQuery(
      async () => {
        if (!db || !activeWorkspaceId) return [];
        return db.notebooks.where("workspaceId").equals(activeWorkspaceId).toArray();
      },
      [db, activeWorkspaceId],
      [],
    ) ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Webhook");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["page.updated"]);
  const [enabled, setEnabled] = useState(true);
  const [rotateSecret, setRotateSecret] = useState(false);
  const [titleContains, setTitleContains] = useState("");
  const [notebookIds, setNotebookIds] = useState<string[]>([]);
  const [pageTypes, setPageTypes] = useState<string[]>([]);
  const [operations, setOperations] = useState<Array<"UPSERT" | "DELETE">>([]);
  const [actorIds, setActorIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);

  const openNew = () => {
    setEditingId(null);
    setName("Webhook");
    setUrl("");
    setEvents(["page.updated"]);
    setEnabled(true);
    setRotateSecret(false);
    setTitleContains("");
    setNotebookIds([]);
    setPageTypes([]);
    setOperations([]);
    setActorIds([]);
    setFormOpen(true);
  };

  const openEdit = (endpoint: {
    id: string;
    name: string;
    url: string;
    events: WebhookEvent[];
    filters: WebhookFilters;
    enabled: boolean;
  }) => {
    setEditingId(endpoint.id);
    setName(endpoint.name);
    setUrl(endpoint.url);
    setEvents(endpoint.events.length ? endpoint.events : ["page.updated"]);
    setEnabled(endpoint.enabled);
    setRotateSecret(false);
    setTitleContains(endpoint.filters.titleContains ?? "");
    setNotebookIds(endpoint.filters.notebookIds);
    setPageTypes(endpoint.filters.pageTypes);
    setOperations(endpoint.filters.operations);
    setActorIds(endpoint.filters.actorIds);
    setFormOpen(true);
  };

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["webhooks", activeWorkspaceId] }),
      queryClient.invalidateQueries({ queryKey: ["webhook-deliveries", activeWorkspaceId] }),
    ]);
  };

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) => {
    set(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);
  };

  const save = async () => {
    if (!isSafeWebhookUrl(url)) {
      toast.error("Use a public https URL; localhost and private addresses are refused.");
      return;
    }
    if (!events.length) {
      toast.error("Choose at least one event.");
      return;
    }
    setBusy(true);
    try {
      await client.webhook.save({
        id: editingId ?? undefined,
        name,
        url,
        events,
        enabled,
        rotateSecret,
        filters: {
          titleContains: titleContains || null,
          notebookIds,
          pageTypes,
          operations,
          actorIds,
        },
      });
      await refresh();
      setFormOpen(false);
      setRotateSecret(false);
      toast.success(editingId ? "Destination updated" : "Destination created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the destination");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (id: string) => {
    try {
      await client.webhook.test({ id });
      await refresh();
      toast.success("Test delivery queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue the test");
    }
  };

  const remove = async (id: string) => {
    try {
      await client.webhook.remove({ id });
      await refresh();
      if (editingId === id) setFormOpen(false);
      toast.success("Destination removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the destination");
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium">Automation destinations</h3>
          <Button
            size="sm"
            className="h-8 rounded-md text-xs"
            disabled={!online || (endpoints.data?.length ?? 0) >= 5}
            onClick={openNew}
          >
            <Plus className="size-3" /> New destination
          </Button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Lattice POSTs signed JSON when content changes. Each destination picks its own events and
          conditions; deliveries retry with backoff for up to five attempts. Signature header:{" "}
          <span className="font-mono">x-lattice-signature: sha256=HMAC(secret, body)</span>.
        </p>

        {!online ? (
          <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-xs text-muted-foreground">
            Automations need a connection to the sync server.
          </p>
        ) : (
          <div className="mt-2 space-y-1">
            {endpoints.data?.length ? (
              endpoints.data.map((endpoint) => (
                <div
                  key={endpoint.id}
                  className="rounded-lg border border-border/50 bg-background/50 px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium">{endpoint.name}</span>
                    {!endpoint.enabled ? (
                      <span className="rounded-full border border-border/60 px-1.5 py-0.5 text-xs text-muted-foreground">
                        paused
                      </span>
                    ) : null}
                    <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {endpoint.url}
                    </code>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{endpoint.events.join(", ")}</span>
                    <span>{describeFilters(endpoint.filters)}</span>
                    <span>
                      {endpoint.lastDeliveryAt
                        ? `last ${new Date(endpoint.lastDeliveryAt).toLocaleString()}${
                            endpoint.lastStatus ? ` · HTTP ${endpoint.lastStatus}` : ""
                          }`
                        : "no deliveries yet"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-xs"
                      onClick={() => openEdit(endpoint)}
                    >
                      <Pencil className="size-2.5" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-xs"
                      onClick={() => void sendTest(endpoint.id)}
                    >
                      <Send className="size-2.5" /> Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-md text-xs text-destructive"
                      onClick={() => setPendingRemove({ id: endpoint.id, name: endpoint.name })}
                    >
                      <Trash2 className="size-2.5" /> Remove
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No destinations yet. Create one to react to page, whiteboard, capture, or comment
                events.
              </p>
            )}
          </div>
        )}
      </div>

      {formOpen && online ? (
        <div className="rounded-xl border border-border/70 bg-card/40 p-4">
          <h3 className="text-xs font-medium">
            {editingId ? "Edit destination" : "New destination"}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <label className="block w-40">
              <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Name
              </span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/40"
              />
            </label>
            <label className="block min-w-[240px] flex-1">
              <span className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Endpoint URL
              </span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://hooks.example.com/lattice"
                spellCheck={false}
                className="h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-primary/40"
              />
            </label>
          </div>

          <div className="mt-3">
            <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
              Events
            </span>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    onChange={() => toggle(events, event, setEvents)}
                    className="size-3 accent-[var(--saffron)]"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{event}</span>
                  <span className="truncate">{EVENT_LABELS[event]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Conditions
              </span>
              <label className="mt-1 block">
                <input
                  value={titleContains}
                  onChange={(event) => setTitleContains(event.target.value)}
                  placeholder="Only titles containing…"
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary/40"
                />
              </label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={operations.includes("UPSERT")}
                    onChange={() => toggle(operations, "UPSERT", setOperations)}
                    className="size-3 accent-[var(--moss)]"
                  />
                  Saved / restored
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    checked={operations.includes("DELETE")}
                    onChange={() => toggle(operations, "DELETE", setOperations)}
                    className="size-3 accent-[var(--moss)]"
                  />
                  Deleted / trashed
                </label>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {PAGE_TYPES.map((type) => (
                  <label key={type} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={pageTypes.includes(type)}
                      onChange={() => toggle(pageTypes, type, setPageTypes)}
                      className="size-3 accent-[var(--moss)]"
                    />
                    {type.toLowerCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Notebooks
                </span>
                <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                  {notebooks.length ? (
                    notebooks
                      .filter((notebook) => !notebook.deletedAt)
                      .map((notebook) => (
                        <label key={notebook.id} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={notebookIds.includes(notebook.id)}
                            onChange={() => toggle(notebookIds, notebook.id, setNotebookIds)}
                            className="size-3 accent-[var(--moss)]"
                          />
                          <span className="truncate">{notebook.name}</span>
                        </label>
                      ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No notebooks.</p>
                  )}
                </div>
              </div>
              <div>
                <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Authors
                </span>
                <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                  {(members.data ?? []).map((member) => (
                    <label key={member.userId} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={actorIds.includes(member.userId)}
                        onChange={() => toggle(actorIds, member.userId, setActorIds)}
                        className="size-3 accent-[var(--moss)]"
                      />
                      <span className="truncate">{member.user.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="size-3 accent-[var(--moss)]"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={rotateSecret}
                onChange={(event) => setRotateSecret(event.target.checked)}
                className="size-3 accent-[var(--saffron)]"
              />
              Rotate signing secret on save
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy}
              onClick={() => void save()}
            >
              {editingId ? "Save destination" : "Create destination"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg text-xs"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground">
              At most five destinations per workspace.
            </span>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove this destination?"
        description={
          pendingRemove
            ? `“${pendingRemove.name}” stops receiving events and its pending deliveries are cancelled.`
            : ""
        }
        confirmLabel="Remove"
        onClose={() => setPendingRemove(null)}
        onConfirm={async () => {
          const endpoint = pendingRemove;
          setPendingRemove(null);
          if (endpoint) await remove(endpoint.id);
        }}
      />

      {online ? (
        <div className="rounded-xl border border-border/70 bg-card/40 p-4">
          <h3 className="text-xs font-medium">Recent deliveries</h3>
          <div className="mt-2 space-y-1">
            {deliveries.data?.length ? (
              deliveries.data.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-xs"
                >
                  <span className="text-xs text-muted-foreground">{delivery.endpointName}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {delivery.event}
                  </span>
                  <span
                    className={cn(
                      "font-medium uppercase tracking-wide",
                      STATUS_TONE[delivery.status] ?? "text-muted-foreground",
                    )}
                  >
                    {delivery.status.toLowerCase()}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(delivery.createdAt).toLocaleString()}
                  </span>
                  {delivery.attempts ? (
                    <span className="text-muted-foreground">
                      {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {delivery.lastError ? (
                    <span
                      className="min-w-0 flex-1 truncate text-destructive"
                      title={delivery.lastError}
                    >
                      {delivery.lastError}
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="py-3 text-center text-xs text-muted-foreground">
                No deliveries yet. Create a destination and send a test.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
