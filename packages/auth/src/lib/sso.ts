import { createHash, randomBytes } from "node:crypto";

import { normalizeIssuer } from "@notes-learning/domain";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { decryptSecret, encryptSecret } from "./secrets";

/**
 * OIDC plumbing for workspace single sign-on.
 *
 * Only the authorization-code + PKCE flow is supported, and only with an
 * issuer that serves a standard discovery document. The client secret is
 * encrypted at rest with a key derived from the deployment secret; the token
 * exchange happens server-side, so a browser never sees the secret.
 */

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

const discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export async function discoverOidc(issuer: string): Promise<OidcDiscovery> {
  const normalized = normalizeIssuer(issuer);
  if (!normalized) throw new Error("The issuer must be a https URL.");
  const cached = discoveryCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const response = await fetch(`${normalized}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(6_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Discovery failed (${response.status}) for ${normalized}.`);
  }
  const document = (await response.json()) as Record<string, unknown>;
  const value: OidcDiscovery = {
    issuer: typeof document.issuer === "string" ? document.issuer : normalized,
    authorization_endpoint: String(document.authorization_endpoint ?? ""),
    token_endpoint: String(document.token_endpoint ?? ""),
    jwks_uri: String(document.jwks_uri ?? ""),
    ...(typeof document.userinfo_endpoint === "string"
      ? { userinfo_endpoint: document.userinfo_endpoint }
      : {}),
  };
  if (!value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) {
    throw new Error("The discovery document is missing authorization, token, or JWKS endpoints.");
  }
  discoveryCache.set(normalized, { value, expiresAt: Date.now() + DISCOVERY_TTL_MS });
  return value;
}

export function encryptSsoSecret(secret: string, keyMaterial: string): string {
  return encryptSecret(secret, keyMaterial, "sso");
}

export function decryptSsoSecret(payload: string, keyMaterial: string): string {
  return decryptSecret(payload, keyMaterial, "sso");
}

export function encryptAiKey(apiKey: string, keyMaterial: string): string {
  return encryptSecret(apiKey, keyMaterial, "ai");
}

export function decryptAiKey(payload: string, keyMaterial: string): string {
  return decryptSecret(payload, keyMaterial, "ai");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthorizeUrl(input: {
  discovery: OidcDiscovery;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const url = new URL(input.discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface OidcIdentity {
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeCodeForIdentity(input: {
  discovery: OidcDiscovery;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
}): Promise<OidcIdentity> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code_verifier: input.verifier,
  });
  const response = await fetch(input.discovery.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`The identity provider refused the code exchange (${response.status}).`);
  }
  const tokens = (await response.json()) as Record<string, unknown>;
  const idToken = typeof tokens.id_token === "string" ? tokens.id_token : null;
  if (!idToken) throw new Error("The identity provider did not return an ID token.");

  const jwks = createRemoteJWKSet(new URL(input.discovery.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: input.discovery.issuer,
    audience: input.clientId,
  });
  if (typeof payload.nonce === "string" && payload.nonce !== input.nonce) {
    throw new Error("The ID token nonce does not match this sign-in attempt.");
  }

  let email = typeof payload.email === "string" ? payload.email : null;
  let emailVerified =
    payload.email_verified === true || payload.email_verified === "true" ? true : false;
  let name =
    typeof payload.name === "string"
      ? payload.name
      : typeof payload.preferred_username === "string"
        ? payload.preferred_username
        : null;

  if ((!email || !emailVerified || !name) && input.discovery.userinfo_endpoint) {
    const accessToken = typeof tokens.access_token === "string" ? tokens.access_token : null;
    if (accessToken) {
      try {
        const userinfo = await fetch(input.discovery.userinfo_endpoint, {
          headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
          signal: AbortSignal.timeout(6_000),
        });
        if (userinfo.ok) {
          const claims = (await userinfo.json()) as Record<string, unknown>;
          if (!email && typeof claims.email === "string") email = claims.email;
          if (claims.email_verified === true || claims.email_verified === "true") {
            emailVerified = true;
          }
          if (!name && typeof claims.name === "string") name = claims.name;
        }
      } catch {
        // The ID token claims remain authoritative; userinfo is a fallback.
      }
    }
  }

  if (!email) throw new Error("The identity provider did not share an email address.");
  return {
    email: email.trim().toLowerCase(),
    emailVerified,
    name: (name ?? email).trim().slice(0, 120),
  };
}
