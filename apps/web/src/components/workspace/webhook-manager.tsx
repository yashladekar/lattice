"use client";

import { isSafeWebhookUrl, WEBHOOK_EVENTS, type WebhookEvent } from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
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

export function WebhookManager() {
  const { online, activeWorkspaceId } = useAppData();
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["webhook", activeWorkspaceId],
    queryFn: async () => client.webhook.get(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", activeWorkspaceId],
    queryFn: async () => client.webhook.deliveries(),
    enabled: online && Boolean(activeWorkspaceId),
  });
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["page.updated"]);
  const [enabled, setEnabled] = useState(true);
  const [rotateSecret, setRotateSecret] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!status.data) return;
    setUrl(status.data.url);
    setEvents(status.data.events.length ? status.data.events : ["page.updated"]);
    setEnabled(status.data.enabled);
    setSecret(status.data.secret);
  }, [status.data]);

  const toggleEvent = (event: WebhookEvent) => {
    setEvents((current) =>
      current.includes(event)
        ? current.filter((entry) => entry !== event)
        : [...current, event],
    );
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
      const result = await client.webhook.save({
        url,
        events,
        enabled,
        rotateSecret,
      });
      setSecret(result.secret);
      setRotateSecret(false);
      await Promise.all([status.refetch(), deliveries.refetch()]);
      await queryClient.invalidateQueries({ queryKey: ["webhook", activeWorkspaceId] });
      toast.success("Webhook saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the webhook");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    try {
      await client.webhook.test();
      await deliveries.refetch();
      toast.success("Test delivery queued");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue the test");
    }
  };

  const remove = async () => {
    if (!window.confirm("Remove this webhook endpoint and cancel pending deliveries?")) return;
    try {
      await client.webhook.remove();
      await Promise.all([status.refetch(), deliveries.refetch()]);
      setUrl("");
      setEvents(["page.updated"]);
      setEnabled(true);
      setSecret(null);
      toast.success("Webhook removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the webhook");
    }
  };

  const copySecret = async () => {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast.success("Signing secret copied");
    } catch {
      toast.error("Could not copy the secret");
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border/70 bg-card/40 p-4">
        <h3 className="text-[11px] font-medium">Webhook endpoint</h3>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          Lattice POSTs JSON when content changes. Every delivery is signed with{" "}
          <span className="font-mono">x-lattice-signature: sha256=HMAC(secret, body)</span>, so
          your receiver can verify it. Deliveries retry with backoff for up to five attempts.
        </p>

        {!online ? (
          <p className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 text-[9px] text-muted-foreground">
            Webhooks need a connection to the sync server.
          </p>
        ) : (
          <>
            <label className="mt-3 block">
              <span className="mb-1 block text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                Endpoint URL
              </span>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://hooks.example.com/lattice"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-[10px] outline-none focus:border-primary/40"
              />
            </label>

            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-center gap-2 text-[9.5px]">
                  <input
                    type="checkbox"
                    checked={events.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="size-3 accent-[var(--saffron)]"
                  />
                  <span className="font-mono text-[8.5px] text-muted-foreground">{event}</span>
                  <span className="truncate">{EVENT_LABELS[event]}</span>
                </label>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[9.5px]">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  className="size-3 accent-[var(--moss)]"
                />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-[9.5px]">
                <input
                  type="checkbox"
                  checked={rotateSecret}
                  onChange={(event) => setRotateSecret(event.target.checked)}
                  className="size-3 accent-[var(--saffron)]"
                />
                Rotate signing secret on save
              </label>
            </div>

            {secret ? (
              <div className="mt-2 rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                    Signing secret
                  </span>
                  <code className="min-w-0 flex-1 break-all font-mono text-[9px]">{secret}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 rounded-md text-[8px]"
                    onClick={() => void copySecret()}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-8 rounded-lg text-[10px]" disabled={busy} onClick={() => void save()}>
                Save webhook
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-[10px]"
                disabled={!status.data?.configured}
                onClick={() => void sendTest()}
              >
                <Send className="size-3" /> Send test
              </Button>
              {status.data?.configured ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-[10px] text-destructive"
                  onClick={() => void remove()}
                >
                  <Trash2 className="size-3" /> Remove
                </Button>
              ) : null}
              <span className="text-[8px] text-muted-foreground">
                {status.data?.lastDeliveryAt
                  ? `Last delivery ${new Date(status.data.lastDeliveryAt).toLocaleString()}${
                      status.data.lastStatus ? ` · HTTP ${status.data.lastStatus}` : ""
                    }`
                  : "No deliveries yet."}
              </span>
            </div>
          </>
        )}
      </div>

      {online ? (
        <div className="rounded-xl border border-border/70 bg-card/40 p-4">
          <h3 className="text-[11px] font-medium">Recent deliveries</h3>
          <div className="mt-2 space-y-1">
            {deliveries.data?.length ? (
              deliveries.data.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5 text-[9px]"
                >
                  <span className="font-mono text-[8.5px] text-muted-foreground">{delivery.event}</span>
                  <span className={cn("font-medium uppercase tracking-wide", STATUS_TONE[delivery.status] ?? "text-muted-foreground")}>
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
                    <span className="min-w-0 flex-1 truncate text-destructive" title={delivery.lastError}>
                      {delivery.lastError}
                    </span>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="py-3 text-center text-[9px] text-muted-foreground">
                No deliveries yet. Save the endpoint and send a test.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
