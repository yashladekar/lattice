import { randomUUID } from "node:crypto";

import { afterEach, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";
import { encryptAiKey } from "@notes-learning/auth";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { resolveAiConfig } from "./ai-config";

const deployment = {
  baseUrl: "https://deployment.example.com/v1",
  apiKey: "deployment-key",
  model: "deployment-model",
};
const keyMaterial = "integration-test-key-material";

describeWithDatabase("workspace AI config resolution", () => {
  let db: Database;
  let workspace: TestWorkspace;

  afterEach(async () => {
    if (!workspace) return;
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  const setup = async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  };

  it("falls back to the deployment config when the workspace has none", async () => {
    await setup();
    const resolved = await resolveAiConfig(db, workspace.id, deployment, keyMaterial);
    expect(resolved.source).toBe("deployment");
    expect(resolved.config?.apiKey).toBe("deployment-key");
  });

  it("prefers a workspace key and decrypts it", async () => {
    await setup();
    await db.workspaceAiConfig.create({
      data: {
        workspaceId: workspace.id,
        baseUrl: "https://workspace.example.com/v1",
        apiKey: encryptAiKey("workspace-key", keyMaterial),
        model: "workspace-model",
        embeddingModel: "workspace-embed",
        updatedById: workspace.ownerId,
      },
    });
    const resolved = await resolveAiConfig(db, workspace.id, deployment, keyMaterial);
    expect(resolved.source).toBe("workspace");
    expect(resolved.config).toEqual({
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
    const resolved = await resolveAiConfig(db, workspace.id, deployment, keyMaterial);
    expect(resolved.source).toBe("deployment");
    expect(resolved.config?.apiKey).toBe("deployment-key");
  });

  it("needs key material to decrypt, and falls back without it", async () => {
    await setup();
    await db.workspaceAiConfig.create({
      data: {
        workspaceId: workspace.id,
        baseUrl: "https://workspace.example.com/v1",
        apiKey: encryptAiKey("workspace-key", keyMaterial),
        model: "workspace-model",
        updatedById: workspace.ownerId,
      },
    });
    const resolved = await resolveAiConfig(db, workspace.id, deployment, undefined);
    expect(resolved.source).toBe("deployment");
  });

  it("reports no source when there is neither workspace nor deployment config", async () => {
    await setup();
    const resolved = await resolveAiConfig(db, workspace.id, null, keyMaterial);
    expect(resolved.source).toBe("none");
    expect(resolved.config).toBeNull();
  });
});
