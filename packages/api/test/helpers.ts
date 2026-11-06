import { randomUUID } from "node:crypto";

import { createPrismaClient, type Database } from "@notes-learning/db";
import { describe } from "vitest";

import { hasDatabase } from "./setup";

/**
 * Each integration test owns one throwaway workspace, so tests can run in
 * parallel without seeing each other's rows. Cleanup removes every table that
 * carries a workspaceId, children first.
 *
 * The suite is not registered when there is no DATABASE_URL, so a checkout
 * without Postgres still gets a green `pnpm test` for the domain suite.
 */
export type DescribeWithDatabase = (name: string, fn: () => void) => void;

export const describeWithDatabase: DescribeWithDatabase = (name, fn) => {
  if (!hasDatabase) return;
  describe(name, fn);
};

export function createTestDatabase(): Database {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  return createPrismaClient({ DATABASE_URL: process.env.DATABASE_URL });
}

export interface TestWorkspace {
  id: string;
  ownerId: string;
  slug: string;
}

export async function createTestWorkspace(
  db: Database,
  options: { retentionDays?: number } = {},
): Promise<TestWorkspace> {
  const id = `itest_${randomUUID()}`;
  const ownerId = `itest_user_${randomUUID()}`;
  const slug = id;
  await db.workspace.create({
    data: {
      id,
      name: "Integration test",
      slug,
      ownerId,
      ...(options.retentionDays !== undefined ? { trashRetentionDays: options.retentionDays } : {}),
    },
  });
  await db.workspaceMember.create({
    data: { id: randomUUID(), workspaceId: id, userId: ownerId, role: "OWNER", status: "ACTIVE" },
  });
  return { id, ownerId, slug };
}

export async function cleanupTestWorkspace(db: Database, workspaceId: string): Promise<void> {
  await db.flashcard.deleteMany({ where: { workspaceId } });
  await db.deck.deleteMany({ where: { workspaceId } });
  await db.reviewLog.deleteMany({ where: { workspaceId } });
  await db.pageEmbedding.deleteMany({ where: { workspaceId } });
  await db.suggestedEdit.deleteMany({ where: { workspaceId } });
  await db.comment.deleteMany({ where: { workspaceId } });
  await db.attachment.deleteMany({ where: { workspaceId } });
  await db.pageVersion.deleteMany({ where: { workspaceId } });
  await db.pageDocument.deleteMany({ where: { workspaceId } });
  await db.pageTag.deleteMany({ where: { page: { workspaceId } } });
  await db.page.deleteMany({ where: { workspaceId } });
  await db.canvasVersion.deleteMany({ where: { workspaceId } });
  await db.canvas.deleteMany({ where: { workspaceId } });
  await db.knowledgeEdge.deleteMany({ where: { workspaceId } });
  await db.knowledgeNode.deleteMany({ where: { workspaceId } });
  await db.template.deleteMany({ where: { workspaceId } });
  await db.capture.deleteMany({ where: { workspaceId } });
  await db.tag.deleteMany({ where: { workspaceId } });
  await db.notebook.deleteMany({ where: { workspaceId } });
  await db.objectType.deleteMany({ where: { workspaceId } });
  await db.legalHold.deleteMany({ where: { workspaceId } });
  await db.ssoConnection.deleteMany({ where: { workspaceId } });
  await db.ssoLoginState.deleteMany({ where: { workspaceId } });
  await db.workspaceAiConfig.deleteMany({ where: { workspaceId } });
  await db.scimToken.deleteMany({ where: { workspaceId } });
  const scimGroupIds = (
    await db.scimGroup.findMany({ where: { workspaceId }, select: { id: true } })
  ).map((group) => group.id);
  if (scimGroupIds.length) {
    await db.scimGroupMember.deleteMany({ where: { groupId: { in: scimGroupIds } } });
  }
  await db.scimGroup.deleteMany({ where: { workspaceId } });
  await db.workspaceIngestToken.deleteMany({ where: { workspaceId } });
  await db.workspaceInvite.deleteMany({ where: { workspaceId } });
  await db.webhookDelivery.deleteMany({ where: { workspaceId } });
  await db.webhookEndpoint.deleteMany({ where: { workspaceId } });
  await db.notification.deleteMany({ where: { workspaceId } });
  await db.auditLog.deleteMany({ where: { workspaceId } });
  await db.syncConflict.deleteMany({ where: { workspaceId } });
  await db.syncOp.deleteMany({ where: { workspaceId } });
  await db.syncChange.deleteMany({ where: { workspaceId } });
  await db.collabDocument.deleteMany({ where: { workspaceId } });
  const teamIds = (
    await db.team.findMany({ where: { workspaceId }, select: { id: true } })
  ).map((team) => team.id);
  if (teamIds.length) {
    await db.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  await db.team.deleteMany({ where: { workspaceId } });
  await db.workspaceMember.deleteMany({ where: { workspaceId } });
  await db.workspace.deleteMany({ where: { id: workspaceId } });
}
