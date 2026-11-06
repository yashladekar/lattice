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
import { hashToken } from "../authz";
import { ingestEmail } from "./ingest-email";

describeWithDatabase("email ingestion", () => {
  let db: Database;
  let workspace: TestWorkspace;
  const token = `ingest_itest_${randomUUID()}`;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    await db.workspaceIngestToken.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        tokenHash: hashToken(token),
        createdById: workspace.ownerId,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("refuses missing or unknown tokens", async () => {
    expect((await ingestEmail(db, { token: "", body: {} })).status).toBe(401);
    expect((await ingestEmail(db, { token: "ingest_nope", body: {} })).status).toBe(401);
  });

  it("stores a message as an inbox capture", async () => {
    const result = await ingestEmail(db, {
      token,
      body: { subject: "Reading list", text: "Two articles worth keeping.", from: "ada@example.com" },
    });
    expect(result.status).toBe(202);
    if (result.status !== 202) throw new Error("expected a capture");
    const capture = await db.capture.findUnique({ where: { id: result.captureId } });
    expect(capture?.type).toBe("EMAIL");
    expect(capture?.status).toBe("INBOX");
    expect(capture?.title).toBe("Reading list");
    expect(capture?.content).toContain("Two articles worth keeping");
    const change = await db.syncChange.findFirst({
      where: { workspaceId: workspace.id, entity: "capture", entityId: result.captureId },
    });
    expect(change).toBeTruthy();
  });

  it("refuses a message with nothing to capture", async () => {
    const result = await ingestEmail(db, { token, body: { subject: "" } });
    expect(result.status).toBe(400);
  });

  it("refuses a revoked token", async () => {
    await db.workspaceIngestToken.updateMany({
      where: { workspaceId: workspace.id },
      data: { revokedAt: new Date() },
    });
    expect((await ingestEmail(db, { token, body: { text: "hi" } })).status).toBe(401);
  });
});
