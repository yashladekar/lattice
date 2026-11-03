import { z } from "zod";

import { protectedProcedure, workspaceProcedure } from "../index";

export const notificationRouter = {
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }).optional())
    .handler(async ({ context, input }) => {
      return context.db.notification.findMany({
        where: { userId: context.session.user.id },
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 30,
      });
    }),

  unreadCount: protectedProcedure.handler(async ({ context }) => {
    return context.db.notification.count({
      where: { userId: context.session.user.id, readAt: null },
    });
  }),

  markRead: protectedProcedure
    .input(z.object({ notificationId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      await context.db.notification.updateMany({
        where: { id: input.notificationId, userId: context.session.user.id },
        data: { readAt: new Date() },
      });
      return { ok: true };
    }),

  markAllRead: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    await context.db.notification.updateMany({
      where: { userId: context.userId, workspaceId: context.workspaceId, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }),
};

export const deviceRouter = {
  register: protectedProcedure
    .input(
      z.object({
        deviceId: z.string().min(1).max(200),
        name: z.string().max(100),
        platform: z.string().max(40),
      }),
    )
    .handler(async ({ context, input }) => {
      const device = await context.db.device.upsert({
        where: { userId_id: { userId: context.session.user.id, id: input.deviceId } },
        create: {
          id: input.deviceId,
          userId: context.session.user.id,
          name: input.name,
          platform: input.platform,
        },
        update: { name: input.name, platform: input.platform, lastSeenAt: new Date() },
      });
      return device;
    }),

  list: protectedProcedure.handler(async ({ context }) => {
    return context.db.device.findMany({
      where: { userId: context.session.user.id },
      orderBy: { lastSeenAt: "desc" },
    });
  }),

  remove: protectedProcedure
    .input(z.object({ deviceId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      await context.db.device.deleteMany({
        where: { id: input.deviceId, userId: context.session.user.id },
      });
      return { ok: true };
    }),
};
