/**
 * Legal hold coverage.
 *
 * A hold preserves content past the retention window. Purge is the only path
 * that permanently deletes rows, so the rules for what a hold protects live
 * here as pure functions and the purge service applies them to each table.
 *
 * Deliberately explicit: a workspace hold covers everything, a notebook hold
 * covers that notebook plus the pages and canvases inside it, and a page hold
 * covers that page alone. Released holds cover nothing.
 */
export const LEGAL_HOLD_SCOPES = ["WORKSPACE", "NOTEBOOK", "PAGE"] as const;
export type LegalHoldScope = (typeof LEGAL_HOLD_SCOPES)[number];

export interface LegalHoldLike {
  scope: string;
  targetId: string | null;
  releasedAt?: string | Date | null;
}

export interface HoldCoverage {
  workspace: boolean;
  notebookIds: Set<string>;
  pageIds: Set<string>;
}

export function isLegalHoldScope(value: unknown): value is LegalHoldScope {
  return typeof value === "string" && (LEGAL_HOLD_SCOPES as readonly string[]).includes(value);
}

/** Active holds only: a released hold must never keep content alive. */
export function holdCoverage(holds: LegalHoldLike[]): HoldCoverage {
  const coverage: HoldCoverage = {
    workspace: false,
    notebookIds: new Set(),
    pageIds: new Set(),
  };
  for (const hold of holds) {
    if (hold.releasedAt) continue;
    const target = hold.targetId ?? "";
    if (hold.scope === "WORKSPACE") coverage.workspace = true;
    else if (hold.scope === "NOTEBOOK" && target) coverage.notebookIds.add(target);
    else if (hold.scope === "PAGE" && target) coverage.pageIds.add(target);
  }
  return coverage;
}

/** Expands notebook holds into their pages, so callers filter one id set. */
export function expandHeldPages(
  coverage: HoldCoverage,
  pages: Array<{ id: string; notebookId: string | null }>,
): Set<string> {
  const held = new Set(coverage.pageIds);
  if (!coverage.notebookIds.size) return held;
  for (const page of pages) {
    if (page.notebookId && coverage.notebookIds.has(page.notebookId)) held.add(page.id);
  }
  return held;
}

export function expandHeldCanvases(
  coverage: HoldCoverage,
  canvases: Array<{ id: string; notebookId: string | null }>,
): Set<string> {
  const held = new Set<string>();
  if (!coverage.notebookIds.size) return held;
  for (const canvas of canvases) {
    if (canvas.notebookId && coverage.notebookIds.has(canvas.notebookId)) held.add(canvas.id);
  }
  return held;
}

/** Graph nodes that represent held pages or canvases. */
export function expandHeldNodes(
  nodes: Array<{ id: string; pageId: string | null; canvasId: string | null }>,
  heldPages: Set<string>,
  heldCanvases: Set<string>,
): Set<string> {
  const held = new Set<string>();
  for (const node of nodes) {
    if (node.pageId && heldPages.has(node.pageId)) held.add(node.id);
    else if (node.canvasId && heldCanvases.has(node.canvasId)) held.add(node.id);
  }
  return held;
}

/** Decks live in notebooks, so a notebook hold preserves its decks too. */
export function expandHeldDecks(
  decks: Array<{ id: string; notebookId: string | null }>,
  coverage: HoldCoverage,
): Set<string> {
  const held = new Set<string>();
  if (!coverage.notebookIds.size) return held;
  for (const deck of decks) {
    if (deck.notebookId && coverage.notebookIds.has(deck.notebookId)) held.add(deck.id);
  }
  return held;
}

/** Human-readable summary for the settings list. */
export function describeLegalHoldHolders(
  holds: LegalHoldLike[],
  names: { notebook: Map<string, string>; page: Map<string, string> },
): string {
  const labels: string[] = [];
  for (const hold of holds) {
    if (hold.releasedAt) continue;
    if (hold.scope === "WORKSPACE") labels.push("the whole workspace");
    else if (hold.scope === "NOTEBOOK") {
      labels.push(names.notebook.get(hold.targetId ?? "") ?? "a notebook");
    } else if (hold.scope === "PAGE") {
      labels.push(names.page.get(hold.targetId ?? "") ?? "a page");
    }
  }
  if (!labels.length) return "Nothing is under hold.";
  return `Held: ${labels.join(", ")}.`;
}
