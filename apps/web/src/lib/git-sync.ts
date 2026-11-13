import {
  docToMarkdown,
  encodeBase64Utf8,
  decodeBase64Utf8,
  hashContent,
  isSyncedToRepo,
  markdownPathForTitle,
  planGitSync,
  readGitProperties,
  type GitSyncAction,
} from "@notes-learning/domain";

import { githubApi, type GithubAuth } from "@/lib/github-api";
import { markdownToDoc, parseRepoInput } from "@/lib/github-import";
import type { LatticeDB } from "@/lib/local/db";
import { savePageContentLocal, updatePagePropertiesLocal } from "@/lib/local/repository";

export interface GitTarget {
  repo: string;
  branch: string;
  pathPrefix: string;
  auth: GithubAuth;
}

export interface GitSyncRow {
  pageId: string;
  title: string;
  path: string;
  action: GitSyncAction;
  reason: string;
  remoteSha: string | null;
  recordedRemoteSha: string | null;
  localHash: string;
  recordedLocalHash: string | null;
}

async function githubMessage(response: Response): Promise<string> {
  if (response.status === 401) return "GitHub rejected the token.";
  if (response.status === 404) return "Not found. Check the repository and path, or add a token.";
  if (response.status === 403 || response.status === 429) {
    return response.headers.get("x-ratelimit-remaining") === "0"
      ? "GitHub rate limit reached. Add a token or try again later."
      : "GitHub refused the request. A token with write access may be required.";
  }
  if (response.status === 409) return "The file changed on the remote while syncing.";
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) return body.message;
  } catch {
    // Fall through to the status below.
  }
  return `GitHub returned ${response.status}.`;
}

async function resolveBranch(target: GitTarget): Promise<string> {
  if (target.branch.trim()) return target.branch.trim();
  const parsed = parseRepoInput(target.repo);
  if (!parsed) throw new Error("Use owner/repository.");
  const response = await githubApi(target.auth, "GET", `/repos/${parsed.owner}/${parsed.repo}`);
  if (!response.ok) throw new Error(await githubMessage(response));
  const body = (await response.json()) as { default_branch?: string };
  return body.default_branch ?? "main";
}

/** Path to blob SHA for every Markdown file under the configured prefix. */
export async function fetchRemoteTree(target: GitTarget): Promise<Map<string, string>> {
  const parsed = parseRepoInput(target.repo);
  if (!parsed) throw new Error("Use owner/repository.");
  const branch = await resolveBranch(target);
  const response = await githubApi(
    target.auth,
    "GET",
    `/repos/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  if (!response.ok) throw new Error(await githubMessage(response));

  const tree = (await response.json()) as { tree?: Array<{ path?: string; type?: string; sha?: string }> };
  const prefix = target.pathPrefix.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  const files = new Map<string, string>();
  for (const entry of tree.tree ?? []) {
    if (entry.type !== "blob" || typeof entry.path !== "string") continue;
    if (!/\.mdx?$/i.test(entry.path)) continue;
    if (prefix && !entry.path.startsWith(prefix)) continue;
    files.set(entry.path, entry.sha ?? "");
  }
  return files;
}

async function fetchRemoteFile(
  target: GitTarget,
  branch: string,
  path: string,
): Promise<{ markdown: string; sha: string }> {
  const parsed = parseRepoInput(target.repo);
  if (!parsed) throw new Error("Use owner/repository.");
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await githubApi(
    target.auth,
    "GET",
    `/repos/${parsed.owner}/${parsed.repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`,
  );
  if (!response.ok) throw new Error(await githubMessage(response));
  const body = (await response.json()) as { content?: string; sha?: string; encoding?: string };
  if (!body.content) throw new Error("That file is too large for the contents API.");
  return { markdown: decodeBase64Utf8(body.content), sha: body.sha ?? "" };
}

/**
 * Compares every page bound to this repository against the remote tree. Only
 * the tree is read here, so planning a sync costs one request.
 */
export async function planSync(
  db: LatticeDB,
  workspaceId: string,
  target: GitTarget,
): Promise<GitSyncRow[]> {
  const parsed = parseRepoInput(target.repo);
  if (!parsed) throw new Error("Use owner/repository.");
  const canonicalRepo = `${parsed.owner}/${parsed.repo}`;

  const pages = (await db.pages.where("workspaceId").equals(workspaceId).toArray()).filter(
    (page) => !page.deletedAt && isSyncedToRepo(page.properties, canonicalRepo),
  );

  const remote = await fetchRemoteTree(target);
  const rows: GitSyncRow[] = [];

  for (const page of pages) {
    const git = readGitProperties(page.properties);
    const document = await db.pageDocuments.get(page.id);
    const markdown = document ? docToMarkdown(document.content) : "";
    const localHash = hashContent(markdown);
    const path = git.path ?? "";
    const remoteSha = remote.get(path) ?? null;
    const decision = planGitSync({
      remoteSha,
      recordedRemoteSha: git.remoteSha ?? null,
      localHash,
      recordedLocalHash: git.localHash ?? null,
    });
    rows.push({
      pageId: page.id,
      title: page.title,
      path,
      action: decision.action,
      reason: decision.reason,
      remoteSha,
      recordedRemoteSha: git.remoteSha ?? null,
      localHash,
      recordedLocalHash: git.localHash ?? null,
    });
  }

  return rows;
}

async function writeRemote(
  target: GitTarget,
  branch: string,
  input: { path: string; markdown: string; sha: string | null; message: string },
): Promise<string> {
  const parsed = parseRepoInput(target.repo);
  if (!parsed) throw new Error("Use owner/repository.");
  const encoded = input.path.split("/").map(encodeURIComponent).join("/");
  const response = await githubApi(
    target.auth,
    "PUT",
    `/repos/${parsed.owner}/${parsed.repo}/contents/${encoded}`,
    {
      body: {
        message: input.message,
        content: encodeBase64Utf8(input.markdown),
        branch,
        ...(input.sha ? { sha: input.sha } : {}),
      },
    },
  );
  if (!response.ok) throw new Error(await githubMessage(response));
  const body = (await response.json()) as { content?: { sha?: string } };
  return body.content?.sha ?? "";
}

export interface GitSyncOptions {
  userId: string;
  commitMessage: string;
  /** Pages that have no remote counterpart get a generated path. */
  pathForNewPage?: (title: string) => string;
}

/** Writes one page to the remote and records the new blob SHA. */
export async function pushRow(
  db: LatticeDB,
  row: GitSyncRow,
  target: GitTarget,
  options: GitSyncOptions,
): Promise<void> {
  const branch = await resolveBranch(target);
  const page = await db.pages.get(row.pageId);
  const document = await db.pageDocuments.get(row.pageId);
  if (!page || !document) throw new Error("That page is no longer available.");

  const markdown = docToMarkdown(document.content);
  const path =
    row.path || (options.pathForNewPage?.(page.title) ?? markdownPathForTitle(page.title, target.pathPrefix));

  const sha = await writeRemote(target, branch, {
    path,
    markdown,
    sha: shaForPush(row),
    message: options.commitMessage || `Update ${path} from Lattice`,
  });

  await updatePagePropertiesLocal(db, row.pageId, {
    ...page.properties,
    source: "github",
    repo: target.repo,
    branch,
    path,
    remoteSha: sha,
    localHash: hashContent(markdown),
    syncedAt: new Date().toISOString(),
  });
}

/** A brand new file must not send a sha; an existing one must, to force a 409. */
function shaForPush(row: GitSyncRow): string | null {
  if (row.action === "publish" || row.action === "remote-missing") return null;
  return row.remoteSha;
}

/** Reads one page from the remote into the local document. */
export async function pullRow(
  db: LatticeDB,
  row: GitSyncRow,
  target: GitTarget,
  options: { userId: string },
): Promise<void> {
  const branch = await resolveBranch(target);
  const page = await db.pages.get(row.pageId);
  if (!page) throw new Error("That page is no longer available.");

  const remote = await fetchRemoteFile(target, branch, row.path);
  const doc = markdownToDoc(remote.markdown);
  await savePageContentLocal(db, { pageId: row.pageId, content: doc, userId: options.userId });
  await updatePagePropertiesLocal(db, row.pageId, {
    ...page.properties,
    source: "github",
    repo: target.repo,
    branch,
    path: row.path,
    remoteSha: remote.sha,
    localHash: hashContent(docToMarkdown(doc)),
    syncedAt: new Date().toISOString(),
  });
}
