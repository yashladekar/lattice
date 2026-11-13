import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, it } from "vitest";

import type { Database } from "@notes-learning/db";
import { createAuth } from "@notes-learning/auth";
import { encryptSsoSecret } from "@notes-learning/auth";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { startFakeIdp, type FakeIdp } from "../../test/fake-idp";

/**
 * Drives the real better-auth endpoints: start, authorize (fake IdP), callback,
 * then a session lookup with the cookie the callback set. No HTTP listener for
 * the app itself — `auth.handler` takes a Request and returns a Response.
 */
const APP_ORIGIN = "http://localhost:3101";
const AUTH_BASE = "http://localhost:3999/api/auth";
const PROVISIONED_EMAIL = `sso-${randomUUID()}@example.com`;
const STRANGER_EMAIL = `stranger-${randomUUID()}@example.com`;

describeWithDatabase("sso flow", () => {
  let db: Database;
  let workspace: TestWorkspace;
  let idp: FakeIdp;
  let auth: ReturnType<typeof createAuth>;

  beforeAll(async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    idp = await startFakeIdp({ email: PROVISIONED_EMAIL, name: "SSO User" });
    await db.ssoConnection.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        issuer: idp.issuer,
        clientId: idp.clientId,
        clientSecret: encryptSsoSecret("client-secret", process.env.BETTER_AUTH_SECRET!),
        domains: ["example.com"],
        createdById: workspace.ownerId,
      },
    });
    auth = createAuth(
      {
        BETTER_AUTH_URL: AUTH_BASE,
        BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
        CORS_ORIGIN: APP_ORIGIN,
      },
      db,
    );
  });

  afterAll(async () => {
    await cleanupTestWorkspace(db, workspace.id);
    const user = await db.user.findUnique({ where: { email: PROVISIONED_EMAIL } });
    if (user) {
      await db.session.deleteMany({ where: { userId: user.id } });
      await db.account.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    }
    await idp.close();
    await db.$disconnect();
  });

  const startUrl = () =>
    `${AUTH_BASE}/sso/start?workspace=${encodeURIComponent(workspace.slug)}&redirect=/app`;

  it("signs in a provisioned member and sets a session cookie", async () => {
    idp.setIdentity({ email: PROVISIONED_EMAIL, name: "SSO User" });
    // A provisioned member: better-auth's adapter looks the user up by email.
    const user = await db.user.create({
      data: {
        id: `sso_user_${randomUUID()}`,
        name: "SSO User",
        email: PROVISIONED_EMAIL,
        emailVerified: true,
      },
    });
    await db.workspaceMember.create({
      data: {
        id: randomUUID(),
        workspaceId: workspace.id,
        userId: user.id,
        role: "EDITOR",
        status: "ACTIVE",
      },
    });

    const start = await auth.handler(new Request(startUrl()));
    expect(start.status).toBe(302);
    const authorizeUrl = start.headers.get("location");
    expect(authorizeUrl).toContain("/authorize");
    expect(authorizeUrl).toContain("code_challenge_method=S256");

    const authorize = await fetch(authorizeUrl!, { redirect: "manual" });
    expect(authorize.status).toBe(302);
    const callbackUrl = authorize.headers.get("location")!;
    expect(callbackUrl).toContain("/sso/callback");

    const callback = await auth.handler(new Request(callbackUrl));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${APP_ORIGIN}/app`);
    const cookie = callback.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    expect(cookie).toContain("session_token");

    const session = await auth.handler(
      new Request(`${AUTH_BASE}/get-session`, { headers: { cookie } }),
    );
    const payload = (await session.json()) as { user?: { email?: string } } | null;
    expect(payload?.user?.email).toBe(PROVISIONED_EMAIL);
  });

  it("refuses an identity that is not provisioned in the workspace", async () => {
    idp.setIdentity({ email: STRANGER_EMAIL, name: "Stranger" });
    const start = await auth.handler(new Request(startUrl()));
    const authorizeUrl = start.headers.get("location")!;
    const authorize = await fetch(authorizeUrl, { redirect: "manual" });
    const callbackUrl = authorize.headers.get("location")!;
    const callback = await auth.handler(new Request(callbackUrl));
    expect(callback.headers.get("location")).toBe(
      `${APP_ORIGIN}/login?sso_error=not_provisioned`,
    );
  });

  it("refuses an identity outside the configured email domains", async () => {
    idp.setIdentity({ email: `outside-${randomUUID()}@other.example`, name: "Outside" });
    const start = await auth.handler(new Request(startUrl()));
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callback = await auth.handler(new Request(authorize.headers.get("location")!));
    expect(callback.headers.get("location")).toBe(
      `${APP_ORIGIN}/login?sso_error=domain_not_allowed`,
    );
  });

  it("does not start for an unknown workspace", async () => {
    const response = await auth.handler(
      new Request(`${AUTH_BASE}/sso/start?workspace=does-not-exist`),
    );
    expect(response.headers.get("location")).toBe(
      `${APP_ORIGIN}/login?sso_error=not_configured`,
    );
  });

  it("refuses a replayed callback state", async () => {
    idp.setIdentity({ email: PROVISIONED_EMAIL, name: "SSO User" });
    const start = await auth.handler(new Request(startUrl()));
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callbackUrl = authorize.headers.get("location")!;
    await auth.handler(new Request(callbackUrl));
    const replay = await auth.handler(new Request(callbackUrl));
    expect(replay.headers.get("location")).toBe(`${APP_ORIGIN}/login?sso_error=state_expired`);
  });

  it("falls back to the app root for an off-origin redirect", async () => {
    idp.setIdentity({ email: PROVISIONED_EMAIL, name: "SSO User" });
    const user = await db.user.findUnique({ where: { email: PROVISIONED_EMAIL } });
    expect(user).toBeTruthy();
    const start = await auth.handler(
      new Request(`${startUrl()}&redirect=${encodeURIComponent("//evil.example.com/phish")}`),
    );
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const callback = await auth.handler(
      new Request(authorize.headers.get("location")!),
    );
    expect(callback.headers.get("location")).toBe(`${APP_ORIGIN}/app`);
  });
});
