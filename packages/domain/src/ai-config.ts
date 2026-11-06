/**
 * Workspace AI credentials.
 *
 * A workspace can point Lattice at its own OpenAI-compatible provider instead
 * of the deployment's environment configuration. The base URL is admin-set, so
 * it is validated like any other outbound endpoint: https, no embedded
 * credentials or query, and plain http only for a provider running on this
 * machine. Keys are never returned in full — the API masks them.
 */
export function normalizeAiBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const localHost = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** Shows enough to recognize a key, never enough to use it. */
export function maskApiKey(value: string): string {
  if (!value) return "";
  const tail = value.slice(-4);
  return value.length <= 8 ? "••••" : `••••${tail}`;
}

export function normalizeModelName(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > max) return null;
  return model;
}
