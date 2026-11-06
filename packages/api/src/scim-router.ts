import {
  SCIM_ENTERPRISE_USER_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_MAX_RESULTS,
  SCIM_ROLE_EXTENSION,
  SCIM_USER_SCHEMA,
  createId,
  parseScimFilter,
  readScimPatchOperations,
  roleForScimGroup,
  roleForScimRole,
  scimError,
  scimList,
  toScimGroup,
  toScimUser,
} from "@notes-learning/domain";
import express, { type Request, type Response } from "express";

import type { Database } from "@notes-learning/db";

import { hashToken, writeAudit } from "./authz";
import { appendChanges, toJsonSafe } from "./services/changes";

/**
 * SCIM 2.0 provisioning for identity providers.
 *
 * The surface is deliberately the part IdPs actually drive: Users and Groups,
 * with filter matching on userName/externalId/displayName and PATCH support for
 * deactivation. Every mutation goes through the change log and the audit log,
 * exactly like the in-app member procedures, so a provisioned change reaches
 * every device and shows up in the audit trail.
 */

export function createScimRouter(database: Database): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  interface ScimAuth {
    workspaceId: string;
    tokenId: string;
}

  async function authenticate(req: Request): Promise<ScimAuth | null> {
    const header = req.headers.authorization ?? "";
    if (!header.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length).trim();
    if (!token.startsWith("scim_")) return null;
    const record = await database.scimToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, workspaceId: true, revokedAt: true, lastUsedAt: true },
    });
    if (!record || record.revokedAt) return null;
    if (!record.lastUsedAt || Date.now() - record.lastUsedAt.getTime() > 60_000) {
      void database.scimToken
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    }
    return { workspaceId: record.workspaceId, tokenId: record.id };
}

  function baseUrl(req: Request): string {
    return `${req.protocol}://${req.get("host") ?? "localhost"}/scim/v2`;
}

  function sendError(res: Response, status: number, detail: string, scimType?: string) {
    res.status(status).json(scimError(status, detail, scimType));
}

  function memberIdsFromValue(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && typeof (entry as { value?: unknown }).value === "string") {
          return (entry as { value: string }).value;
        }
        return null;
      })
      .filter((entry): entry is string => Boolean(entry));
}

  function normalizeEmail(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

  function displayNameFromBody(body: Record<string, unknown>, fallback: string): string {
    if (typeof body.displayName === "string" && body.displayName.trim()) {
      return body.displayName.trim().slice(0, 120);
    }
    const name = body.name;
    if (name && typeof name === "object" && !Array.isArray(name)) {
      const record = name as Record<string, unknown>;
      const parts = [record.givenName, record.familyName]
        .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
        .map((part) => part.trim());
      if (parts.length) return parts.join(" ").slice(0, 120);
    }
    return fallback;
}

  function roleFromBody(body: Record<string, unknown>, fallback: "ADMIN" | "MEMBER" | "EDITOR" | "VIEWER") {
    const roles = body.roles;
    if (Array.isArray(roles)) {
      for (const entry of roles) {
        const value =
          typeof entry === "string"
            ? entry
            : entry && typeof entry === "object"
              ? (entry as { value?: unknown }).value
              : null;
        const mapped = roleForScimRole(value);
        if (mapped) return mapped;
      }
    }
    return fallback;
}

  async function loadMember(workspaceId: string, memberId: string) {
    const member = await database.workspaceMember.findFirst({
      where: { id: memberId, workspaceId, deletedAt: null },
    });
    if (!member) return null;
    const user = await database.user.findUnique({
      where: { id: member.userId },
      select: { id: true, name: true, email: true },
    });
    return { ...member, user };
}

  async function appendMemberChange(
    workspaceId: string,
    actorId: string,
    memberId: string,
    op: "UPSERT" | "DELETE",
  ) {
    const row = await database.workspaceMember.findUnique({ where: { id: memberId } });
    if (!row) return;
    await database.$transaction(async (tx) => {
      await appendChanges(tx, workspaceId, actorId, [
        { entity: "member", entityId: row.id, op, data: toJsonSafe(row) },
      ]);
    });
}

  /** Applies a group's role to one of its members, never demoting the owner. */
  async function applyGroupRole(
    workspaceId: string,
    actorId: string,
    memberId: string,
    role: string,
  ) {
    const member = await database.workspaceMember.findFirst({
      where: { id: memberId, workspaceId, deletedAt: null },
    });
    if (!member || member.role === "OWNER" || member.role === role) return;
    await database.workspaceMember.update({ where: { id: member.id }, data: { role } });
    await appendMemberChange(workspaceId, actorId, member.id, "UPSERT");
    await writeAudit(database, {
      workspaceId,
      actorId,
      action: "member.role_from_group",
      resourceType: "member",
      resourceId: member.id,
      metadata: { role },
    });
}

  // --- discovery -------------------------------------------------------------

  router.get("/ServiceProviderConfig", (_req, res) => {
    res.json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      documentationUri: "https://github.com/notes-learning/notes-learning",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: SCIM_MAX_RESULTS },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "Workspace SCIM token from Settings → Members → Provisioning.",
          primary: true,
        },
      ],
    });
  });

  router.get("/Schemas", (_req, res) => {
    res.json(
      scimList(
        [
          {
            id: SCIM_USER_SCHEMA,
            name: "User",
            attributes: [
              { name: "userName", type: "string", required: true, mutability: "readWrite", uniqueness: "server" },
              { name: "displayName", type: "string", mutability: "readWrite" },
              { name: "active", type: "boolean", mutability: "readWrite" },
              { name: "externalId", type: "string", mutability: "readWrite" },
              { name: "roles", type: "complex", multiValued: true, mutability: "readWrite" },
            ],
          },
          {
            id: SCIM_ENTERPRISE_USER_SCHEMA,
            name: "EnterpriseUser",
            attributes: [{ name: "department", type: "string", mutability: "readWrite" }],
          },
          {
            id: SCIM_GROUP_SCHEMA,
            name: "Group",
            attributes: [
              { name: "displayName", type: "string", required: true, mutability: "readWrite" },
              { name: "members", type: "complex", multiValued: true, mutability: "readWrite" },
              { name: SCIM_ROLE_EXTENSION, type: "complex", mutability: "readWrite" },
            ],
          },
        ],
        3,
        1,
      ),
    );
  });

  router.get("/ResourceTypes", (_req, res) => {
    res.json(
      scimList(
        [
          { id: "User", name: "User", endpoint: "/Users", schema: SCIM_USER_SCHEMA },
          { id: "Group", name: "Group", endpoint: "/Groups", schema: SCIM_GROUP_SCHEMA },
        ],
        2,
        1,
      ),
    );
  });

  // --- users -----------------------------------------------------------------

  router.get("/Users", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");

    const filter = parseScimFilter(typeof req.query.filter === "string" ? req.query.filter : null);
    if (filter === "invalid") {
      return sendError(res, 400, "Only `attribute eq \"value\"` filters are supported.", "invalidFilter");
    }
    const startIndex = Math.max(1, Number(req.query.startIndex) || 1);
    const count = Math.min(SCIM_MAX_RESULTS, Math.max(1, Number(req.query.count) || SCIM_MAX_RESULTS));

    const members = await database.workspaceMember.findMany({
      where: { workspaceId: auth.workspaceId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    const users = await database.user.findMany({
      where: { id: { in: members.map((member) => member.userId) } },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((user) => [user.id, user]));
    const resources = members
      .map((member) => ({ ...member, user: userById.get(member.userId) ?? null }))
      .filter((member) => {
        if (!filter) return true;
        if (filter.attribute === "externalId") {
          return (member.externalId ?? "").toLowerCase() === filter.value.toLowerCase();
        }
        if (filter.attribute === "userName") {
          return (member.user?.email ?? "").toLowerCase() === filter.value.toLowerCase();
        }
        return (member.user?.name ?? "").toLowerCase().includes(filter.value.toLowerCase());
      });

    const page = resources.slice(startIndex - 1, startIndex - 1 + count);
    res.json(
      scimList(
        page.map((member) => toScimUser(member, baseUrl(req))),
        resources.length,
        startIndex,
      ),
    );
  });

  router.get("/Users/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const member = await loadMember(auth.workspaceId, req.params.id);
    if (!member) return sendError(res, 404, "User not found.");
    res.json(toScimUser(member, baseUrl(req)));
  });

  router.post("/Users", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(body.userName);
    if (!email) return sendError(res, 400, "userName must be an email address.", "invalidValue");
    if (Array.isArray(body.roles) && body.roles.some((entry) => roleForScimRole(
      typeof entry === "string" ? entry : (entry as { value?: unknown })?.value,
    ) === null && String(typeof entry === "string" ? entry : (entry as { value?: unknown })?.value ?? "").toLowerCase().includes("owner"))) {
      return sendError(res, 400, "Ownership cannot be granted through SCIM.", "invalidValue");
    }
    const name = displayNameFromBody(body, email);
    const role = roleFromBody(body, "EDITOR");
    const active = body.active !== false;
    const externalId =
      typeof body.externalId === "string" && body.externalId.trim()
        ? body.externalId.trim().slice(0, 120)
        : null;

    const existingUser = await database.user.findUnique({ where: { email }, select: { id: true } });
    const existingMember = existingUser
      ? await database.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId: auth.workspaceId, userId: existingUser.id } },
        })
      : null;
    if (existingMember && !existingMember.deletedAt) {
      return sendError(res, 409, "This user is already provisioned.", "uniqueness");
    }

    const member = await database.$transaction(async (tx) => {
      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: { name: body.displayName ? name : undefined },
          })
        : await tx.user.create({
            data: { id: createId(), name, email, emailVerified: false, image: null },
          });
      const membership = existingMember
        ? await tx.workspaceMember.update({
            where: { id: existingMember.id },
            data: {
              role,
              externalId,
              status: active ? "ACTIVE" : "SUSPENDED",
              deletedAt: null,
            },
          })
        : await tx.workspaceMember.create({
            data: {
              id: createId(),
              workspaceId: auth.workspaceId,
              userId: user.id,
              role,
              externalId,
              status: active ? "ACTIVE" : "SUSPENDED",
            },
          });
      return { ...membership, user: { id: user.id, name: user.name, email: user.email } };
    });

    await appendMemberChange(auth.workspaceId, auth.tokenId, member.id, "UPSERT");
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.user_created",
      resourceType: "member",
      resourceId: member.id,
      metadata: { role, externalId },
    });
    res
      .status(201)
      .location(`${baseUrl(req)}/Users/${member.id}`)
      .json(toScimUser(member, baseUrl(req)));
  });

  router.put("/Users/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const member = await loadMember(auth.workspaceId, req.params.id);
    if (!member) return sendError(res, 404, "User not found.");
    if (member.role === "OWNER") return sendError(res, 403, "Ownership is managed in the workspace.");

    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = normalizeEmail(body.userName ?? member.user?.email);
    if (!email) return sendError(res, 400, "userName must be an email address.", "invalidValue");
    if (email !== member.user?.email) {
      const clash = await database.user.findUnique({ where: { email }, select: { id: true } });
      if (clash && clash.id !== member.userId) {
        return sendError(res, 409, "Another account already uses this email.", "uniqueness");
      }
      await database.user.update({ where: { id: member.userId }, data: { email } });
    }
    const name = displayNameFromBody(body, member.user?.name ?? email);
    if (name !== member.user?.name) {
      await database.user.update({ where: { id: member.userId }, data: { name } });
    }
    const active = body.active !== false;
    const externalId =
      typeof body.externalId === "string" && body.externalId.trim()
        ? body.externalId.trim().slice(0, 120)
        : null;
    const role = roleFromBody(body, member.role as "EDITOR");
    await database.workspaceMember.update({
      where: { id: member.id },
      data: { role, status: active ? "ACTIVE" : "SUSPENDED", externalId },
    });
    await appendMemberChange(auth.workspaceId, auth.tokenId, member.id, "UPSERT");
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.user_updated",
      resourceType: "member",
      resourceId: member.id,
      metadata: { role, active },
    });
    const updated = await loadMember(auth.workspaceId, member.id);
    res.json(toScimUser(updated!, baseUrl(req)));
  });

  router.patch("/Users/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const member = await loadMember(auth.workspaceId, req.params.id);
    if (!member) return sendError(res, 404, "User not found.");
    if (member.role === "OWNER") return sendError(res, 403, "Ownership is managed in the workspace.");

    const operations = readScimPatchOperations(req.body);
    if (!operations.length) return sendError(res, 400, "No supported patch operations.", "invalidValue");
    const next: {
      active?: boolean;
      role?: string;
      externalId?: string | null;
      displayName?: string;
    } = {};
    for (const operation of operations) {
      const path = operation.path?.toLowerCase();
      const value = operation.value;
      if (path === "active" || (!path && value && typeof value === "object" && "active" in value)) {
        const active = path === "active" ? Boolean(value) : Boolean((value as { active?: unknown }).active);
        next.active = active;
        continue;
      }
      if (path === "externalid") {
        next.externalId = typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
        continue;
      }
      if (path === "displayname" || path === "name.formatted") {
        if (typeof value === "string" && value.trim()) next.displayName = value.trim().slice(0, 120);
        continue;
      }
      if (path === "roles" || path === "roles.value") {
        const mapped = roleFromBody({ roles: Array.isArray(value) ? value : [value] }, "EDITOR");
        next.role = mapped;
        continue;
      }
      if (!path && value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if ("externalId" in record && typeof record.externalId === "string") {
          next.externalId = record.externalId.trim() || null;
        }
        if (Array.isArray(record.roles)) next.role = roleFromBody({ roles: record.roles }, "EDITOR");
      }
    }

    const data: Record<string, unknown> = {};
    if (next.active !== undefined) data.status = next.active ? "ACTIVE" : "SUSPENDED";
    if (next.role) data.role = next.role;
    if (next.externalId !== undefined) data.externalId = next.externalId;
    if (Object.keys(data).length) {
      await database.workspaceMember.update({ where: { id: member.id }, data });
      await appendMemberChange(auth.workspaceId, auth.tokenId, member.id, "UPSERT");
    }
    if (next.displayName) {
      await database.user.update({ where: { id: member.userId }, data: { name: next.displayName } });
    }
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.user_patched",
      resourceType: "member",
      resourceId: member.id,
      metadata: { ...next },
    });
    const updated = await loadMember(auth.workspaceId, member.id);
    res.json(toScimUser(updated!, baseUrl(req)));
  });

  router.delete("/Users/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const member = await loadMember(auth.workspaceId, req.params.id);
    if (!member) return sendError(res, 404, "User not found.");
    if (member.role === "OWNER") {
      return sendError(res, 403, "Ownership must be transferred before deprovisioning.");
    }
    await database.workspaceMember.update({
      where: { id: member.id },
      data: { deletedAt: new Date(), status: "SUSPENDED" },
    });
    await appendMemberChange(auth.workspaceId, auth.tokenId, member.id, "DELETE");
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.user_deleted",
      resourceType: "member",
      resourceId: member.id,
    });
    res.status(204).end();
  });

  // --- groups ----------------------------------------------------------------

  async function groupResource(auth: ScimAuth, groupId: string, req: Request) {
    const group = await database.scimGroup.findFirst({
      where: { id: groupId, workspaceId: auth.workspaceId },
    });
    if (!group) return null;
    const links = await database.scimGroupMember.findMany({ where: { groupId: group.id } });
    const members = await database.workspaceMember.findMany({
      where: { id: { in: links.map((link) => link.memberId) } },
      select: { id: true, userId: true },
    });
    const users = await database.user.findMany({
      where: { id: { in: members.map((member) => member.userId) } },
      select: { id: true, email: true },
    });
    const emailById = new Map(users.map((user) => [user.id, user.email]));
    return toScimGroup(
      group,
      members.map((member) => ({ memberId: member.id, display: emailById.get(member.userId) })),
      baseUrl(req),
    );
}

  router.get("/Groups", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const groups = await database.scimGroup.findMany({
      where: { workspaceId: auth.workspaceId },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    const filter = parseScimFilter(typeof req.query.filter === "string" ? req.query.filter : null);
    const visible = filter && filter !== "invalid" && filter.attribute === "displayName"
      ? groups.filter((group) => group.displayName.toLowerCase().includes(filter.value.toLowerCase()))
      : groups;
    const resources = await Promise.all(visible.map((group) => groupResource(auth, group.id, req)));
    res.json(scimList(resources.filter(Boolean), visible.length, 1));
  });

  router.get("/Groups/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const resource = await groupResource(auth, req.params.id, req);
    if (!resource) return sendError(res, 404, "Group not found.");
    res.json(resource);
  });

  router.post("/Groups", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 120) : "";
    if (!displayName) return sendError(res, 400, "displayName is required.", "invalidValue");
    const extension = body[SCIM_ROLE_EXTENSION] as { role?: unknown } | undefined;
    const role = roleForScimGroup(displayName, extension?.role) ?? "EDITOR";
    const existing = await database.scimGroup.findUnique({
      where: { workspaceId_displayName: { workspaceId: auth.workspaceId, displayName } },
    });
    if (existing) return sendError(res, 409, "A group with this name already exists.", "uniqueness");

    const group = await database.scimGroup.create({
      data: { id: createId(), workspaceId: auth.workspaceId, displayName, role },
    });
    const memberIds = memberIdsFromValue(body.members);
    for (const memberId of memberIds) {
      const member = await loadMember(auth.workspaceId, memberId);
      if (!member) continue;
      await database.scimGroupMember.create({ data: { id: createId(), groupId: group.id, memberId } });
      await applyGroupRole(auth.workspaceId, auth.tokenId, memberId, role);
    }
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.group_created",
      resourceType: "scim_group",
      resourceId: group.id,
      metadata: { displayName, role, members: memberIds.length },
    });
    const resource = await groupResource(auth, group.id, req);
    res.status(201).location(`${baseUrl(req)}/Groups/${group.id}`).json(resource);
  });

  router.patch("/Groups/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const group = await database.scimGroup.findFirst({
      where: { id: req.params.id, workspaceId: auth.workspaceId },
    });
    if (!group) return sendError(res, 404, "Group not found.");
    const operations = readScimPatchOperations(req.body);
    if (!operations.length) return sendError(res, 400, "No supported patch operations.", "invalidValue");

    for (const operation of operations) {
      const path = operation.path?.toLowerCase() ?? "";
      if (path.startsWith("displayname") && typeof operation.value === "string") {
        await database.scimGroup.update({
          where: { id: group.id },
          data: { displayName: operation.value.trim().slice(0, 120) },
        });
        continue;
      }
      if (path.startsWith("members") && operation.op === "remove") {
        const bracket = /\[value\s+eq\s+"([^"]+)"\]/i.exec(operation.path ?? "");
        const ids = bracket ? [bracket[1]!] : memberIdsFromValue(operation.value);
        if (ids.length) {
          await database.scimGroupMember.deleteMany({
            where: { groupId: group.id, memberId: { in: ids } },
          });
        }
        continue;
      }
      if (path.startsWith("members") || path === "") {
        const ids = memberIdsFromValue(
          Array.isArray(operation.value)
            ? operation.value
            : operation.value && typeof operation.value === "object"
              ? ((operation.value as { members?: unknown }).members ?? [])
              : [],
        );
        for (const memberId of ids) {
          const member = await loadMember(auth.workspaceId, memberId);
          if (!member) continue;
          await database.scimGroupMember.upsert({
            where: { groupId_memberId: { groupId: group.id, memberId } },
            create: { id: createId(), groupId: group.id, memberId },
            update: {},
          });
          await applyGroupRole(auth.workspaceId, auth.tokenId, memberId, group.role);
        }
      }
    }
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.group_patched",
      resourceType: "scim_group",
      resourceId: group.id,
    });
    const resource = await groupResource(auth, group.id, req);
    res.json(resource);
  });

  router.delete("/Groups/:id", async (req, res) => {
    const auth = await authenticate(req);
    if (!auth) return sendError(res, 401, "A valid SCIM bearer token is required.");
    const group = await database.scimGroup.findFirst({
      where: { id: req.params.id, workspaceId: auth.workspaceId },
      select: { id: true },
    });
    if (!group) return sendError(res, 404, "Group not found.");
    await database.$transaction([
      database.scimGroupMember.deleteMany({ where: { groupId: group.id } }),
      database.scimGroup.delete({ where: { id: group.id } }),
    ]);
    await writeAudit(database, {
      workspaceId: auth.workspaceId,
      actorId: auth.tokenId,
      action: "scim.group_deleted",
      resourceType: "scim_group",
      resourceId: group.id,
    });
    res.status(204).end();
  });

  return router;
}
