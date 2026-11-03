/**
 * Audit log export.
 *
 * CSV is the format compliance asks for, and the escaping is the part that
 * breaks: an audit entry can contain a comma, a quote, or a newline, and any of
 * those unescaped turns one row into two and silently corrupts the file.
 */

export interface AuditExportRow {
  /** ISO string or a Date, whichever the caller has; both are written as ISO. */
  createdAt: string | Date;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  actorId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export const AUDIT_COLUMNS = [
  "timestamp",
  "action",
  "resourceType",
  "resourceId",
  "actorId",
  "metadata",
] as const;

/** RFC 4180: quote when the value contains a delimiter, a quote, or a line break. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function metadataCell(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata || !Object.keys(metadata).length) return "";
  try {
    return JSON.stringify(metadata);
  } catch {
    return "";
  }
}

/**
 * Rows are written oldest first. A leading BOM is optional because spreadsheet
 * tools need it to read UTF-8, and plain tools do not want it.
 */
function isoStamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function auditLogToCsv(
  rows: AuditExportRow[],
  options: { bom?: boolean } = {},
): string {
  const ordered = [...rows].sort(
    (a, b) => isoStamp(a.createdAt).localeCompare(isoStamp(b.createdAt)),
  );
  const lines = [AUDIT_COLUMNS.join(",")];

  for (const row of ordered) {
    lines.push(
      [
        csvCell(isoStamp(row.createdAt)),
        csvCell(row.action),
        csvCell(row.resourceType),
        csvCell(row.resourceId),
        csvCell(row.actorId),
        csvCell(metadataCell(row.metadata)),
      ].join(","),
    );
  }

  const body = `${lines.join("\r\n")}\r\n`;
  return options.bom === false ? body : `\uFEFF${body}`;
}

export function auditExportFilename(workspaceName: string, at = new Date()): string {
  const slug =
    workspaceName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace";
  const stamp = at.toISOString().slice(0, 10);
  return `${slug}-audit-${stamp}.csv`;
}
