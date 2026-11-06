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

/**
 * Conditions a destination applies on top of its event subscription. An empty
 * rule matches everything the subscription allows.
 */
export interface WebhookFilters {
  titleContains: string | null;
  notebookIds: string[];
  pageTypes: string[];
  operations: Array<"UPSERT" | "DELETE">;
  actorIds: string[];
}

export const EMPTY_WEBHOOK_FILTERS: WebhookFilters = {
  titleContains: null,
  notebookIds: [],
  pageTypes: [],
  operations: [],
  actorIds: [],
};

export const MAX_WEBHOOK_ENDPOINTS = 5;
const MAX_FILTER_IDS = 25;

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, 80);
    if (!trimmed) continue;
    seen.add(trimmed);
    if (seen.size >= MAX_FILTER_IDS) break;
  }
  return [...seen];
}

export function parseWebhookFilters(value: unknown): WebhookFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_WEBHOOK_FILTERS };
  }
  const record = value as Record<string, unknown>;
  const titleContains =
    typeof record.titleContains === "string" && record.titleContains.trim()
      ? record.titleContains.trim().slice(0, 80)
      : null;
  const operations = idList(record.operations).filter(
    (entry): entry is "UPSERT" | "DELETE" => entry === "UPSERT" || entry === "DELETE",
  );
  return {
    titleContains,
    notebookIds: idList(record.notebookIds),
    pageTypes: idList(record.pageTypes).map((entry) => entry.toUpperCase()),
    operations,
    actorIds: idList(record.actorIds),
  };
}

export function hasWebhookFilters(filters: WebhookFilters): boolean {
  return Boolean(
    filters.titleContains ||
      filters.notebookIds.length ||
      filters.pageTypes.length ||
      filters.operations.length ||
      filters.actorIds.length,
  );
}

/**
 * Evaluates one queued change against a destination's conditions. A condition
 * on a field the event does not carry excludes the change rather than passing
 * it through, so a narrowed destination stays narrow.
 */
export function webhookMatchesFilters(
  filters: WebhookFilters,
  change: { entity: string; op: "UPSERT" | "DELETE"; data: Record<string, unknown> },
  actorId: string | null,
): boolean {
  if (filters.operations.length && !filters.operations.includes(change.op)) return false;
  if (filters.actorIds.length && (!actorId || !filters.actorIds.includes(actorId))) return false;
  if (filters.titleContains) {
    const title = typeof change.data.title === "string" ? change.data.title : null;
    if (!title || !title.toLowerCase().includes(filters.titleContains.toLowerCase())) return false;
  }
  if (filters.notebookIds.length) {
    const notebookId = typeof change.data.notebookId === "string" ? change.data.notebookId : null;
    if (!notebookId || !filters.notebookIds.includes(notebookId)) return false;
  }
  if (filters.pageTypes.length) {
    const type = typeof change.data.type === "string" ? change.data.type.toUpperCase() : null;
    if (!type || !filters.pageTypes.includes(type)) return false;
  }
  return true;
}
