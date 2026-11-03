import { z } from "zod";

import { workspaceProcedure } from "../index";

export interface PresenceEntry {
  userId: string;
  pageId: string;
  lastSeenAt: number;
}

const presence = new Map<string, Map<string, PresenceEntry>>();

function prune(workspaceId: string): Map<string, PresenceEntry> {
  const room = presence.get(workspaceId) ?? new Map<string, PresenceEntry>();
  const cutoff = Date.now() - 35_000;
  for (const [userId, entry] of room) {
    if (entry.lastSeenAt < cutoff) room.delete(userId);
  }
  presence.set(workspaceId, room);
  return room;
}

export const presenceRouter = {
  ping: workspaceProcedure("VIEWER")
    .input(z.object({ pageId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const room = prune(context.workspaceId);
      room.set(context.userId, {
        userId: context.userId,
        pageId: input.pageId,
        lastSeenAt: Date.now(),
      });
      presence.set(context.workspaceId, room);
      const peers = [...room.values()].filter(
        (entry) => entry.userId !== context.userId && entry.pageId === input.pageId,
      );
      const users = await context.db.user.findMany({
        where: { id: { in: peers.map((entry) => entry.userId) } },
        select: { id: true, name: true, image: true },
      });
      const userById = new Map(users.map((user) => [user.id, user]));
      return peers.map((peer) => ({
        ...peer,
        name: userById.get(peer.userId)?.name ?? "Someone",
        image: userById.get(peer.userId)?.image ?? null,
      }));
    }),

  list: workspaceProcedure("VIEWER")
    .input(z.object({ pageId: z.string().min(1) }))
    .handler(({ context, input }) => {
      const room = prune(context.workspaceId);
      return [...room.values()].filter(
        (entry) => entry.userId !== context.userId && entry.pageId === input.pageId,
      );
    }),
};
