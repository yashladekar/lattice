import { randomUUID } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { afterEach, expect, it } from "vitest";

import { createTestDatabase, describeWithDatabase } from "../../test/helpers";
import {
  decryptGithubAccessToken,
  getUserGithubConnection,
  storeGithubConnection,
} from "./github-connection";

const keyMaterial = "integration-test-key-material";

const identity = {
  id: 7,
  login: "octocat",
  name: "The Octocat",
  avatarUrl: "https://example.com/a.png",
};

describeWithDatabase("GitHub credential store", () => {
  let db: Database;
  const userId = `itest_github_${randomUUID()}`;

  afterEach(async () => {
    if (!db) return;
    await db.githubConnection.deleteMany({ where: { userId } });
    await db.githubLoginState.deleteMany({ where: { userId } });
    await db.$disconnect();
  });

  const store = (accessToken = "github-token") =>
    storeGithubConnection({
      db,
      userId,
      identity,
      tokens: { accessToken, tokenType: "bearer", scopes: ["repo", "read:user"] },
      keyMaterial,
    });

  it("encrypts the token at rest and keeps the account readable", async () => {
    db = createTestDatabase();
    await store();

    const row = await db.githubConnection.findUniqueOrThrow({ where: { userId } });
    expect(row.accessToken.startsWith("v1.")).toBe(true);
    expect(row.accessToken).not.toContain("github-token");
    expect(row.login).toBe("octocat");
    expect(row.scopes).toEqual(["repo", "read:user"]);

    const connection = await getUserGithubConnection(db, userId);
    expect(decryptGithubAccessToken(connection!, keyMaterial)).toBe("github-token");
  });

  it("replaces the token for the same person instead of adding a row", async () => {
    db = createTestDatabase();
    await store();
    await store("second-token");

    expect(await db.githubConnection.count({ where: { userId } })).toBe(1);
    const connection = await getUserGithubConnection(db, userId);
    expect(decryptGithubAccessToken(connection!, keyMaterial)).toBe("second-token");
  });

  it("returns null instead of throwing for an unreadable ciphertext", async () => {
    db = createTestDatabase();
    await store();
    await db.githubConnection.update({
      where: { userId },
      data: { accessToken: "v1.broken" },
    });
    const connection = await getUserGithubConnection(db, userId);
    expect(decryptGithubAccessToken(connection!, keyMaterial)).toBeNull();
  });
});
