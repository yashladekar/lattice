import { createConsoleQueryValidator } from "@notes-learning/domain";
import type { Database } from "@notes-learning/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CONSOLE_ROW_LIMIT = 500;
const STATEMENT_TIMEOUT_MS = 4000;
const TRANSACTION_TIMEOUT_MS = 8000;
const MAX_CELL_LENGTH = 2000;

/**
 * Everything the console can see. Each view filters itself to the caller's
 * workspace, so a query cannot reach another tenant even by accident.
 */
const VIEWS: Array<{ name: string; description: string; select: string }> = [
  {
    name: "pages",
    description: "Live pages with their notebook",
    select: `
      SELECT p.id, p.title, p.icon, p.type, p.visibility, p.properties,
             p."notebookId" AS notebook_id, n.name AS notebook,
             p."parentId" AS parent_id, p."createdAt" AS created_at, p."updatedAt" AS updated_at
      FROM page p
      LEFT JOIN notebook n ON n.id = p."notebookId"
      WHERE p."workspaceId" = current_setting('lattice.workspace_id', true) AND p."deletedAt" IS NULL`,
  },
  {
    name: "page_bodies",
    description: "Document text length and revision per page",
    select: `
      SELECT d."pageId" AS page_id, p.title, d.rev, d."schemaVersion" AS schema_version,
             length(d."plainText") AS characters,
             coalesce(array_length(regexp_split_to_array(trim(d."plainText"), '\\s+'), 1), 0) AS words,
             d."updatedAt" AS updated_at
      FROM page_document d
      JOIN page p ON p.id = d."pageId"
      WHERE d."workspaceId" = current_setting('lattice.workspace_id', true) AND p."deletedAt" IS NULL`,
  },
  {
    name: "notebooks",
    description: "Notebooks and their page counts",
    select: `
      SELECT n.id, n.name, n.description, n.kind, n."parentId" AS parent_id,
             (SELECT count(*) FROM page p WHERE p."notebookId" = n.id AND p."deletedAt" IS NULL) AS page_count,
             n."createdAt" AS created_at, n."updatedAt" AS updated_at
      FROM notebook n
      WHERE n."workspaceId" = current_setting('lattice.workspace_id', true) AND n."deletedAt" IS NULL`,
  },
  {
    name: "tags",
    description: "Tags and how many pages carry them",
    select: `
      SELECT t.id, t.name, t.color,
             (SELECT count(*) FROM page_tag pt WHERE pt."tagId" = t.id) AS page_count,
             t."createdAt" AS created_at
      FROM tag t
      WHERE t."workspaceId" = current_setting('lattice.workspace_id', true) AND t."deletedAt" IS NULL`,
  },
  {
    name: "page_tags",
    description: "Tag assignments per page",
    select: `
      SELECT pt.id, pt."pageId" AS page_id, p.title, t.name AS tag, pt.source, pt."createdAt" AS created_at
      FROM page_tag pt
      JOIN page p ON p.id = pt."pageId"
      JOIN tag t ON t.id = pt."tagId"
      WHERE p."workspaceId" = current_setting('lattice.workspace_id', true) AND p."deletedAt" IS NULL`,
  },
  {
    name: "captures",
    description: "Inbox captures",
    select: `
      SELECT c.id, c.type, c.title, c.url, c.source, c.status,
             length(coalesce(c.content, '')) AS characters,
             c."createdAt" AS created_at
      FROM capture c
      WHERE c."workspaceId" = current_setting('lattice.workspace_id', true) AND c."deletedAt" IS NULL`,
  },
  {
    name: "attachments",
    description: "Uploaded files",
    select: `
      SELECT a.id, a.name, a.mime, a.size, a."pageId" AS page_id, a.url, a."createdAt" AS created_at
      FROM attachment a
      WHERE a."workspaceId" = current_setting('lattice.workspace_id', true) AND a."deletedAt" IS NULL`,
  },
  {
    name: "comments",
    description: "Page comments",
    select: `
      SELECT c.id, c."pageId" AS page_id, p.title, c."blockId" AS block_id,
             c."resolvedAt" IS NOT NULL AS resolved, length(c.body) AS characters,
             c."createdAt" AS created_at
      FROM comment c
      JOIN page p ON p.id = c."pageId"
      WHERE c."workspaceId" = current_setting('lattice.workspace_id', true) AND c."deletedAt" IS NULL`,
  },
  {
    name: "decks",
    description: "Spaced-repetition decks",
    select: `
      SELECT d.id, d.name, d.description,
             (SELECT count(*) FROM flashcard f WHERE f."deckId" = d.id AND f."deletedAt" IS NULL) AS card_count,
             d."createdAt" AS created_at
      FROM deck d
      WHERE d."workspaceId" = current_setting('lattice.workspace_id', true) AND d."deletedAt" IS NULL`,
  },
  {
    name: "flashcards",
    description: "Cards with their scheduling state",
    select: `
      SELECT f.id, f."deckId" AS deck_id, d.name AS deck, f."pageId" AS page_id,
             f.front, f.back, f.source, f.interval, f.ease, f.reps, f.lapses,
             f."dueAt" AS due_at, f."lastReviewedAt" AS last_reviewed_at
      FROM flashcard f
      JOIN deck d ON d.id = f."deckId"
      WHERE f."workspaceId" = current_setting('lattice.workspace_id', true) AND f."deletedAt" IS NULL`,
  },
  {
    name: "nodes",
    description: "Knowledge graph nodes",
    select: `
      SELECT n.id, n.kind, n.title, n."pageId" AS page_id, n."canvasId" AS canvas_id,
             n."aiGenerated" AS ai_generated, n.x, n.y, n."createdAt" AS created_at
      FROM knowledge_node n
      WHERE n."workspaceId" = current_setting('lattice.workspace_id', true) AND n."deletedAt" IS NULL`,
  },
  {
    name: "edges",
    description: "Knowledge graph edges",
    select: `
      SELECT e.id, e."relationType" AS relation_type, e.label, e.weight, e.origin,
             e."aiGenerated" AS ai_generated,
             s.title AS source, t.title AS target, e."createdAt" AS created_at
      FROM knowledge_edge e
      JOIN knowledge_node s ON s.id = e."sourceNodeId"
      JOIN knowledge_node t ON t.id = e."targetNodeId"
      WHERE e."workspaceId" = current_setting('lattice.workspace_id', true) AND e."deletedAt" IS NULL`,
  },
  {
    name: "versions",
    description: "Page version history",
    select: `
      SELECT v.id, v."pageId" AS page_id, v.title, v.version, v.note, v."createdAt" AS created_at
      FROM page_version v
      WHERE v."workspaceId" = current_setting('lattice.workspace_id', true)`,
  },
  {
    name: "activity",
    description: "Audit log entries",
    select: `
      SELECT a.id, a.action, a."resourceType" AS resource_type, a."resourceId" AS resource_id,
             a."actorId" AS actor_id, a.metadata, a."createdAt" AS created_at
      FROM audit_log a
      WHERE a."workspaceId" = current_setting('lattice.workspace_id', true)`,
  },
  {
    name: "members",
    description: "Workspace members",
    select: `
      SELECT m.id, m.role, m.status, u.name, u.email, m."createdAt" AS joined_at
      FROM workspace_member m
      JOIN "user" u ON u.id = m."userId"
      WHERE m."workspaceId" = current_setting('lattice.workspace_id', true) AND m."deletedAt" IS NULL`,
  },
];

const ALLOWED_VIEWS = VIEWS.map((view) => view.name);
const validateConsoleQuery = createConsoleQueryValidator(ALLOWED_VIEWS);

let viewsReady: Promise<void> | null = null;

/** Views live in their own schema; creating them is idempotent and cheap. */
export async function ensureConsoleViews(db: Database): Promise<void> {
  viewsReady ??= (async () => {
    await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS console`);
    for (const view of VIEWS) {
      await db.$executeRawUnsafe(
        `CREATE OR REPLACE VIEW console.${view.name} AS ${view.select}`,
      );
    }
  })().catch((error: unknown) => {
    viewsReady = null;
    throw error;
  });
  return viewsReady;
}

function toCell(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.length > MAX_CELL_LENGTH ? `${value.slice(0, MAX_CELL_LENGTH)}…` : value;
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json.length > MAX_CELL_LENGTH ? `${json.slice(0, MAX_CELL_LENGTH)}…` : value;
    } catch {
      return "[unserialisable]";
    }
  }
  return value;
}

export interface ConsoleResult {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

/**
 * Runs a validated query in a read-only transaction against the console
 * schema, with the caller's workspace bound for the duration. Postgres
 * rejects writes, the statement timeout bounds runaway scans, and the wrapped
 * subquery caps how many rows come back.
 */
export async function runConsoleQuery(
  db: Database,
  input: { workspaceId: string; sql: string },
): Promise<ConsoleResult> {
  if (!UUID.test(input.workspaceId)) throw new Error("Unknown workspace");
  const validated = validateConsoleQuery(input.sql);
  if ("error" in validated) throw new Error(validated.error);

  await ensureConsoleViews(db);

  const started = Date.now();
  return db.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      await tx.$executeRawUnsafe("SET LOCAL search_path = console, pg_catalog");
      await tx.$executeRawUnsafe(`SET LOCAL lattice.workspace_id = '${input.workspaceId}'`);

      const wrapped = `SELECT * FROM (${validated.sql}) AS lattice_query LIMIT ${CONSOLE_ROW_LIMIT + 1}`;
      const result = (await tx.$queryRawUnsafe(wrapped)) as Array<Record<string, unknown>>;
      const truncated = result.length > CONSOLE_ROW_LIMIT;
      const page = truncated ? result.slice(0, CONSOLE_ROW_LIMIT) : result;

      return {
        columns: page[0] ? Object.keys(page[0]) : [],
        rows: page.map((row) => {
          const mapped: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) mapped[key] = toCell(value);
          return mapped;
        }),
        rowCount: page.length,
        truncated,
        durationMs: Date.now() - started,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 5000 },
  );
}

export interface ConsoleView {
  name: string;
  description: string;
  columns: Array<{ name: string; type: string }>;
}

export async function describeConsoleViews(db: Database): Promise<ConsoleView[]> {
  await ensureConsoleViews(db);
  const rows = (await db.$queryRawUnsafe(
    `SELECT table_name, column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'console'
     ORDER BY table_name, ordinal_position`,
  )) as Array<{ table_name: string; column_name: string; data_type: string }>;

  return VIEWS.map((view) => ({
    name: view.name,
    description: view.description,
    columns: rows
      .filter((row) => row.table_name === view.name)
      .map((row) => ({ name: row.column_name, type: row.data_type })),
  }));
}
