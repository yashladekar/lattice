import { client } from "@/utils/orpc";

/**
 * How an import or sync authenticates against GitHub. `connection` means the
 * token lives encrypted on the server and every call is proxied; `manual` is
 * the original behaviour where the person pastes a token for this run only.
 */
export type GithubAuth = { kind: "connection" } | { kind: "manual"; token: string };

export const GITHUB_API = "https://api.github.com";

export function usesStoredGithubToken(auth: GithubAuth): boolean {
  return auth.kind === "connection" || auth.token.trim().length > 0;
}

/**
 * A `fetch`-shaped call for the GitHub REST API. Manual calls go straight to
 * GitHub with the pasted token; connection calls go to the server, which
 * injects the stored token and refuses any path outside the import/sync set.
 */
export async function githubApi(
  auth: GithubAuth,
  method: "GET" | "PUT",
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  if (auth.kind === "manual") {
    return fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        ...(auth.token.trim() ? { Authorization: `Bearer ${auth.token.trim()}` } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  if (options.signal?.aborted) throw new DOMException("Import cancelled", "AbortError");
  const result = await client.github.request({
    method,
    path,
    ...(options.body === undefined ? {} : { body: options.body }),
  });
  return new Response(
    result.body === null || result.body === undefined ? null : JSON.stringify(result.body),
    {
      status: result.status,
      headers: {
        "content-type": "application/json",
        ...(result.rateRemaining ? { "x-ratelimit-remaining": result.rateRemaining } : {}),
      },
    },
  );
}
