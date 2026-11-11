import type { Database } from "@notes-learning/db";
import {
  AGENT_LIMITS,
  blockIdOf,
  nodePlainText,
  relatedDocuments,
  safeDoc,
  type Role,
} from "@notes-learning/domain";
import { z } from "zod";

import { assertPageReadable } from "../services/page-access";
import { retrievePages } from "../services/retrieval";
import { getAccessiblePageIds } from "../services/sync";

/**
 * Everything the agent can do on the server is a read. Writes are proposed as a
 * plan and applied by the person who approved it, on their own device, through
 * the normal document write path — never here.
 *
 * Tool names and inputs are fixed in this module. The model never supplies a
 * URL, a table name, or a user id.
 */
export interface AgentToolContext {
  db: Database;
  workspaceId: string;
  userId: string;
  role: Role;
  /** Running character budget so one question cannot read the whole workspace. */
  readBudget: { used: number };
}

export interface AgentToolResult {
  /** One short line for the UI trace, e.g. `Read “Spaced repetition”`. */
  label: string;
  /** JSON payload handed back to the model. */
  data: unknown;
}

const pageIdField = z.string().min(1).max(128);
const readPageInput = z.object({ pageId: pageIdField });

const TOOL_INPUTS = {
  search_pages: z.object({
    query: z.string().trim().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(10).optional(),
  }),
  read_page: readPageInput,
  related_pages: readPageInput,
  graph_neighbors: readPageInput,
  list_pages: z.object({
    limit: z.coerce.number().int().min(1).max(20).optional(),
    blankOnly: z.coerce.boolean().optional(),
  }),
} as const;

export type AgentToolName = keyof typeof TOOL_INPUTS;

export const AGENT_TOOL_NAMES = Object.keys(TOOL_INPUTS) as AgentToolName[];

export function isAgentToolName(value: string): value is AgentToolName {
  return Object.hasOwn(TOOL_INPUTS, value);
}

export const AGENT_TOOL_CATALOGUE = `- search_pages { "query": string, "limit"?: 1-10 }
    Find pages by words in their title or body. Returns pageId, title, excerpt.
- read_page { "pageId": string }
    Read one page. Returns its title, plain text, and an outline of top-level
    blocks with the blockId needed for insert/replace ops.
- related_pages { "pageId": string }
    Pages that share vocabulary with the given page.
- graph_neighbors { "pageId": string }
    Typed relations in and out of this page's graph node.
- list_pages { "limit"?: 1-20, "blankOnly"?: boolean }
    The most recently updated pages the reader can access, with a "chars" count.
    Pass "blankOnly": true to list only pages whose body is empty.`;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function takeBudget(context: AgentToolContext, requested: number): number {
  const remaining = AGENT_LIMITS.maxTotalReadChars - context.readBudget.used;
  return Math.max(0, Math.min(requested, remaining));
}

async function loadReadablePage(context: AgentToolContext, pageId: string) {
  await assertPageReadable(
    context.db,
    context.workspaceId,
    pageId,
    context.userId,
    context.role,
  );
  const page = await context.db.page.findFirst({
    where: { id: pageId, workspaceId: context.workspaceId, deletedAt: null },
  });
  if (!page) throw new Error("That page does not exist.");
  return page;
}

async function searchPages(
  context: AgentToolContext,
  input: z.infer<typeof TOOL_INPUTS.search_pages>,
): Promise<AgentToolResult> {
  const limit = input.limit ?? 6;
  const pages = await retrievePages(
    context.db,
    context.workspaceId,
    context.userId,
    context.role,
    input.query,
    undefined,
    limit,
  );
  return {
    label: `Searched “${truncate(input.query, 60)}”`,
    data: pages.map((page) => ({
      pageId: page.pageId,
      title: page.title,
      excerpt: page.excerpt,
      updatedAt: page.updatedAt,
    })),
  };
}

async function readPage(
  context: AgentToolContext,
  input: z.infer<typeof TOOL_INPUTS.read_page>,
): Promise<AgentToolResult> {
  const page = await loadReadablePage(context, input.pageId);
  const document = await context.db.pageDocument.findUnique({
    where: { pageId: page.id },
    select: { content: true, plainText: true },
  });
  const doc = safeDoc(document?.content);
  const budget = takeBudget(context, AGENT_LIMITS.maxReadChars);
  if (budget === 0) {
    return {
      label: `Skipped reading “${truncate(page.title, 60)}”`,
      data: { error: "Reading budget exhausted for this question." },
    };
  }
  const plainText = (document?.plainText ?? "").slice(0, budget);
  context.readBudget.used += plainText.length;

  return {
    label: `Read “${truncate(page.title, 60)}”`,
    data: {
      pageId: page.id,
      title: page.title,
      plainText,
      truncated: (document?.plainText?.length ?? 0) > plainText.length,
      outline: doc.content.map((node) => ({
        blockId: blockIdOf(node),
        type: node.type,
        text: truncate(nodePlainText(node), 160),
      })),
    },
  };
}

async function relatedPages(
  context: AgentToolContext,
  input: z.infer<typeof TOOL_INPUTS.related_pages>,
): Promise<AgentToolResult> {
  const page = await loadReadablePage(context, input.pageId);
  const allowed = await getAccessiblePageIds(
    context.db,
    context.workspaceId,
    context.userId,
    context.role,
  );
  const pages = await context.db.page.findMany({
    where: {
      workspaceId: context.workspaceId,
      deletedAt: null,
      ...(allowed ? { id: { in: [...allowed] } } : {}),
    },
    take: 500,
  });
  const documents = await context.db.pageDocument.findMany({
    where: {
      workspaceId: context.workspaceId,
      pageId: { in: pages.map((entry) => entry.id) },
    },
    select: { pageId: true, plainText: true },
  });
  const bodyByPage = new Map(documents.map((entry) => [entry.pageId, entry.plainText]));
  const related = relatedDocuments(
    { id: page.id, title: page.title, body: bodyByPage.get(page.id) ?? "" },
    pages
      .filter((entry) => entry.id !== page.id)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        body: bodyByPage.get(entry.id) ?? "",
      })),
    5,
  ).filter((entry) => entry.score > 0.05);

  return {
    label: `Found ${related.length} related page${related.length === 1 ? "" : "s"}`,
    data: related.map((entry) => ({
      pageId: entry.id,
      title: entry.title,
      score: Math.round(entry.score * 100) / 100,
    })),
  };
}

async function graphNeighbors(
  context: AgentToolContext,
  input: z.infer<typeof TOOL_INPUTS.graph_neighbors>,
): Promise<AgentToolResult> {
  const page = await loadReadablePage(context, input.pageId);
  const edges = await context.db.knowledgeEdge.findMany({
    where: {
      workspaceId: context.workspaceId,
      deletedAt: null,
      OR: [{ sourceNodeId: page.id }, { targetNodeId: page.id }],
    },
    take: 40,
  });
  const neighbourIds = [
    ...new Set(
      edges.flatMap((edge) => [edge.sourceNodeId, edge.targetNodeId]).filter((id) => id !== page.id),
    ),
  ];
  const nodes = neighbourIds.length
    ? await context.db.knowledgeNode.findMany({
        where: { id: { in: neighbourIds }, workspaceId: context.workspaceId, deletedAt: null },
        select: { id: true, title: true, kind: true },
      })
    : [];
  const titleById = new Map(nodes.map((node) => [node.id, node.title]));

  const direction = (
    id: string,
    relationType: string,
    origin: string,
  ): { pageId: string; title: string; relation: string; origin: string } | null => {
    const title = titleById.get(id);
    return title ? { pageId: id, title, relation: relationType, origin } : null;
  };

  return {
    label: `Read the graph around “${truncate(page.title, 60)}”`,
    data: {
      outgoing: edges
        .filter((edge) => edge.sourceNodeId === page.id)
        .map((edge) => direction(edge.targetNodeId, edge.relationType, edge.origin))
        .filter((entry) => entry !== null),
      incoming: edges
        .filter((edge) => edge.targetNodeId === page.id)
        .map((edge) => direction(edge.sourceNodeId, edge.relationType, edge.origin))
        .filter((entry) => entry !== null),
    },
  };
}

async function listPages(
  context: AgentToolContext,
  input: z.infer<typeof TOOL_INPUTS.list_pages>,
): Promise<AgentToolResult> {
  const allowed = await getAccessiblePageIds(
    context.db,
    context.workspaceId,
    context.userId,
    context.role,
  );
  const pages = await context.db.page.findMany({
    where: {
      workspaceId: context.workspaceId,
      deletedAt: null,
      ...(allowed ? { id: { in: [...allowed] } } : {}),
      ...(input.blankOnly
        ? { OR: [{ document: { is: { plainText: "" } } }, { document: { is: null } }] }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: input.limit ?? 10,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      document: { select: { plainText: true } },
    },
  });
  return {
    label: `Listed ${pages.length} recent page${pages.length === 1 ? "" : "s"}`,
    data: pages.map((page) => ({
      pageId: page.id,
      title: page.title,
      // Lets the model spot blank pages without reading every one of them.
      chars: page.document?.plainText.length ?? 0,
      updatedAt: page.updatedAt.toISOString(),
    })),
  };
}

/**
 * Runs one tool call. Failures are returned as tool data rather than thrown so
 * the model can recover, and so a missing page never leaks whether it exists.
 */
export async function runAgentTool(
  context: AgentToolContext,
  name: string,
  input: unknown,
): Promise<AgentToolResult> {
  if (!isAgentToolName(name)) {
    return { label: `Unknown tool: ${name}`, data: { error: `Unknown tool "${name}".` } };
  }
  const parsed = TOOL_INPUTS[name].safeParse(input ?? {});
  if (!parsed.success) {
    return {
      label: `Rejected ${name}`,
      data: { error: `Invalid input for ${name}.` },
    };
  }

  try {
    switch (name) {
      case "search_pages":
        return await searchPages(context, parsed.data as z.infer<typeof TOOL_INPUTS.search_pages>);
      case "read_page":
        return await readPage(context, parsed.data as z.infer<typeof TOOL_INPUTS.read_page>);
      case "related_pages":
        return await relatedPages(
          context,
          parsed.data as z.infer<typeof TOOL_INPUTS.related_pages>,
        );
      case "graph_neighbors":
        return await graphNeighbors(
          context,
          parsed.data as z.infer<typeof TOOL_INPUTS.graph_neighbors>,
        );
      case "list_pages":
        return await listPages(context, parsed.data as z.infer<typeof TOOL_INPUTS.list_pages>);
    }
  } catch {
    return { label: `Could not run ${name}`, data: { error: `${name} could not be completed.` } };
  }
}
