export type GitSyncAction =
  | "in-sync"
  | "publish"
  | "push"
  | "pull"
  | "conflict"
  | "remote-missing";

export interface GitSyncInput {
  /** Current blob SHA on the remote, or null when the file is not there. */
  remoteSha: string | null;
  /** Blob SHA recorded when this page was last synced, or null if never. */
  recordedRemoteSha: string | null;
  /** Hash of the local body right now. */
  localHash: string;
  /** Hash of the local body at the last sync, or null if never. */
  recordedLocalHash: string | null;
}

export interface GitSyncDecision {
  action: GitSyncAction;
  /** Short, user-facing explanation of why this row is in that state. */
  reason: string;
}

/**
 * Compares what we last agreed on with what each side looks like now, so a
 * sync never overwrites a change it has not seen. Only one side moving is a
 * safe move; both moving is a conflict the caller has to resolve.
 */
export function planGitSync(input: GitSyncInput): GitSyncDecision {
  const { remoteSha, recordedRemoteSha, localHash, recordedLocalHash } = input;

  if (!remoteSha && !recordedRemoteSha) {
    return { action: "publish", reason: "Not on the remote yet." };
  }
  if (!remoteSha && recordedRemoteSha) {
    return { action: "remote-missing", reason: "Deleted on the remote since the last sync." };
  }
  if (remoteSha && !recordedRemoteSha) {
    return { action: "conflict", reason: "This path exists on the remote with no sync record." };
  }

  const remoteChanged = remoteSha !== recordedRemoteSha;
  const localChanged = recordedLocalHash === null || localHash !== recordedLocalHash;

  if (!remoteChanged && !localChanged) {
    return { action: "in-sync", reason: "Both sides match the last sync." };
  }
  if (!remoteChanged) {
    return { action: "push", reason: "Edited here since the last sync." };
  }
  if (!localChanged) {
    return { action: "pull", reason: "Edited on the remote since the last sync." };
  }
  return { action: "conflict", reason: "Edited in both places since the last sync." };
}

/**
 * FNV-1a over the text. This detects change, it does not protect anything, so
 * it deliberately stays cheap and synchronous on both server and browser.
 */
export function hashContent(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${text.length.toString(16)}`;
}

/** UTF-8 safe base64, which is what the GitHub contents API expects. */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64Utf8(encoded: string): string {
  const binary = atob(encoded.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

/** Filesystem-safe Markdown path for a page that does not exist remotely yet. */
export function markdownPathForTitle(title: string, prefix?: string | null): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "untitled";
  const folder = prefix?.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return folder ? `${folder}/${base}.md` : `${base}.md`;
}

export interface GitPageProperties {
  source?: string;
  repo?: string;
  branch?: string;
  path?: string;
  remoteSha?: string;
  localHash?: string;
}

/** Reads the sync bookkeeping out of a page's free-form properties. */
export function readGitProperties(properties: unknown): GitPageProperties {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return {};
  const record = properties as Record<string, unknown>;
  const pick = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : undefined);
  return {
    source: pick("source"),
    repo: pick("repo"),
    branch: pick("branch"),
    path: pick("path"),
    remoteSha: pick("remoteSha"),
    localHash: pick("localHash"),
  };
}

/** Pages that are eligible to take part in a sync against this repository. */
export function isSyncedToRepo(properties: unknown, repo: string): boolean {
  const git = readGitProperties(properties);
  if (!git.path) return false;
  if (git.source !== "github") return false;
  return git.repo?.toLowerCase() === repo.toLowerCase();
}
