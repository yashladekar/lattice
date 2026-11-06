import { describe, expect, it } from "vitest";

import {
  parseScimFilter,
  readScimPatchOperations,
  roleForScimGroup,
  roleForScimRole,
  scimList,
  toScimUser,
} from "./scim";

describe("scim filters", () => {
  it("reads the filters identity providers send", () => {
    expect(parseScimFilter('userName eq "Ada@Example.com"')).toEqual({
      attribute: "userName",
      value: "Ada@Example.com",
    });
    expect(parseScimFilter('externalId eq "00u1"')).toEqual({
      attribute: "externalId",
      value: "00u1",
    });
    expect(parseScimFilter("  displayName EQ \"Design\"  ")).toEqual({
      attribute: "displayName",
      value: "Design",
    });
  });

  it("treats empty as no filter and anything else as invalid", () => {
    expect(parseScimFilter("")).toBeNull();
    expect(parseScimFilter(null)).toBeNull();
    expect(parseScimFilter('userName sw "Ada"')).toBe("invalid");
    expect(parseScimFilter('userName eq ""')).toBe("invalid");
    expect(parseScimFilter("nonsense")).toBe("invalid");
  });
});

describe("scim role mapping", () => {
  it("maps common IdP role names", () => {
    expect(roleForScimRole("Admin")).toBe("ADMIN");
    expect(roleForScimRole("lattice-editors")).toBe("EDITOR");
    expect(roleForScimRole("Member")).toBe("EDITOR");
    expect(roleForScimRole("Read only")).toBe("VIEWER");
    expect(roleForScimRole("guest")).toBe("VIEWER");
    expect(roleForScimRole("owner")).toBeNull();
    expect(roleForScimRole("")).toBeNull();
    expect(roleForScimRole(42)).toBeNull();
  });

  it("prefers the explicit group role, then the group name", () => {
    expect(roleForScimGroup("Platform", "viewer")).toBe("VIEWER");
    expect(roleForScimGroup("lattice-admins")).toBe("ADMIN");
    expect(roleForScimGroup("Design team")).toBeNull();
  });
});

describe("scim resources", () => {
  const member = {
    id: "m1",
    userId: "u1",
    role: "EDITOR",
    status: "ACTIVE",
    externalId: "00u1",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-02T00:00:00.000Z",
    user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
  };

  it("serializes a member as a SCIM user", () => {
    const user = toScimUser(member, "https://api.example.com/scim/v2");
    expect(user.userName).toBe("ada@example.com");
    expect(user.externalId).toBe("00u1");
    expect(user.active).toBe(true);
    expect(user.name).toEqual({
      givenName: "Ada",
      familyName: "Lovelace",
      formatted: "Ada Lovelace",
    });
    expect(user.emails).toEqual([{ value: "ada@example.com", primary: true, type: "work" }]);
    expect(user.roles).toEqual([{ value: "EDITOR", primary: true }]);
    expect(user.meta.location).toBe("https://api.example.com/scim/v2/Users/m1");
  });

  it("marks suspended members inactive", () => {
    expect(toScimUser({ ...member, status: "SUSPENDED" }, "x").active).toBe(false);
    expect(toScimUser({ ...member, user: null }, "x").userName).toBe("");
  });

  it("wraps list results in the SCIM envelope", () => {
    expect(scimList(["a", "b"], 42, 1)).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 42,
      startIndex: 1,
      itemsPerPage: 2,
      Resources: ["a", "b"],
    });
  });
});

describe("scim patch bodies", () => {
  it("keeps valid operations and drops noise", () => {
    expect(
      readScimPatchOperations({
        Operations: [
          { op: "replace", path: "active", value: false },
          { op: "add", value: { name: { givenName: "Grace" } } },
          { op: "bogus", path: "active", value: true },
          "nope",
          { op: "remove", path: "members" },
        ],
      }),
    ).toEqual([
      { op: "replace", path: "active", value: false },
      { op: "add", value: { name: { givenName: "Grace" } } },
      { op: "remove", path: "members" },
    ]);
  });

  it("accepts lowercase operations arrays and junk", () => {
    expect(readScimPatchOperations({ operations: [{ op: "Replace", value: { active: false } }] })).toEqual([
      { op: "replace", value: { active: false } },
    ]);
    expect(readScimPatchOperations(null)).toEqual([]);
    expect(readScimPatchOperations({ Operations: "x" })).toEqual([]);
  });
});
