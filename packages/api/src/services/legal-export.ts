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
export const LEGAL_EXPORT_CAPS = {
  members: 1_000,
  notebooks: 2_000,
  pages: 5_000,
  pageVersions: 5_000,
  canvases: 2_000,
  knowledgeNodes: 10_000,
  knowledgeEdges: 20_000,
  tags: 2_000,
  pageTags: 20_000,
  comments: 10_000,
  captures: 5_000,
  templates: 1_000,
  decks: 2_000,
  flashcards: 20_000,
  attachments: 5_000,
  suggestedEdits: 5_000,
  objectTypes: 500,
  auditLog: 5_000,
} as const;

export type LegalExportCapKey = keyof typeof LEGAL_EXPORT_CAPS;

export interface LegalExportOptions {
  /** Test hook: override individual caps without generating huge fixtures. */
  caps?: Partial<Record<LegalExportCapKey, number>>;
}

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
  options: LegalExportOptions = {},
): Promise<LegalExportBundle> {
  const caps = { ...LEGAL_EXPORT_CAPS, ...options.caps };
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
    db.workspaceMember.findMany({ where: { workspaceId }, take: caps.members + 1 }),
    db.notebook.findMany({ where: { workspaceId }, take: caps.notebooks + 1 }),
    db.page.findMany({ where: { workspaceId }, take: caps.pages + 1 }),
    db.pageDocument.findMany({ where: { workspaceId }, take: caps.pages + 1 }),
    db.pageVersion.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: caps.pageVersions + 1,
    }),
    db.canvas.findMany({ where: { workspaceId }, take: caps.canvases + 1 }),
    db.knowledgeNode.findMany({ where: { workspaceId }, take: caps.knowledgeNodes + 1 }),
    db.knowledgeEdge.findMany({ where: { workspaceId }, take: caps.knowledgeEdges + 1 }),
    db.tag.findMany({ where: { workspaceId }, take: caps.tags + 1 }),
    db.pageTag.findMany({ where: { page: { workspaceId } }, take: caps.pageTags + 1 }),
    db.comment.findMany({ where: { workspaceId }, take: caps.comments + 1 }),
    db.capture.findMany({ where: { workspaceId }, take: caps.captures + 1 }),
    db.template.findMany({ where: { workspaceId }, take: caps.templates + 1 }),
    db.deck.findMany({ where: { workspaceId }, take: caps.decks + 1 }),
    db.flashcard.findMany({ where: { workspaceId }, take: caps.flashcards + 1 }),
    db.attachment.findMany({ where: { workspaceId }, take: caps.attachments + 1 }),
    db.suggestedEdit.findMany({ where: { workspaceId }, take: caps.suggestedEdits + 1 }),
    db.objectType.findMany({ where: { workspaceId }, take: caps.objectTypes + 1 }),
    db.legalHold.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
    db.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: caps.auditLog + 1,
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
    members: takeWithCap(members, caps.members, "members"),
    users,
    notebooks: takeWithCap(notebooks, caps.notebooks, "notebooks"),
    pages: takeWithCap(pages, caps.pages, "pages"),
    pageDocuments: takeWithCap(documents, caps.pages, "pageDocuments"),
    pageVersions: takeWithCap(versions, caps.pageVersions, "pageVersions"),
    canvases: takeWithCap(canvases, caps.canvases, "canvases"),
    knowledgeNodes: takeWithCap(nodes, caps.knowledgeNodes, "knowledgeNodes"),
    knowledgeEdges: takeWithCap(edges, caps.knowledgeEdges, "knowledgeEdges"),
    tags: takeWithCap(tags, caps.tags, "tags"),
    pageTags: takeWithCap(pageTags, caps.pageTags, "pageTags"),
    comments: takeWithCap(comments, caps.comments, "comments"),
    captures: takeWithCap(captures, caps.captures, "captures"),
    templates: takeWithCap(templates, caps.templates, "templates"),
    decks: takeWithCap(decks, caps.decks, "decks"),
    flashcards: takeWithCap(flashcards, caps.flashcards, "flashcards"),
    attachments: takeWithCap(attachments, caps.attachments, "attachments"),
    suggestedEdits: takeWithCap(suggestedEdits, caps.suggestedEdits, "suggestedEdits"),
    objectTypes: takeWithCap(objectTypes, caps.objectTypes, "objectTypes"),
    legalHolds: holds,
    auditLog: takeWithCap(audit, caps.auditLog, "auditLog"),
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
