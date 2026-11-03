import { describe, expect, it } from "vitest";

import {
  decodeBase64Utf8,
  encodeBase64Utf8,
  hashContent,
  isSyncedToRepo,
  markdownPathForTitle,
  planGitSync,
  readGitProperties,
} from "./git-sync";

const synced = (overrides: Partial<Parameters<typeof planGitSync>[0]> = {}) => ({
  remoteSha: "sha-a",
  recordedRemoteSha: "sha-a",
  localHash: "local-hash",
  recordedLocalHash: "local-hash",
  ...overrides,
});

describe("planGitSync", () => {
  it("reports a clean row as in sync", () => {
    expect(planGitSync(synced()).action).toBe("in-sync");
  });

  it("pushes when only the local side moved", () => {
    expect(planGitSync(synced({ localHash: "local-hash-2" })).action).toBe("push");
  });

  it("pulls when only the remote side moved", () => {
    expect(planGitSync(synced({ remoteSha: "sha-b" })).action).toBe("pull");
  });

  it("conflicts when both sides moved", () => {
    const decision = planGitSync(synced({ remoteSha: "sha-b", localHash: "local-hash-2" }));
    expect(decision.action).toBe("conflict");
    expect(decision.reason).toContain("both places");
  });

  it("publishes a page that has never been synced", () => {
    const decision = planGitSync({
      remoteSha: null,
      recordedRemoteSha: null,
      localHash: "local-hash",
      recordedLocalHash: null,
    });
    expect(decision.action).toBe("publish");
  });

  it("reports a file deleted remotely instead of deleting the page", () => {
    const decision = planGitSync(synced({ remoteSha: null }));
    expect(decision.action).toBe("remote-missing");
    expect(decision.reason).toContain("Deleted on the remote");
  });

  it("conflicts when a remote file exists with no record of agreeing on it", () => {
    const decision = planGitSync({
      remoteSha: "sha-a",
      recordedRemoteSha: null,
      localHash: "local-hash",
      recordedLocalHash: null,
    });
    expect(decision.action).toBe("conflict");
    expect(decision.reason).toContain("no sync record");
  });

  it("treats a first sync with no recorded local hash as a local change", () => {
    expect(planGitSync(synced({ recordedLocalHash: null })).action).toBe("push");
  });
});

describe("hashContent", () => {
  it("is stable for identical text and different for an edit", () => {
    expect(hashContent("# Title\n\nBody")).toBe(hashContent("# Title\n\nBody"));
    expect(hashContent("# Title\n\nBody")).not.toBe(hashContent("# Title\n\nBody!"));
  });

  it("distinguishes an empty body from null-ish input", () => {
    expect(hashContent("")).toMatch(/^[0-9a-f]{8}:0$/);
  });

  it("notices a change that only affects length", () => {
    expect(hashContent("abcdefghij")).not.toBe(hashContent("abcd"));
  });
});

describe("base64 round trips", () => {
  it("handles multi-byte characters", () => {
    const text = "Emoji 🧠 and accents éü — plus 日本語";
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it("matches the known encoding of a simple string", () => {
    expect(encodeBase64Utf8("hello")).toBe("aGVsbG8=");
  });
});

describe("markdownPathForTitle", () => {
  it("slugifies a title", () => {
    expect(markdownPathForTitle("On CRDTs & Consensus!")).toBe("on-crdts-consensus.md");
  });

  it("honours a path prefix", () => {
    expect(markdownPathForTitle("Notes", "docs/guides/")).toBe("docs/guides/notes.md");
  });

  it("falls back for a title with nothing usable", () => {
    expect(markdownPathForTitle("!!!")).toBe("untitled.md");
  });
});

describe("git properties", () => {
  it("reads the bookkeeping a synced page carries", () => {
    expect(
      readGitProperties({ source: "github", repo: "a/b", path: "x.md", remoteSha: "s", localHash: "h" }),
    ).toEqual({ source: "github", repo: "a/b", branch: undefined, path: "x.md", remoteSha: "s", localHash: "h" });
  });

  it("tolerates junk", () => {
    expect(readGitProperties(null)).toEqual({});
    expect(readGitProperties([1, 2])).toEqual({});
    expect(readGitProperties({ path: 42 })).toEqual({
      source: undefined,
      repo: undefined,
      branch: undefined,
      path: undefined,
      remoteSha: undefined,
      localHash: undefined,
    });
  });

  it("only claims pages bound to the repo being synced", () => {
    const properties = { source: "github", repo: "owner/repo", path: "a.md" };
    expect(isSyncedToRepo(properties, "owner/repo")).toBe(true);
    expect(isSyncedToRepo(properties, "OWNER/REPO")).toBe(true);
    expect(isSyncedToRepo(properties, "owner/other")).toBe(false);
    expect(isSyncedToRepo({ source: "vault", repo: "owner/repo", path: "a.md" }, "owner/repo")).toBe(false);
    expect(isSyncedToRepo({ source: "github", repo: "owner/repo" }, "owner/repo")).toBe(false);
  });
});
