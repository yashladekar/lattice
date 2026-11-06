import { createHmac } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { isSafeWebhookUrl } from "@notes-learning/domain";

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];
export const MAX_WEBHOOK_ATTEMPTS = 5;

/**
 * Attempts the pending deliveries that are due now. Failures back off and are
 * retried up to MAX_WEBHOOK_ATTEMPTS; disabled endpoints and unsafe URLs are
 * cancelled instead of retried.
 */
export async function deliverWebhookBatch(
  db: Database,
): Promise<{ delivered: number; failed: number; skipped: number }> {
  const due = await db.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  let delivered = 0;
  let failed = 0;
  let skipped = 0;

  for (const delivery of due) {
    const endpoint = await db.webhookEndpoint.findUnique({
      where: { id: delivery.endpointId },
    });
    if (!endpoint || !endpoint.enabled || !isSafeWebhookUrl(endpoint.url)) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "CANCELLED",
          lastError: endpoint
            ? endpoint.enabled
              ? "Endpoint URL is no longer allowed."
              : "Endpoint disabled."
            : "Endpoint removed.",
        },
      });
      skipped += 1;
      continue;
    }

    const body = JSON.stringify(delivery.payload);
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Lattice-Webhooks/1.0",
          "x-lattice-event": delivery.event,
          "x-lattice-delivery": delivery.id,
          "x-lattice-signature": signWebhookPayload(endpoint.secret, body),
        },
        body,
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`Endpoint returned ${response.status}.`);
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "DELIVERED",
          attempts: delivery.attempts + 1,
          deliveredAt: new Date(),
          lastError: null,
        },
      });
      await db.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastDeliveryAt: new Date(), lastStatus: response.status },
      });
      delivered += 1;
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const exhausted = attempts >= MAX_WEBHOOK_ATTEMPTS;
      const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1;
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          attempts,
          status: exhausted ? "FAILED" : "PENDING",
          lastError: (error instanceof Error ? error.message : "Delivery failed").slice(0, 300),
          nextAttemptAt: exhausted
            ? delivery.nextAttemptAt
            : new Date(Date.now() + backoff * 60_000),
        },
      });
      await db.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastDeliveryAt: new Date() },
      });
      failed += 1;
    }
  }

  return { delivered, failed, skipped };
}
