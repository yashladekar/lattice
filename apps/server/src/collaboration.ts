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
const PERSIST_DEBOUNCE_MS = 2_000;

/** Resources that support a live session. */
export type CollabResource = "page" | "canvas";

interface Connection {
  socket: WebSocket;
  userId: string;
  controlledIds: number[];
}

interface Room {
  key: string;
  resourceType: CollabResource;
  resourceId: string;
  workspaceId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  connections: Set<Connection>;
  needsSeed: boolean;
  idleTimer: NodeJS.Timeout | null;
  persistTimer: NodeJS.Timeout | null;
  dirty: boolean;
  /** Set when the room is being discarded, so nothing persists it on the way out. */
  reset: boolean;
}

const rooms = new Map<string, Room>();
const pendingRooms = new Map<string, Promise<Room>>();
const wss = new WebSocketServer({ noServer: true });

function roomKey(resourceType: CollabResource, resourceId: string): string {
  return `${resourceType}:${resourceId}`;
}

/** Whether this user currently has the resource open in a live session. */
export function isCollaborating(
  resourceType: CollabResource,
  resourceId: string,
  userId: string,
): boolean {
  const room = rooms.get(roomKey(resourceType, resourceId));
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

function createRoom(
  resourceType: CollabResource,
  resourceId: string,
  workspaceId: string,
): Room {
  const doc = new Y.Doc();
  const room: Room = {
    key: roomKey(resourceType, resourceId),
    resourceType,
    resourceId,
    workspaceId,
    doc,
    awareness: new awarenessProtocol.Awareness(doc),
    connections: new Set(),
    needsSeed: true,
    idleTimer: null,
    persistTimer: null,
    dirty: false,
    reset: false,
  };

  room.doc.on("update", (update: Uint8Array, origin: unknown) => {
    room.dirty = true;
    schedulePersist(room);
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
    void flushPersist(room).finally(() => {
      room.doc.destroy();
      room.awareness.destroy();
      rooms.delete(room.key);
    });
  }, ROOM_IDLE_MS);
}

/**
 * Writes the merged document so a session outlives its room. Debounced while
 * people are typing, and flushed the moment the last peer leaves, which is what
 * rescues an edit made just before a tab is closed or crashes.
 */
function schedulePersist(room: Room): void {
  if (room.persistTimer) return;
  room.persistTimer = setTimeout(() => {
    room.persistTimer = null;
    void flushPersist(room);
  }, PERSIST_DEBOUNCE_MS);
}

async function flushPersist(room: Room): Promise<void> {
  if (room.reset) return;
  if (room.persistTimer) {
    clearTimeout(room.persistTimer);
    room.persistTimer = null;
  }
  if (!room.dirty) return;
  room.dirty = false;
  const state = Buffer.from(Y.encodeStateAsUpdate(room.doc));
  if (!state.length) return;
  try {
    await db.collabDocument.upsert({
      where: {
        resourceType_resourceId: {
          resourceType: room.resourceType,
          resourceId: room.resourceId,
        },
      },
      create: {
        resourceType: room.resourceType,
        resourceId: room.resourceId,
        workspaceId: room.workspaceId,
        state,
        size: state.length,
      },
      update: { state, size: state.length },
    });
  } catch {
    // Keep it dirty so the next change, or the next disconnect, tries again.
    room.dirty = true;
  }
}

/**
 * Drops a page's stored CRDT and any live room, so the next session seeds from
 * the document instead of replaying a copy that no longer matches it. Used
 * after a write landed outside the session: peers reconnect and pick up the
 * stored document.
 */
export async function resetCollabState(
  resourceType: CollabResource,
  resourceId: string,
): Promise<void> {
  const key = roomKey(resourceType, resourceId);
  const room = rooms.get(key);
  if (room) {
    room.reset = true;
    if (room.persistTimer) {
      clearTimeout(room.persistTimer);
      room.persistTimer = null;
    }
    if (room.idleTimer) {
      clearTimeout(room.idleTimer);
      room.idleTimer = null;
    }
    room.dirty = false;
    for (const connection of room.connections) {
      try {
        connection.socket.close(1012, "Document reset");
      } catch {
        // The peer is already gone; the room is dropped below either way.
      }
    }
    room.connections.clear();
    room.doc.destroy();
    room.awareness.destroy();
    rooms.delete(key);
  }
  await db.collabDocument.deleteMany({
    where: { resourceType, resourceId },
  });
}

/**
 * A page document written outside a live session — a version restore, a
 * Markdown-mode save, an import — makes the stored CRDT stale, so it is
 * dropped and the next session seeds from that document instead.
 */
export async function invalidateCollabState(
  resourceType: CollabResource,
  resourceId: string,
): Promise<void> {
  if (rooms.has(roomKey(resourceType, resourceId))) return;
  try {
    await db.collabDocument.delete({
      where: { resourceType_resourceId: { resourceType, resourceId } },
    });
  } catch {
    // Nothing stored, nothing to drop.
  }
}

/**
 * Loads any stored document before the first peer attaches, so joining a
 * resource resumes the session instead of re-seeding it. Room creation is
 * guarded so two peers arriving together share one load.
 */
async function getOrCreateRoom(
  resourceType: CollabResource,
  resourceId: string,
  workspaceId: string,
): Promise<Room> {
  const key = roomKey(resourceType, resourceId);
  const existing = rooms.get(key);
  if (existing) return existing;

  const pending = pendingRooms.get(key);
  if (pending) return pending;

  const created = (async () => {
    const room = createRoom(resourceType, resourceId, workspaceId);
    try {
      const stored = await db.collabDocument.findUnique({
        where: { resourceType_resourceId: { resourceType, resourceId } },
      });
      if (stored?.state?.length) {
        Y.applyUpdate(room.doc, new Uint8Array(stored.state), "persisted");
        room.needsSeed = false;
        room.dirty = false;
      }
    } catch {
      // Without the stored state a peer seeds the room as before.
    }
    pendingRooms.delete(key);
    return room;
  })();

  pendingRooms.set(key, created);
  return created;
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
      // Nobody left to re-send this, so make it durable before the room idles.
      void flushPersist(room);
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
  resourceType: CollabResource;
  resourceId: string;
  workspaceId: string;
  userId: string;
} | null> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/collab") return null;
  const workspaceId = url.searchParams.get("workspaceId");
  const resourceId = url.searchParams.get("id") ?? url.searchParams.get("pageId");
  const type = url.searchParams.get("type") ?? "page";
  if (!workspaceId || !resourceId) return null;
  if (type !== "page" && type !== "canvas") return null;
  const resourceType: CollabResource = type;

  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  if (!session?.user) return null;

  const membership = await db.workspaceMember.findFirst({
    where: { workspaceId, userId: session.user.id, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (!membership) return null;

  const exists =
    resourceType === "page"
      ? await db.page.findFirst({
          where: { id: resourceId, workspaceId, deletedAt: null },
          select: { id: true },
        })
      : await db.canvas.findFirst({
          where: { id: resourceId, workspaceId, deletedAt: null },
          select: { id: true },
        });
  if (!exists) return null;

  return { resourceType, resourceId, workspaceId, userId: session.user.id };
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
          void getOrCreateRoom(
            identity.resourceType,
            identity.resourceId,
            identity.workspaceId,
          ).then((room) => {
            handleConnection(room, ws, identity.userId);
          });
        });
      })
      .catch(() => {
        socket.destroy();
      });
  });
}
