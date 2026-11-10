import { afterEach, expect, it, vi } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { CHATGPT_PLAN_SCOPE, type ChatGptIdentity, type ChatGptTokenSet } from "../ai/chatgpt";
import {
  chatGptAccessToken,
  getUserChatGptConnection,
  storeChatGptConnection,
} from "./chatgpt-connection";

const keyMaterial = "integration-test-key-material";
const clientId = "oaiapp_test";
const hostId = "urn:uuid:22222222-2222-4222-8222-222222222222";

const identity: ChatGptIdentity = {
  subject: "openai-subject",
  email: "person@example.com",
  emailVerified: true,
  name: "Person",
};

function tokens(overrides: Partial<ChatGptTokenSet> = {}): ChatGptTokenSet {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    idToken: "id-token",
    tokenType: "Bearer",
    expiresIn: 3_600,
    scopes: ["openid", CHATGPT_PLAN_SCOPE],
    earliestRefreshAt: null,
    ...overrides,
  };
}

function tokenResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      token_type: "Bearer",
      expires_in: 3_600,
      scope: `openid ${CHATGPT_PLAN_SCOPE}`,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describeWithDatabase("ChatGPT credential store", () => {
  let db: Database;
  let workspace: TestWorkspace;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (!workspace) return;
    await db.chatGptConnection.deleteMany({ where: { userId: workspace.ownerId } });
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  const setup = async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  };

  const store = (overrides: { identity?: ChatGptIdentity; tokens?: ChatGptTokenSet } = {}) =>
    storeChatGptConnection({
      db,
      userId: workspace.ownerId,
      clientId,
      hostId,
      tokens: overrides.tokens ?? tokens(),
      identity: overrides.identity ?? identity,
      keyMaterial,
      model: "gpt-test",
    });

  it("encrypts every token at rest", async () => {
    await setup();
    await store();
    const row = await db.chatGptConnection.findFirstOrThrow({
      where: { userId: workspace.ownerId },
    });
    for (const value of [row.accessToken, row.refreshToken, row.idToken]) {
      expect(value.startsWith("v1.")).toBe(true);
      expect(value).not.toContain("access-token");
      expect(value).not.toContain("refresh-token");
      expect(value).not.toContain("id-token");
    }
    expect(row.planEnabled).toBe(true);
    expect(row.email).toBe("person@example.com");
  });

  it("returns the stored access token before it nears expiry", async () => {
    await setup();
    await store();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const row = await getUserChatGptConnection(db, workspace.ownerId);
    expect(await chatGptAccessToken(db, row!, keyMaterial)).toBe("access-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes and rotates the refresh token near expiry", async () => {
    await setup();
    await store();
    await db.chatGptConnection.updateMany({
      where: { userId: workspace.ownerId },
      data: { accessExpiresAt: new Date(Date.now() - 1_000) },
    });
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () => tokenResponse(),
    );
    vi.stubGlobal("fetch", fetchMock);

    const row = await getUserChatGptConnection(db, workspace.ownerId);
    expect(await chatGptAccessToken(db, row!, keyMaterial)).toBe("rotated-access");

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain(`client_id=${clientId}`);
    expect(body).toContain("resource=https%3A%2F%2Fapi.openai.com%2Fv1");

    const refreshed = await getUserChatGptConnection(db, workspace.ownerId);
    expect(await chatGptAccessToken(db, refreshed!, keyMaterial)).toBe("rotated-access");
    expect(refreshed?.lastError).toBeNull();
  });

  it("clears unusable tokens but keeps the registration after a terminal refresh error", async () => {
    await setup();
    await store();
    await db.chatGptConnection.updateMany({
      where: { userId: workspace.ownerId },
      data: { accessExpiresAt: new Date(Date.now() - 1_000) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const row = await getUserChatGptConnection(db, workspace.ownerId);
    expect(await chatGptAccessToken(db, row!, keyMaterial)).toBeNull();

    const after = await getUserChatGptConnection(db, workspace.ownerId);
    expect(after?.accessToken).toBe("");
    expect(after?.refreshToken).toBe("");
    expect(after?.lastError).toBe("invalid_grant");
    expect(after?.clientId).toBe(clientId);
    expect(after?.subject).toBe("openai-subject");
  });

  it("keeps credentials when the refresh endpoint is temporarily unavailable", async () => {
    await setup();
    await store();
    await db.chatGptConnection.updateMany({
      where: { userId: workspace.ownerId },
      data: { accessExpiresAt: new Date(Date.now() - 1_000) },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    const row = await getUserChatGptConnection(db, workspace.ownerId);
    expect(await chatGptAccessToken(db, row!, keyMaterial)).toBeNull();

    const after = await getUserChatGptConnection(db, workspace.ownerId);
    expect(after?.refreshToken).not.toBe("");
    expect(after?.lastError).toBe("http_503");
  });

  it("refuses to reuse a registration for a different ChatGPT account", async () => {
    await setup();
    await store();
    await expect(
      store({
        identity: { ...identity, subject: "someone-else" },
      }),
    ).rejects.toThrow(/different account/);
  });

  it("writes one row per user and client id", async () => {
    await setup();
    await store();
    await store({ tokens: tokens({ accessToken: "second" }) });
    expect(await db.chatGptConnection.count({ where: { userId: workspace.ownerId } })).toBe(1);
    const row = await getUserChatGptConnection(db, workspace.ownerId);
    expect(await chatGptAccessToken(db, row!, keyMaterial)).toBe("second");
  });
});
