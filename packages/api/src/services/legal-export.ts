import type { Database } from "@notes-learning/db";

/**
 * Builds a self-contained JSON bundle for a legal request.
 *
 * It includes soft-deleted rows on purpose — a hold exists precisely to
 * preserve content that ordinary retention would remove — and it never includes
 * credentials: no SSO client secret, no webhook signing secrets, no ingest or
 * SCIM token hashes. Every list is capped and truncation is reported, so a
 * consumer knows when the bundle is partial.
 */
const CAPS = {
  pages: 5_000,
  pageVersions: 5_000,
  audit: 5_000,
  comments: 10_000,
} as const;

export interface LegalExportBundle {
  generatedAt: string;
  workspaceId: string;
  counts: Record<string, number>;
  truncated: string[];
  data: Record<string, unknown>;
}

export async function buildLegalExport(
  db: Database,
  workspaceId: string,
): Promise<LegalExportBundle> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error("Workspace not found.");

  const [
    members,
    notebooks,
    pages,
    documents,
    versions,
    canvases,
    nodes,
    edges,
    tags,
    pageTags,
    comments,
    captures,
    templates,
    decks,
    flashcards,
    attachments,
    suggestedEdits,
    objectTypes,
    holds,
    audit,
  ] = await Promise.all([
    db.workspaceMember.findMany({ where: { workspaceId } }),
    db.notebook.findMany({ where: { workspaceId } }),
    db.page.findMany({ where: { workspaceId }, take: CAPS.pages + 1 }),
    db.pageDocument.findMany({ where: { workspaceId } }),
    db.pageVersion.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: CAPS.pageVersions + 1,
    }),
    db.canvas.findMany({ where: { workspaceId } }),
    db.knowledgeNode.findMany({ where: { workspaceId } }),
    db.knowledgeEdge.findMany({ where: { workspaceId } }),
    db.tag.findMany({ where: { workspaceId } }),
    db.pageTag.findMany({ where: { page: { workspaceId } } }),
    db.comment.findMany({ where: { workspaceId }, take: CAPS.comments + 1 }),
    db.capture.findMany({ where: { workspaceId } }),
    db.template.findMany({ where: { workspaceId } }),
    db.deck.findMany({ where: { workspaceId } }),
    db.flashcard.findMany({ where: { workspaceId } }),
    db.attachment.findMany({ where: { workspaceId } }),
    db.suggestedEdit.findMany({ where: { workspaceId } }),
    db.objectType.findMany({ where: { workspaceId } }),
    db.legalHold.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: CAPS.audit + 1,
    }),
  ]);

  const users = await db.user.findMany({
    where: { id: { in: members.map((member) => member.userId) } },
    select: { id: true, name: true, email: true, emailVerified: true, createdAt: true },
  });

  const truncated: string[] = [];
  const takeWithCap = <T>(rows: T[], cap: number, label: string): T[] => {
    if (rows.length <= cap) return rows;
    truncated.push(label);
    return rows.slice(0, cap);
  };

  const data = {
    workspace,
    members,
    users,
    notebooks,
    pages: takeWithCap(pages, CAPS.pages, "pages"),
    pageDocuments: documents,
    pageVersions: takeWithCap(versions, CAPS.pageVersions, "pageVersions"),
    canvases,
    knowledgeNodes: nodes,
    knowledgeEdges: edges,
    tags,
    pageTags,
    comments: takeWithCap(comments, CAPS.comments, "comments"),
    captures,
    templates,
    decks,
    flashcards,
    attachments,
    suggestedEdits,
    objectTypes,
    legalHolds: holds,
    auditLog: takeWithCap(audit, CAPS.audit, "auditLog"),
  };

  const counts = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : 1]),
  );

  return {
    generatedAt: new Date().toISOString(),
    workspaceId,
    counts,
    truncated,
    data,
  };
}
