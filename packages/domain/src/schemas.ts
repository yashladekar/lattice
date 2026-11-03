import { z } from "zod";

import {
  CAPTURE_STATUSES,
  CAPTURE_TYPES,
  MEMBER_STATUSES,
  NODE_KINDS,
  NOTEBOOK_KINDS,
  PAGE_TYPES,
  RELATION_TYPES,
  ROLES,
  SHARE_PERMISSIONS,
  SHARE_RESOURCE_TYPES,
  SYNC_ENTITIES,
  VISIBILITIES,
  WORKSPACE_TYPES,
} from "./types";

export const roleSchema = z.enum(ROLES);
export const visibilitySchema = z.enum(VISIBILITIES);
export const workspaceTypeSchema = z.enum(WORKSPACE_TYPES);
export const notebookKindSchema = z.enum(NOTEBOOK_KINDS);
export const pageTypeSchema = z.enum(PAGE_TYPES);
export const nodeKindSchema = z.enum(NODE_KINDS);
export const relationTypeSchema = z.enum(RELATION_TYPES);
export const captureTypeSchema = z.enum(CAPTURE_TYPES);
export const captureStatusSchema = z.enum(CAPTURE_STATUSES);
export const memberStatusSchema = z.enum(MEMBER_STATUSES);
export const shareResourceTypeSchema = z.enum(SHARE_RESOURCE_TYPES);
export const sharePermissionSchema = z.enum(SHARE_PERMISSIONS);
export const syncEntitySchema = z.enum(SYNC_ENTITIES);

export const idSchema = z.string().min(1).max(128);
export const workspaceIdSchema = z.object({ workspaceId: idSchema });

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80),
  type: workspaceTypeSchema.default("ORGANIZATION"),
  description: z.string().max(500).optional(),
});

export const ensureWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
});

export const inviteMemberInput = z.object({
  workspaceId: idSchema,
  email: z.email(),
  role: roleSchema.default("EDITOR"),
});

export const acceptInviteInput = z.object({
  token: z.string().min(8).max(256),
});

export const updateMemberInput = z.object({
  workspaceId: idSchema,
  memberId: idSchema,
  role: roleSchema.optional(),
  status: memberStatusSchema.optional(),
});

export const createNotebookInput = z.object({
  workspaceId: idSchema,
  name: z.string().trim().min(1).max(100),
  parentId: idSchema.nullable().optional(),
  kind: notebookKindSchema.default("NOTEBOOK"),
  icon: z.string().max(16).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  visibility: visibilitySchema.default("WORKSPACE"),
});

export const updateNotebookInput = z.object({
  workspaceId: idSchema,
  notebookId: idSchema,
  name: z.string().trim().min(1).max(100).optional(),
  parentId: idSchema.nullable().optional(),
  icon: z.string().max(16).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  visibility: visibilitySchema.optional(),
  sortOrder: z.number().int().optional(),
});

export const createPageInput = z.object({
  workspaceId: idSchema,
  notebookId: idSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
  title: z.string().trim().max(200).default("Untitled"),
  type: pageTypeSchema.default("DOCUMENT"),
  icon: z.string().max(16).nullable().optional(),
  visibility: visibilitySchema.default("WORKSPACE"),
  templateId: z.string().max(80).nullable().optional(),
});

export const updatePageInput = z.object({
  workspaceId: idSchema,
  pageId: idSchema,
  title: z.string().trim().max(200).optional(),
  icon: z.string().max(16).nullable().optional(),
  coverUrl: z.string().max(2000).nullable().optional(),
  notebookId: idSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  visibility: visibilitySchema.optional(),
  sortOrder: z.number().int().optional(),
  publishedAt: z.string().datetime().nullable().optional(),
});

export const savePageDocumentInput = z.object({
  workspaceId: idSchema,
  pageId: idSchema,
  baseRev: z.number().int().nonnegative(),
  content: z.record(z.string(), z.unknown()),
  plainText: z.string().max(2_000_000).optional(),
  schemaVersion: z.number().int().positive().default(1),
});

export const createCanvasInput = z.object({
  workspaceId: idSchema,
  notebookId: idSchema.nullable().optional(),
  title: z.string().trim().max(200).default("Untitled canvas"),
  icon: z.string().max(16).nullable().optional(),
  templateId: z.string().max(80).nullable().optional(),
});

export const saveCanvasInput = z.object({
  workspaceId: idSchema,
  canvasId: idSchema,
  baseRev: z.number().int().nonnegative(),
  data: z.record(z.string(), z.unknown()),
  schemaVersion: z.number().int().positive().default(1),
});

export const upsertNodeInput = z.object({
  workspaceId: idSchema,
  id: idSchema,
  kind: nodeKindSchema,
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  pageId: idSchema.nullable().optional(),
  canvasId: idSchema.nullable().optional(),
  color: z.string().max(32).nullable().optional(),
  x: z.number().nullable().optional(),
  y: z.number().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const upsertEdgeInput = z.object({
  workspaceId: idSchema,
  id: idSchema.optional(),
  sourceNodeId: idSchema,
  targetNodeId: idSchema,
  relationType: relationTypeSchema,
  label: z.string().max(200).nullable().optional(),
  weight: z.number().min(0).max(10).optional(),
  origin: z.enum(["MANUAL", "PAGE_LINK", "CANVAS_LINK", "AI"]).optional(),
  aiGenerated: z.boolean().optional(),
});

export const createCaptureInput = z.object({
  workspaceId: idSchema,
  type: captureTypeSchema.default("NOTE"),
  title: z.string().trim().max(300).default(""),
  content: z.string().max(2_000_000).nullable().optional(),
  url: z.string().max(4000).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateCaptureInput = z.object({
  workspaceId: idSchema,
  captureId: idSchema,
  title: z.string().trim().max(300).optional(),
  content: z.string().max(2_000_000).nullable().optional(),
  status: captureStatusSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const organizeCaptureInput = z.object({
  workspaceId: idSchema,
  captureId: idSchema,
  notebookId: idSchema.nullable().optional(),
});

export const generateCardsInput = z.object({
  workspaceId: idSchema,
  pageId: idSchema,
  deckId: idSchema.nullable().optional(),
});

export const reviewCardInput = z.object({
  workspaceId: idSchema,
  flashcardId: idSchema,
  rating: z.number().int().min(1).max(4),
});

export const createDeckInput = z.object({
  workspaceId: idSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  notebookId: idSchema.nullable().optional(),
});

export const createCommentInput = z.object({
  workspaceId: idSchema,
  pageId: idSchema,
  blockId: idSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
  body: z.string().trim().min(1).max(10_000),
});

export const createShareInput = z.object({
  workspaceId: idSchema,
  resourceType: shareResourceTypeSchema,
  resourceId: idSchema,
  permission: sharePermissionSchema.default("VIEW"),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export const syncOpSchema = z.object({
  opId: idSchema,
  entity: syncEntitySchema,
  entityId: idSchema,
  op: z.enum(["UPSERT", "DELETE"]),
  baseRev: z.number().int().nonnegative().optional(),
  payload: z.record(z.string(), z.unknown()),
});

export const syncPushInput = z.object({
  workspaceId: idSchema,
  ops: z.array(syncOpSchema).max(50),
});

export const syncPullInput = z.object({
  workspaceId: idSchema,
  cursor: z.string().max(200).nullable().optional(),
  limit: z.number().int().min(1).max(1000).default(500),
});

export const syncSnapshotInput = z.object({
  workspaceId: idSchema,
});

export const resolveConflictInput = z.object({
  workspaceId: idSchema,
  conflictId: idSchema,
  resolution: z.enum(["KEEP_LOCAL", "KEEP_REMOTE"]),
  content: z.record(z.string(), z.unknown()).optional(),
});

export const searchInput = z.object({
  workspaceId: idSchema,
  query: z.string().max(300),
  limit: z.number().int().min(1).max(100).default(30),
});

export const askAiInput = z.object({
  workspaceId: idSchema,
  question: z.string().trim().min(2).max(4000),
  scope: z
    .object({
      notebookId: idSchema.nullable().optional(),
      pageIds: z.array(idSchema).max(50).optional(),
    })
    .optional(),
  threadId: idSchema.nullable().optional(),
});

export const aiPageActionInput = z.object({
  workspaceId: idSchema,
  pageId: idSchema,
  action: z.enum([
    "summarize",
    "explain",
    "connections",
    "flashcards",
    "mindmap",
    "gaps",
    "outdated",
    "examples",
  ]),
});

export const createTemplateInput = z.object({
  workspaceId: idSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(16).nullable().optional(),
  category: z.string().max(50).default("Writing"),
  pageId: idSchema.optional(),
  content: z.record(z.string(), z.unknown()).optional(),
});

export const presenceInput = z.object({
  workspaceId: idSchema,
  pageId: idSchema,
});

export const publicShareInput = z.object({
  token: z.string().min(8).max(256),
  type: z.enum(["PAGE", "CANVAS", "NOTEBOOK", "GRAPH"]).default("PAGE"),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;
export type CreatePageInput = z.infer<typeof createPageInput>;
export type SyncPushInput = z.infer<typeof syncPushInput>;
export type SyncPullInput = z.infer<typeof syncPullInput>;
export type AskAiInput = z.infer<typeof askAiInput>;
