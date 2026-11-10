import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { nodePlainText, type BlockEdit, type TipTapNode } from "@notes-learning/domain";

import type { BlockApplyResult } from "@/lib/local/editor-bridge";

interface TopLevelBlock {
  blockId: string | null;
  from: number;
  to: number;
}

interface Mutation {
  from: number;
  to: number;
  nodes: ProseMirrorNode[];
}

/**
 * A model-authored block cannot be allowed to break the editor. If it does not
 * fit the schema (an unknown mark, a node type this build dropped), fall back to
 * its plain text in a paragraph.
 */
function toProseMirror(schema: Editor["schema"], node: TipTapNode): ProseMirrorNode {
  try {
    return schema.nodeFromJSON(node);
  } catch {
    const text = nodePlainText(node).replace(/\s+/g, " ").trim();
    return schema.node("paragraph", null, text ? [schema.text(text)] : []);
  }
}

function topLevelBlocks(editor: Editor): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  editor.state.doc.forEach((node, offset) => {
    const blockId =
      typeof node.attrs.blockId === "string"
        ? node.attrs.blockId
        : typeof node.attrs.id === "string"
          ? node.attrs.id
          : null;
    blocks.push({ blockId, from: offset, to: offset + node.nodeSize });
  });
  return blocks;
}

/**
 * Applies block edits to the editor's current document in a single transaction,
 * so peers receive one update and undo sees one step.
 *
 * Positions come from the live document, not from whatever snapshot the plan was
 * built against: a block id that has since disappeared is skipped, never guessed.
 */
export function applyBlockEditsToEditor(
  editor: Editor,
  edits: readonly BlockEdit[],
): BlockApplyResult {
  if (editor.isDestroyed) {
    return { applied: 0, skipped: ["The editor is closed."] };
  }

  const schema = editor.schema;
  const blocks = topLevelBlocks(editor);
  const mutations: Mutation[] = [];
  const replaced = new Set<string>();
  const skipped: string[] = [];
  let applied = 0;

  for (const edit of edits) {
    if (edit.kind === "append_blocks") {
      const doc = editor.state.doc;
      const nodes = edit.nodes.map((node) => toProseMirror(schema, node));
      const first = doc.firstChild;
      const onlyEmptyParagraph =
        mutations.length === 0 &&
        doc.childCount === 1 &&
        first !== null &&
        first.type.name === "paragraph" &&
        first.content.size === 0;
      // Match the store path: appending to an untouched note replaces the empty
      // starter paragraph instead of leaving a blank line above the new blocks.
      mutations.push(
        onlyEmptyParagraph && first
          ? { from: 0, to: first.nodeSize, nodes }
          : { from: doc.content.size, to: doc.content.size, nodes },
      );
      applied += 1;
      continue;
    }

    if (edit.kind === "insert_blocks") {
      const target = blocks.find((entry) => entry.blockId === edit.afterBlockId);
      if (!target) {
        skipped.push(`No block ${edit.afterBlockId} to insert after.`);
        continue;
      }
      mutations.push({
        from: target.to,
        to: target.to,
        nodes: edit.nodes.map((node) => toProseMirror(schema, node)),
      });
      applied += 1;
      continue;
    }

    const wanted = new Set(edit.blockIds);
    const matched = blocks.filter(
      (entry) => entry.blockId !== null && wanted.has(entry.blockId) && !replaced.has(entry.blockId),
    );
    if (!matched.length) {
      skipped.push("No matching block to replace.");
      continue;
    }

    const nodes = edit.nodes.map((node) => toProseMirror(schema, node));
    const [first, ...rest] = matched;
    if (!first) continue;
    replaced.add(first.blockId ?? "");
    mutations.push({ from: first.from, to: first.to, nodes });
    for (const extra of rest) {
      if (extra.blockId) replaced.add(extra.blockId);
      // Mirror the store-level rule: drop the other matched blocks where they
      // are rather than swallowing whatever sits between them.
      mutations.push({ from: extra.from, to: extra.to, nodes: [] });
    }
    applied += 1;
  }

  if (!mutations.length) return { applied: 0, skipped };

  // Highest offset first, so earlier positions stay valid in the same transaction.
  mutations.sort((a, b) => b.from - a.from);

  const tr = editor.state.tr;
  for (const mutation of mutations) {
    if (!mutation.nodes.length) {
      if (mutation.to > mutation.from) tr.delete(mutation.from, mutation.to);
    } else if (mutation.to > mutation.from) {
      tr.replaceWith(mutation.from, mutation.to, mutation.nodes);
    } else {
      tr.insert(mutation.from, mutation.nodes);
    }
  }
  // Dispatching is how typing reaches Yjs; no focus() so the drawer keeps it.
  editor.view.dispatch(tr);

  return { applied, skipped };
}
