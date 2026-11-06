import type { Role } from "./types";

/**
 * SCIM 2.0 helpers.
 *
 * Provisioning is a plain REST contract, so the parsing and mapping live here as
 * pure functions: the HTTP layer only wires them to the database, and every
 * mapping decision (which IdP role becomes which workspace role) is testable
 * without a server.
 */
export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_ENTERPRISE_USER_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
export const SCIM_ROLE_EXTENSION = "urn:lattice:scim:1.0:Group";
export const SCIM_MAX_RESULTS = 100;

/** Workspace roles SCIM may assign. Ownership is never handed out by a token. */
export const SCIM_ROLES: Array<"ADMIN" | "MEMBER" | "EDITOR" | "VIEWER"> = [
  "ADMIN",
  "MEMBER",
  "EDITOR",
  "VIEWER",
];

export interface ScimFilter {
  attribute: "userName" | "externalId" | "displayName";
  value: string;
}

/**
 * Parses the subset of SCIM filters IdPs actually send for matching:
 * `userName eq "x"`, `externalId eq "y"`, `displayName eq "z"`. Anything more
 * elaborate is rejected rather than approximated, so a caller sees that it was
 * not understood.
 */
export function parseScimFilter(value: string | null | undefined): ScimFilter | null | "invalid" {
  if (!value || !value.trim()) return null;
  const match = /^\s*(userName|externalId|displayName)\s+eq\s+"([^"]*)"\s*$/i.exec(value);
  if (!match) return "invalid";
  const attribute =
    match[1]!.toLowerCase() === "username"
      ? "userName"
      : match[1]!.toLowerCase() === "externalid"
        ? "externalId"
        : "displayName";
  const literal = match[2]!.trim();
  if (!literal) return "invalid";
  return { attribute, value: literal };
}

/** Maps an IdP-supplied role name onto a workspace role. */
export function roleForScimRole(value: unknown): Exclude<Role, "OWNER"> | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("owner")) return null;
  if (normalized.includes("admin")) return "ADMIN";
  if (normalized.includes("editor") || normalized.includes("member") || normalized.includes("write")) {
    return "EDITOR";
  }
  if (normalized.includes("viewer") || normalized.includes("read") || normalized.includes("guest")) {
    return "VIEWER";
  }
  return null;
}

/**
 * Group names from the common IdP conventions map to a role; a custom
 * `urn:lattice:scim:1.0:Group` role attribute wins when it is present.
 */
export function roleForScimGroup(displayName: string, extensionRole?: unknown): Exclude<Role, "OWNER"> | null {
  const fromExtension = roleForScimRole(extensionRole);
  if (fromExtension) return fromExtension;
  return roleForScimRole(displayName.replace(/[_-]+/g, " "));
}

export interface ScimMemberRecord {
  id: string;
  userId: string;
  role: string;
  status: string;
  externalId?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  user: { id: string; name: string; email: string } | null;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name: { givenName?: string; familyName?: string; formatted?: string };
  displayName: string;
  emails: Array<{ value: string; primary: boolean; type: string }>;
  active: boolean;
  roles: Array<{ value: string; primary: boolean }>;
  meta: {
    resourceType: "User";
    created: string;
    lastModified: string;
    location: string;
  };
}

function splitName(name: string): { givenName?: string; familyName?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { givenName: parts[0] };
  return { givenName: parts[0], familyName: parts.slice(1).join(" ") };
}

export function toScimUser(
  member: ScimMemberRecord,
  baseUrl: string,
): ScimUserResource {
  const displayName = member.user?.name ?? "";
  return {
    schemas: [SCIM_USER_SCHEMA, SCIM_ENTERPRISE_USER_SCHEMA],
    id: member.id,
    ...(member.externalId ? { externalId: member.externalId } : {}),
    userName: member.user?.email ?? "",
    name: { ...splitName(displayName), formatted: displayName },
    displayName: displayName || (member.user?.email ?? ""),
    emails: member.user?.email
      ? [{ value: member.user.email, primary: true, type: "work" }]
      : [],
    active: member.status === "ACTIVE",
    roles: [{ value: member.role, primary: true }],
    meta: {
      resourceType: "User",
      created: new Date(member.createdAt).toISOString(),
      lastModified: new Date(member.updatedAt).toISOString(),
      location: `${baseUrl}/Users/${member.id}`,
    },
  };
}

export interface ScimGroupRecord {
  id: string;
  displayName: string;
  role: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ScimGroupResource {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string }>;
  meta: {
    resourceType: "Group";
    created: string;
    lastModified: string;
    location: string;
  };
  [SCIM_ROLE_EXTENSION]: { role: string };
}

export function toScimGroup(
  group: ScimGroupRecord,
  members: Array<{ memberId: string; display?: string }>,
  baseUrl: string,
): ScimGroupResource {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: group.id,
    displayName: group.displayName,
    members: members.map((member) => ({
      value: member.memberId,
      ...(member.display ? { display: member.display } : {}),
    })),
    meta: {
      resourceType: "Group",
      created: new Date(group.createdAt).toISOString(),
      lastModified: new Date(group.updatedAt).toISOString(),
      location: `${baseUrl}/Groups/${group.id}`,
    },
    [SCIM_ROLE_EXTENSION]: { role: group.role },
  };
}

/** RFC 7644 list envelope. */
export function scimList<T>(
  resources: T[],
  totalResults: number,
  startIndex: number,
): {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
} {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export interface ScimPatchOperation {
  op: "add" | "replace" | "remove";
  path?: string;
  value?: unknown;
}

/** Reads the operations array from an RFC 7644 PATCH body, keeping valid ops. */
export function readScimPatchOperations(body: unknown): ScimPatchOperation[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const operations = (body as { Operations?: unknown; operations?: unknown });
  const list = Array.isArray(operations.Operations)
    ? operations.Operations
    : Array.isArray(operations.operations)
      ? operations.operations
      : [];
  const parsed: ScimPatchOperation[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const op = typeof record.op === "string" ? record.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") continue;
    parsed.push({
      op,
      ...(typeof record.path === "string" && record.path.trim() ? { path: record.path.trim() } : {}),
      ...("value" in record ? { value: record.value } : {}),
    });
  }
  return parsed;
}

export function scimError(status: number, detail: string, scimType?: string) {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
    ...(scimType ? { scimType } : {}),
  };
}
