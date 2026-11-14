/**
 * The one outbound HTTP policy. Every feature that fetches a URL supplied by a
 * workspace — webhooks, SSO discovery and token exchange, URL preview, and an
 * admin-configured AI provider — crosses this seam.
 *
 * The policy rejects credentials in the URL, requires https (or an explicit
 * http opt-in), resolves every address the host returns, and accepts only the
 * address classes the caller allowed. Redirects are followed manually so each
 * hop is checked again; authorization and cookie headers do not travel to a
 * different origin.
 */

export interface OutboundAddress {
  address: string;
}

export interface OutboundDeps {
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  lookup(hostname: string): Promise<string[]>;
}

export interface OutboundOptions {
  /** Allow http in addition to https. Used by the public URL previewer. */
  allowHttp?: boolean;
  /** Allow 127.0.0.0/8 and ::1. Used for local identity providers and AI. */
  allowLoopback?: boolean;
  /** Allow RFC 1918 / CGNAT / ULA. Used only for an admin-configured AI host. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxRedirects?: number;
}

export class OutboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type AddressKind = "public" | "private" | "loopback" | "reserved";

function stripBrackets(value: string): string {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function stripZone(value: string): string {
  const zone = value.indexOf("%");
  return zone >= 0 ? value.slice(0, zone) : value;
}

function parseIpv4(value: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

function ipv6Groups(value: string): number[] | null {
  let host = stripZone(stripBrackets(value)).toLowerCase();
  if (!host.includes(":")) return null;

  const lastColon = host.lastIndexOf(":");
  if (host.includes(".") && lastColon >= 0) {
    const ipv4 = parseIpv4(host.slice(lastColon + 1));
    if (!ipv4) return null;
    const high = ((ipv4[0]! << 8) | ipv4[1]!).toString(16);
    const low = ((ipv4[2]! << 8) | ipv4[3]!).toString(16);
    host = `${host.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = host.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;

  const groups = [
    ...head,
    ...Array.from({ length: Math.max(0, missing) }, () => "0"),
    ...tail,
  ];
  if (groups.length !== 8) return null;
  const values = groups.map((group) =>
    /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return values.every(Number.isFinite) ? values : null;
}

function ipv4Kind(parts: number[]): AddressKind {
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return "reserved";
  if (a === 10) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "reserved";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return "reserved";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if ((a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) {
    return "reserved";
  }
  if (a === 192 && b === 88 && c === 99) return "reserved";
  if (a >= 224) return "reserved";
  return "public";
}

function ipv6Kind(value: string): AddressKind {
  const groups = ipv6Groups(value);
  if (!groups) return "reserved";

  if (groups.every((group) => group === 0)) return "reserved";
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return "loopback";

  // IPv4-mapped or IPv4-compatible addresses carry the useful classification
  // in the last two groups.
  const firstFiveZero = groups.slice(0, 5).every((group) => group === 0);
  if (firstFiveZero && (groups[5] === 0xffff || groups[5] === 0)) {
    const embedded = [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff];
    return ipv4Kind(embedded);
  }
  if ((groups[0]! & 0xfe00) === 0xfc00) return "private";
  if ((groups[0]! & 0xffc0) === 0xfe80) return "reserved";
  if ((groups[0]! & 0xff00) === 0xff00) return "reserved";
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return "reserved";
  return "public";
}

export function isIpLiteral(value: string): boolean {
  const host = stripZone(stripBrackets(value));
  return Boolean(parseIpv4(host)) || Boolean(ipv6Groups(host));
}

/** Whether a literal address is routable on the public internet. */
export function isPublicAddress(value: string): boolean {
  const host = stripZone(stripBrackets(value));
  const ipv4 = parseIpv4(host);
  if (ipv4) return ipv4Kind(ipv4) === "public";
  if (!host.includes(":")) return false;
  return ipv6Kind(host) === "public";
}

function addressKind(value: string): AddressKind {
  const host = stripZone(stripBrackets(value));
  const ipv4 = parseIpv4(host);
  if (ipv4) return ipv4Kind(ipv4);
  if (!host.includes(":")) return "reserved";
  return ipv6Kind(host);
}

function isLoopbackHostname(hostname: string): boolean {
  const host = stripBrackets(hostname).toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || host.startsWith("127.");
}

function normalizeUrl(value: string | URL): URL {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new OutboundError("Outbound URL is invalid.");
  }
  if (url.username || url.password) {
    throw new OutboundError("Outbound URLs cannot include credentials.");
  }
  return url;
}

function protocolAllowed(url: URL, options: OutboundOptions): boolean {
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  if (options.allowHttp) return true;
  return options.allowLoopback === true && isLoopbackHostname(url.hostname);
}

function addressAllowed(address: string, options: OutboundOptions): boolean {
  const kind = addressKind(address);
  if (kind === "public") return true;
  if (kind === "loopback") return options.allowLoopback === true;
  if (kind === "private") return options.allowPrivate === true;
  return false;
}

async function resolveAddresses(hostname: string, deps: OutboundDeps): Promise<string[]> {
  const host = stripBrackets(hostname);
  if (isIpLiteral(host)) return [host];
  const addresses = await deps.lookup(host);
  return addresses.map(stripBrackets);
}

function redirectedInit(
  init: RequestInit,
  status: number,
  from: URL,
  to: URL,
): RequestInit {
  const headers = new Headers(init.headers);
  if (from.origin !== to.origin) {
    headers.delete("authorization");
    headers.delete("cookie");
    headers.delete("proxy-authorization");
  }
  let method = init.method ?? "GET";
  let body = init.body;
  if (status === 303 || ((status === 301 || status === 302) && method.toUpperCase() === "POST")) {
    method = "GET";
    body = undefined;
    headers.delete("content-type");
    headers.delete("content-length");
  }
  return { ...init, method, body, headers };
}

export interface OutboundRequest {
  /** Parses, resolves, and validates a URL without making a request. */
  assertSafe(url: string | URL, options?: OutboundOptions): Promise<URL>;
  /** Validated fetch with manual redirect handling and a timeout per hop. */
  fetch(url: string | URL, init?: RequestInit, options?: OutboundOptions): Promise<Response>;
}

export function createOutbound(deps: OutboundDeps): OutboundRequest {
  async function assertSafe(
    value: string | URL,
    options: OutboundOptions = {},
  ): Promise<URL> {
    const url = normalizeUrl(value);
    if (!protocolAllowed(url, options)) {
      throw new OutboundError("Outbound URL must use https.");
    }
    const addresses = await resolveAddresses(url.hostname, deps);
    if (!addresses.length) {
      throw new OutboundError("Outbound host did not resolve.");
    }
    for (const address of addresses) {
      if (!addressAllowed(address, options)) {
        throw new OutboundError("Outbound URL resolves to a non-public address.");
      }
    }
    return url;
  }

  async function fetchSafe(
    value: string | URL,
    init: RequestInit = {},
    options: OutboundOptions = {},
  ): Promise<Response> {
    let url = await assertSafe(value, options);
    let requestInit: RequestInit = { ...init, redirect: "manual" };
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

    for (let redirects = 0; ; redirects += 1) {
      const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = requestInit.signal
        ? AbortSignal.any([requestInit.signal, timeout])
        : timeout;
      const response = await deps.fetch(url, { ...requestInit, signal });
      if (!REDIRECT_STATUSES.has(response.status)) return response;

      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects >= maxRedirects) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundError("Outbound request redirected too many times.");
      }

      const next = new URL(location, url);
      requestInit = redirectedInit(requestInit, response.status, url, next);
      await response.body?.cancel().catch(() => undefined);
      url = await assertSafe(next, options);
    }
  }

  return { assertSafe, fetch: fetchSafe };
}
