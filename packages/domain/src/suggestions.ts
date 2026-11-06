import { SUGGESTION_STATUSES, type SuggestionStatus } from "./types";

export function isSuggestionStatus(value: unknown): value is SuggestionStatus {
  return typeof value === "string" && (SUGGESTION_STATUSES as readonly string[]).includes(value);
}

/**
 * A suggestion is stale when the page moved past the revision the author saw.
 * Accepting it still works, but the reviewer should be warned first.
 */
export function suggestionIsStale(baseRev: number, currentRev: number): boolean {
  return currentRev > baseRev;
}
