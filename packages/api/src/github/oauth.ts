/**
 * GitHub device flow. Unlike OpenAI, GitHub has no dynamic client
 * registration, so a deployment brings its own OAuth App client id and the
 * person types a short code at github.com/login/device. No client secret and
 * no loopback callback are involved, which is what makes this work for a
 * self-hosted or desktop Lattice.
 *
 * Everything here runs on the server: the browser receives the user code, never
 * the access token or the device code.
 */

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

export interface GithubDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface GithubDeviceTokens {
  accessToken: string;
  tokenType: string;
  scopes: string[];
}

export type GithubDevicePoll =
  | ({ status: "connected" } & GithubDeviceTokens)
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
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Lattice",
    },
    body: new URLSearchParams(fields).toString(),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
  const response = await fetch(`${API_URL}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "Lattice",
    },
  });
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
const SEGMENT_PATTERN = /^[^/\\\u0000-\u001f\u007f]{1,255}$/;

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

function validSegments(segments: string[]): boolean {
  return segments.every(
    (segment) =>
      SEGMENT_PATTERN.test(segment) &&
      segment !== "." &&
      segment !== ".." &&
      !segment.includes("/") &&
      !segment.includes("\\"),
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
  if (!segments || !validSegments(segments)) return null;
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
    const ref = remainder.slice(2);
    if (!validSegments(ref)) return null;
    return method === "GET"
      ? `${base}/git/trees/${ref.map(encodeURIComponent).join("/")}${suffix}`
      : null;
  }

  if (remainder[0] === "contents" && remainder.length >= 2) {
    const filePath = remainder.slice(1);
    if (!validSegments(filePath)) return null;
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
  const response = await fetch(`${API_URL}${input.path}`, {
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
