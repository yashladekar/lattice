import { z } from "zod";

import { createId } from "./ids";
import { RELATION_TYPES, type TipTapDoc, type TipTapNode } from "./types";

/**
 * A change plan proposed by the assistant. It is always applied by a person, on
 * their own device, through the normal document write path — nothing here
 * touches the server.
 *
 * The block allowlist is a security boundary, not tidiness: a model that emitted
 * a `pageEmbed`, `liveBlock`, or `request` block could reference content the
 * reader is not allowed to see, or make the renderer perform a network call.
 */
export const AGENT_LIMITS = {
  maxSteps: 6,
  maxOps: 12,
  maxNodesPerOp: 40,
  maxBlockIdsPerOp: 20,
  maxCardsPerOp: 20,
  maxReadChars: 6_000,
  maxTotalReadChars: 24_000,
  maxMarkdownChars: 20_000,
} as const;

const ALLOWED_NODES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "text",
]);

const ALLOWED_MARKS = new Set(["bold", "italic", "strike", "code", "underline", "highlight"]);

const MAX_DEPTH = 8;

export type AgentOp =
  | { kind: "append_blocks"; pageId: string; nodes: TipTapNode[] }
  | { kind: "insert_blocks"; pageId: string; afterBlockId: string; nodes: TipTapNode[] }
  | {
      kind: "replace_blocks";
      pageId: string;
      blockIds: string[];
      nodes: TipTapNode[];
    }
  | {
      kind: "create_page";
      /** Plan-local alias so later ops can target a page that does not exist yet. */
      ref?: string;
      title: string;
      markdown: string;
      parentPageId?: string;
    }
  | {
      kind: "link_pages";
      sourcePageId: string;
      targetPageId: string;
      relationType: (typeof RELATION_TYPES)[number];
      label?: string;
    }
  | {
      kind: "create_flashcards";
      pageId: string;
      cards: Array<{ front: string; back: string }>;
    };

export interface AgentPlan {
  title: string;
  ops: AgentOp[];
}

/**
 * A page id that only exists inside one plan. `create_page` declares it; any
 * other op may use it, which is how a plan links or edits pages it is creating.
 */
export const PLAN_REF_PREFIX = "ref:";

export function isPlanRef(value: string): boolean {
  return value.startsWith(PLAN_REF_PREFIX);
}

/** Every alias declared by this plan's `create_page` ops. */
export function planRefs(plan: AgentPlan): Set<string> {
  const refs = new Set<string>();
  for (const op of plan.ops) {
    if (op.kind === "create_page" && op.ref) refs.add(op.ref);
  }
  return refs;
}

export type BlockEdit = Extract<
  AgentOp,
  { kind: "append_blocks" | "insert_blocks" | "replace_blocks" }
>;

function normalizeMarks(value: unknown): TipTapNode["marks"] {
  if (!Array.isArray(value)) return undefined;
  const marks: NonNullable<TipTapNode["marks"]> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const type = (entry as { type?: unknown }).type;
    if (typeof type !== "string" || !ALLOWED_MARKS.has(type)) continue;
    marks.push({ type });
  }
  return marks.length ? marks : undefined;
}

function normalizeNode(value: unknown, depth: number): TipTapNode | null {
  if (depth > MAX_DEPTH) return null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : null;
  if (!type || !ALLOWED_NODES.has(type)) return null;

  if (type === "text") {
    const text = typeof record.text === "string" ? record.text : null;
    if (!text) return null;
    const marks = normalizeMarks(record.marks);
    return { type: "text", text, ...(marks ? { marks } : {}) };
  }

  const node: TipTapNode = { type };

  if (type === "heading") {
    const raw = record.attrs;
    const level =
      raw && typeof raw === "object"
        ? Number((raw as Record<string, unknown>).level)
        : Number.NaN;
    node.attrs = {
      level: Number.isFinite(level) ? Math.min(3, Math.max(1, Math.round(level))) : 2,
    };
  }
  if (type === "taskItem") {
    const raw = record.attrs;
    const checked =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>).checked === true
        : false;
    node.attrs = { checked };
  }
  if (type === "codeBlock") {
    const raw = record.attrs;
    const language =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>).language : null;
    if (typeof language === "string" && /^[a-z0-9+#._-]{1,24}$/i.test(language)) {
      node.attrs = { language };
    }
  }

  const children = Array.isArray(record.content) ? record.content : null;
  if (children) {
    const content = children.flatMap((child) => {
      const normalized = normalizeNode(child, depth + 1);
      return normalized ? [normalized] : [];
    });
    if (content.length) node.content = content;
  }
  return node;
}

/** Drops unknown block types, unsafe marks, and anything past the per-op cap. */
export function normalizeAgentNodes(value: unknown): TipTapNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: TipTapNode[] = [];
  for (const entry of value) {
    const node = normalizeNode(entry, 0);
    if (!node) continue;
    nodes.push(node);
    if (nodes.length >= AGENT_LIMITS.maxNodesPerOp) break;
  }
  return nodes;
}

const pageIdSchema = z.string().min(1).max(128);
const nodesField = z.unknown();

const agentOpShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("append_blocks"), pageId: pageIdSchema, nodes: nodesField }),
  z.object({
    kind: z.literal("insert_blocks"),
    pageId: pageIdSchema,
    afterBlockId: pageIdSchema,
    nodes: nodesField,
  }),
  z.object({
    kind: z.literal("replace_blocks"),
    pageId: pageIdSchema,
    blockIds: z.array(pageIdSchema).min(1).max(AGENT_LIMITS.maxBlockIdsPerOp),
    nodes: nodesField,
  }),
  z.object({
    kind: z.literal("create_page"),
    ref: z.string().trim().min(1).max(80).optional(),
    title: z.string().trim().min(1).max(120),
    markdown: z.string().min(1).max(AGENT_LIMITS.maxMarkdownChars),
    parentPageId: pageIdSchema.optional(),
  }),
  z.object({
    kind: z.literal("link_pages"),
    sourcePageId: pageIdSchema,
    targetPageId: pageIdSchema,
    relationType: z.enum([...RELATION_TYPES]),
    label: z.string().trim().max(80).optional(),
  }),
  z.object({
    kind: z.literal("create_flashcards"),
    pageId: pageIdSchema,
    cards: z
      .array(
        z.object({
          front: z.string().trim().min(1).max(500),
          back: z.string().trim().min(1).max(2_000),
        }),
      )
      .min(1)
      .max(AGENT_LIMITS.maxCardsPerOp),
  }),
]);

const agentPlanShape = z.object({
  title: z.string().trim().min(1).max(120),
  ops: z.array(agentOpShape).min(1),
});

/**
 * Models rarely copy a prefix twice, so `fundamentals` and `ref:fundamentals`
 * are the same alias. Anything that cannot make a usable slug is dropped
 * rather than failing the whole plan.
 */
export function normalizePlanRef(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/^ref:/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${PLAN_REF_PREFIX}${slug}` : null;
}

function canonicalizeOpRefs(op: AgentOp, canonical: Map<string, string>): AgentOp {
  const fix = (value: string) => canonical.get(value) ?? value;
  switch (op.kind) {
    case "append_blocks":
    case "insert_blocks":
    case "replace_blocks":
    case "create_flashcards":
      return { ...op, pageId: fix(op.pageId) };
    case "create_page":
      return {
        ...op,
        ...(op.parentPageId ? { parentPageId: fix(op.parentPageId) } : {}),
      };
    case "link_pages":
      return { ...op, sourcePageId: fix(op.sourcePageId), targetPageId: fix(op.targetPageId) };
  }
}

function normalizeOp(
  raw: z.infer<typeof agentOpShape>,
  warnings: string[],
): AgentOp | null {
  if (raw.kind === "append_blocks" || raw.kind === "insert_blocks" || raw.kind === "replace_blocks") {
    const nodes = normalizeAgentNodes(raw.nodes);
    if (!nodes.length) {
      warnings.push("A change was dropped because it contained no supported blocks.");
      return null;
    }
    if (raw.kind === "append_blocks") return { kind: raw.kind, pageId: raw.pageId, nodes };
    if (raw.kind === "insert_blocks") {
      return {
        kind: raw.kind,
        pageId: raw.pageId,
        afterBlockId: raw.afterBlockId,
        nodes,
      };
    }
    return { kind: raw.kind, pageId: raw.pageId, blockIds: raw.blockIds, nodes };
  }
  if (raw.kind === "create_page") {
    const ref = raw.ref ? normalizePlanRef(raw.ref) : null;
    return {
      kind: raw.kind,
      title: raw.title,
      markdown: raw.markdown,
      ...(ref ? { ref } : {}),
      ...(raw.parentPageId ? { parentPageId: raw.parentPageId } : {}),
    };
  }
  if (raw.kind === "link_pages") {
    return {
      kind: raw.kind,
      sourcePageId: raw.sourcePageId,
      targetPageId: raw.targetPageId,
      relationType: raw.relationType,
      ...(raw.label ? { label: raw.label } : {}),
    };
  }
  return { kind: raw.kind, pageId: raw.pageId, cards: raw.cards };
}

/**
 * Validates a model-authored plan: shape first, then the block allowlist, then
 * the op cap. Anything unusable is dropped and reported, never applied.
 */
export function normalizeAgentPlan(value: unknown): {
  plan: AgentPlan | null;
  warnings: string[];
} {
  const warnings: string[] = [];
  const parsed = agentPlanShape.safeParse(value);
  if (!parsed.success) {
    return { plan: null, warnings: ["The proposed plan was not readable."] };
  }

  const ops: AgentOp[] = [];
  const seenRefs = new Set<string>();
  for (const raw of parsed.data.ops) {
    if (ops.length >= AGENT_LIMITS.maxOps) {
      warnings.push(`Only the first ${AGENT_LIMITS.maxOps} changes were kept.`);
      break;
    }
    const op = normalizeOp(raw, warnings);
    if (!op) continue;
    if (op.kind === "create_page" && op.ref) {
      if (seenRefs.has(op.ref)) {
        warnings.push(`“${op.ref}” was declared twice, so one page was dropped.`);
        continue;
      }
      seenRefs.add(op.ref);
    }
    ops.push(op);
  }
  if (!ops.length) return { plan: null, warnings };

  // Aliases may be written with or without the prefix; canonicalise every
  // reference against the aliases this plan actually declares.
  const canonical = new Map<string, string>();
  for (const op of ops) {
    if (op.kind !== "create_page" || !op.ref) continue;
    canonical.set(op.ref, op.ref);
    canonical.set(op.ref.slice(PLAN_REF_PREFIX.length), op.ref);
  }
  const resolved = ops.map((op) => canonicalizeOpRefs(op, canonical));

  return { plan: { title: parsed.data.title, ops: resolved }, warnings };
}

function withFreshBlockIds(node: TipTapNode): TipTapNode {
  if (node.type === "text") return node;
  const copy: TipTapNode = { ...node, attrs: { ...(node.attrs ?? {}), blockId: createId() } };
  if (node.content) copy.content = node.content.map(withFreshBlockIds);
  return copy;
}

function blockIdOfNode(node: TipTapNode): string | null {
  const id = node.attrs?.blockId ?? node.attrs?.id;
  return typeof id === "string" ? id : null;
}

function topLevelIndex(content: TipTapNode[], blockId: string): number {
  return content.findIndex((node) => blockIdOfNode(node) === blockId);
}

/**
 * Applies block edits to a document. Only top-level blocks can be targeted,
 * which is what `read_page` exposes in its outline. Unknown block ids are
 * skipped rather than throwing, so a stale plan degrades instead of failing.
 */
export function applyBlockEdits(
  doc: TipTapDoc,
  edits: readonly BlockEdit[],
): { doc: TipTapDoc; applied: number; skipped: string[] } {
  let content = [...doc.content];
  const skipped: string[] = [];
  let applied = 0;

  for (const edit of edits) {
    if (edit.kind === "append_blocks") {
      const nodes = edit.nodes.map(withFreshBlockIds);
      if (content.length === 1 && content[0]?.type === "paragraph" && !content[0]?.content) {
        content = nodes;
      } else {
        content = [...content, ...nodes];
      }
      applied += 1;
      continue;
    }

    if (edit.kind === "insert_blocks") {
      const index = topLevelIndex(content, edit.afterBlockId);
      if (index === -1) {
        skipped.push(`No block ${edit.afterBlockId} to insert after.`);
        continue;
      }
      const nodes = edit.nodes.map(withFreshBlockIds);
      content = [...content.slice(0, index + 1), ...nodes, ...content.slice(index + 1)];
      applied += 1;
      continue;
    }

    const targets = new Set(edit.blockIds);
    const nodes = edit.nodes.map(withFreshBlockIds);
    const next: TipTapNode[] = [];
    let inserted = false;
    for (const node of content) {
      const id = blockIdOfNode(node);
      if (id === null || !targets.has(id)) {
        next.push(node);
        continue;
      }
      if (!inserted) {
        next.push(...nodes);
        inserted = true;
      }
    }
    if (!inserted) {
      skipped.push("No matching block to replace.");
      continue;
    }
    content = next;
    applied += 1;
  }

  return { doc: { type: "doc", content }, applied, skipped };
}

/** Short human summary used by the approval card and the thread history. */
export function describeAgentOp(op: AgentOp): string {
  switch (op.kind) {
    case "append_blocks":
      return `Append ${op.nodes.length} block${op.nodes.length === 1 ? "" : "s"}`;
    case "insert_blocks":
      return `Insert ${op.nodes.length} block${op.nodes.length === 1 ? "" : "s"}`;
    case "replace_blocks":
      return `Replace ${op.blockIds.length} block${op.blockIds.length === 1 ? "" : "s"}`;
    case "create_page":
      return `Create page “${op.title}”`;
    case "link_pages":
      return `Link pages (${op.relationType.toLowerCase().replace(/_/g, " ")})`;
    case "create_flashcards":
      return `${op.cards.length} flashcard${op.cards.length === 1 ? "" : "s"}`;
  }
}
