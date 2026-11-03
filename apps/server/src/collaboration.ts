import type { IncomingMessage, Server } from "node:http";

import { fromNodeHeaders } from "better-auth/node";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { auth, db } from "./services";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_SEED_REQUEST = 2;

const ROOM_IDLE_MS = 30_000;

interface Connection {
  socket: WebSocket;
  userId: string;
  controlledIds: number[];
}

interface Room {
  key: string;
  workspaceId: string;
  pageId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Set<Connection>;
  needsSeed: boolean;
  idleTimer: NodeJS.Timeout | null;
}

const rooms = new Map<string, Room>();
const wss = new WebSocketServer({ noServer: true });

function roomKey(workspaceId: string, pageId: string): string {
  return `${workspaceId}:${pageId}`;
}

/** Whether this user currently has the page open in a live session. */
export function isCollaborating(
  workspaceId: string,
  pageId: string,
  userId: string,
): boolean {
  const room = rooms.get(roomKey(workspaceId, pageId));
  if (!room) return false;
  for (const connection of room.connections) {
    if (connection.userId === userId) return true;
  }
  return false;
}

function send(socket: WebSocket, payload: Uint8Array): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(payload);
  }
}

function syncMessage(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function createRoom(workspaceId: string, pageId: string): Room {
  const doc = new Y.Doc();
  const room: Room = {
    key: roomKey(workspaceId, pageId),
    workspaceId,
    pageId,
    doc,
    awareness: new awarenessProtocol.Awareness(doc),
    connections: new Set(),
    needsSeed: true,
    idleTimer: null,
  };

  room.doc.on("update", (update: Uint8Array, origin: unknown) => {
    const message = syncMessage((encoder) => syncProtocol.writeUpdate(encoder, update));
    for (const connection of room.connections) {
      if (connection === origin) continue;
      send(connection.socket, message);
    }
  });

  room.awareness.on(
    "update",
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      const changed = [...added, ...updated, ...removed];
      if (!changed.length) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed),
      );
      const message = encoding.toUint8Array(encoder);
      for (const connection of room.connections) {
        if (connection === origin) continue;
        send(connection.socket, message);
      }
    },
  );

  rooms.set(room.key, room);
  return room;
}

function scheduleRoomCleanup(room: Room): void {
  if (room.idleTimer) clearTimeout(room.idleTimer);
  room.idleTimer = setTimeout(() => {
    if (room.connections.size > 0) return;
    room.doc.destroy();
    room.awareness.destroy();
    rooms.delete(room.key);
  }, ROOM_IDLE_MS);
}

function handleConnection(room: Room, socket: WebSocket, userId: string): void {
  const connection: Connection = { socket, userId, controlledIds: [] };
  room.connections.add(connection);
  if (room.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }

  send(
    socket,
    syncMessage((encoder) => syncProtocol.writeSyncStep1(encoder, room.doc)),
  );

  const states = room.awareness.getStates();
  if (states.size) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
    );
    send(socket, encoding.toUint8Array(encoder));
  }

  if (room.needsSeed) {
    // The first peer in a fresh room pushes its local document in; everyone
    // else must not seed, or the merge would duplicate the whole page.
    room.needsSeed = false;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SEED_REQUEST);
    send(socket, encoding.toUint8Array(encoder));
  }

  socket.on("message", (data: ArrayBuffer | Buffer) => {
    try {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, connection);
        if (encoding.length(encoder) > 1) {
          send(socket, encoding.toUint8Array(encoder));
        }
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          connection,
        );
        for (const [clientId, state] of room.awareness.getStates()) {
          if (state && !connection.controlledIds.includes(clientId)) {
            connection.controlledIds.push(clientId);
          }
        }
      }
    } catch {
      // Malformed frames are ignored; the socket stays usable for valid ones.
    }
  });

  const close = () => {
    awarenessProtocol.removeAwarenessStates(
      room.awareness,
      connection.controlledIds,
      null,
    );
    room.connections.delete(connection);
    if (room.connections.size === 0) {
      scheduleRoomCleanup(room);
      return;
    }
    if (room.needsSeed) {
      // The seeder left before pushing content; promote the next peer.
      const next = room.connections.values().next().value as Connection | undefined;
      if (next) {
        room.needsSeed = false;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SEED_REQUEST);
        send(next.socket, encoding.toUint8Array(encoder));
      }
    }
  };

  socket.on("close", close);
  socket.on("error", close);
}

async function authenticate(request: IncomingMessage): Promise<{
  workspaceId: string;
  pageId: string;
  userId: string;
} | null> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/collab") return null;
  const workspaceId = url.searchParams.get("workspaceId");
  const pageId = url.searchParams.get("pageId");
  if (!workspaceId || !pageId) return null;

  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session?.user) return null;

  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!membership) return null;

  const page = await db.page.findFirst({
    where: { id: pageId, workspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!page) return null;

  return { workspaceId, pageId, userId: session.user.id };
}

export function attachCollaboration(server: Server): void {
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/collab") return;

    void authenticate(request)
      .then((identity) => {
        if (!identity) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          const key = roomKey(identity.workspaceId, identity.pageId);
          const room = rooms.get(key) ?? createRoom(identity.workspaceId, identity.pageId);
          handleConnection(room, ws, identity.userId);
        });
      })
      .catch(() => {
        socket.destroy();
      });
  });
}
