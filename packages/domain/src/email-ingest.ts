export interface EmailIngestPayload {
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  from?: unknown;
  to?: unknown;
}

export interface EmailCaptureDraft {
  title: string;
  content: string;
  source: string | null;
  metadata: Record<string, string>;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

/** Very small HTML-to-text pass for providers that only forward `html`. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * Normalizes an inbound email webhook payload into something the capture
 * inbox understands. Providers differ, so this accepts plain body fields
 * rather than a provider-specific shape.
 */
export function captureFromEmail(payload: EmailIngestPayload): EmailCaptureDraft | null {
  const body = text(payload.text, 100_000) || htmlToText(text(payload.html, 200_000));
  const subject = text(payload.subject, 200);
  if (!subject && !body) return null;

  const metadata: Record<string, string> = {};
  const from = text(payload.from, 320);
  const to = text(payload.to, 320);
  if (from) metadata.from = from;
  if (to) metadata.to = to;

  return {
    title: subject || "Email capture",
    content: body || subject,
    source: from || null,
    metadata,
  };
}
