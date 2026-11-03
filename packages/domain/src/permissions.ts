import type { Page, Role, Visibility } from "./types";

export const ROLE_RANK: Record<Role, number> = {
  GUEST: 0,
  VIEWER: 1,
  EDITOR: 2,
  MEMBER: 3,
  ADMIN: 4,
  OWNER: 5,
};

export function hasRole(role: Role | null | undefined, minimum: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export function canReadContent(role: Role | null | undefined): boolean {
  return hasRole(role, "VIEWER");
}

export function canComment(role: Role | null | undefined): boolean {
  return hasRole(role, "VIEWER");
}

export function canEditContent(role: Role | null | undefined): boolean {
  return hasRole(role, "EDITOR");
}

export function canCreateContent(role: Role | null | undefined): boolean {
  return hasRole(role, "MEMBER");
}

export function canShare(role: Role | null | undefined): boolean {
  return hasRole(role, "MEMBER");
}

export function canManageMembers(role: Role | null | undefined): boolean {
  return hasRole(role, "ADMIN");
}

export function canManageWorkspace(role: Role | null | undefined): boolean {
  return hasRole(role, "ADMIN");
}

export function canDeleteWorkspace(role: Role | null | undefined): boolean {
  return hasRole(role, "OWNER");
}

export interface PageAccessInput {
  page: Pick<Page, "createdById" | "visibility">;
  userId: string;
  role: Role | null;
  explicitPermissionRole?: Role | null;
}

export function canReadPage(input: PageAccessInput): boolean {
  const { page, userId, role, explicitPermissionRole } = input;
  if (!role) return false;
  if (hasRole(role, "ADMIN")) return true;
  if (page.createdById === userId) return true;
  if (explicitPermissionRole) return true;
  return page.visibility === "WORKSPACE" || page.visibility === "PUBLIC";
}

export function canEditPage(input: PageAccessInput): boolean {
  const { page, userId, role, explicitPermissionRole } = input;
  if (!canEditContent(role)) return false;
  if (hasRole(role, "ADMIN")) return true;
  if (page.createdById === userId) return true;
  if (explicitPermissionRole && hasRole(explicitPermissionRole, "EDITOR")) return true;
  return page.visibility === "WORKSPACE";
}

export function canResolveVisibility(
  visibility: Visibility,
  role: Role | null,
): Visibility | null {
  if (!role) return null;
  if (visibility === "PUBLIC" && !canShare(role)) return null;
  return visibility;
}

export function assertRole(role: Role | null | undefined, minimum: Role): asserts role is Role {
  if (!hasRole(role, minimum)) {
    throw new Error(`Requires ${minimum} role`);
  }
}
