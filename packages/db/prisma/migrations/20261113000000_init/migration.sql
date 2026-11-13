-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "workspace_ai_config" (
    "workspaceId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embeddingModel" TEXT,
    "transcribeModel" TEXT,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_ai_config_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatgpt_host" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "hostId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatgpt_host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatgpt_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "idToken" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "accessExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "model" TEXT,
    "planEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "lastRequestId" TEXT,
    "lastRefreshedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chatgpt_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatgpt_login_state" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "clientId" TEXT,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatgpt_login_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_ai_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chatSource" TEXT NOT NULL DEFAULT 'auto',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_ai_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "blockId" TEXT,
    "parentId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggested_edit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "baseRev" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "suggested_edit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_link" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'VIEW',
    "includeSubPages" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_permission" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resource_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_endpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Webhook',
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastDeliveryAt" TIMESTAMPTZ(3),
    "lastStatus" INTEGER,

    CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_document" (
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "collab_document_pkey" PRIMARY KEY ("resourceType","resourceId")
);

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERSONAL',
    "description" TEXT,
    "icon" TEXT,
    "accent" TEXT,
    "ownerId" TEXT NOT NULL,
    "syncVersion" INTEGER NOT NULL DEFAULT 0,
    "trashRetentionDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_ingest_token" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "workspace_ingest_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_member" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "externalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "workspace_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_token" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "scim_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_group" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scim_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scim_group_member" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "scim_group_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2f6b4f',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notebook" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'NOTEBOOK',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'WORKSPACE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notebookId" TEXT,
    "parentId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "title" TEXT NOT NULL DEFAULT 'Untitled',
    "icon" TEXT,
    "coverUrl" TEXT,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'WORKSPACE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_document" (
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
    "plainText" TEXT NOT NULL DEFAULT '',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_document_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "page_version" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notebookId" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Untitled canvas',
    "icon" TEXT,
    "data" JSONB NOT NULL DEFAULT '{"version":1,"elements":[]}',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "rev" INTEGER NOT NULL DEFAULT 0,
    "thumbnail" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "canvas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_version" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Writing',
    "content" JSONB NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NOTE',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT,
    "url" TEXT,
    "source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INBOX',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pageId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "tokenType" TEXT NOT NULL DEFAULT 'bearer',
    "accessToken" TEXT NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "github_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_login_state" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'oauth',
    "deviceCode" TEXT,
    "userCode" TEXT,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 5,
    "returnTo" TEXT NOT NULL DEFAULT '/app?view=settings&tab=sync',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_login_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_node" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TOPIC',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pageId" TEXT,
    "canvasId" TEXT,
    "color" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_edge" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL DEFAULT 'RELATED_TO',
    "label" TEXT,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_edge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#8b8b7a',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_tag" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_type" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2f6b4f',
    "description" TEXT,
    "properties" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "object_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_embedding" (
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "vector" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "page_embedding_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "deck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "notebookId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2f6b4f',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "deck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flashcard" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "deckId" TEXT NOT NULL,
    "pageId" TEXT,
    "blockId" TEXT,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "hint" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "dueAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interval" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "flashcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_log" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "flashcardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previousDueAt" TIMESTAMPTZ(3) NOT NULL,
    "nextDueAt" TIMESTAMPTZ(3) NOT NULL,
    "interval" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "review_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_hold" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "releasedById" TEXT,

    CONSTRAINT "legal_hold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_connection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "domains" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sso_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_login_state" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "redirect" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_login_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_thread" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ai_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "provider" TEXT,
    "plan" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_change" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_op" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "result" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_op_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflict" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseRev" INTEGER NOT NULL,
    "remoteRev" INTEGER NOT NULL,
    "localData" JSONB NOT NULL,
    "remoteData" JSONB NOT NULL,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "sync_conflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "chatgpt_host_hostId_key" ON "chatgpt_host"("hostId");

-- CreateIndex
CREATE INDEX "chatgpt_connection_userId_idx" ON "chatgpt_connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chatgpt_connection_userId_clientId_key" ON "chatgpt_connection"("userId", "clientId");

-- CreateIndex
CREATE INDEX "chatgpt_login_state_expiresAt_idx" ON "chatgpt_login_state"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_ai_preference_userId_workspaceId_key" ON "user_ai_preference"("userId", "workspaceId");

-- CreateIndex
CREATE INDEX "comment_pageId_createdAt_idx" ON "comment"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "comment_workspaceId_updatedAt_idx" ON "comment"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "suggested_edit_workspaceId_status_updatedAt_idx" ON "suggested_edit"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "suggested_edit_pageId_status_idx" ON "suggested_edit"("pageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "share_link_tokenHash_key" ON "share_link"("tokenHash");

-- CreateIndex
CREATE INDEX "share_link_workspaceId_resourceType_resourceId_idx" ON "share_link"("workspaceId", "resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "resource_permission_workspaceId_userId_idx" ON "resource_permission"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "resource_permission_resourceType_resourceId_userId_key" ON "resource_permission"("resourceType", "resourceId", "userId");

-- CreateIndex
CREATE INDEX "audit_log_workspaceId_createdAt_idx" ON "audit_log"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_actorId_idx" ON "audit_log"("actorId");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_createdAt_idx" ON "notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "device_userId_idx" ON "device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "device_userId_id_key" ON "device"("userId", "id");

-- CreateIndex
CREATE INDEX "webhook_endpoint_workspaceId_updatedAt_idx" ON "webhook_endpoint"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "webhook_delivery_status_nextAttemptAt_idx" ON "webhook_delivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "webhook_delivery_workspaceId_createdAt_idx" ON "webhook_delivery"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "collab_document_workspaceId_idx" ON "collab_document"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_slug_key" ON "workspace"("slug");

-- CreateIndex
CREATE INDEX "workspace_ownerId_idx" ON "workspace"("ownerId");

-- CreateIndex
CREATE INDEX "workspace_updatedAt_idx" ON "workspace"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ingest_token_workspaceId_key" ON "workspace_ingest_token"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_ingest_token_tokenHash_key" ON "workspace_ingest_token"("tokenHash");

-- CreateIndex
CREATE INDEX "workspace_ingest_token_workspaceId_idx" ON "workspace_ingest_token"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_member_userId_idx" ON "workspace_member"("userId");

-- CreateIndex
CREATE INDEX "workspace_member_workspaceId_externalId_idx" ON "workspace_member"("workspaceId", "externalId");

-- CreateIndex
CREATE INDEX "workspace_member_workspaceId_updatedAt_idx" ON "workspace_member"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_member_workspaceId_userId_key" ON "workspace_member"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "scim_token_tokenHash_key" ON "scim_token"("tokenHash");

-- CreateIndex
CREATE INDEX "scim_token_workspaceId_createdAt_idx" ON "scim_token"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "scim_group_workspaceId_updatedAt_idx" ON "scim_group"("workspaceId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "scim_group_workspaceId_displayName_key" ON "scim_group"("workspaceId", "displayName");

-- CreateIndex
CREATE INDEX "scim_group_member_memberId_idx" ON "scim_group_member"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "scim_group_member_groupId_memberId_key" ON "scim_group_member"("groupId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invite_tokenHash_key" ON "workspace_invite"("tokenHash");

-- CreateIndex
CREATE INDEX "workspace_invite_workspaceId_idx" ON "workspace_invite"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_invite_email_idx" ON "workspace_invite"("email");

-- CreateIndex
CREATE INDEX "team_workspaceId_idx" ON "team"("workspaceId");

-- CreateIndex
CREATE INDEX "team_member_userId_idx" ON "team_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_member_teamId_userId_key" ON "team_member"("teamId", "userId");

-- CreateIndex
CREATE INDEX "notebook_workspaceId_updatedAt_idx" ON "notebook"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "notebook_workspaceId_parentId_idx" ON "notebook"("workspaceId", "parentId");

-- CreateIndex
CREATE INDEX "page_workspaceId_updatedAt_idx" ON "page"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "page_workspaceId_notebookId_idx" ON "page"("workspaceId", "notebookId");

-- CreateIndex
CREATE INDEX "page_workspaceId_parentId_idx" ON "page"("workspaceId", "parentId");

-- CreateIndex
CREATE INDEX "page_createdById_idx" ON "page"("createdById");

-- CreateIndex
CREATE INDEX "page_document_workspaceId_idx" ON "page_document"("workspaceId");

-- CreateIndex
CREATE INDEX "page_version_workspaceId_createdAt_idx" ON "page_version"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "page_version_pageId_version_key" ON "page_version"("pageId", "version");

-- CreateIndex
CREATE INDEX "canvas_workspaceId_updatedAt_idx" ON "canvas"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "canvas_workspaceId_notebookId_idx" ON "canvas"("workspaceId", "notebookId");

-- CreateIndex
CREATE INDEX "canvas_version_workspaceId_createdAt_idx" ON "canvas_version"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_version_canvasId_version_key" ON "canvas_version"("canvasId", "version");

-- CreateIndex
CREATE INDEX "template_workspaceId_updatedAt_idx" ON "template"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "capture_workspaceId_status_updatedAt_idx" ON "capture"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "capture_workspaceId_createdAt_idx" ON "capture"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "attachment_workspaceId_pageId_idx" ON "attachment"("workspaceId", "pageId");

-- CreateIndex
CREATE UNIQUE INDEX "github_connection_userId_key" ON "github_connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "github_login_state_deviceCode_key" ON "github_login_state"("deviceCode");

-- CreateIndex
CREATE INDEX "github_login_state_expiresAt_idx" ON "github_login_state"("expiresAt");

-- CreateIndex
CREATE INDEX "github_login_state_userId_idx" ON "github_login_state"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_node_pageId_key" ON "knowledge_node"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_node_canvasId_key" ON "knowledge_node"("canvasId");

-- CreateIndex
CREATE INDEX "knowledge_node_workspaceId_updatedAt_idx" ON "knowledge_node"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "knowledge_node_workspaceId_kind_idx" ON "knowledge_node"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "knowledge_edge_workspaceId_updatedAt_idx" ON "knowledge_edge"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "knowledge_edge_workspaceId_sourceNodeId_idx" ON "knowledge_edge"("workspaceId", "sourceNodeId");

-- CreateIndex
CREATE INDEX "knowledge_edge_workspaceId_targetNodeId_idx" ON "knowledge_edge"("workspaceId", "targetNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_edge_sourceNodeId_targetNodeId_relationType_origi_key" ON "knowledge_edge"("sourceNodeId", "targetNodeId", "relationType", "origin");

-- CreateIndex
CREATE INDEX "tag_workspaceId_idx" ON "tag"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "tag_workspaceId_name_key" ON "tag"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "page_tag_tagId_idx" ON "page_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "page_tag_pageId_tagId_key" ON "page_tag"("pageId", "tagId");

-- CreateIndex
CREATE INDEX "object_type_workspaceId_updatedAt_idx" ON "object_type"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "page_embedding_workspaceId_idx" ON "page_embedding"("workspaceId");

-- CreateIndex
CREATE INDEX "deck_workspaceId_updatedAt_idx" ON "deck"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "flashcard_workspaceId_dueAt_idx" ON "flashcard"("workspaceId", "dueAt");

-- CreateIndex
CREATE INDEX "flashcard_workspaceId_pageId_idx" ON "flashcard"("workspaceId", "pageId");

-- CreateIndex
CREATE INDEX "flashcard_deckId_idx" ON "flashcard"("deckId");

-- CreateIndex
CREATE INDEX "review_log_workspaceId_reviewedAt_idx" ON "review_log"("workspaceId", "reviewedAt");

-- CreateIndex
CREATE INDEX "review_log_userId_idx" ON "review_log"("userId");

-- CreateIndex
CREATE INDEX "legal_hold_workspaceId_releasedAt_idx" ON "legal_hold"("workspaceId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "sso_connection_workspaceId_key" ON "sso_connection"("workspaceId");

-- CreateIndex
CREATE INDEX "sso_login_state_expiresAt_idx" ON "sso_login_state"("expiresAt");

-- CreateIndex
CREATE INDEX "ai_thread_workspaceId_userId_updatedAt_idx" ON "ai_thread"("workspaceId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ai_message_threadId_createdAt_idx" ON "ai_message"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_change_workspaceId_version_id_idx" ON "sync_change"("workspaceId", "version", "id");

-- CreateIndex
CREATE INDEX "sync_change_workspaceId_createdAt_idx" ON "sync_change"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_op_workspaceId_createdAt_idx" ON "sync_op"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "sync_conflict_workspaceId_resolvedAt_createdAt_idx" ON "sync_conflict"("workspaceId", "resolvedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notebook" ADD CONSTRAINT "notebook_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "notebook"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_document" ADD CONSTRAINT "page_document_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_version" ADD CONSTRAINT "page_version_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_version" ADD CONSTRAINT "canvas_version_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edge" ADD CONSTRAINT "knowledge_edge_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "knowledge_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edge" ADD CONSTRAINT "knowledge_edge_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "knowledge_node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_tag" ADD CONSTRAINT "page_tag_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_tag" ADD CONSTRAINT "page_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flashcard" ADD CONSTRAINT "flashcard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "deck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_log" ADD CONSTRAINT "review_log_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_message" ADD CONSTRAINT "ai_message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ai_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

