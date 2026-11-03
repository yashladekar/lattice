"use client";

import {
  canvasFingerprint,
  type CanvasDocument,
  type CanvasElement,
  type CanvasElementMap,
} from "@notes-learning/domain";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";

import { CollabProvider, collaborationUrl, type CollabPeer, type CollabStatus } from "@/lib/collab";

const ELEMENTS = "elements";
const PUBLISH_DEBOUNCE_MS = 350;
const TEARDOWN_GRACE_MS = 150;

/**
 * React re-runs effects immediately in development, so a provider that is
 * destroyed on the first cleanup never comes back. Only tear it down if the
 * session really stayed closed.
 */
const pendingTeardown = new WeakMap<CollabProvider, ReturnType<typeof setTimeout>>();

export interface CanvasCollaboration {
  status: CollabStatus;
  peers: CollabPeer[];
  /** Called with the local document whenever it settles after an edit. */
  publish: (document: CanvasDocument) => void;
  /** Publishes the local pointer in canvas space, throttled. */
  setCursor: (cursor: { x: number; y: number } | null) => void;
}

function toYElement(element: CanvasElement): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [field, value] of Object.entries(element as unknown as Record<string, unknown>)) {
    map.set(field, value);
  }
  return map;
}

function fromYElements(map: Y.Map<Y.Map<unknown>>): CanvasElementMap {
  const elements: CanvasElementMap = {};
  for (const [id, element] of map.entries()) {
    elements[id] = { id, ...(element.toJSON() as object) } as CanvasElement;
  }
  return elements;
}

/**
 * Binds a canvas to a Yjs room. Local edits are published on a short debounce
 * and only for the fields that moved, so concurrent work on different shapes,
 * or on different fields of one shape, both survive. Remote changes are handed
 * back through `onRemote`, and the resulting document is fingerprinted so the
 * echo of a remote change is not published straight back.
 */
export function useCanvasCollaboration(options: {
  canvasId: string;
  workspaceId: string | null;
  enabled: boolean;
  userName: string;
  onRemote: (elements: CanvasElementMap, knownRemoteIds: string[]) => void;
}): CanvasCollaboration {
  const { canvasId, workspaceId, enabled, userName, onRemote } = options;
  const [status, setStatus] = useState<CollabStatus>("disconnected");
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const onRemoteRef = useRef(onRemote);
  onRemoteRef.current = onRemote;

  const provider = useMemo(() => {
    if (!enabled || !canvasId || !workspaceId) return null;
    return new CollabProvider();
  }, [canvasId, enabled, workspaceId]);

  const fingerprintRef = useRef<{ remote: string | null; published: string | null }>({
    remote: null,
    published: null,
  });
  const knownIdsRef = useRef<string[]>([]);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDocument = useRef<CanvasDocument | null>(null);

  useEffect(() => {
    if (!provider || !workspaceId) return;
    const pending = pendingTeardown.get(provider);
    if (pending) {
      clearTimeout(pending);
      pendingTeardown.delete(provider);
    }
    const elements = provider.doc.getMap<Y.Map<unknown>>(ELEMENTS);
    provider.setUser({ name: userName, color: "#2f6b4f" });

    const applyRemote = () => {
      const remote = fromYElements(elements);
      const merged: CanvasDocument = { version: 1, elements: Object.values(remote) };
      fingerprintRef.current.remote = canvasFingerprint(merged);
      knownIdsRef.current = Object.keys(remote);
      onRemoteRef.current(remote, knownIdsRef.current);
    };

    provider.onSeedRequest = () => {
      const pending = pendingDocument.current;
      if (!pending) return;
      provider.doc.transact(() => {
        for (const element of pending.elements) elements.set(element.id, toYElement(element));
      }, "seed");
      knownIdsRef.current = Object.keys(fromYElements(elements));
    };

    const observer = () => {
      applyRemote();
    };
    elements.observeDeep(observer);

    provider.onStatus = setStatus;
    provider.onPeers = setPeers;
    provider.connect(collaborationUrl(workspaceId, canvasId, "canvas"));

    // A room that already holds the board still needs one delivery.
    const initial = setTimeout(applyRemote, 600);

    return () => {
      clearTimeout(initial);
      elements.unobserveDeep(observer);
      provider.onStatus = undefined;
      provider.onPeers = undefined;
      provider.onSeedRequest = undefined;
      provider.close();
      pendingTeardown.set(
        provider,
        setTimeout(() => {
          pendingTeardown.delete(provider);
          provider.destroy();
        }, TEARDOWN_GRACE_MS),
      );
    };
  }, [provider, workspaceId, canvasId, userName]);

  const publish = (document: CanvasDocument) => {
    pendingDocument.current = document;
    if (!provider) return;
    if (publishTimer.current) clearTimeout(publishTimer.current);
    publishTimer.current = setTimeout(() => {
      publishTimer.current = null;
      const next = pendingDocument.current;
      if (!next || !provider) return;
      const fingerprint = canvasFingerprint(next);
      if (fingerprint === fingerprintRef.current.remote) return;
      if (fingerprint === fingerprintRef.current.published) return;
      fingerprintRef.current.published = fingerprint;

      const elements = provider.doc.getMap<Y.Map<unknown>>(ELEMENTS);
      const published = new Set(knownIdsRef.current);
      const nextIds = new Set(next.elements.map((element) => element.id));

      provider.doc.transact(() => {
        for (const element of next.elements) {
          const existing = elements.get(element.id);
          if (!existing) {
            elements.set(element.id, toYElement(element));
            continue;
          }
          const fields = element as unknown as Record<string, unknown>;
          for (const [field, value] of Object.entries(fields)) {
            if (field === "id") continue;
            const current = existing.get(field);
            if (JSON.stringify(current) === JSON.stringify(value)) continue;
            existing.set(field, value);
          }
        }
        for (const id of published) {
          if (!nextIds.has(id)) elements.delete(id);
        }
      }, "local");
      knownIdsRef.current = [...nextIds];
    }, PUBLISH_DEBOUNCE_MS);
  };

  const setCursor = (cursor: { x: number; y: number } | null) => {
    if (!provider) return;
    if (cursorTimer.current) clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => provider.setCursor(cursor), 60);
  };

  return { status, peers, publish, setCursor };
}
