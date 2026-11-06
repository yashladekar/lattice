import { randomBytes, randomUUID } from "node:crypto";

import { Prisma, type Database } from "@notes-learning/db";
import {
  MAX_WEBHOOK_ENDPOINTS,
  WEBHOOK_EVENTS,
  createId,
  isSafeWebhookUrl,
  isWebhookEvent,
  parseWebhookFilters,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { writeAudit } from "../authz";
import { workspaceProcedure } from "../index";

const filtersSchema = z
  .object({
    titleContains: z.string().trim().max(80).nullish(),
    notebookIds: z.array(z.string().max(80)).max(25).optional(),
    pageTypes: z.array(z.string().max(20)).max(8).optional(),
    operations: z.array(z.enum(["UPSERT", "DELETE"])).max(2).optional(),
    actorIds: z.array(z.string().max(80)).max(25).optional(),
  })
  .optional();

async function requireEndpoint(db: Database, workspaceId: string, id: string) {
  const endpoint = await db.webhookEndpoint.findFirst({
    where: { id, workspaceId },
  });
  if (!endpoint) throw new ORPCError("NOT_FOUND", { message: "Destination not found." });
  return endpoint;
}

export const webhookRouter = {
  list: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const endpoints = await context.db.webhookEndpoint.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "asc" },
    });
    return endpoints.map((endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      events: (Array.isArray(endpoint.events) ? endpoint.events : []).filter(isWebhookEvent),
      filters: parseWebhookFilters(endpoint.filters),
      enabled: endpoint.enabled,
      secret: endpoint.secret,
      lastDeliveryAt: endpoint.lastDeliveryAt?.toISOString() ?? null,
      lastStatus: endpoint.lastStatus ?? null,
    }));
  }),

  save: workspaceProcedure("ADMIN")
    .input(
      z.object({
        id: z.string().max(64).optional(),
        name: z.string().trim().max(60).default("Webhook"),
        url: z.string().trim().min(1).max(2000),
        events: z.array(z.string().max(40)).min(1).max(WEBHOOK_EVENTS.length),
        filters: filtersSchema,
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
      const filters = parseWebhookFilters(input.filters ?? {});
      const existing = input.id
        ? await requireEndpoint(context.db, context.workspaceId, input.id)
        : null;
      if (!existing) {
        const count = await context.db.webhookEndpoint.count({
          where: { workspaceId: context.workspaceId },
        });
        if (count >= MAX_WEBHOOK_ENDPOINTS) {
          throw new ORPCError("BAD_REQUEST", {
            message: `A workspace can run at most ${MAX_WEBHOOK_ENDPOINTS} destinations.`,
          });
        }
      }
      const secret =
        !existing || input.rotateSecret
          ? `whsec_${randomBytes(24).toString("base64url")}`
          : existing.secret;
      const data = {
        name: input.name || "Webhook",
        url: input.url,
        events,
        filters: filters as unknown as Prisma.InputJsonValue,
        enabled: input.enabled,
        secret,
      };
      const endpoint = existing
        ? await context.db.webhookEndpoint.update({ where: { id: existing.id }, data })
        : await context.db.webhookEndpoint.create({
            data: {
              id: createId(),
              workspaceId: context.workspaceId,
              createdById: context.userId,
              ...data,
            },
          });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: existing ? "workspace.webhook_updated" : "workspace.webhook_saved",
        resourceType: "workspace",
        resourceId: endpoint.id,
      });
      return { id: endpoint.id, secret: endpoint.secret, events };
    }),

  remove: workspaceProcedure("ADMIN")
    .input(z.object({ id: z.string().max(64) }))
    .handler(async ({ context, input }) => {
      const endpoint = await context.db.webhookEndpoint.findFirst({
        where: { id: input.id, workspaceId: context.workspaceId },
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
        resourceId: endpoint.id,
      });
      return { ok: true };
    }),

  deliveries: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const [deliveries, endpoints] = await Promise.all([
      context.db.webhookDelivery.findMany({
        where: { workspaceId: context.workspaceId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          endpointId: true,
          event: true,
          status: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          deliveredAt: true,
        },
      }),
      context.db.webhookEndpoint.findMany({
        where: { workspaceId: context.workspaceId },
        select: { id: true, name: true },
      }),
    ]);
    const nameById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint.name]));
    return deliveries.map((delivery) => ({
      ...delivery,
      endpointName: nameById.get(delivery.endpointId) ?? "Removed destination",
    }));
  }),

  test: workspaceProcedure("ADMIN")
    .input(z.object({ id: z.string().max(64).optional() }).optional())
    .handler(async ({ context, input }) => {
      const endpoint = input?.id
        ? await requireEndpoint(context.db, context.workspaceId, input.id)
        : await context.db.webhookEndpoint.findFirst({
            where: { workspaceId: context.workspaceId },
            orderBy: { createdAt: "asc" },
          });
      if (!endpoint) throw new ORPCError("BAD_REQUEST", { message: "Save a destination first." });
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
