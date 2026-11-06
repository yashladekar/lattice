import { randomBytes, randomUUID } from "node:crypto";

import {
  WEBHOOK_EVENTS,
  createId,
  isSafeWebhookUrl,
  isWebhookEvent,
  type WebhookEvent,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { writeAudit } from "../authz";
import { workspaceProcedure } from "../index";

export const webhookRouter = {
  get: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const endpoint = await context.db.webhookEndpoint.findUnique({
      where: { workspaceId: context.workspaceId },
    });
    if (!endpoint) {
      return {
        configured: false,
        url: "",
        events: [] as WebhookEvent[],
        secret: null,
        enabled: false,
        lastDeliveryAt: null,
        lastStatus: null,
      };
    }
    return {
      configured: true,
      url: endpoint.url,
      events: (Array.isArray(endpoint.events) ? endpoint.events : []).filter(isWebhookEvent),
      secret: endpoint.secret,
      enabled: endpoint.enabled,
      lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
      lastStatus: endpoint.lastStatus ?? null,
    };
  }),

  save: workspaceProcedure("ADMIN")
    .input(
      z.object({
        url: z.string().trim().min(1).max(2000),
        events: z.array(z.string().max(40)).min(1).max(WEBHOOK_EVENTS.length),
        enabled: z.boolean().default(true),
        rotateSecret: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      if (!isSafeWebhookUrl(input.url)) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Use a public https URL; localhost and private addresses are refused.",
        });
      }
      const events = [...new Set(input.events.filter(isWebhookEvent))];
      if (!events.length) {
        throw new ORPCError("BAD_REQUEST", { message: "Choose at least one event." });
      }
      const existing = await context.db.webhookEndpoint.findUnique({
        where: { workspaceId: context.workspaceId },
      });
      const secret =
        !existing || input.rotateSecret
          ? `whsec_${randomBytes(24).toString("base64url")}`
          : existing.secret;
      const endpoint = await context.db.webhookEndpoint.upsert({
        where: { workspaceId: context.workspaceId },
        create: {
          id: createId(),
          workspaceId: context.workspaceId,
          url: input.url,
          events,
          enabled: input.enabled,
          secret,
          createdById: context.userId,
        },
        update: { url: input.url, events, enabled: input.enabled, secret },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "workspace.webhook_saved",
        resourceType: "workspace",
        resourceId: context.workspaceId,
      });
      return { secret: endpoint.secret, events };
    }),

  remove: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const endpoint = await context.db.webhookEndpoint.findUnique({
      where: { workspaceId: context.workspaceId },
      select: { id: true },
    });
    if (!endpoint) return { ok: true };
    await context.db.$transaction(async (tx) => {
      await tx.webhookDelivery.updateMany({
        where: { endpointId: endpoint.id, status: "PENDING" },
        data: { status: "CANCELLED", lastError: "Endpoint removed." },
      });
      await tx.webhookEndpoint.delete({ where: { id: endpoint.id } });
    });
    await writeAudit(context.db, {
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "workspace.webhook_removed",
      resourceType: "workspace",
      resourceId: context.workspaceId,
    });
    return { ok: true };
  }),

  deliveries: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    return context.db.webhookDelivery.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        deliveredAt: true,
      },
    });
  }),

  test: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const endpoint = await context.db.webhookEndpoint.findUnique({
      where: { workspaceId: context.workspaceId },
    });
    if (!endpoint) throw new ORPCError("BAD_REQUEST", { message: "Save an endpoint first." });
    const delivery = await context.db.webhookDelivery.create({
      data: {
        id: `whd_${randomUUID()}`,
        workspaceId: context.workspaceId,
        endpointId: endpoint.id,
        event: "webhook.test",
        payload: {
          event: "webhook.test",
          workspaceId: context.workspaceId,
          entity: "workspace",
          entityId: context.workspaceId,
          op: "UPSERT",
          occurredAt: new Date().toISOString(),
        },
      },
      select: { id: true },
    });
    return { deliveryId: delivery.id };
  }),
};
