import { getApiBaseUrl } from "@/lib/config";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_SEED_REQUEST = 2;

export type CollabStatus = "connecting" | "connected" | "disconnected";

export interface CollabPeer {
  clientId: number;
  name: string;
  color: string;
}

export function collaborationUrl(workspaceId: string, pageId: string): string {
  const base = getApiBaseUrl().replace(/^http/, "ws");
  const params = new URLSearchParams({ workspaceId, pageId });
  return `${base}/collab?${params.toString()}`;
}

/**
 * A small Yjs provider speaking the same sync and awareness protocol as the
 * Lattice collaboration relay. Unlike a generic provider it understands one
 * extra message: the server asks exactly one peer to seed a fresh room, so the
 * document is never inserted twice.
 */
export class CollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  status: CollabStatus = "disconnected";

  onStatus?: (status: CollabStatus) => void;
  onSeedRequest?: () => void;
  onPeers?: (peers: CollabPeer[]) => void;

  private socket: WebSocket | null = null;
  private closed = false;
  private suspended = false;
  private retries = 0;
  private synced = false;
  private url = "";
  private connectedUrl = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.send(encodeSync(update));
  };

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin !== this) {
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed),
        );
        this.send(encoding.toUint8Array(encoder));
      }
    }
    this.emitPeers();
  };

  constructor() {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);
  }

  connect(url: string) {
    if (this.closed) return;
    this.suspended = false;
    this.url = url;
    if (this.socket) {
      if (this.connectedUrl !== url) {
        // The workspace became known after the first attempt; reconnect.
        this.suspended = true;
        this.socket.close();
        this.suspended = false;
        this.open(url);
      }
      return;
    }
    this.open(url);
  }

  /** Drops the socket but keeps the document, so the session can resume. */
  close() {
    this.suspended = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus("disconnected");
  }

  /** TipTap's unique-id extension listens for the initial sync handshake. */
  on(event: string, handler: (...args: never[]) => void) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (...args: unknown[]) => void);
    this.listeners.set(event, set);
  }

  off(event: string, handler: (...args: never[]) => void) {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  emit(event: string, ...args: unknown[]) {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(...args);
  }

  get isSynced(): boolean {
    return this.synced;
  }

  setUser(user: { name: string; color: string }) {
    this.awareness.setLocalStateField("user", user);
    this.emitPeers();
  }

  destroy() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.listeners.clear();
    this.close();
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
    this.socket?.close();
    this.socket = null;
    this.doc.destroy();
  }

  get isConnected(): boolean {
    return this.status === "connected";
  }

  private emitPeers() {
    if (!this.onPeers) return;
    const localId = this.awareness.clientID;
    const peers: CollabPeer[] = [];
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === localId) continue;
      const user = (state as { user?: { name?: string; color?: string } } | undefined)?.user;
      if (!user?.name) continue;
      peers.push({
        clientId,
        name: user.name,
        color: user.color ?? "#e8892f",
      });
    }
    this.onPeers(peers);
  }

  private setStatus(status: CollabStatus) {
    this.status = status;
    this.onStatus?.(status);
  }

  private send(payload: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(payload as unknown as ArrayBuffer);
    }
  }

  private open(url: string) {
    if (this.closed) return;
    this.connectedUrl = url;
    this.setStatus("connecting");
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    this.socket = socket;

    socket.onopen = () => {
      if (this.closed || this.socket !== socket) {
        socket.close();
        return;
      }
      this.retries = 0;
      this.setStatus("connected");

      const step1 = encoding.createEncoder();
      encoding.writeVarUint(step1, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(step1, this.doc);
      this.send(encoding.toUint8Array(step1));

      const local = this.awareness.getLocalState();
      if (local) {
        const awareness = encoding.createEncoder();
        encoding.writeVarUint(awareness, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          awareness,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]),
        );
        this.send(encoding.toUint8Array(awareness));
      }
    };

    socket.onmessage = (event) => {
      const bytes =
        event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : new Uint8Array();
      if (!bytes.length) return;
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);

      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const subtype = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder));
        }
        // Step 2 carries the room state; after that the editor can assign ids.
        if (!this.synced && subtype !== syncProtocol.messageYjsSyncStep1) {
          this.synced = true;
          this.emit("synced", { synced: true });
        }
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          this,
        );
      } else if (type === MESSAGE_SEED_REQUEST) {
        this.onSeedRequest?.();
      }
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.setStatus("disconnected");
      if (this.closed || this.suspended || this.reconnectTimer) return;
      const delay = Math.min(10_000, 1000 * 2 ** this.retries);
      this.retries += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.open(this.url);
      }, delay);
    };

    socket.onerror = () => {
      socket.close();
    };
  }
}

function encodeSync(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}
