import { describe, expect, it } from "vitest";

import {
  normalizeIssuer,
  parseSsoDomains,
  resolveSsoRedirect,
  ssoDomainChallenge,
  ssoDomainMatches,
  ssoErrorRedirect,
} from "./sso";

describe("sso issuer", () => {
  it("accepts https issuers and normalizes trailing slashes", () => {
    expect(normalizeIssuer("https://login.example.com")).toBe("https://login.example.com");
    expect(normalizeIssuer("https://login.example.com/")).toBe("https://login.example.com");
    expect(normalizeIssuer("https://idp.example.com/tenant")).toBe(
      "https://idp.example.com/tenant",
    );
  });

  it("allows plain http only on localhost", () => {
    expect(normalizeIssuer("http://localhost:4111")).toBe("http://localhost:4111");
    expect(normalizeIssuer("http://127.0.0.1:4111/")).toBe("http://127.0.0.1:4111");
    expect(normalizeIssuer("http://login.example.com")).toBeNull();
  });

  it("refuses anything that is not a plain https origin", () => {
    expect(normalizeIssuer("http://login.example.com")).toBeNull();
    expect(normalizeIssuer("https://user:pass@login.example.com")).toBeNull();
    expect(normalizeIssuer("https://login.example.com?x=1")).toBeNull();
    expect(normalizeIssuer("not a url")).toBeNull();
    expect(normalizeIssuer(42)).toBeNull();
  });
});

describe("sso domains", () => {
  it("normalizes, deduplicates, and caps domains", () => {
    expect(parseSsoDomains(["@Example.com", "example.com", "evil", ""])).toEqual(["example.com"]);
    const many = parseSsoDomains(Array.from({ length: 30 }, (_, index) => `team${index}.example.com`));
    expect(many).toHaveLength(20);
  });

  it("matches only the exact domain", () => {
    const domains = ["example.com"];
    expect(ssoDomainMatches(domains, "ada@example.com")).toBe(true);
    expect(ssoDomainMatches(domains, "ada@EXAMPLE.COM")).toBe(true);
    expect(ssoDomainMatches(domains, "ada@mail.example.com")).toBe(false);
    expect(ssoDomainMatches(domains, "ada@evil-example.com")).toBe(false);
    expect(ssoDomainMatches(domains, "not-an-email")).toBe(false);
  });
});

describe("sso redirects", () => {
  const allowed = ["http://localhost:3101", "https://app.example.com"];

  it("allows same-origin paths and allow-listed origins", () => {
    expect(resolveSsoRedirect("/app?view=page&id=1", allowed)).toBe("/app?view=page&id=1");
    expect(resolveSsoRedirect("https://app.example.com/app", allowed)).toBe(
      "https://app.example.com/app",
    );
  });

  it("refuses protocol-relative and foreign origins", () => {
    expect(resolveSsoRedirect("//evil.example.com", allowed)).toBe("/app");
    expect(resolveSsoRedirect("https://evil.example.com/phish", allowed)).toBe("/app");
    expect(resolveSsoRedirect("javascript:alert(1)", allowed)).toBe("/app");
    expect(resolveSsoRedirect(null, allowed)).toBe("/app");
  });

  it("builds an encoded error redirect", () => {
    expect(ssoErrorRedirect("https://app.example.com/", "not_provisioned")).toBe(
      "https://app.example.com/login?sso_error=not_provisioned",
    );
  });
});

describe("sso domain challenge", () => {
  it("is stable per workspace and domain", () => {
    const first = ssoDomainChallenge("ws-a", "Example.com");
    expect(first).toBe(ssoDomainChallenge("ws-a", "example.com"));
    expect(first.startsWith("lattice-verify=")).toBe(true);
  });

  it("differs across workspaces and domains", () => {
    expect(ssoDomainChallenge("ws-a", "example.com")).not.toBe(
      ssoDomainChallenge("ws-b", "example.com"),
    );
    expect(ssoDomainChallenge("ws-a", "example.com")).not.toBe(
      ssoDomainChallenge("ws-a", "other.com"),
    );
  });
});
