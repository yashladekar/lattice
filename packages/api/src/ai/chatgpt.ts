import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Sign in with ChatGPT (open-source token sharing).
 *
 * This is a public OAuth client: there is no client secret. The first
 * registration runs with `client_id=dynamic_agent_client` and returns an issued
 * `oaiapp_…` client id that later sign-ins reuse. Tokens are obtained against
 * `https://api.openai.com/v1` and only ever authorise the Responses API.
 */

export const SIWC = {
  issuer: "https://auth.openai.com",
  authorizeEndpoint: "https://auth.openai.com/api/accounts/authorize",
  tokenEndpoint: "https://auth.openai.com/api/accounts/oauth/token",
  discoveryUrl: "https://auth.openai.com/.well-known/openid-configuration",
  jwksUrl: "https://auth.openai.com/.well-known/jwks.json",
  apiBaseUrl: "https://api.openai.com/v1",
  resource: "https://api.openai.com/v1",
  dynamicClientId: "dynamic_agent_client",
  agentName: "Lattice",
} as const;

export const SIWC_IDENTITY_SCOPES = ["openid", "profile", "email"] as const;
export const SIWC_PLAN_SCOPES = [
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
] as const;
export const SIWC_REQUESTED_SCOPES = [...SIWC_IDENTITY_SCOPES, ...SIWC_PLAN_SCOPES];

export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";

/** Refresh tokens that can never work again; the user has to sign in anew. */
export const SIWC_TERMINAL_REFRESH_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "invalid_client",
]);

export class ChatGptTokenError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ChatGptTokenError";
  }
}

export class ChatGptError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly requestId: string | null,
    readonly param?: string,
  ) {
    super(message);
    this.name = "ChatGptError";
  }
}

export interface ChatGptAuthorizeInput {
  clientId: string;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /** Only on initial dynamic registration; the user can rename it later. */
  agentNameHint?: string;
  idTokenHint?: string;
  loginHint?: string;
  prompt?: "consent";
}

export function buildChatGptAuthorizeUrl(input: ChatGptAuthorizeInput): string {
  const url = new URL(SIWC.authorizeEndpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("ext_agent_host_id", input.hostId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SIWC_REQUESTED_SCOPES.join(" "));
  url.searchParams.set("resource", SIWC.resource);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.agentNameHint) url.searchParams.set("agent_name_hint", input.agentNameHint);
  if (input.idTokenHint) url.searchParams.set("id_token_hint", input.idTokenHint);
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  if (input.prompt) url.searchParams.set("prompt", input.prompt);
  return url.toString();
}

export interface ChatGptTokenSet {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  expiresIn: number;
  scopes: string[];
  earliestRefreshAt: string | null;
}

function requestIdOf(response: Response): string | null {
  return response.headers.get("openai-request-id") ?? response.headers.get("x-request-id");
}

async function readTokenError(response: Response): Promise<ChatGptTokenError> {
  let code = `http_${response.status}`;
  let message = `OpenAI rejected the token request (${response.status}).`;
  try {
    const text = await response.text();
    if (text) {
      const body = JSON.parse(text) as Record<string, unknown>;
      if (typeof body.error === "string") code = body.error;
      if (typeof body.error_description === "string") message = body.error_description;
      else if (typeof body.detail === "string") message = body.detail;
    }
  } catch {
    // Keep the generic message; the status is what matters for recovery.
  }
  return new ChatGptTokenError(code, response.status, message);
}

async function requestTokens(body: URLSearchParams): Promise<ChatGptTokenSet> {
  const response = await fetch(SIWC.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw await readTokenError(response);

  const json = (await response.json()) as Record<string, unknown>;
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;
  if (!accessToken) {
    throw new ChatGptTokenError("invalid_response", response.status, "OpenAI returned no access token.");
  }
  const expiresIn =
    typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in : 3_600;
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    idToken: typeof json.id_token === "string" ? json.id_token : null,
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
    expiresIn,
    scopes:
      typeof json.scope === "string"
        ? json.scope.split(" ").map((scope) => scope.trim()).filter(Boolean)
        : [],
    earliestRefreshAt:
      typeof json.earliest_refresh_at === "string" ? json.earliest_refresh_at : null,
  };
}

export function exchangeChatGptCode(input: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<ChatGptTokenSet> {
  return requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.verifier,
      resource: SIWC.resource,
    }),
  );
}

/** Omits `scope` so the grant keeps whatever the user originally consented to. */
export function refreshChatGptTokens(input: {
  clientId: string;
  refreshToken: string;
}): Promise<ChatGptTokenSet> {
  return requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      resource: SIWC.resource,
    }),
  );
}

let cachedJwks: JWTVerifyGetKey | null = null;

export function chatGptJwks(): JWTVerifyGetKey {
  cachedJwks ??= createRemoteJWKSet(new URL(SIWC.jwksUrl));
  return cachedJwks;
}

export interface ChatGptIdentity {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export async function verifyChatGptIdToken(input: {
  idToken: string;
  clientId: string;
  nonce: string;
  keySet?: JWTVerifyGetKey;
}): Promise<ChatGptIdentity> {
  const { payload } = await jwtVerify(input.idToken, input.keySet ?? chatGptJwks(), {
    issuer: SIWC.issuer,
    audience: input.clientId,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });
  if (payload.nonce !== input.nonce) {
    throw new Error("The ChatGPT identity token does not match this sign-in attempt.");
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("The ChatGPT identity token did not contain a subject.");
  }
  return {
    subject: payload.sub,
    email:
      typeof payload.email === "string" && payload.email.trim()
        ? payload.email.trim().toLowerCase()
        : null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    name:
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 120)
        : null,
  };
}

interface DiscoveryDocument {
  revocation_endpoint?: string;
}

let cachedRevocationEndpoint: { value: string | null; expiresAt: number } | null = null;

export async function discoverRevocationEndpoint(): Promise<string | null> {
  if (cachedRevocationEndpoint && cachedRevocationEndpoint.expiresAt > Date.now()) {
    return cachedRevocationEndpoint.value;
  }
  try {
    const response = await fetch(SIWC.discoveryUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const document = (await response.json()) as DiscoveryDocument;
    const value =
      typeof document.revocation_endpoint === "string" ? document.revocation_endpoint : null;
    cachedRevocationEndpoint = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
    return value;
  } catch {
    return null;
  }
}

/**
 * Ends the renewable session. An empty 200 is success, including for a token
 * that was already invalid, so the caller can clear local credentials.
 */
export async function revokeChatGptSession(input: {
  refreshToken: string;
  clientId?: string;
}): Promise<boolean> {
  const endpoint = await discoverRevocationEndpoint();
  if (!endpoint) return false;
  const body = new URLSearchParams({
    token: input.refreshToken,
    token_type_hint: "refresh_token",
  });
  if (input.clientId) body.set("client_id", input.clientId);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface ChatGptModel {
  slug: string;
  displayName: string;
}

/** OpenAI answers with `{ models: [...] }` here, not the usual `{ data: [...] }`. */
export async function listChatGptModels(accessToken: string): Promise<ChatGptModel[]> {
  const response = await fetch(`${SIWC.apiBaseUrl}/models`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw await chatGptHttpError(response);
  const json = (await response.json()) as { models?: unknown };
  if (!Array.isArray(json.models)) return [];
  return json.models.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (record.visibility !== "list") return [];
    if (typeof record.slug !== "string" || !record.slug) return [];
    return [
      {
        slug: record.slug,
        displayName:
          typeof record.display_name === "string" && record.display_name
            ? record.display_name
            : record.slug,
      },
    ];
  });
}

async function chatGptHttpError(response: Response): Promise<ChatGptError> {
  const requestId = requestIdOf(response);
  let code = `http_${response.status}`;
  let message = `OpenAI returned ${response.status}.`;
  let param: string | undefined;
  try {
    const text = await response.text();
    if (text) {
      const body = JSON.parse(text) as Record<string, unknown>;
      // Direct-route admission answers with a bare `{ detail }` before a
      // Responses request starts; treat it as diagnostic text only.
      if (typeof body.detail === "string") message = body.detail;
      const error =
        body.error && typeof body.error === "object"
          ? (body.error as Record<string, unknown>)
          : body;
      if (typeof error.code === "string") code = error.code;
      if (typeof error.message === "string") message = error.message;
      if (typeof error.param === "string") param = error.param;
    }
  } catch {
    // Keep the generic message.
  }
  return new ChatGptError(message, code, response.status, requestId, param);
}

export interface ChatGptResponseInput {
  accessToken: string;
  model: string;
  instructions?: string;
  input: Array<{ role: "user" | "assistant"; content: string }>;
  signal?: AbortSignal;
}

/**
 * Consumes an incremental SSE buffer. Returns the `data:` payloads that are
 * complete, keeping any partial tail for the next chunk.
 */
export function createSseDecoder(): (chunk: string) => string[] {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk.replace(/\r\n/g, "\n");
    const payloads: string[] = [];
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) payloads.push(data);
      boundary = buffer.indexOf("\n\n");
    }
    return payloads;
  };
}

export type ChatGptStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done" };

/**
 * Streams `POST /v1/responses`. The route requires `store: false` and
 * `stream: true`, and inference only counts as successful once
 * `response.completed` arrives.
 */
export async function* streamChatGptResponse(
  input: ChatGptResponseInput,
): AsyncGenerator<ChatGptStreamEvent> {
  const response = await fetch(`${SIWC.apiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: input.model,
      ...(input.instructions ? { instructions: input.instructions } : {}),
      input: input.input,
      store: false,
      stream: true,
    }),
    signal: input.signal ?? AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw await chatGptHttpError(response);
  if (!response.body) {
    throw new ChatGptError(
      "OpenAI returned no response stream.",
      "empty_stream",
      response.status,
      requestIdOf(response),
    );
  }

  const requestId = requestIdOf(response);
  const decoder = new TextDecoder();
  const readEvents = createSseDecoder();
  let completed = false;

  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    for (const payload of readEvents(decoder.decode(chunk, { stream: true }))) {
      if (payload === "[DONE]") {
        completed = true;
        break;
      }
      const event = parseEvent(payload);
      if (!event) continue;

      if (event.type === "response.output_text.delta") {
        if (typeof event.delta === "string" && event.delta) {
          yield { type: "delta", text: event.delta };
        }
        continue;
      }
      if (event.type === "response.completed") {
        completed = true;
        break;
      }
      if (event.type === "response.failed") {
        const error = responseErrorOf(event);
        throw new ChatGptError(
          error.message ?? "ChatGPT plan usage failed.",
          error.code ?? "response_failed",
          response.status,
          requestId,
          error.param,
        );
      }
      if (event.type === "response.incomplete") {
        throw new ChatGptError(
          "The response ended before it was complete.",
          "incomplete",
          response.status,
          requestId,
        );
      }
      if (event.type === "error") {
        const error = responseErrorOf(event);
        throw new ChatGptError(
          error.message ?? "ChatGPT plan usage failed.",
          error.code ?? "response_error",
          response.status,
          requestId,
          error.param,
        );
      }
    }
    if (completed) break;
  }

  if (!completed) {
    throw new ChatGptError(
      "The response stream ended before completion.",
      "stream_truncated",
      response.status,
      requestId,
    );
  }
  yield { type: "done" };
}

function parseEvent(payload: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(payload) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function responseErrorOf(event: Record<string, unknown>): {
  code?: string;
  message?: string;
  param?: string;
} {
  const response =
    event.response && typeof event.response === "object"
      ? (event.response as Record<string, unknown>)
      : null;
  const nested =
    (response?.error as Record<string, unknown> | undefined) ??
    (event.error as Record<string, unknown> | undefined) ??
    event;
  return {
    ...(typeof nested.code === "string" ? { code: nested.code } : {}),
    ...(typeof nested.message === "string" ? { message: nested.message } : {}),
    ...(typeof nested.param === "string" ? { param: nested.param } : {}),
  };
}
