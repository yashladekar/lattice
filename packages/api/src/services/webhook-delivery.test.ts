import { randomUUID } from "node:crypto";

import { afterEach, expect, it, vi } from "vitest";

import type { Database } from "@notes-learning/db";
import { signWebhookPayload } from "./webhooks";

import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { deliverWebhookBatch } from "./webhooks";
import { pushSync } from "./sync";

/**
 * Webhook automation rules and delivery. The transport is stubbed so the tests
 * exercise the real signing, status, and backoff code without reaching out.
 */
describeWithDatabase("webhook deliveries", () => {
  let db: Database;
  let workspace: TestWorkspace;

  const setup = async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
  };

  const endpoint = async (input: {
    name: string;
    filters?: Record<string, unknown>;
    enabled?: boolean;
    secret?: string;
  }) => {
    const id = randomUUID();
    await db.webhookEndpoint.create({
      data: {
        id,
        workspaceId: workspace.id,
        name: input.name,
        url: "https://hooks.example.com/lattice",
        secret: input.secret ?? "whsec_test_secret",
        events: ["page.updated"],
        filters: (input.filters ?? {}) as never,
        enabled: input.enabled ?? true,
        createdById: workspace.ownerId,
      },
    });
    return id;
  };

  const pushPage = (pageId: string, title: string) =>
    pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `p-${randomUUID()}`,
          entity: "page",
          entityId: pageId,
          op: "UPSERT",
          payload: { title },
        },
      ],
    });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (!workspace) return;
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  it("queues events per destination and applies filters when queueing", async () => {
    await setup();
    const filtered = await endpoint({ name: "Roadmap only", filters: { titleContains: "roadmap" } });
    const everything = await endpoint({ name: "Everything" });

    await pushPage(`webhook_roadmap_${workspace.id}`, "Q3 Roadmap");
    await pushPage(`webhook_scratch_${workspace.id}`, "Scratch pad");

    const filteredDeliveries = await db.webhookDelivery.findMany({
      where: { endpointId: filtered },
    });
    const allDeliveries = await db.webhookDelivery.findMany({ where: { endpointId: everything } });
    expect(filteredDeliveries).toHaveLength(1);
    expect(allDeliveries).toHaveLength(2);
    expect(filteredDeliveries[0]?.event).toBe("page.updated");
  });

  it("signs the payload and marks a successful delivery", async () => {
    await setup();
    const endpointId = await endpoint({ name: "Signed" });
    const payload = {
      event: "page.updated",
      workspaceId: workspace.id,
      entity: "page",
      entityId: "webhook_signed",
      op: "UPSERT",
      actorId: workspace.ownerId,
      occurredAt: new Date().toISOString(),
    };
    const deliveryId = `whd_${randomUUID()}`;
    await db.webhookDelivery.create({
      data: {
        id: deliveryId,
        workspaceId: workspace.id,
        endpointId,
        event: "page.updated",
        payload: payload as never,
      },
    });

    const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: String(init.body),
      });
      return new Response("ok", { status: 200 });
    });

    const result = await deliverWebhookBatch(db);
    expect(result.delivered).toBe(1);
    expect(seen).toHaveLength(1);
    const request = seen[0]!;
    expect(request.url).toBe("https://hooks.example.com/lattice");
    expect(request.headers["x-lattice-signature"]).toBe(
      signWebhookPayload("whsec_test_secret", request.body),
    );
    expect(request.headers["x-lattice-event"]).toBe("page.updated");

    const delivery = await db.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).toBe("DELIVERED");
    expect(delivery?.attempts).toBe(1);
    const endpointRow = await db.webhookEndpoint.findUnique({ where: { id: endpointId } });
    expect(endpointRow?.lastStatus).toBe(200);
  });

  it("delivers a due row once when two sweeps overlap", async () => {
    await setup();
    const endpointId = await endpoint({ name: "Overlapping" });
    const deliveryId = `whd_${randomUUID()}`;
    await db.webhookDelivery.create({
      data: {
        id: deliveryId,
        workspaceId: workspace.id,
        endpointId,
        event: "page.updated",
        payload: { event: "page.updated" } as never,
      },
    });
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response("ok", { status: 200 });
    });

    const [first, second] = await Promise.all([deliverWebhookBatch(db), deliverWebhookBatch(db)]);
    expect(calls).toBe(1);
    expect(first.delivered + second.delivered).toBe(1);
    expect((await db.webhookDelivery.findUnique({ where: { id: deliveryId } }))?.status).toBe(
      "DELIVERED",
    );
  });

  it("backs off after a failed attempt", async () => {
    await setup();
    const endpointId = await endpoint({ name: "Failing" });
    const deliveryId = `whd_${randomUUID()}`;
    await db.webhookDelivery.create({
      data: {
        id: deliveryId,
        workspaceId: workspace.id,
        endpointId,
        event: "page.updated",
        payload: { event: "page.updated" } as never,
      },
    });
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));

    const result = await deliverWebhookBatch(db);
    expect(result.failed).toBe(1);
    const delivery = await db.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).toBe("PENDING");
    expect(delivery?.attempts).toBe(1);
    expect(delivery?.lastError).toContain("500");
    expect(delivery?.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("cancels deliveries for a disabled destination", async () => {
    await setup();
    const endpointId = await endpoint({ name: "Paused", enabled: false });
    const deliveryId = `whd_${randomUUID()}`;
    await db.webhookDelivery.create({
      data: {
        id: deliveryId,
        workspaceId: workspace.id,
        endpointId,
        event: "page.updated",
        payload: { event: "page.updated" } as never,
      },
    });

    const result = await deliverWebhookBatch(db);
    expect(result.skipped).toBe(1);
    const delivery = await db.webhookDelivery.findUnique({ where: { id: deliveryId } });
    expect(delivery?.status).toBe("CANCELLED");
  });
});
