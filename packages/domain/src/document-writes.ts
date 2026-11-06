/**
 * Live sessions and out-of-band document writes.
 *
 * A page with a live Yjs room exchanges JSON snapshots whose `baseRev` is stale
 * by design, so the server accepts those without a conflict check. That leaves
 * one hazard: a write from outside the session (accepting a suggestion,
 * restoring a version, an import) is invisible to the CRDT, and a peer's next
 * snapshot can put the older body back.
 *
 * Two rules keep that honest. Document ops carry an origin, so the server can
 * tell a session snapshot from a write. And a live editor refuses to persist
 * when an out-of-band write landed under it, instead of quietly overwriting it.
 */
export type DocumentChangeSource = "session" | "write";

export interface LiveWriteDecisionInput {
  /** Revision this editor last wrote or loaded. */
  lastWrittenRev: number;
  /** Revision currently in the local store. */
  currentRev: number;
  /** Origin of the change that produced `currentRev`, when known. */
  lastChangeSource?: DocumentChangeSource | null;
}

/**
 * Whether a live editor would overwrite a newer out-of-band write. Sessions
 * advance each other's revisions constantly, so only a revision that came from
 * outside the session counts.
 */
export function liveWriteWouldClobber(input: LiveWriteDecisionInput): boolean {
  if (input.currentRev <= input.lastWrittenRev) return false;
  return input.lastChangeSource === "write";
}
