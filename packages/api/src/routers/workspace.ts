import { randomBytes, randomUUID } from "node:crypto";

import type { Database, TransactionClient } from "@notes-learning/db";
import {
  hasRole,
  slugify,
  createId,
  inviteMemberInput,
  normalizeIssuer,
  parseSsoDomains,
  updateMemberInput,
  createWorkspaceInput,
  describeLegalHoldHolders,
  ensureWorkspaceInput,
  maskApiKey,
  normalizeAiBaseUrl,
  normalizeModelName,
} from "@notes-learning/domain";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { decryptAiKey, discoverOidc, encryptAiKey, encryptSsoSecret } from "@notes-learning/auth";

import { createToken, hashToken, requireMembership, writeAudit } from "../authz";
import { protectedProcedure, workspaceProcedure } from "../index";
import { appendChanges, toJsonSafe } from "../services/changes";
import { buildLegalExport } from "../services/legal-export";

function welcomeDocument(targetPageId: string | null) {
  return {
    type: "doc",
    content: [
      {
        type: "callout",
        attrs: { title: "Welcome to Lattice", emoji: "✦", color: "saffron" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Lattice connects writing, visual thinking, and learning in one local-first workspace. Everything you create is saved on this device first.",
              },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Start with one thought" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Type something below. Press ",
          },
          { type: "text", text: "/", marks: [{ type: "code" }] },
          { type: "text", text: " for blocks, " },
          { type: "text", text: "@", marks: [{ type: "code" }] },
          { type: "text", text: " to mention a page or person, and " },
          { type: "text", text: "[[", marks: [{ type: "code" }] },
          { type: "text", text: " to link another note." },
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Write a note about something you are learning" }] },
            ],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Create a whiteboard and connect two ideas" }] },
            ],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Review the memory cards generated from your notes" }] },
            ],
          },
        ],
      },
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "The five verbs" }],
      },
      {
        type: "bulletList",
        content: [
          ["Create", "capture and write without friction."],
          ["Connect", "link notes, pages, and ideas."],
          ["Visualize", "think spatially on an infinite canvas."],
          ["Understand", "turn notes into retrieval practice."],
          ["Build", "turn understanding into projects and decisions."],
        ].map(([title, body]) => ({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: title ?? "", marks: [{ type: "bold" }] },
                { type: "text", text: ` — ${body ?? ""}` },
              ],
            },
          ],
        })),
      },
      ...(targetPageId
        ? [
            {
              type: "heading",
              attrs: { level: 2 },
              content: [{ type: "text", text: "Go deeper" }],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "pageLink",
                  attrs: { pageId: targetPageId, title: "How Lattice thinks", icon: "◈" },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

const guideDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "One knowledge model, many views" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Pages, whiteboards, topics, and flashcards are all first-class objects in the same graph. A view never creates a copy of your content — it is another lens on the same records.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Local-first by default" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Your browser stores a full copy of your workspace in IndexedDB. The server is a sync and collaboration authority, not a gatekeeper. You can keep working when the network disappears, and export everything at any time.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Relationships are content" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Use [[ page links for lightweight connections, then add typed relationships such as depends on, explains, or prerequisite of when the structure matters.",
        },
      ],
    },
    {
      type: "callout",
      attrs: { title: "Try this", emoji: "↺", color: "moss" },
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open the graph, find this page, and add a relation. Then generate flashcards from your notes." },
          ],
        },
      ],
    },
  ],
};

async function uniqueWorkspaceSlug(
  tx: TransactionClient,
  name: string,
): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let attempt = 0;
  while (await tx.workspace.findUnique({ where: { slug }, select: { id: true } })) {
    attempt += 1;
    slug = `${base}-${randomUUID().slice(0, 6)}`;
    if (attempt > 5) break;
  }
  return slug;
}

async function createDefaultNotebook(
  tx: TransactionClient,
  workspaceId: string,
  userId: string,
  name = "My knowledge",
): Promise<{ id: string }> {
  return tx.notebook.create({
    data: {
      id: createId(),
      workspaceId,
      name,
      icon: "◫",
      color: "#2f6b4f",
      visibility: "WORKSPACE",
      createdById: userId,
    },
    select: { id: true },
  });
}

async function seedWelcome(
  tx: TransactionClient,
  workspaceId: string,
  userId: string,
  notebookId: string,
): Promise<void> {
  const guideId = createId();
  const guidePage = await tx.page.create({
    data: {
      id: guideId,
      workspaceId,
      notebookId,
      title: "How Lattice thinks",
      icon: "◈",
      type: "DOCUMENT",
      visibility: "WORKSPACE",
      createdById: userId,
      updatedById: userId,
      sortOrder: 1,
    },
  });
  await tx.pageDocument.create({
    data: {
      pageId: guidePage.id,
      workspaceId,
      content: guideDocument,
      plainText:
        "One knowledge model, many views. Pages, whiteboards, topics, and flashcards are all first-class objects in the same graph.",
    },
  });
  await tx.knowledgeNode.create({
    data: {
      id: guidePage.id,
      workspaceId,
      kind: "PAGE",
      title: guidePage.title,
      pageId: guidePage.id,
      createdById: userId,
    },
  });

  const welcomeId = createId();
  const welcome = await tx.page.create({
    data: {
      id: welcomeId,
      workspaceId,
      notebookId,
      title: "Welcome to Lattice",
      icon: "✦",
      type: "DOCUMENT",
      visibility: "WORKSPACE",
      createdById: userId,
      updatedById: userId,
      sortOrder: 0,
    },
  });
  await tx.pageDocument.create({
    data: {
      pageId: welcome.id,
      workspaceId,
      content: welcomeDocument(guidePage.id),
      plainText:
        "Welcome to Lattice. Lattice connects writing, visual thinking, and learning in one local-first workspace.",
    },
  });
  await tx.knowledgeNode.create({
    data: {
      id: welcome.id,
      workspaceId,
      kind: "PAGE",
      title: welcome.title,
      pageId: welcome.id,
      createdById: userId,
    },
  });
  await tx.knowledgeEdge.create({
    data: {
      id: `link:${welcome.id}:${guidePage.id}`,
      workspaceId,
      sourceNodeId: welcome.id,
      targetNodeId: guidePage.id,
      relationType: "REFERENCES",
      origin: "PAGE_LINK",
      createdById: userId,
    },
  });
}

async function ensurePersonalWorkspace(
  context: {
    db: Database;
    userId: string;
    name: string;
  },
  input: { name?: string },
): Promise<{ workspaceIds: string[] }> {
  const memberships = await context.db.workspaceMember.findMany({
    where: { userId: context.userId, status: "ACTIVE", deletedAt: null },
    select: { workspaceId: true },
  });
  const workspaceIds = memberships.map((membership) => membership.workspaceId);
  const existingWorkspaces = workspaceIds.length
    ? await context.db.workspace.findMany({
        where: { id: { in: workspaceIds }, deletedAt: null, type: "PERSONAL" },
        select: { id: true },
      })
    : [];
  if (existingWorkspaces.length) return { workspaceIds };

  const created = await context.db.$transaction(async (tx) => {
    const name = input.name?.trim() || `${context.name.split(" ")[0] ?? "Personal"}'s Lattice`;
    const workspace = await tx.workspace.create({
      data: {
        id: createId(),
        name,
        slug: await uniqueWorkspaceSlug(tx, name),
        type: "PERSONAL",
        icon: "✦",
        accent: "#e07a2e",
        ownerId: context.userId,
      },
    });
    await tx.workspaceMember.create({
      data: {
        id: createId(),
        workspaceId: workspace.id,
        userId: context.userId,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    const notebook = await createDefaultNotebook(tx, workspace.id, context.userId);
    await seedWelcome(tx, workspace.id, context.userId, notebook.id);
    return workspace;
  });
  return { workspaceIds: [...workspaceIds, created.id] };
}

export const workspaceRouter = {
  ensure: protectedProcedure
    .input(ensureWorkspaceInput)
    .handler(async ({ context, input }) => {
      const user = context.session.user;
      await ensurePersonalWorkspace(
        {
          db: context.db,
          userId: user.id,
          name: user.name,
        },
        input,
      );
      const memberships = await context.db.workspaceMember.findMany({
        where: { userId: user.id, status: "ACTIVE", deletedAt: null },
      });
      const workspaces = await context.db.workspace.findMany({
        where: {
          id: { in: memberships.map((membership) => membership.workspaceId) },
          deletedAt: null,
        },
      });
      const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
      const results = memberships
        .map((membership) => {
          const workspace = workspaceById.get(membership.workspaceId);
          return workspace ? { workspace, role: membership.role } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .sort((a, b) => {
          if (a.workspace.type !== b.workspace.type) {
            return a.workspace.type === "PERSONAL" ? -1 : 1;
          }
          return a.workspace.name.localeCompare(b.workspace.name);
        });
      return {
        memberships: results,
        workspace: results[0]?.workspace ?? null,
        role: results[0]?.role ?? null,
      };
    }),

  list: protectedProcedure.handler(async ({ context }) => {
    const memberships = await context.db.workspaceMember.findMany({
      where: { userId: context.session.user.id, status: "ACTIVE", deletedAt: null },
    });
    const workspaces = await context.db.workspace.findMany({
      where: {
        id: { in: memberships.map((membership) => membership.workspaceId) },
        deletedAt: null,
      },
    });
    const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    return memberships
      .map((membership) => {
        const workspace = byId.get(membership.workspaceId);
        return workspace ? { workspace, role: membership.role } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }),

  get: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const workspace = await context.db.workspace.findFirst({
      where: { id: context.workspaceId, deletedAt: null },
    });
    if (!workspace) throw new ORPCError("NOT_FOUND");
    return { workspace, role: context.role };
  }),

  create: protectedProcedure.input(createWorkspaceInput).handler(async ({ context, input }) => {
    const user = context.session.user;
    const workspace = await context.db.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          id: createId(),
          name: input.name,
          slug: await uniqueWorkspaceSlug(tx, input.name),
          type: input.type,
          description: input.description ?? null,
          icon: input.type === "ORGANIZATION" ? "◈" : "✦",
          accent: input.type === "ORGANIZATION" ? "#2f6b4f" : "#e07a2e",
          ownerId: user.id,
        },
      });
      await tx.workspaceMember.create({
        data: {
          id: createId(),
          workspaceId: created.id,
          userId: user.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });
      await createDefaultNotebook(
        tx,
        created.id,
        user.id,
        input.type === "ORGANIZATION" ? "Team knowledge" : "My knowledge",
      );
      return created;
    });
    await writeAudit(context.db, {
      workspaceId: workspace.id,
      actorId: user.id,
      action: "workspace.created",
      resourceType: "workspace",
      resourceId: workspace.id,
      metadata: { type: workspace.type },
    });
    return { workspace, role: "OWNER" as const };
  }),

  update: workspaceProcedure("ADMIN")
    .input(
      z.object({
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().max(500).nullable().optional(),
        icon: z.string().max(16).nullable().optional(),
        accent: z.string().max(32).nullable().optional(),
        trashRetentionDays: z.number().int().min(0).max(3650).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const workspace = await context.db.workspace.update({
        where: { id: context.workspaceId },
        data: input,
      });
      await context.db.$transaction(async (tx) => {
        await appendChanges(tx, context.workspaceId, context.userId, [
          { entity: "workspace", entityId: workspace.id, op: "UPSERT", data: toJsonSafe(workspace) },
        ]);
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "workspace.updated",
        resourceType: "workspace",
        resourceId: workspace.id,
      });
      return { workspace };
    }),

  members: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const memberships = await context.db.workspaceMember.findMany({
      where: { workspaceId: context.workspaceId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    const users = await context.db.user.findMany({
      where: { id: { in: memberships.map((membership) => membership.userId) } },
      select: { id: true, name: true, email: true, image: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    return memberships.map((membership) => ({
      ...membership,
      user: userById.get(membership.userId) ?? {
        id: membership.userId,
        name: "Unknown member",
        email: "",
        image: null,
      },
    }));
  }),

  invite: workspaceProcedure("ADMIN")
    .input(inviteMemberInput.omit({ workspaceId: true }))
    .handler(async ({ context, input }) => {
      if (input.role === "OWNER" && !hasRole(context.role, "OWNER")) {
        throw new ORPCError("FORBIDDEN", { message: "Only the owner can invite an owner" });
      }
      if (input.role === "ADMIN" && !hasRole(context.role, "OWNER")) {
        throw new ORPCError("FORBIDDEN", { message: "Only the owner can invite admins" });
      }
      const existingUser = await context.db.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existingUser) {
        const existingMember = await context.db.workspaceMember.findFirst({
          where: {
            workspaceId: context.workspaceId,
            userId: existingUser.id,
            deletedAt: null,
          },
        });
        if (existingMember) {
          throw new ORPCError("CONFLICT", { message: "This person is already a member" });
        }
      }
      const { token, tokenHash } = createToken();
      const invite = await context.db.workspaceInvite.create({
        data: {
          id: createId(),
          workspaceId: context.workspaceId,
          email: input.email.toLowerCase(),
          role: input.role,
          tokenHash,
          invitedById: context.userId,
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "member.invited",
        resourceType: "invite",
        resourceId: invite.id,
        metadata: { email: invite.email, role: invite.role },
      });
      return {
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
        },
        token,
      };
    }),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(8).max(256) }))
    .handler(async ({ context, input }) => {
      const invite = await context.db.workspaceInvite.findUnique({
        where: { tokenHash: hashToken(input.token) },
      });
      if (!invite) throw new ORPCError("NOT_FOUND", { message: "Invite not found" });
      if (invite.acceptedAt) throw new ORPCError("CONFLICT", { message: "Invite already used" });
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new ORPCError("BAD_REQUEST", { message: "Invite expired" });
      }
      const user = context.session.user;
      if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
        throw new ORPCError("FORBIDDEN", {
          message: `This invite is for ${invite.email}`,
        });
      }
      const workspace = await context.db.workspace.findFirst({
        where: { id: invite.workspaceId, deletedAt: null },
      });
      if (!workspace) throw new ORPCError("NOT_FOUND", { message: "Workspace not found" });
      const existing = await context.db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id },
        },
      });
      await context.db.$transaction(async (tx) => {
        if (existing) {
          await tx.workspaceMember.update({
            where: { id: existing.id },
            data: { status: "ACTIVE", role: invite.role, deletedAt: null },
          });
        } else {
          await tx.workspaceMember.create({
            data: {
              id: createId(),
              workspaceId: invite.workspaceId,
              userId: user.id,
              role: invite.role,
              status: "ACTIVE",
            },
          });
        }
        await tx.workspaceInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
      });
      await writeAudit(context.db, {
        workspaceId: invite.workspaceId,
        actorId: user.id,
        action: "member.joined",
        resourceType: "member",
        resourceId: user.id,
      });
      return { workspace, role: invite.role };
    }),

  updateMember: workspaceProcedure("ADMIN")
    .input(updateMemberInput.omit({ workspaceId: true }))
    .handler(async ({ context, input }) => {
      const member = await context.db.workspaceMember.findFirst({
        where: { id: input.memberId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!member) throw new ORPCError("NOT_FOUND", { message: "Member not found" });
      if (member.role === "OWNER" && !hasRole(context.role, "OWNER")) {
        throw new ORPCError("FORBIDDEN", { message: "Only the owner can change the owner" });
      }
      if (input.role === "OWNER" && context.role !== "OWNER") {
        throw new ORPCError("FORBIDDEN", { message: "Only the owner can transfer ownership" });
      }
      if (input.role === "ADMIN" && context.role !== "OWNER") {
        throw new ORPCError("FORBIDDEN", { message: "Only the owner can promote admins" });
      }
      const updated = await context.db.$transaction(async (tx) => {
        const result = await tx.workspaceMember.update({
          where: { id: member.id },
          data: {
            ...(input.role ? { role: input.role } : {}),
            ...(input.status ? { status: input.status } : {}),
          },
        });
        await appendChanges(tx, context.workspaceId, context.userId, [
          { entity: "member", entityId: result.id, op: "UPSERT", data: toJsonSafe(result) },
        ]);
        return result;
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "member.updated",
        resourceType: "member",
        resourceId: updated.id,
        metadata: { role: updated.role, status: updated.status },
      });
      return { member: updated };
    }),

  removeMember: workspaceProcedure("ADMIN")
    .input(z.object({ memberId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const member = await context.db.workspaceMember.findFirst({
        where: { id: input.memberId, workspaceId: context.workspaceId, deletedAt: null },
      });
      if (!member) throw new ORPCError("NOT_FOUND");
      if (member.role === "OWNER") {
        throw new ORPCError("FORBIDDEN", { message: "Ownership must be transferred first" });
      }
      if (member.userId === context.userId) {
        throw new ORPCError("BAD_REQUEST", { message: "Use leave instead" });
      }
      const removed = await context.db.$transaction(async (tx) => {
        const result = await tx.workspaceMember.update({
          where: { id: member.id },
          data: { deletedAt: new Date(), status: "SUSPENDED" },
        });
        await appendChanges(tx, context.workspaceId, context.userId, [
          { entity: "member", entityId: result.id, op: "DELETE", data: toJsonSafe(result) },
        ]);
        return result;
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "member.removed",
        resourceType: "member",
        resourceId: removed.id,
      });
      return { ok: true };
    }),

  leave: protectedProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const membership = await requireMembership(
        context.db,
        context.session.user.id,
        input.workspaceId,
        "GUEST",
      );
      const member = await context.db.workspaceMember.findUnique({
        where: { id: membership.id },
      });
      if (!member) throw new ORPCError("NOT_FOUND");
      if (member.role === "OWNER") {
        const owners = await context.db.workspaceMember.count({
          where: {
            workspaceId: input.workspaceId,
            role: "OWNER",
            status: "ACTIVE",
            deletedAt: null,
          },
        });
        if (owners > 1) throw new ORPCError("BAD_REQUEST", { message: "Transfer ownership first" });
        throw new ORPCError("BAD_REQUEST", {
          message: "The owner cannot leave. Delete the workspace or transfer ownership.",
        });
      }
      await context.db.workspaceMember.update({
        where: { id: membership.id },
        data: { deletedAt: new Date(), status: "SUSPENDED" },
      });
      return { ok: true };
    }),

  ingestToken: workspaceProcedure("VIEWER").handler(async ({ context }) => {
    const row = await context.db.workspaceIngestToken.findUnique({
      where: { workspaceId: context.workspaceId },
      select: { createdAt: true, revokedAt: true },
    });
    return {
      active: Boolean(row && !row.revokedAt),
      createdAt: row?.createdAt.toISOString() ?? null,
    };
  }),

  createIngestToken: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const { token, tokenHash } = createToken();
    await context.db.workspaceIngestToken.upsert({
      where: { workspaceId: context.workspaceId },
      create: {
        id: createId(),
        workspaceId: context.workspaceId,
        tokenHash,
        createdById: context.userId,
      },
      update: {
        tokenHash,
        createdById: context.userId,
        createdAt: new Date(),
        revokedAt: null,
      },
    });
    await writeAudit(context.db, {
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "workspace.ingest_token_created",
      resourceType: "workspace",
      resourceId: context.workspaceId,
    });
    return { token };
  }),

  revokeIngestToken: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    await context.db.workspaceIngestToken.updateMany({
      where: { workspaceId: context.workspaceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(context.db, {
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "workspace.ingest_token_revoked",
      resourceType: "workspace",
      resourceId: context.workspaceId,
    });
    return { ok: true };
  }),

  scimTokens: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const tokens = await context.db.scimToken.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
    });
    return tokens.map((token) => ({
      ...token,
      createdAt: token.createdAt.toISOString(),
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
      revokedAt: token.revokedAt?.toISOString() ?? null,
    }));
  }),

  createScimToken: workspaceProcedure("ADMIN")
    .input(z.object({ name: z.string().trim().min(1).max(60) }))
    .handler(async ({ context, input }) => {
      const active = await context.db.scimToken.count({
        where: { workspaceId: context.workspaceId, revokedAt: null },
      });
      if (active >= 5) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Revoke a SCIM token before creating another (at most five active).",
        });
      }
      const token = `scim_${randomBytes(24).toString("base64url")}`;
      const created = await context.db.scimToken.create({
        data: {
          id: createId(),
          workspaceId: context.workspaceId,
          name: input.name,
          tokenHash: hashToken(token),
          createdById: context.userId,
        },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "workspace.scim_token_created",
        resourceType: "scim_token",
        resourceId: created.id,
        metadata: { name: created.name },
      });
      return { id: created.id, token };
    }),

  revokeScimToken: workspaceProcedure("ADMIN")
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const token = await context.db.scimToken.findFirst({
        where: { id: input.id, workspaceId: context.workspaceId, revokedAt: null },
        select: { id: true },
      });
      if (!token) throw new ORPCError("NOT_FOUND", { message: "Token not found" });
      await context.db.scimToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "workspace.scim_token_revoked",
        resourceType: "scim_token",
        resourceId: token.id,
      });
      return { ok: true };
    }),

  ssoConnection: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const connection = await context.db.ssoConnection.findUnique({
      where: { workspaceId: context.workspaceId },
      select: {
        issuer: true,
        clientId: true,
        domains: true,
        enabled: true,
        updatedAt: true,
      },
    });
    if (!connection) {
      return {
        configured: false,
        issuer: "",
        clientId: "",
        domains: [] as string[],
        enabled: false,
        updatedAt: null,
      };
    }
    return {
      configured: true,
      issuer: connection.issuer,
      clientId: connection.clientId,
      domains: parseSsoDomains(connection.domains),
      enabled: connection.enabled,
      updatedAt: connection.updatedAt.toISOString(),
    };
  }),

  saveSsoConnection: workspaceProcedure("ADMIN")
    .input(
      z.object({
        issuer: z.string().trim().min(1).max(500),
        clientId: z.string().trim().min(1).max(200),
        clientSecret: z.string().trim().max(500).optional(),
        domains: z.array(z.string().max(200)).max(20).default([]),
        enabled: z.boolean().default(true),
      }),
    )
    .handler(async ({ context, input }) => {
      const issuer = normalizeIssuer(input.issuer);
      if (!issuer) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Use the issuer's https URL, without a path query or credentials.",
        });
      }
      let discovery;
      try {
        discovery = await discoverOidc(issuer);
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Discovery failed for that issuer.",
        });
      }
      const existing = await context.db.ssoConnection.findUnique({
        where: { workspaceId: context.workspaceId },
      });
      if (!existing && !input.clientSecret) {
        throw new ORPCError("BAD_REQUEST", { message: "A client secret is required." });
      }
      if (!context.secrets) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "This server cannot store workspace secrets.",
        });
      }
      const secret = input.clientSecret
        ? encryptSsoSecret(input.clientSecret, context.secrets.keyMaterial)
        : existing!.clientSecret;
      const connection = await context.db.ssoConnection.upsert({
        where: { workspaceId: context.workspaceId },
        create: {
          id: createId(),
          workspaceId: context.workspaceId,
          issuer,
          clientId: input.clientId,
          clientSecret: secret,
          domains: parseSsoDomains(input.domains),
          enabled: input.enabled,
          createdById: context.userId,
        },
        update: {
          issuer,
          clientId: input.clientId,
          clientSecret: secret,
          domains: parseSsoDomains(input.domains),
          enabled: input.enabled,
        },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "workspace.sso_configured",
        resourceType: "sso_connection",
        resourceId: connection.id,
        metadata: { issuer, clientId: connection.clientId, domains: input.domains.length },
      });
      return {
        issuer: connection.issuer,
        authorizationEndpoint: discovery.authorization_endpoint,
      };
    }),

  removeSsoConnection: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const connection = await context.db.ssoConnection.findUnique({
      where: { workspaceId: context.workspaceId },
      select: { id: true },
    });
    if (!connection) return { ok: true };
    await context.db.ssoConnection.delete({ where: { id: connection.id } });
    await writeAudit(context.db, {
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "workspace.sso_removed",
      resourceType: "sso_connection",
      resourceId: connection.id,
    });
    return { ok: true };
  }),

  legalHolds: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const holds = await context.db.legalHold.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
    });
    const notebookIds = holds
      .filter((hold) => hold.scope === "NOTEBOOK" && hold.targetId)
      .map((hold) => hold.targetId!);
    const pageIds = holds
      .filter((hold) => hold.scope === "PAGE" && hold.targetId)
      .map((hold) => hold.targetId!);
    const [notebooks, pages] = await Promise.all([
      context.db.notebook.findMany({
        where: { workspaceId: context.workspaceId, id: { in: notebookIds } },
        select: { id: true, name: true },
      }),
      context.db.page.findMany({
        where: { workspaceId: context.workspaceId, id: { in: pageIds } },
        select: { id: true, title: true },
      }),
    ]);
    const notebookNames = new Map(notebooks.map((notebook) => [notebook.id, notebook.name]));
    const pageNames = new Map(pages.map((page) => [page.id, page.title]));
    return {
      holds: holds.map((hold) => ({
        ...hold,
        createdAt: hold.createdAt.toISOString(),
        releasedAt: hold.releasedAt?.toISOString() ?? null,
        targetLabel:
          hold.scope === "WORKSPACE"
            ? "Entire workspace"
            : hold.scope === "NOTEBOOK"
              ? (notebookNames.get(hold.targetId ?? "") ?? "Deleted notebook")
              : (pageNames.get(hold.targetId ?? "") ?? "Deleted page"),
      })),
      summary: describeLegalHoldHolders(holds, {
        notebook: notebookNames,
        page: pageNames,
      }),
    };
  }),

  createLegalHold: workspaceProcedure("ADMIN")
    .input(
      z.object({
        scope: z.enum(["WORKSPACE", "NOTEBOOK", "PAGE"]),
        targetId: z.string().min(1).nullable().optional(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .handler(async ({ context, input }) => {
      const targetId = input.scope === "WORKSPACE" ? null : (input.targetId ?? null);
      if (input.scope !== "WORKSPACE" && !targetId) {
        throw new ORPCError("BAD_REQUEST", { message: "Choose what the hold covers." });
      }
      if (input.scope === "NOTEBOOK") {
        const notebook = await context.db.notebook.findFirst({
          where: { id: targetId!, workspaceId: context.workspaceId },
          select: { id: true },
        });
        if (!notebook) throw new ORPCError("NOT_FOUND", { message: "Notebook not found" });
      }
      if (input.scope === "PAGE") {
        const page = await context.db.page.findFirst({
          where: { id: targetId!, workspaceId: context.workspaceId },
          select: { id: true },
        });
        if (!page) throw new ORPCError("NOT_FOUND", { message: "Page not found" });
      }
      const existing = await context.db.legalHold.findFirst({
        where: {
          workspaceId: context.workspaceId,
          scope: input.scope,
          targetId,
          releasedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        throw new ORPCError("CONFLICT", { message: "That scope is already under hold." });
      }
      const hold = await context.db.legalHold.create({
        data: {
          id: createId(),
          workspaceId: context.workspaceId,
          scope: input.scope,
          targetId,
          reason: input.reason.trim(),
          createdById: context.userId,
        },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "legal_hold.created",
        resourceType: "legal_hold",
        resourceId: hold.id,
        metadata: { scope: hold.scope, targetId: hold.targetId, reason: hold.reason },
      });
      return { id: hold.id };
    }),

  releaseLegalHold: workspaceProcedure("ADMIN")
    .input(z.object({ id: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const hold = await context.db.legalHold.findFirst({
        where: { id: input.id, workspaceId: context.workspaceId, releasedAt: null },
        select: { id: true },
      });
      if (!hold) throw new ORPCError("NOT_FOUND", { message: "Hold not found" });
      await context.db.legalHold.update({
        where: { id: hold.id },
        data: { releasedAt: new Date(), releasedById: context.userId },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "legal_hold.released",
        resourceType: "legal_hold",
        resourceId: hold.id,
      });
      return { ok: true };
    }),

  legalExport: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const bundle = await buildLegalExport(context.db, context.workspaceId);
    await writeAudit(context.db, {
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "legal_export.created",
      resourceType: "workspace",
      resourceId: context.workspaceId,
      metadata: { counts: bundle.counts, truncated: bundle.truncated },
    });
    return bundle;
  }),

  aiConfig: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const row = await context.db.workspaceAiConfig.findUnique({
      where: { workspaceId: context.workspaceId },
    });
    let masked: string | null = null;
    if (row && context.secrets) {
      try {
        masked = maskApiKey(decryptAiKey(row.apiKey, context.secrets.keyMaterial));
      } catch {
        masked = "••••";
      }
    } else if (row) {
      masked = "••••";
    }
    return {
      configured: Boolean(row),
      baseUrl: row?.baseUrl ?? "",
      model: row?.model ?? "",
      embeddingModel: row?.embeddingModel ?? "",
      transcribeModel: row?.transcribeModel ?? "",
      apiKeyMasked: masked,
      deploymentAvailable: Boolean(context.ai?.apiKey),
      source: row ? "workspace" : context.ai?.apiKey ? "deployment" : "none",
    };
  }),

  saveAiConfig: workspaceProcedure("ADMIN")
    .input(
      z.object({
        baseUrl: z.string().trim().min(1).max(500),
        apiKey: z.string().trim().max(500).optional(),
        model: z.string().trim().min(1).max(120),
        embeddingModel: z.string().trim().max(120).optional(),
        transcribeModel: z.string().trim().max(120).optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const baseUrl = normalizeAiBaseUrl(input.baseUrl);
      if (!baseUrl) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Use an https base URL without credentials or a query string.",
        });
      }
      const model = normalizeModelName(input.model);
      if (!model) throw new ORPCError("BAD_REQUEST", { message: "A model name is required." });
      const embeddingModel = input.embeddingModel
        ? normalizeModelName(input.embeddingModel)
        : null;
      const transcribeModel = input.transcribeModel
        ? normalizeModelName(input.transcribeModel)
        : null;
      const existing = await context.db.workspaceAiConfig.findUnique({
        where: { workspaceId: context.workspaceId },
      });
      const providedKey = input.apiKey?.trim();
      if (!existing && !providedKey) {
        throw new ORPCError("BAD_REQUEST", {
          message: "An API key is required the first time you save provider credentials.",
        });
      }
      if (!context.secrets) {
        throw new ORPCError("PRECONDITION_FAILED", {
          message: "This server cannot store workspace secrets.",
        });
      }
      const apiKey = providedKey
        ? encryptAiKey(providedKey, context.secrets.keyMaterial)
        : existing!.apiKey;
      const config = await context.db.workspaceAiConfig.upsert({
        where: { workspaceId: context.workspaceId },
        create: {
          workspaceId: context.workspaceId,
          baseUrl,
          apiKey,
          model,
          embeddingModel,
          transcribeModel,
          updatedById: context.userId,
        },
        update: {
          baseUrl,
          apiKey,
          model,
          embeddingModel,
          transcribeModel,
          updatedById: context.userId,
        },
      });
      await writeAudit(context.db, {
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "ai_config.updated",
        resourceType: "workspace_ai_config",
        resourceId: config.workspaceId,
        metadata: { baseUrl, model, rotatedKey: Boolean(providedKey) },
      });
      return { baseUrl: config.baseUrl, model: config.model };
    }),

  removeAiConfig: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    const existing = await context.db.workspaceAiConfig.findUnique({
      where: { workspaceId: context.workspaceId },
      select: { workspaceId: true },
    });
    if (!existing) return { ok: true };
    await context.db.workspaceAiConfig.delete({ where: { workspaceId: context.workspaceId } });
    await writeAudit(context.db, {
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "ai_config.removed",
      resourceType: "workspace_ai_config",
      resourceId: context.workspaceId,
    });
    return { ok: true };
  }),

  audit: workspaceProcedure("ADMIN").handler(async ({ context }) => {
    return context.db.auditLog.findMany({
      where: { workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }),
};
