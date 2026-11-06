import type { Database } from "@notes-learning/db";
import { extractPageLinks, safeDoc, type Role } from "@notes-learning/domain";

import { getAccessiblePageIds } from "./sync";

export interface VersionTimelineEntryDto {
  id: string;
  pageId: string;
  version: number;
  title: string;
  createdAt: Date;
  links: string[];
}

/**
 * Compact version history for graph playback: every workspace version the
 * member can read, newest first, with the page links that version contained.
 * Version bodies are parsed here and never leave the server — the client only
 * needs to know which links existed when.
 */
export async function versionTimeline(
  db: Database,
  input: { workspaceId: string; userId: string; role: Role; limit: number },
): Promise<VersionTimelineEntryDto[]> {
  const allowed = await getAccessiblePageIds(db, input.workspaceId, input.userId, input.role);
  const versions = await db.pageVersion.findMany({
    where: {
      workspaceId: input.workspaceId,
      ...(allowed ? { pageId: { in: [...allowed] } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    select: {
      id: true,
      pageId: true,
      version: true,
      title: true,
      createdAt: true,
      content: true,
    },
  });
  return versions.map((version) => ({
    id: version.id,
    pageId: version.pageId,
    version: version.version,
    title: version.title,
    createdAt: version.createdAt,
    links: extractPageLinks(safeDoc(version.content)).map((link) => link.pageId),
  }));
}
