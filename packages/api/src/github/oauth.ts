/**
 * GitHub authorization. Two flows, chosen by the deployment:
 *
 * - Authorization code (Vercel-style): the person clicks Connect, approves the
 *   OAuth App on github.com, and GitHub redirects back to the server callback.
 *   This needs a client secret and a registered callback URL.
 * - Device flow: GitHub shows a short code to type. No secret or callback URL,
 *   which makes it the fallback for deployments behind an unreachable origin.
 *
 * All of this runs on the server; the browser never receives GitHub's token.
 */

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_URL = "https://api.github.com";

/** `repo` covers private repositories and pushes; `read:user` identifies the account. */
export const GITHUB_SCOPE = "repo read:user";
export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export class GithubError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GithubError";
    this.code = code;
  }
}

export interface GithubTokenSet {
  accessToken: string;
  tokenType: string;
  scopes: string[];
}

export interface GithubDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type GithubDevicePoll =
  | ({ status: "connected" } & GithubTokenSet)
  | { status: "pending"; interval: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; message: string };

export interface GithubIdentity {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.round(number), min), max);
}

async function postForm(url: string, fields: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Lattice",
      },
      body: new URLSearchParams(fields).toString(),
    });
  } catch {
    throw new GithubError("network_failed", "GitHub could not be reached. Try again.");
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function buildGithubAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scope ?? GITHUB_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("allow_signup", "true");
  return url.toString();
}

export async function exchangeGithubCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GithubTokenSet> {
  const response = await postForm(TOKEN_URL, {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const body = await readJson(response);
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";
  if (!accessToken) {
    const message = typeof body?.error_description === "string" ? body.error_description : "";
    throw new GithubError(
      typeof body?.error === "string" ? body.error : "exchange_failed",
      message || "GitHub did not return a token for that authorization.",
    );
  }
  return {
    accessToken,
    tokenType: typeof body?.token_type === "string" ? body.token_type : "bearer",
    scopes: typeof body?.scope === "string" ? body.scope.split(/[\s,]+/).filter(Boolean) : [],
  };
}

export async function startGithubDeviceFlow(clientId: string): Promise<GithubDeviceStart> {
  const response = await postForm(DEVICE_CODE_URL, {
    client_id: clientId,
    scope: GITHUB_SCOPE,
  });
  const body = await readJson(response);
  const deviceCode = typeof body?.device_code === "string" ? body.device_code : "";
  const userCode = typeof body?.user_code === "string" ? body.user_code : "";
  if (!response.ok || !deviceCode || !userCode) {
    const message = typeof body?.error_description === "string" ? body.error_description : "";
    throw new GithubError(
      "device_start_failed",
      message || `GitHub refused the device-code request (${response.status}).`,
    );
  }
  return {
    deviceCode,
    userCode,
    verificationUri:
      typeof body?.verification_uri === "string" && /^https:\/\/github\.com\//.test(body.verification_uri)
        ? body.verification_uri
        : "https://github.com/login/device",
    expiresIn: clamp(body?.expires_in, 60, 1_800, 900),
    interval: clamp(body?.interval, 5, 60, 5),
  };
}

export async function pollGithubDeviceFlow(input: {
  clientId: string;
  deviceCode: string;
}): Promise<GithubDevicePoll> {
  const response = await postForm(TOKEN_URL, {
    client_id: input.clientId,
    device_code: input.deviceCode,
    grant_type: GITHUB_DEVICE_GRANT,
  });
  const body = await readJson(response);
  const accessToken = typeof body?.access_token === "string" ? body.access_token : "";

  if (accessToken) {
    return {
      status: "connected",
      accessToken,
      tokenType: typeof body?.token_type === "string" ? body.token_type : "bearer",
      scopes:
        typeof body?.scope === "string"
          ? body.scope.split(/[\s,]+/).filter(Boolean)
          : [],
    };
  }

  const error = typeof body?.error === "string" ? body.error : "";
  const description = typeof body?.error_description === "string" ? body.error_description : "";
  switch (error) {
    case "authorization_pending":
      return { status: "pending", interval: 5 };
    case "slow_down":
      return { status: "pending", interval: 10 };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      return {
        status: "error",
        message: description || (response.ok ? "GitHub returned no token." : `GitHub returned ${response.status}.`),
      };
  }
}

export async function fetchGithubIdentity(accessToken: string): Promise<GithubIdentity> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/user`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "Lattice",
      },
    });
  } catch {
    throw new GithubError("network_failed", "GitHub could not be reached. Try again.");
  }
  const body = await readJson(response);
  const login = typeof body?.login === "string" ? body.login : "";
  if (!response.ok || !login) {
    throw new GithubError(
      "identity_failed",
      response.status === 401
        ? "GitHub rejected the token."
        : `GitHub could not identify the account (${response.status}).`,
    );
  }
  return {
    id: typeof body?.id === "number" ? body.id : 0,
    login,
    name: typeof body?.name === "string" ? body.name : null,
    avatarUrl: typeof body?.avatar_url === "string" ? body.avatar_url : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Proxied API                                                                 */
/* -------------------------------------------------------------------------- */

export type GithubProxyMethod = "GET" | "PUT";

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;
const QUERY_PATTERN = /^[A-Za-z0-9_.~%&=+,-]{0,512}$/;

function decodeSegments(raw: string): string[] | null {
  try {
    return raw
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

/**
 * A decoded path segment. A slash may survive decoding when the caller encoded
 * one (`feature%2Fnested`); branch refs are split on it, other paths reject it.
 */
function safeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= 255 &&
    segment !== "." &&
    segment !== ".." &&
    !/[\\\u0000-\u001f\u007f]/.test(segment)
  );
}

/**
 * Turns the paths Lattice's import and sync actually use into a canonical
 * GitHub API path, or null. This is the only gate between a signed-in user and
 * their token, so anything outside the list — other owners' endpoints, the
 * graphql API, search, admin paths — is refused rather than forwarded.
 */
export function parseGithubApiPath(method: GithubProxyMethod, rawPath: string): string | null {
  if (typeof rawPath !== "string" || !rawPath.startsWith("/") || rawPath.length > 2_048) {
    return null;
  }
  if (rawPath.startsWith("//") || /[\u0000-\u001f\u007f\\#]/.test(rawPath)) return null;

  const question = rawPath.indexOf("?");
  const rawName = question === -1 ? rawPath : rawPath.slice(0, question);
  const query = question === -1 ? "" : rawPath.slice(question + 1);
  if (query && !QUERY_PATTERN.test(query)) return null;
  // Percent-encoded control characters have no business in a GitHub query and
  // are the one thing the character class above would otherwise let through.
  if (/%(0[0-9a-f]|1[0-9a-f])/i.test(query)) return null;

  const segments = decodeSegments(rawName);
  if (!segments || !segments.every(safeSegment)) return null;
  const suffix = query ? `?${query}` : "";

  const [root, ...rest] = segments;
  if (root === "user") {
    if (rest.length === 0) return method === "GET" ? `/user${suffix}` : null;
    if (rest.length === 1 && rest[0] === "repos") {
      return method === "GET" ? `/user/repos${suffix}` : null;
    }
    return null;
  }
  if (root !== "repos") return null;

  const [owner, repo, ...remainder] = rest;
  if (!owner || !repo || !NAME_PATTERN.test(owner) || !NAME_PATTERN.test(repo)) return null;
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  if (!remainder.length) return method === "GET" ? `${base}${suffix}` : null;

  if (remainder[0] === "git" && remainder[1] === "trees" && remainder.length >= 3) {
    // A branch name may contain `/`, either literally or percent-encoded. Splitting
    // it back into segments keeps every segment validated while preserving the ref.
    const ref = remainder.slice(2).flatMap((segment) => segment.split("/"));
    if (!ref.length || !ref.every(safeSegment)) return null;
    return method === "GET"
      ? `${base}/git/trees/${ref.map(encodeURIComponent).join("/")}${suffix}`
      : null;
  }

  if (remainder[0] === "contents" && remainder.length >= 2) {
    const filePath = remainder.slice(1);
    if (!filePath.every((segment) => safeSegment(segment) && !segment.includes("/"))) return null;
    return method === "GET" || method === "PUT"
      ? `${base}/contents/${filePath.map(encodeURIComponent).join("/")}${suffix}`
      : null;
  }

  return null;
}

export interface GithubApiResult {
  status: number;
  body: unknown;
  rateRemaining: string | null;
}

export async function githubApiRequest(input: {
  accessToken: string;
  method: GithubProxyMethod;
  path: string;
  body?: unknown;
}): Promise<GithubApiResult> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${input.path}`, {
      method: input.method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.accessToken}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": "Lattice",
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
  } catch {
    throw new GithubError("network_failed", "GitHub could not be reached. Try again.");
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return {
    status: response.status,
    body,
    rateRemaining: response.headers.get("x-ratelimit-remaining"),
  };
}
