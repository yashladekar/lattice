import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { buildLegalExport } from "./legal-export";

describeWithDatabase("legal export bundle", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const secret = "sso-client-secret-do-not-export";
  const webhookSecret = "whsec_do_not_export";
  const scimTokenHash = "scimtokenhash_do_not_export";

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.page.create({
      data: {
        id: `itest_export_page_${workspace.id}`,
        workspaceId: workspace.id,
        title: "Deleted but preserved",
        createdById: workspace.ownerId,
        deletedAt: new Date(),
      },
    });
    await db.auditLog.create({
      data: {
        id: `audit_${randomUUID()}`,
        workspaceId: workspace.id,
        actorId: workspace.ownerId,
        action: "legal_export.created",
        resourceType: "workspace",
        resourceId: workspace.id,
      },
    });
    await db.ssoConnection.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        issuer: "https://idp.example.com",
        clientId: "client-id",
        clientSecret: secret,
        domains: ["example.com"],
        createdById: workspace.ownerId,
      },
    });
    await db.webhookEndpoint.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        name: "Export test",
        url: "https://hooks.example.com/lattice",
        secret: webhookSecret,
        createdById: workspace.ownerId,
      },
    });
    await db.scimToken.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        name: "Export test",
        tokenHash: scimTokenHash,
        createdById: workspace.ownerId,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("includes soft-deleted rows and the audit log", async () => {
    const bundle = await buildLegalExport(db, workspace.id);
    const pages = bundle.data.pages as Array<{ title: string; deletedAt: string | null }>;
    expect(pages.some((page) => page.title === "Deleted but preserved")).toBe(true);
    expect(pages.find((page) => page.title === "Deleted but preserved")?.deletedAt).not.toBeNull();
    expect(bundle.counts.auditLog).toBeGreaterThan(0);
    expect(bundle.truncated).toEqual([]);
  });

  it("never includes credentials or token hashes", async () => {
    const bundle = await buildLegalExport(db, workspace.id);
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(webhookSecret);
    expect(serialized).not.toContain(scimTokenHash);
    expect(bundle.data).not.toHaveProperty("webhookEndpoints");
    expect(bundle.data).not.toHaveProperty("ssoConnections");
    expect(bundle.data).not.toHaveProperty("scimTokens");
  });

  it("reports counts for every section", async () => {
    const bundle = await buildLegalExport(db, workspace.id);
    expect(bundle.workspaceId).toBe(workspace.id);
    expect(bundle.counts.workspace).toBe(1);
    expect(bundle.counts.pages).toBeGreaterThanOrEqual(1);
    expect(bundle.generatedAt).toBeTruthy();
  });
});

describeWithDatabase("legal export caps", () => {
  let db: Database;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.page.createMany({
      data: [1, 2, 3].map((index) => ({
        id: `itest_cap_${index}_${workspace.id}`,
        workspaceId: workspace.id,
        title: `Page ${index}`,
        createdById: workspace.ownerId,
      })),
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("truncates a capped list and says so", async () => {
    const bundle = await buildLegalExport(db, workspace.id, { caps: { pages: 1 } });
    expect((bundle.data.pages as unknown[]).length).toBe(1);
    expect(bundle.truncated).toContain("pages");
  });

  it("leaves the bundle untruncated under the default caps", async () => {
    const bundle = await buildLegalExport(db, workspace.id);
    expect((bundle.data.pages as unknown[]).length).toBe(3);
    expect(bundle.truncated).toEqual([]);
  });
});
