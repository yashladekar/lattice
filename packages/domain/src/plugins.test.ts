import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  PLUGIN_METHODS,
  capabilityForMethod,
  describeRecord,
  highestRisk,
  initialGrant,
  isGranted,
  unsupportedRequests,
  validateManifest,
} from "./plugins";

const base = {
  id: "com.example.words",
  name: "Word count",
  version: "1.2.3",
  description: "Counts words on the open page.",
  permissions: ["page:read"],
};

describe("validateManifest", () => {
  it("accepts a well-formed manifest", () => {
    const result = validateManifest(base);
    expect(result.ok).toBe(true);
    expect(result.manifest?.permissions).toEqual(["page:read"]);
  });

  it("accepts an empty permission list", () => {
    expect(validateManifest({ ...base, permissions: [] }).ok).toBe(true);
  });

  it("requires an id, name, version, description, and permissions list", () => {
    const result = validateManifest({});
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "id is required.",
        "name is required.",
        "version is required.",
        "description is required.",
        "permissions is required. Use an empty list for a plugin that needs nothing.",
      ]),
    );
  });

  it("rejects an id that would not survive being a key", () => {
    expect(validateManifest({ ...base, id: "Word Count" }).errors).toContain(
      "id must be lowercase letters, numbers, dots, and dashes.",
    );
  });

  it("rejects a version that is not one", () => {
    expect(validateManifest({ ...base, version: "latest" }).errors).toContain(
      "version must look like 1.0.0.",
    );
    expect(validateManifest({ ...base, version: "1.2.3-beta.1" }).ok).toBe(true);
  });

  it("refuses a permission this host does not have", () => {
    const result = validateManifest({ ...base, permissions: ["page:read", "network"] });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Unknown permission: network.");
  });

  it("does not accept the network capability even by another spelling", () => {
    for (const spelling of ["network", "net", "fetch", "http", "NETWORK"]) {
      expect(validateManifest({ ...base, permissions: [spelling] }).ok).toBe(false);
    }
    expect(CAPABILITIES).not.toContain("network" as never);
  });

  it("deduplicates repeated permissions", () => {
    const result = validateManifest({ ...base, permissions: ["page:read", "page:read"] });
    expect(result.manifest?.permissions).toEqual(["page:read"]);
  });

  it("rejects non-objects and arrays", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest("nope").ok).toBe(false);
    expect(validateManifest([]).ok).toBe(false);
  });
});

describe("grants", () => {
  const manifest = { ...base, permissions: ["page:read", "page:write"] };

  it("grants only what the manifest asked for", () => {
    expect(initialGrant(manifest as never)).toEqual(["page:read", "page:write"]);
  });

  it("denies a capability outside the grant", () => {
    const record = { granted: ["page:read"] as const, enabled: true };
    expect(isGranted(record, "page:read")).toBe(true);
    expect(isGranted(record, "page:write")).toBe(false);
  });

  it("denies everything while the plugin is disabled", () => {
    const record = { granted: ["page:read"] as const, enabled: false };
    expect(isGranted(record, "page:read")).toBe(false);
  });

  it("reports requests this host cannot satisfy", () => {
    expect(unsupportedRequests({ ...manifest, permissions: ["page:read", "telepathy"] } as never)).toEqual([
      "telepathy",
    ]);
  });
});

describe("presentation", () => {
  it("takes the highest risk in the set", () => {
    expect(highestRisk(["page:read"])).toBe("low");
    expect(highestRisk(["page:read", "page:create"])).toBe("medium");
    expect(highestRisk(["page:read", "page:write"])).toBe("high");
    expect(highestRisk([])).toBe("low");
  });

  it("describes a record in plain language", () => {
    expect(describeRecord({ manifest: base as never, granted: [], enabled: true })).toBe(
      "Needs no access to your notes.",
    );
    expect(
      describeRecord({ manifest: base as never, granted: ["page:read", "storage"], enabled: true }),
    ).toBe("Can read the page you are on, store plugin data.");
  });
});

describe("method capability table", () => {
  it("only names capabilities the host actually has", () => {
    for (const capability of Object.values(PLUGIN_METHODS)) {
      expect(CAPABILITIES).toContain(capability);
    }
  });

  it("resolves the methods a plugin is allowed to call", () => {
    expect(capabilityForMethod("readPage")).toBe("page:read");
    expect(capabilityForMethod("writePage")).toBe("page:write");
    expect(capabilityForMethod("getItem")).toBe("storage");
  });

  it("refuses inherited object members", () => {
    expect(capabilityForMethod("rm -rf")).toBeNull();
    expect(capabilityForMethod("constructor")).toBeNull();
    expect(capabilityForMethod("__proto__")).toBeNull();
    expect(capabilityForMethod("toString")).toBeNull();
    expect(capabilityForMethod("hasOwnProperty")).toBeNull();
  });
});
