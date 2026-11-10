import {
  applyBlockEdits,
  safeDoc,
  simpleMarkdownToDoc,
  type AgentOp,
} from "@notes-learning/domain";

import { client } from "@/utils/orpc";

import type { LatticeDB } from "./db";
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

  for (const op of input.ops) {
    try {
      if (op.kind === "append_blocks" || op.kind === "insert_blocks" || op.kind === "replace_blocks") {
        const document = await db.pageDocuments.get(op.pageId);
        if (!document) {
          skipped.push("A page in the plan no longer exists.");
          continue;
        }
        if (!snapshotted.has(op.pageId)) {
          snapshotted.add(op.pageId);
          await snapshotPage(op.pageId);
        }
        const result = applyBlockEdits(safeDoc(document.content), [op]);
        if (!result.applied) {
          skipped.push(...result.skipped);
          continue;
        }
        const saved = await savePageContentLocal(db, {
          pageId: op.pageId,
          content: result.doc,
          userId: input.userId,
          source: "write",
        });
        if (!saved) {
          skipped.push("A page could not be updated.");
          continue;
        }
        notifyDocumentReplaced(op.pageId, saved.content, saved.rev);
        applied += 1;
        continue;
      }

      if (op.kind === "create_page") {
        const created = await createPageLocal(db, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          notebookId: input.notebookId,
          parentId: op.parentPageId ?? null,
          title: op.title,
          content: safeDoc(simpleMarkdownToDoc(op.markdown)),
        });
        notifyDocumentReplaced(created.page.id, created.document.content);
        applied += 1;
        continue;
      }

      if (op.kind === "link_pages") {
        await upsertEdgeLocal(db, {
          workspaceId: input.workspaceId,
          userId: input.userId,
          sourceNodeId: op.sourcePageId,
          targetNodeId: op.targetPageId,
          relationType: op.relationType,
          ...(op.label ? { label: op.label } : {}),
          origin: "AI",
          aiGenerated: true,
        });
        applied += 1;
        continue;
      }

      const deck = await ensureDeckLocal(db, input.workspaceId);
      for (const card of op.cards) {
        await createFlashcardLocal(db, {
          workspaceId: input.workspaceId,
          deckId: deck.id,
          front: card.front,
          back: card.back,
          pageId: op.pageId,
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
