import { safeDoc, type TipTapDoc } from "@notes-learning/domain";
import { generateJSON } from "@tiptap/html";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";

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

function headers(token?: string): HeadersInit {
  const base: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token?.trim()) base.Authorization = `Bearer ${token.trim()}`;
  return base;
}

async function githubError(response: Response): Promise<string> {
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

export async function fetchGithubMarkdown(
  input: GithubRepo & { pathPrefix?: string; token?: string },
  options: { signal?: AbortSignal; onProgress?: (progress: GithubImportProgress) => void } = {},
): Promise<GithubMarkdownFile[]> {
  const { owner, repo } = input;
  const { signal, onProgress } = options;

  onProgress?.({ phase: "listing", done: 0, total: 0, label: "Reading repository…" });

  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: headers(input.token),
    signal,
  });
  if (!repoResponse.ok) throw new Error(await githubError(repoResponse));
  const repoInfo = (await repoResponse.json()) as { default_branch?: string };
  const branch = repoInfo.default_branch ?? "main";

  const treeResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: headers(input.token), signal },
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
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
    const response = await fetch(rawUrl, { signal });
    if (!response.ok) continue;
    const text = await response.text();
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
