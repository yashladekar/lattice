import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import { encryptAiKey, encryptChatGptToken } from "@notes-learning/auth";
import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { CHATGPT_PLAN_SCOPE } from "../ai/chatgpt";
import { resolveAiConfig } from "./ai-config";

const deployment = {
  baseUrl: "https://deployment.example.com/v1",
  apiKey: "deployment-key",
  model: "deployment-model",
};
const keyMaterial = "integration-test-key-material";
const CHATGPT_MODEL = "gpt-test-sol";

describeWithDatabase("workspace AI config resolution", () => {
  let db: Database;
  let workspace: TestWorkspace;

  afterEach(async () => {
    if (!workspace) return;
    await db.chatGptConnection.deleteMany({ where: { userId: workspace.ownerId } });
    await db.userAiPreference.deleteMany({ where: { userId: workspace.ownerId } });
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  const setup = async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  };

  const resolve = () =>
    resolveAiConfig(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      deployment,
      keyMaterial,
    });

  const addWorkspaceKey = () =>
    db.workspaceAiConfig.create({
      data: {
        workspaceId: workspace.id,
        baseUrl: "https://workspace.example.com/v1",
        apiKey: encryptAiKey("workspace-key", keyMaterial),
        model: "workspace-model",
        embeddingModel: "workspace-embed",
        updatedById: workspace.ownerId,
      },
    });

  const addChatGptConnection = (options: { planEnabled?: boolean; model?: string | null } = {}) =>
    db.chatGptConnection.create({
      data: {
        id: randomUUID(),
        userId: workspace.ownerId,
        clientId: "oaiapp_test",
        hostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
        subject: "openai-subject",
        email: "person@example.com",
        name: "Person",
        idToken: encryptChatGptToken("id-token", keyMaterial),
        accessToken: encryptChatGptToken("access-token", keyMaterial),
        refreshToken: encryptChatGptToken("refresh-token", keyMaterial),
        scopes: [CHATGPT_PLAN_SCOPE],
        accessExpiresAt: new Date(Date.now() + 3_600_000),
        model: options.model === undefined ? CHATGPT_MODEL : options.model,
        planEnabled: options.planEnabled ?? true,
      },
    });

  const setPreference = (chatSource: string) =>
    db.userAiPreference.create({
      data: { id: randomUUID(), userId: workspace.ownerId, workspaceId: workspace.id, chatSource },
    });

  it("falls back to the deployment config when the workspace has none", async () => {
    await setup();
    const resolved = await resolve();
    expect(resolved.source).toBe("deployment");
    expect(resolved.chat?.apiKey).toBe("deployment-key");
    expect(resolved.aux?.apiKey).toBe("deployment-key");
  });

  it("prefers a workspace key and decrypts it", async () => {
    await setup();
    await addWorkspaceKey();
    const resolved = await resolve();
    expect(resolved.source).toBe("workspace");
    expect(resolved.chat).toEqual({
      baseUrl: "https://workspace.example.com/v1",
      apiKey: "workspace-key",
      model: "workspace-model",
      embeddingModel: "workspace-embed",
    });
  });

  it("falls back instead of breaking when the ciphertext cannot be read", async () => {
    await setup();
    await db.workspaceAiConfig.create({
      data: {
        workspaceId: workspace.id,
        baseUrl: "https://workspace.example.com/v1",
        apiKey: `v1.${Buffer.from(randomUUID()).toString("base64url")}`,
        model: "workspace-model",
        updatedById: workspace.ownerId,
      },
    });
    const resolved = await resolve();
    expect(resolved.source).toBe("deployment");
    expect(resolved.chat?.apiKey).toBe("deployment-key");
  });

  it("needs key material to decrypt, and falls back without it", async () => {
    await setup();
    await addWorkspaceKey();
    const resolved = await resolveAiConfig(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      deployment,
    });
    expect(resolved.source).toBe("deployment");
  });

  it("reports no source when there is neither workspace nor deployment config", async () => {
    await setup();
    const resolved = await resolveAiConfig(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      deployment: null,
      keyMaterial,
    });
    expect(resolved.source).toBe("none");
    expect(resolved.chat).toBeNull();
    expect(resolved.aux).toBeNull();
  });

  it("puts the user's ChatGPT plan ahead of both key sources by default", async () => {
    await setup();
    await addWorkspaceKey();
    await addChatGptConnection();
    const resolved = await resolve();
    expect(resolved.source).toBe("chatgpt");
    expect(resolved.chat).toMatchObject({
      baseUrl: "https://api.openai.com/v1",
      apiKey: "access-token",
      model: CHATGPT_MODEL,
      auth: "chatgpt",
    });
    expect(resolved.chatgpt).toMatchObject({
      connected: true,
      email: "person@example.com",
      planEnabled: true,
    });
    expect(resolved.degradedReason).toBeNull();
  });

  it("never uses the ChatGPT plan for embeddings or transcription", async () => {
    await setup();
    await addWorkspaceKey();
    await addChatGptConnection();
    const resolved = await resolve();
    expect(resolved.source).toBe("chatgpt");
    expect(resolved.aux).toMatchObject({
      baseUrl: "https://workspace.example.com/v1",
      apiKey: "workspace-key",
    });
    expect(resolved.aux?.auth).toBeUndefined();
  });

  it("leaves aux empty when only a ChatGPT plan is connected", async () => {
    await setup();
    await addChatGptConnection();
    const resolved = await resolveAiConfig(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      deployment: null,
      keyMaterial,
    });
    expect(resolved.source).toBe("chatgpt");
    expect(resolved.aux).toBeNull();
  });

  it("honours an explicit workspace preference over a connected plan", async () => {
    await setup();
    await addWorkspaceKey();
    await addChatGptConnection();
    await setPreference("workspace");
    const resolved = await resolve();
    expect(resolved.source).toBe("workspace");
    expect(resolved.chat?.apiKey).toBe("workspace-key");
  });

  it("keeps a sign-in without plan permission out of the chat path", async () => {
    await setup();
    await addWorkspaceKey();
    await addChatGptConnection({ planEnabled: false });
    const resolved = await resolve();
    expect(resolved.source).toBe("workspace");
    expect(resolved.chatgpt).toMatchObject({ connected: true, planEnabled: false });
  });

  it("explains why a preferred ChatGPT plan is not in use", async () => {
    await setup();
    await addWorkspaceKey();
    await setPreference("chatgpt");
    const resolved = await resolve();
    expect(resolved.source).toBe("workspace");
    expect(resolved.degradedReason).toBe("ChatGPT plan isn't connected for this account.");
  });

  it("needs a chosen model before the plan can serve chat", async () => {
    await setup();
    await addWorkspaceKey();
    await addChatGptConnection({ model: null });
    const resolved = await resolve();
    expect(resolved.source).toBe("workspace");
  });
});
