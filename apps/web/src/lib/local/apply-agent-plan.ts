import {
  applyBlockEdits,
  isPlanRef,
  safeDoc,
  simpleMarkdownToDoc,
  type AgentOp,
} from "@notes-learning/domain";

import { client } from "@/utils/orpc";

import type { LatticeDB } from "./db";
import { getEditorBlockApplier } from "./editor-bridge";
import {
  createFlashcardLocal,
  createPageLocal,
  ensureDeckLocal,
  savePageContentLocal,
  upsertEdgeLocal,
} from "./repository";

/**
 * Applies an approved change plan on the device that approved it.
 *
 * It deliberately goes through the same local repository calls a person's own
 * edits use: the outbox pushes a revision-aware document op, the change log
 * carries it to other devices, and a page open in the editor is told to reload.
 * Writing server-side instead would race the live CRDT room.
 */
export interface ApplyAgentPlanInput {
  workspaceId: string;
  userId: string;
  notebookId: string | null;
  ops: readonly AgentOp[];
}

export interface ApplyAgentPlanResult {
  applied: number;
  skipped: string[];
}

export const DOCUMENT_REPLACED_EVENT = "lattice:document-replaced";

function notifyDocumentReplaced(pageId: string, content: unknown, rev?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DOCUMENT_REPLACED_EVENT, {
      detail: { pageId, content, ...(typeof rev === "number" ? { rev } : {}) },
    }),
  );
}

async function snapshotPage(pageId: string): Promise<void> {
  // Best effort: offline, or a viewer, simply has no snapshot. The plan card
  // already warned about permissions before this ran.
  try {
    await client.page.saveVersion({ pageId, note: "Before AI edit" });
  } catch {
    // Not fatal — the edit still applies.
  }
}

export async function applyAgentPlan(
  db: LatticeDB,
  input: ApplyAgentPlanInput,
): Promise<ApplyAgentPlanResult> {
  let applied = 0;
  const skipped: string[] = [];
  const snapshotted = new Set<string>();
  const createdHere = new Set<string>();
  /** Plan-local aliases, resolved as pages are created. */
  const refToId = new Map<string, string>();

  const snapshotOnce = async (pageId: string) => {
    if (snapshotted.has(pageId) || createdHere.has(pageId)) return;
    snapshotted.add(pageId);
    await snapshotPage(pageId);
  };

  /** Turns a plan ref into the page id created in this run, if it exists. */
  const resolvePageId = (value: string): string | null =>
    isPlanRef(value) ? (refToId.get(value) ?? null) : value;

  // Pages first: a later op may target a page this plan creates, and its id only
  // exists once the page does. Within each pass, plan order is preserved.
  const creates = input.ops.filter((op) => op.kind === "create_page");
  const others = input.ops.filter((op) => op.kind !== "create_page");
  const ordered: AgentOp[] = [...creates, ...others];

  for (const op of ordered) {
    try {
      if (op.kind === "create_page") {
        let parentId: string | null = null;
        if (op.parentPageId) {
          parentId = resolvePageId(op.parentPageId);
          if (parentId === null) {
            skipped.push("A page was skipped because its parent is not in this plan.");
            continue;
          }
        }
        const created = await createPageLocal(db, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          notebookId: input.notebookId,
          parentId,
          title: op.title,
          content: safeDoc(simpleMarkdownToDoc(op.markdown)),
        });
        createdHere.add(created.page.id);
        if (op.ref) refToId.set(op.ref, created.page.id);
        notifyDocumentReplaced(created.page.id, created.document.content);
        applied += 1;
        continue;
      }

      const pageId = "pageId" in op ? resolvePageId(op.pageId) : null;
      if ("pageId" in op && pageId === null) {
        skipped.push("A change referenced a page this plan did not create.");
        continue;
      }

      if (op.kind === "append_blocks" || op.kind === "insert_blocks" || op.kind === "replace_blocks") {
        if (!pageId) continue;
        // A mounted editor owns the live document and the Yjs room. Applying
        // there makes the change a normal transaction; its own debounced persist
        // writes the store, so we must not also write Dexie here.
        const applier = getEditorBlockApplier(pageId);
        if (applier) {
          await snapshotOnce(pageId);
          const viaEditor = applier.apply([op]);
          if (viaEditor.applied) {
            applied += 1;
            continue;
          }
          skipped.push(...viaEditor.skipped);
        }

        const document = await db.pageDocuments.get(pageId);
        if (!document) {
          skipped.push("A page in the plan no longer exists.");
          continue;
        }
        await snapshotOnce(pageId);
        const result = applyBlockEdits(safeDoc(document.content), [op]);
        if (!result.applied) {
          skipped.push(...result.skipped);
          continue;
        }
        const saved = await savePageContentLocal(db, {
          pageId,
          content: result.doc,
          userId: input.userId,
          source: "write",
        });
        if (!saved) {
          skipped.push("A page could not be updated.");
          continue;
        }
        notifyDocumentReplaced(pageId, saved.content, saved.rev);
        applied += 1;
        continue;
      }

      if (op.kind === "link_pages") {
        const sourceId = resolvePageId(op.sourcePageId);
        const targetId = resolvePageId(op.targetPageId);
        if (sourceId === null || targetId === null) {
          skipped.push("A link was skipped because one of its pages is not in this plan.");
          continue;
        }
        await upsertEdgeLocal(db, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          relationType: op.relationType,
          ...(op.label ? { label: op.label } : {}),
          origin: "AI",
          aiGenerated: true,
        });
        applied += 1;
        continue;
      }

      if (!pageId) continue;
      const deck = await ensureDeckLocal(db, input.workspaceId);
      for (const card of op.cards) {
        await createFlashcardLocal(db, {
          workspaceId: input.workspaceId,
          deckId: deck.id,
          front: card.front,
          back: card.back,
          pageId,
          source: "AI",
        });
      }
      applied += 1;
    } catch {
      skipped.push("A change could not be applied.");
    }
  }

  return { applied, skipped };
}
