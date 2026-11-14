import { Prisma, type Database } from "@notes-learning/db";
import { buildSnippet, tokenize, type SearchResult } from "@notes-learning/domain";

export type SearchEntity = SearchResult["type"];

export interface WorkspaceSearchInput {
  workspaceId: string;
  query: string;
  limit: number;
  types?: SearchEntity[];
  /** Restricts page results to one notebook. */
  notebookId?: string | null;
  /** Restricts page results to these page ids. */
  pageIds?: string[];
  /**
   * "all" is web-search semantics (every term must appear). "any" ranks rows
   * that share at least one term, which is what retrieval needs for a full
   * natural-language question.
   */
  match?: "all" | "any";
  /** Null means the role can read every page in the workspace. */
  allowedPageIds: Set<string> | null;
}

interface SearchRow {
  type: string;
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  icon: string | null;
  updatedAt: Date;
  score: number;
}

const ALL_TYPES: SearchEntity[] = ["page", "canvas", "capture", "flashcard"];

/**
 * Full-text search over the workspace. Postgres owns the matching and the
 * ranking; callers get only the rows that make the result set instead of every
 * page body, canvas, capture, and card in the workspace.
 *
 * The expression indexes live in migration 20261114000000_search_indexes. The
 * query still works without them, just slower, which keeps dev databases made
 * with `db push` usable.
 */
export async function searchWorkspace(
  db: Database,
  input: WorkspaceSearchInput,
): Promise<SearchResult[]> {
  const text = input.query.trim();
  if (!text) return [];

  const wanted = new Set(input.types ?? ALL_TYPES);
  if (!wanted.size) return [];

  const limit = Math.max(1, input.limit);
  const allowed = input.allowedPageIds ? [...input.allowedPageIds] : null;
  const pageAccess = allowed
    ? Prisma.sql`AND p.id = ANY(${allowed}::text[])`
    : Prisma.empty;
  const captureAccess = allowed
    ? Prisma.sql`AND ((c.metadata->>'pageId') IS NULL OR (c.metadata->>'pageId') = ANY(${allowed}::text[]))`
    : Prisma.empty;
  const cardAccess = allowed
    ? Prisma.sql`AND (f."pageId" IS NULL OR f."pageId" = ANY(${allowed}::text[]))`
    : Prisma.empty;
  const pageScope = Prisma.sql`
    ${input.notebookId ? Prisma.sql`AND p."notebookId" = ${input.notebookId}` : Prisma.empty}
    ${input.pageIds?.length ? Prisma.sql`AND p.id = ANY(${input.pageIds}::text[])` : Prisma.empty}
  `;

  const branches: Prisma.Sql[] = [];

  if (wanted.has("page")) {
    branches.push(Prisma.sql`(
      SELECT
        'page'::text AS type,
        p.id,
        p."workspaceId",
        p.title,
        coalesce(d."plainText", '') AS body,
        p.icon,
        p."updatedAt",
        (
          ts_rank(to_tsvector('english', coalesce(p.title, '')), q.query) * 2
          + ts_rank(to_tsvector('english', coalesce(d."plainText", '')), q.query)
          + coalesce(
              ts_rank(
                to_tsvector('english', coalesce(array_to_string(taglist.tags, ' '), '')),
                q.query
              ),
              0
            ) * 0.5
        ) AS score
      FROM page p
      CROSS JOIN q
      LEFT JOIN page_document d ON d."pageId" = p.id
      LEFT JOIN LATERAL (
        SELECT array_agg(t.name ORDER BY t.name) AS tags
        FROM page_tag pt
        JOIN tag t ON t.id = pt."tagId"
        WHERE pt."pageId" = p.id
          AND t."workspaceId" = p."workspaceId"
          AND t."deletedAt" IS NULL
      ) taglist ON true
      WHERE p."workspaceId" = ${input.workspaceId}
        AND p."deletedAt" IS NULL
        ${pageAccess}
        ${pageScope}
        AND (
          to_tsvector('english', coalesce(p.title, '')) @@ q.query
          OR to_tsvector('english', coalesce(d."plainText", '')) @@ q.query
          OR EXISTS (
            SELECT 1
            FROM page_tag tagged
            JOIN tag t ON t.id = tagged."tagId"
            WHERE tagged."pageId" = p.id
              AND t."workspaceId" = p."workspaceId"
              AND t."deletedAt" IS NULL
              AND to_tsvector('english', coalesce(t.name, '')) @@ q.query
          )
        )
      ORDER BY score DESC
      LIMIT ${limit}
    )`);
  }

  if (wanted.has("canvas")) {
    branches.push(Prisma.sql`(
      SELECT
        'canvas'::text AS type,
        c.id,
        c."workspaceId",
        c.title,
        coalesce(
          (
            SELECT string_agg(coalesce(e->>'text', e->>'title'), E'\n')
            FROM jsonb_array_elements(coalesce(c.data->'elements', '[]'::jsonb)) e
            WHERE coalesce(e->>'text', e->>'title') IS NOT NULL
          ),
          ''
        ) AS body,
        c.icon,
        c."updatedAt",
        ts_rank(
          to_tsvector(
            'english',
            coalesce(c.title, '') || ' ' || coalesce(c.data::text, '')
          ),
          q.query
        ) AS score
      FROM canvas c
      CROSS JOIN q
      WHERE c."workspaceId" = ${input.workspaceId}
        AND c."deletedAt" IS NULL
        AND to_tsvector(
          'english',
          coalesce(c.title, '') || ' ' || coalesce(c.data::text, '')
        ) @@ q.query
      ORDER BY score DESC
      LIMIT ${limit}
    )`);
  }

  if (wanted.has("capture")) {
    branches.push(Prisma.sql`(
      SELECT
        'capture'::text AS type,
        c.id,
        c."workspaceId",
        coalesce(nullif(c.title, ''), c.url, 'Capture') AS title,
        concat_ws(' ', c.content, c.url) AS body,
        '⌁'::text AS icon,
        c."updatedAt",
        ts_rank(
          to_tsvector(
            'english',
            coalesce(c.title, '') || ' ' || coalesce(c.content, '') || ' ' || coalesce(c.url, '')
          ),
          q.query
        ) AS score
      FROM capture c
      CROSS JOIN q
      WHERE c."workspaceId" = ${input.workspaceId}
        AND c."deletedAt" IS NULL
        ${captureAccess}
        AND to_tsvector(
          'english',
          coalesce(c.title, '') || ' ' || coalesce(c.content, '') || ' ' || coalesce(c.url, '')
        ) @@ q.query
      ORDER BY score DESC
      LIMIT ${limit}
    )`);
  }

  if (wanted.has("flashcard")) {
    branches.push(Prisma.sql`(
      SELECT
        'flashcard'::text AS type,
        f.id,
        f."workspaceId",
        f.front AS title,
        f.back AS body,
        '◒'::text AS icon,
        f."updatedAt",
        ts_rank(
          to_tsvector('english', coalesce(f.front, '') || ' ' || coalesce(f.back, '')),
          q.query
        ) AS score
      FROM flashcard f
      CROSS JOIN q
      WHERE f."workspaceId" = ${input.workspaceId}
        AND f."deletedAt" IS NULL
        ${cardAccess}
        AND to_tsvector('english', coalesce(f.front, '') || ' ' || coalesce(f.back, '')) @@ q.query
      ORDER BY score DESC
      LIMIT ${limit}
    )`);
  }

  if (!branches.length) return [];

  const terms = tokenize(text).slice(0, 16);
  const queryExpression =
    input.match === "any" && terms.length
      ? Prisma.sql`to_tsquery('english', ${terms.join(" | ")})`
      : Prisma.sql`websearch_to_tsquery('english', ${text})`;

  const rows = await db.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH q AS (SELECT ${queryExpression} AS query)
    SELECT * FROM (
      ${Prisma.join(branches, " UNION ALL ")}
    ) AS hits
    ORDER BY score DESC, "updatedAt" DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    type: row.type as SearchEntity,
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title || "Untitled",
    snippet: buildSnippet(row.body, text),
    score: Number(row.score),
    icon: row.icon,
    updatedAt: row.updatedAt.toISOString(),
  }));
}
