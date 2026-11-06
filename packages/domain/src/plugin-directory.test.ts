import { describe, expect, it } from "vitest";

import { DIRECTORY_PLUGINS, directoryPlugins } from "./plugin-directory";
import { initialGrant, validateManifest } from "./plugins";

describe("plugin directory", () => {
  it("ships plugins with valid manifests and sources", () => {
    for (const entry of DIRECTORY_PLUGINS) {
      const validation = validateManifest(entry.manifest);
      expect(validation.ok, entry.manifest.id).toBe(true);
      expect(entry.source.trim().length).toBeGreaterThan(0);
      expect(entry.source).toContain("async function run");
    }
  });

  it("keeps the filtered catalog equal to the shipped catalog", () => {
    expect(directoryPlugins()).toHaveLength(DIRECTORY_PLUGINS.length);
  });

  it("only requests capabilities the host actually has", () => {
    for (const entry of DIRECTORY_PLUGINS) {
      expect(initialGrant(entry.manifest)).toEqual(entry.manifest.permissions);
    }
  });
});
