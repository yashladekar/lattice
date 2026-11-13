import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GithubError,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubIdentity,
  githubApiRequest,
  parseGithubApiPath,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
} from "./oauth";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API path allow-list", () => {
  it("accepts the reads and writes import and sync perform", () => {
    expect(parseGithubApiPath("GET", "/user")).toBe("/user");
    expect(parseGithubApiPath("GET", "/user/repos?per_page=100&sort=pushed")).toBe(
      "/user/repos?per_page=100&sort=pushed",
    );
    expect(parseGithubApiPath("GET", "/repos/owner/repo")).toBe("/repos/owner/repo");
    expect(
      parseGithubApiPath("GET", "/repos/owner/repo/git/trees/main?recursive=1"),
    ).toBe("/repos/owner/repo/git/trees/main?recursive=1");
    expect(parseGithubApiPath("GET", "/repos/owner/repo/git/trees/feature/nested")).toBe(
      "/repos/owner/repo/git/trees/feature/nested",
    );
    expect(parseGithubApiPath("GET", "/repos/owner/repo/git/trees/feature%2Fnested")).toBe(
      "/repos/owner/repo/git/trees/feature/nested",
    );
    expect(parseGithubApiPath("GET", "/repos/owner/repo/contents/docs/readme.md?ref=main")).toBe(
      "/repos/owner/repo/contents/docs/readme.md?ref=main",
    );
    expect(parseGithubApiPath("PUT", "/repos/owner/repo/contents/docs/readme.md")).toBe(
      "/repos/owner/repo/contents/docs/readme.md",
    );
  });

  it("normalises encoded names instead of forwarding them raw", () => {
    expect(parseGithubApiPath("GET", "/repos/own%65r/re%70o")).toBe("/repos/owner/repo");
    expect(parseGithubApiPath("PUT", "/repos/owner/repo/contents/a%20b.md")).toBe(
      "/repos/owner/repo/contents/a%20b.md",
    );
  });

  it("refuses anything outside the import and sync surface", () => {
    for (const path of [
      "/",
      "/graphql",
      "/orgs/owner/repos",
      "/search/code",
      "/repos/owner/repo/issues",
      "/repos/owner/repo/git/blobs/abc",
      "/repos/owner/repo/git/trees",
      "/repos/owner/repo/contents",
      "/user/emails",
      "/user/repos/extra",
    ]) {
      expect(parseGithubApiPath("GET", path)).toBeNull();
    }
    expect(parseGithubApiPath("PUT", "/repos/owner/repo")).toBeNull();
    expect(parseGithubApiPath("PUT", "/user")).toBeNull();
  });

  it("refuses traversal and malformed paths", () => {
    for (const path of [
      "repos/owner/repo",
      "//api.github.com/user",
      "/repos/owner/repo/contents/../secret",
      "/repos/owner/repo/contents/%2e%2e/%2e%2e/secret",
      "/repos/owner/repo/contents/a%2Fb",
      "/repos/owner/repo/contents/%00",
      "/repos/owner/repo#fragment",
      "/repos/owner/repo?x=%0a",
      "/repos//repo",
      `/repos/${"a".repeat(101)}/repo`,
    ]) {
      expect(parseGithubApiPath("GET", path)).toBeNull();
    }
  });
});

describe("authorization-code flow", () => {
  it("builds a callback URL GitHub can approve", () => {
    const url = new URL(
      buildGithubAuthorizeUrl({
        clientId: "client-1",
        redirectUri: "https://lattice.example.com/api/github/callback",
        state: "state-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://lattice.example.com/api/github/callback",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["read:user", "repo"]);
  });

  it("exchanges the code without exposing the secret", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () =>
        json({ access_token: "token-1", token_type: "bearer", scope: "repo,read:user" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await exchangeGithubCode({
        clientId: "client-1",
        clientSecret: "secret-1",
        code: "code-1",
        redirectUri: "https://lattice.example.com/api/github/callback",
      }),
    ).toEqual({ accessToken: "token-1", tokenType: "bearer", scopes: ["repo", "read:user"] });

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("client_secret=secret-1");
    expect(body).toContain("code=code-1");
  });

  it("reports a refused exchange", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: "bad_verification_code", error_description: "The code expired." }),
      ),
    );
    await expect(
      exchangeGithubCode({
        clientId: "client-1",
        clientSecret: "secret-1",
        code: "code-1",
        redirectUri: "https://lattice.example.com/api/github/callback",
      }),
    ).rejects.toMatchObject({ code: "bad_verification_code", message: "The code expired." });
  });
});

describe("device flow", () => {
  it("starts a flow and clamps GitHub's timing values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          device_code: "device-1",
          user_code: "ABCD-1234",
          verification_uri: "https://github.com/login/device",
          expires_in: 900,
          interval: 5,
        }),
      ),
    );
    expect(await startGithubDeviceFlow("client-1")).toEqual({
      deviceCode: "device-1",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });
  });

  it("refuses a start response without a device code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "invalid_client" }, 400)),
    );
    await expect(startGithubDeviceFlow("client-1")).rejects.toBeInstanceOf(GithubError);
  });

  it("turns an unreachable GitHub into a readable error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(startGithubDeviceFlow("client-1")).rejects.toMatchObject({
      code: "network_failed",
      message: "GitHub could not be reached. Try again.",
    });
    await expect(fetchGithubIdentity("token-1")).rejects.toMatchObject({
      code: "network_failed",
    });
  });

  it("maps every polling outcome", async () => {
    const poll = async (body: Record<string, unknown>) => {
      vi.stubGlobal("fetch", vi.fn(async () => json(body)));
      return pollGithubDeviceFlow({ clientId: "client-1", deviceCode: "device-1" });
    };

    expect(
      await poll({ access_token: "token-1", token_type: "bearer", scope: "repo read:user" }),
    ).toEqual({
      status: "connected",
      accessToken: "token-1",
      tokenType: "bearer",
      scopes: ["repo", "read:user"],
    });
    expect(await poll({ error: "authorization_pending" })).toEqual({
      status: "pending",
      interval: 5,
    });
    expect(await poll({ error: "slow_down" })).toEqual({ status: "pending", interval: 10 });
    expect(await poll({ error: "expired_token" })).toEqual({ status: "expired" });
    expect(await poll({ error: "access_denied" })).toEqual({ status: "denied" });
    expect(await poll({ error: "incorrect_device_code", error_description: "Bad code." })).toEqual({
      status: "error",
      message: "Bad code.",
    });
  });

  it("identifies the account behind the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ id: 7, login: "octocat", name: "The Octocat", avatar_url: "https://example.com/a.png" }),
      ),
    );
    expect(await fetchGithubIdentity("token-1")).toEqual({
      id: 7,
      login: "octocat",
      name: "The Octocat",
      avatarUrl: "https://example.com/a.png",
    });
  });

  it("reports a rejected identity request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Bad credentials" }, 401)));
    await expect(fetchGithubIdentity("token-1")).rejects.toMatchObject({ code: "identity_failed" });
  });
});

describe("proxied API request", () => {
  it("sends the stored token and parses the body", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () =>
        json({ tree: [] }, 200),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await githubApiRequest({
      accessToken: "token-1",
      method: "GET",
      path: "/repos/owner/repo",
    });

    expect(result).toEqual({ status: 200, body: { tree: [] }, rateRemaining: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/owner/repo");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-1");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("keeps a non-JSON error body readable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("server exploded", { status: 502 })),
    );
    expect(
      await githubApiRequest({ accessToken: "token-1", method: "GET", path: "/user" }),
    ).toMatchObject({ status: 502, body: "server exploded" });
  });
});
