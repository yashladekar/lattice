/**
 * Single sign-on helpers.
 *
 * The OIDC exchange needs Node crypto and lives in the auth package; what can
 * be decided without a network or a key lives here, so the rules that gate
 * sign-in — which issuer is acceptable, which domains route where, which
 * redirects are allowed back — are testable on their own.
 */
import { hashContent } from "./git-sync";

export const SSO_STATE_TTL_MS = 10 * 60 * 1000;
export const SSO_MAX_DOMAINS = 20;

/**
 * An issuer must be an https origin with no trailing slash or query. Localhost
 * is the one exception, so a developer can run an identity provider locally
 * without a certificate; nothing routable is accepted over plain http.
 */
export function normalizeIssuer(value: unknown): string | null {
  if (typeof value !== "string") return null;
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
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

export function parseSsoDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const domains = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const domain = entry.trim().toLowerCase().replace(/^@/, "");
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) continue;
    domains.add(domain);
    if (domains.size >= SSO_MAX_DOMAINS) break;
  }
  return [...domains];
}

/** Exact domain match, so `evil-example.com` never routes to `example.com`. */
export function ssoDomainMatches(domains: string[], email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return Boolean(domain) && domains.includes(domain);
}

/**
 * The TXT value a workspace owner publishes to prove a new SSO domain. It is
 * public by design: only control of the domain's DNS can add the record.
 */
export function ssoDomainChallenge(workspaceId: string, domain: string): string {
  return `lattice-verify=${hashContent(`sso:${workspaceId}:${domain.toLowerCase()}`)}`;
}

export const SSO_DOMAIN_RECORD_PREFIX = "_lattice-sso";

/**
 * Resolves the post-sign-in redirect. Absolute URLs are only accepted on an
 * allow-listed origin; anything else falls back to the app root, so a crafted
 * `redirect` cannot turn the callback into an open redirect.
 */
export function resolveSsoRedirect(
  value: unknown,
  allowedOrigins: readonly string[],
  fallback = "/app",
): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const target = value.trim();
  if (target.startsWith("/") && !target.startsWith("//")) return target;
  try {
    const url = new URL(target);
    if (allowedOrigins.includes(url.origin)) return url.toString();
  } catch {
    return fallback;
  }
  return fallback;
}

/** The error page the callback sends the browser back to for a failed sign-in. */
export function ssoErrorRedirect(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/login?sso_error=${encodeURIComponent(code)}`;
}

export function ssoErrorDetail(code: string): string {
  switch (code) {
    case "not_provisioned":
      return "Your identity is verified, but this account is not provisioned in that workspace yet. Ask an administrator to invite or provision you.";
    case "email_unverified":
      return "Your identity provider has not verified this email address, so sign-in was refused.";
    case "domain_not_allowed":
      return "This workspace's SSO is not configured for that email domain. Ask an owner to add the domain to the connection.";
    case "state_expired":
      return "That sign-in attempt expired. Start again from the login page.";
    case "provider_error":
      return "The identity provider rejected the sign-in. Check the connection settings.";
    case "not_configured":
      return "This workspace has not configured single sign-on.";
    default:
      return "Single sign-on could not complete. Try again or use another sign-in method.";
  }
}
