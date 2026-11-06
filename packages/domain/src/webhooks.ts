export const WEBHOOK_EVENTS = [
  "page.updated",
  "page.deleted",
  "canvas.updated",
  "canvas.deleted",
  "capture.updated",
  "comment.updated",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function webhookEventForChange(
  entity: string,
  op: "UPSERT" | "DELETE",
): WebhookEvent | null {
  switch (entity) {
    case "page":
      return op === "DELETE" ? "page.deleted" : "page.updated";
    case "canvas":
      return op === "DELETE" ? "canvas.deleted" : "canvas.updated";
    case "capture":
      return op === "UPSERT" ? "capture.updated" : null;
    case "comment":
      return op === "UPSERT" ? "comment.updated" : null;
    default:
      return null;
  }
}

export function isWebhookEvent(value: unknown): value is WebhookEvent {
  return typeof value === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/**
 * Webhook targets must be public HTTPS endpoints. Literal private addresses,
 * localhost, and bare hostnames are refused; DNS-based SSRF checks are left to
 * the deployment's egress policy.
 */
export function isSafeWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (!host || host.startsWith("[")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return false;
  }
  if (!host.includes(".")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  return true;
}
