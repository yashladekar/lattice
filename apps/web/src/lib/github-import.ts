import { decodeBase64Utf8, safeDoc, type TipTapDoc } from "@notes-learning/domain";
import { generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";

import { githubApi, usesStoredGithubToken, type GithubAuth } from "@/lib/github-api";

const MAX_FILES = 40;
const MAX_FILE_BYTES = 200_000;

/** Extensions used only to turn Markdown into a document, not to edit it. */
const importExtensions = [StarterKit];

export function markdownToDoc(markdown: string): TipTapDoc {
  const html = marked.parse(markdown, { async: false }) as string;
  return safeDoc(generateJSON(html, importExtensions));
}

export interface GithubRepo {
  owner: string;
  repo: string;
}

export function parseRepoInput(value: string): GithubRepo | null {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  const [owner, repo, ...rest] = trimmed.split("/");
  if (!owner || !repo || rest.length) return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return { owner, repo };
}

export interface GithubMarkdownFile {
  path: string;
  title: string;
  markdown: string;
  /** Blob SHA, which two-way sync later uses to detect remote edits. */
  sha: string;
  branch: string;
}

export interface GithubImportProgress {
  phase: "listing" | "fetching" | "saving";
  done: number;
  total: number;
  label: string;
}

interface TreeEntry {
  path?: string;
  type?: string;
  sha?: string;
}

async function githubError(response: Response): Promise<string> {
  if (response.status === 401) return "GitHub rejected the token.";
  if (response.status === 404) {
    return "Repository not found. Check the name, or add a token if it is private.";
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      return "GitHub rate limit reached. Add a token or try again later.";
    }
    return "GitHub refused the request. A token may be required.";
  }
  return `GitHub returned ${response.status}.`;
}

function titleFromPath(path: string): string {
  const name = path.split("/").pop() ?? path;
  const base = name.replace(/\.mdx?$/i, "");
  if (base.toLowerCase() === "readme") {
    const folder = path.split("/").slice(-2, -1)[0];
    return folder ? `${folder} README` : "README";
  }
  if (base.toLowerCase() === "index") {
    const folder = path.split("/").slice(-2, -1)[0];
    return folder ? `${folder} index` : "Index";
  }
  return base.replace(/[-_]/g, " ");
}

/**
 * Anonymous imports read raw.githubusercontent.com, which is not rate limited
 * like the API. Private repositories need the API because raw URLs do not
 * accept a credential reliably.
 */
async function fetchFileMarkdown(input: {
  auth: GithubAuth;
  owner: string;
  repo: string;
  branch: string;
  path: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  if (!usesStoredGithubToken(input.auth)) {
    const encoded = input.path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(
      `https://raw.githubusercontent.com/${input.owner}/${input.repo}/${encodeURIComponent(input.branch)}/${encoded}`,
      input.signal ? { signal: input.signal } : {},
    );
    return response.ok ? response.text() : null;
  }

  const encoded = input.path.split("/").map(encodeURIComponent).join("/");
  const response = await githubApi(
    input.auth,
    "GET",
    `/repos/${input.owner}/${input.repo}/contents/${encoded}?ref=${encodeURIComponent(input.branch)}`,
    { ...(input.signal ? { signal: input.signal } : {}) },
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { content?: string; encoding?: string };
  if (!body.content) return null;
  return body.encoding === "base64" ? decodeBase64Utf8(body.content) : body.content;
}

export async function fetchGithubMarkdown(
  input: GithubRepo & { pathPrefix?: string; auth: GithubAuth },
  options: { signal?: AbortSignal; onProgress?: (progress: GithubImportProgress) => void } = {},
): Promise<GithubMarkdownFile[]> {
  const { owner, repo } = input;
  const { signal, onProgress } = options;

  onProgress?.({ phase: "listing", done: 0, total: 0, label: "Reading repository…" });

  const repoResponse = await githubApi(input.auth, "GET", `/repos/${owner}/${repo}`, {
    ...(signal ? { signal } : {}),
  });
  if (!repoResponse.ok) throw new Error(await githubError(repoResponse));
  const repoInfo = (await repoResponse.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch ?? "main";

  const treeResponse = await githubApi(
    input.auth,
    "GET",
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { ...(signal ? { signal } : {}) },
  );
  if (!treeResponse.ok) throw new Error(await githubError(treeResponse));
  const tree = (await treeResponse.json()) as { tree?: TreeEntry[] };

  const prefix = input.pathPrefix?.trim().replace(/^\/+/, "").replace(/\/+$/, "") ?? "";
  const blobs = (tree.tree ?? []).filter(
    (entry) => entry.type === "blob" && typeof entry.path === "string",
  );
  const shaByPath = new Map(blobs.map((entry) => [entry.path as string, entry.sha ?? ""]));
  const paths = blobs
    .map((entry) => entry.path as string)
    .filter((path) => /\.mdx?$/i.test(path))
    .filter((path) => (prefix ? path.startsWith(prefix) : true))
    .slice(0, MAX_FILES);

  if (!paths.length) {
    throw new Error(prefix ? `No Markdown files under “${prefix}”.` : "No Markdown files in this repository.");
  }

  const files: GithubMarkdownFile[] = [];
  for (const [index, path] of paths.entries()) {
    if (signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
    onProgress?.({
      phase: "fetching",
      done: index,
      total: paths.length,
      label: path,
    });
    const text = await fetchFileMarkdown({
      auth: input.auth,
      owner,
      repo,
      branch,
      path,
      ...(signal ? { signal } : {}),
    });
    if (text === null) continue;
    if (text.length > MAX_FILE_BYTES) continue;
    if (!text.trim()) continue;
    files.push({
      path,
      title: titleFromPath(path),
      markdown: text,
      sha: shaByPath.get(path) ?? "",
      branch,
    });
  }

  if (!files.length) throw new Error("Every Markdown file was empty or too large.");
  return files;
}
