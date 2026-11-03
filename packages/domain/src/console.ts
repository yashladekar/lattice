const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|reindex|refresh|call|do|set|reset|begin|commit|rollback|savepoint|release|listen|notify|prepare|deallocate|execute|declare|fetch|move|lock|cluster|discard|checkpoint|into|security)\b/i;

const FORBIDDEN_SCHEMAS = /\b(public|information_schema|pg_catalog|pg_temp)\b|pg_/i;

const TABLE_REFERENCE = /\b(?:from|join)\s+([a-zA-Z_][\w$]*)(?:\.([a-zA-Z_][\w$]*))?/gi;

/** `name as (` … — the shape of a CTE definition, so `with x as (...) from x` works. */
const COMMON_TABLE_EXPRESSION = /\b([a-zA-Z_][\w$]*)\s+as\s*(?:not\s+)?(?:materialized\s+)?\(/gi;

/** Blanks comments and string bodies so the checks cannot be hidden behind them. */
export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''");
}

export interface ConsoleQueryValidator {
  (raw: string): { sql: string } | { error: string };
  allowedViews: readonly string[];
}

/**
 * Builds a validator for a fixed set of workspace-scoped views. Rejections are
 * worded for the person typing the query, and each one names a single rule so
 * a failure is easy to act on.
 */
export function createConsoleQueryValidator(allowedViews: readonly string[]): ConsoleQueryValidator {
  const allowed = new Set(allowedViews.map((view) => view.toLowerCase()));

  const validate = (raw: string): { sql: string } | { error: string } => {
    const sql = raw.trim().replace(/;+\s*$/, "");
    if (!sql) return { error: "Write a query to run." };
    if (sql.includes("$$")) return { error: "Dollar-quoted strings are not supported." };

    const cleaned = stripSqlNoise(sql);
    if (cleaned.includes(";")) return { error: "Run one statement at a time." };

    // Checked before the shape of the statement, so a write reports itself.
    const forbidden = cleaned.match(FORBIDDEN_KEYWORDS);
    if (forbidden?.[0]) {
      return { error: `${forbidden[0].toUpperCase()} is not allowed in the console.` };
    }
    if (!/^(select|with)\b/i.test(cleaned)) {
      return { error: "Only SELECT and WITH queries are allowed." };
    }
    if (FORBIDDEN_SCHEMAS.test(cleaned)) {
      return { error: "Only the console views are queryable; other schemas are blocked." };
    }

    const localNames = new Set<string>();
    for (const match of cleaned.matchAll(COMMON_TABLE_EXPRESSION)) {
      const name = match[1];
      if (name) localNames.add(name.toLowerCase());
    }

    for (const match of cleaned.matchAll(TABLE_REFERENCE)) {
      const qualifier = match[1] ?? "";
      const qualified = match[2];
      const name = qualified ?? qualifier;
      if (qualified && qualifier.toLowerCase() !== "console") {
        return { error: `Schema "${qualifier}" is not queryable. Use the console views instead.` };
      }
      const lower = name.toLowerCase();
      if (localNames.has(lower)) continue;
      if (!allowed.has(lower)) {
        return {
          error: `"${name}" is not a console view. Available: ${[...allowed].join(", ")}.`,
        };
      }
    }

    return { sql };
  };

  return Object.assign(validate, { allowedViews }) as ConsoleQueryValidator;
}
