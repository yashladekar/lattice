import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../test/helpers";
import { hashToken } from "./authz";
import { createScimRouter } from "./scim-router";

/**
 * The SCIM surface as an identity provider sees it: bearer token, Users and
 * Groups, filters, deactivation, and the ownership guards. The router is mounted
 * on a throwaway listener so the HTTP shape is exercised, not just the helpers.
 */
describeWithDatabase("scim http surface", () => {
  let db: Database;
  let workspace: TestWorkspace;
  let server: Server;
  let base = "";
  let token = "";
  const provisionedEmail = `itest-scim-${randomUUID()}@example.com`;

  const scim = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });

  const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    token = `scim_itest_${randomUUID()}`;
    await db.scimToken.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        name: "Integration test",
        tokenHash: hashToken(token),
        createdById: workspace.ownerId,
      },
    });

    const app = express();
    app.use("/scim/v2", createScimRouter(db, { baseUrl: "http://localhost:3999" }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    base = `http://127.0.0.1:${port}/scim/v2`;
  });

  afterAll(async () => {
    const user = await db.user.findUnique({ where: { email: provisionedEmail } });
    if (user) {
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.account.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await cleanupTestWorkspace(db, workspace.id);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.$disconnect();
  });

  it("rejects missing and unknown bearer tokens", async () => {
    const missing = await fetch(`${base}/Users`);
    expect(missing.status).toBe(401);
    const unknown = await fetch(`${base}/Users`, {
      headers: { authorization: "Bearer scim_not_a_token" },
    });
    expect(unknown.status).toBe(401);
  });

  let memberId = "";

  it("provisions a user and reports duplicate provisioning", async () => {
    const created = await scim("/Users", {
      method: "POST",
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: provisionedEmail,
        externalId: "ext-qa-1",
        displayName: "SCIM User",
        active: true,
        roles: [{ value: "editor" }],
      }),
    });
    expect(created.status).toBe(201);
    const body = await json(created);
    memberId = String(body.id);
    expect(body.userName).toBe(provisionedEmail);
    expect(body.externalId).toBe("ext-qa-1");
    expect(body.active).toBe(true);
    expect((body.roles as Array<{ value: string }>)[0]?.value).toBe("EDITOR");

    const member = await db.workspaceMember.findUnique({ where: { id: memberId } });
    expect(member?.role).toBe("EDITOR");
    expect(member?.externalId).toBe("ext-qa-1");
    const user = await db.user.findUnique({ where: { email: provisionedEmail } });
    expect(user?.emailVerified).toBe(false);
    expect(await db.account.count({ where: { userId: user!.id } })).toBe(0);

    const duplicate = await scim("/Users", {
      method: "POST",
      body: JSON.stringify({ userName: provisionedEmail }),
    });
    expect(duplicate.status).toBe(409);
    expect((await json(duplicate)).scimType).toBe("uniqueness");
  });

  it("filters by userName and rejects unsupported filters", async () => {
    const filtered = await scim(
      `/Users?filter=${encodeURIComponent(`userName eq "${provisionedEmail}"`)}`,
    );
    expect(filtered.status).toBe(200);
    expect((await json(filtered)).totalResults).toBe(1);

    const unsupported = await scim(`/Users?filter=${encodeURIComponent('userName sw "it"')}`);
    expect(unsupported.status).toBe(400);
  });

  it("deactivates a member with a PATCH and reactivates with another", async () => {
    const off = await scim(`/Users/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      }),
    });
    expect(off.status).toBe(200);
    expect((await json(off)).active).toBe(false);
    expect((await db.workspaceMember.findUnique({ where: { id: memberId } }))?.status).toBe(
      "SUSPENDED",
    );

    const on = await scim(`/Users/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ Operations: [{ op: "replace", value: { active: true } }] }),
    });
    expect((await json(on)).active).toBe(true);
  });

  it("refuses to change a login email from SCIM", async () => {
    const changed = `scim-changed-${randomUUID()}@example.com`;
    const response = await scim(`/Users/${memberId}`, {
      method: "PUT",
      body: JSON.stringify({ userName: changed, active: true }),
    });
    expect(response.status).toBe(400);
    expect((await json(response)).scimType).toBe("mutability");
    expect(await db.user.findUnique({ where: { email: provisionedEmail } })).not.toBeNull();
  });

  it("does not rename a user who belongs to another workspace", async () => {
    const other = await createTestWorkspace(db);
    const user = await db.user.findUnique({ where: { email: provisionedEmail } });
    await db.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: other.id,
        userId: user!.id,
        role: "VIEWER",
        status: "ACTIVE",
      },
    });
    const response = await scim(`/Users/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({
        Operations: [{ op: "replace", path: "displayName", value: "Renamed Elsewhere" }],
      }),
    });
    expect(response.status).toBe(200);
    const after = await db.user.findUnique({ where: { email: provisionedEmail } });
    expect(after?.name).toBe("SCIM User");
    await cleanupTestWorkspace(db, other.id);
  });

  it("applies a group's role to members and leaves it on removal", async () => {
    const created = await scim("/Groups", {
      method: "POST",
      body: JSON.stringify({
        displayName: "lattice-admins",
        members: [{ value: memberId }],
      }),
    });
    expect(created.status).toBe(201);
    const group = await json(created);
    expect(
      (group["urn:lattice:scim:1.0:Group"] as { role: string } | undefined)?.role,
    ).toBe("ADMIN");
    expect((await db.workspaceMember.findUnique({ where: { id: memberId } }))?.role).toBe("ADMIN");

    const removed = await scim(`/Groups/${String(group.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        Operations: [{ op: "remove", path: `members[value eq "${memberId}"]` }],
      }),
    });
    expect(removed.status).toBe(200);
    expect((await json(removed)).members).toEqual([]);
    expect((await db.workspaceMember.findUnique({ where: { id: memberId } }))?.role).toBe("ADMIN");
  });

  it("refuses to deprovision the workspace owner", async () => {
    const owner = await db.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, userId: workspace.ownerId },
    });
    const response = await scim(`/Users/${owner!.id}`, { method: "DELETE" });
    expect(response.status).toBe(403);
  });

  it("deprovisions a member and stops accepting its token when revoked", async () => {
    const deleted = await scim(`/Users/${memberId}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    const gone = await scim(`/Users/${memberId}`);
    expect(gone.status).toBe(404);
    expect((await db.workspaceMember.findUnique({ where: { id: memberId } }))?.deletedAt).not.toBeNull();

    await db.scimToken.updateMany({
      where: { workspaceId: workspace.id },
      data: { revokedAt: new Date() },
    });
    const revoked = await scim("/Users");
    expect(revoked.status).toBe(401);
  });
});
