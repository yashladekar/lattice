/**
 * Plugin capability model.
 *
 * A manifest declares what a plugin wants; the host decides what it actually
 * gets. Capabilities are named from the data's point of view, not the API's,
 * so a permission reads the same in a consent dialog and in an enforcement
 * check. There is deliberately no network capability in this release.
 */
export const CAPABILITIES = [
  "page:read",
  "page:write",
  "page:create",
  "graph:read",
  "search:read",
  "ai:use",
  "storage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export interface CapabilityInfo {
  label: string;
  description: string;
  /** Higher means a mistake is harder to undo, and the consent UI says so. */
  risk: "low" | "medium" | "high";
}

export const CAPABILITY_INFO: Record<Capability, CapabilityInfo> = {
  "page:read": {
    label: "Read the page you are on",
    description: "Gets the text of the open page while a command is running.",
    risk: "low",
  },
  "page:write": {
    label: "Edit the page you are on",
    description: "Can replace the body of the open page. Every write is saved as a new revision.",
    risk: "high",
  },
  "page:create": {
    label: "Create pages",
    description: "Creates new pages in this workspace.",
    risk: "medium",
  },
  "graph:read": {
    label: "Read the knowledge graph",
    description: "Reads node and edge titles and relations.",
    risk: "low",
  },
  "search:read": {
    label: "Search this workspace",
    description: "Runs workspace searches, including full text.",
    risk: "low",
  },
  "ai:use": {
    label: "Use the configured AI provider",
    description: "Sends prompts through this workspace's AI configuration.",
    risk: "medium",
  },
  storage: {
    label: "Store plugin data",
    description: "Keeps a small key/value store of its own, separate from your notes.",
    risk: "low",
  },
};

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  /** What the plugin asks for. The host grants an intersection of this. */
  permissions: Capability[];
  /** Blocks the plugin contributes to the editor. */
  blocks?: PluginToolDefinition[];
  /** Tools the plugin contributes to canvas generation. */
  canvasTools?: PluginCanvasTool[];
}

export interface PluginToolDefinition {
  id: string;
  label: string;
  description?: string;
  /** How the host renders what the block returns. Defaults to plain text. */
  output?: "text" | "markdown";
}

export interface PluginCanvasTool extends PluginToolDefinition {
  /** How the host renders the markdown the tool returns. */
  layout: "mindmap" | "flow" | "concept";
}

export const MAX_PLUGIN_TOOLS = 8;
export const CANVAS_LAYOUTS = ["mindmap", "flow", "concept"] as const;

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
  manifest?: PluginManifest;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const MAX_TEXT = 240;

function text(value: unknown, field: string, errors: string[], max = MAX_TEXT): string {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} is required.`);
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    errors.push(`${field} must be ${max} characters or fewer.`);
    return trimmed.slice(0, max);
  }
  return trimmed;
}

/**
 * Validates an untrusted manifest. Unknown permissions are an error rather
 * than something to ignore: a plugin asking for a capability this build does
 * not have must not appear installable, because the author clearly expects a
 * different host.
 */
export function validateManifest(input: unknown): ManifestValidation {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["A manifest must be an object."] };
  }
  const record = input as Record<string, unknown>;

  const id = text(record.id, "id", errors);
  if (id && !ID_PATTERN.test(id)) {
    errors.push("id must be lowercase letters, numbers, dots, and dashes.");
  }
  const name = text(record.name, "name", errors, 80);
  const version = text(record.version, "version", errors, 40);
  if (version && !VERSION_PATTERN.test(version)) {
    errors.push("version must look like 1.0.0.");
  }
  const description = text(record.description, "description", errors);

  const permissions: Capability[] = [];
  const rawPermissions = record.permissions;
  if (rawPermissions === undefined || rawPermissions === null) {
    errors.push("permissions is required. Use an empty list for a plugin that needs nothing.");
  } else if (!Array.isArray(rawPermissions)) {
    errors.push("permissions must be a list.");
  } else {
    for (const entry of rawPermissions) {
      if (typeof entry !== "string" || !(CAPABILITIES as readonly string[]).includes(entry)) {
        errors.push(`Unknown permission: ${String(entry)}.`);
        continue;
      }
      const capability = entry as Capability;
      if (!permissions.includes(capability)) permissions.push(capability);
    }
  }

  const toolIdPattern = /^[a-z0-9][a-z0-9-]{0,40}$/;

  function parseTools(value: unknown, field: string, layouts: boolean): PluginToolDefinition[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      errors.push(`${field} must be a list.`);
      return [];
    }
    const tools: PluginToolDefinition[] = [];
    const seen = new Set<string>();
    for (const entry of value.slice(0, MAX_PLUGIN_TOOLS)) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`Every ${field} entry must be an object.`);
        continue;
      }
      const record = entry as Record<string, unknown>;
      const id = text(record.id, `${field}.id`, errors, 41);
      if (id && !toolIdPattern.test(id)) {
        errors.push(`${field}.id must be lowercase letters, numbers, and dashes.`);
        continue;
      }
      if (!id || seen.has(id)) continue;
      const label = text(record.label, `${field}.label`, errors, 60);
      if (!label) continue;
      seen.add(id);
      const description =
        typeof record.description === "string" && record.description.trim()
          ? record.description.trim().slice(0, 160)
          : undefined;
      let layout: PluginCanvasTool["layout"] | undefined;
      if (layouts) {
        if (!(CANVAS_LAYOUTS as readonly unknown[]).includes(record.layout)) {
          errors.push(`${field}.layout must be one of ${CANVAS_LAYOUTS.join(", ")}.`);
          continue;
        }
        layout = record.layout as PluginCanvasTool["layout"];
      }
      let output: PluginToolDefinition["output"];
      if (!layouts && record.output !== undefined) {
        if (record.output !== "text" && record.output !== "markdown") {
          errors.push(`${field}.output must be text or markdown.`);
          continue;
        }
        output = record.output;
      }
      tools.push({
        id,
        label,
        ...(description ? { description } : {}),
        ...(layout ? { layout } : {}),
        ...(output ? { output } : {}),
      });
    }
    if (Array.isArray(value) && value.length > MAX_PLUGIN_TOOLS) {
      errors.push(`${field} is capped at ${MAX_PLUGIN_TOOLS} entries.`);
    }
    return tools;
  }

  const blocks = parseTools(record.blocks, "blocks", false);
  const canvasTools = parseTools(record.canvasTools, "canvasTools", true);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    manifest: {
      id,
      name,
      version,
      description,
      permissions,
      ...(blocks.length ? { blocks } : {}),
      ...(canvasTools.length ? { canvasTools: canvasTools as PluginCanvasTool[] } : {}),
    },
  };
}

export interface PluginRecord {
  manifest: PluginManifest;
  /** What the user agreed to, which may be less than the manifest asked for. */
  granted: Capability[];
  enabled: boolean;
}

/** The host's answer for a single call, which is what the runtime enforces. */
export function isGranted(
  record: Pick<PluginRecord, "granted" | "enabled">,
  capability: Capability,
): boolean {
  return record.enabled && record.granted.includes(capability);
}

/**
 * Computes what to grant on install. Anything the manifest did not ask for is
 * never granted, so a record cannot silently widen later.
 */
export function initialGrant(manifest: PluginManifest): Capability[] {
  return manifest.permissions.filter((permission) => (CAPABILITIES as readonly string[]).includes(permission));
}

/** Permissions the manifest asks for that this host will not hand over. */
export function unsupportedRequests(manifest: PluginManifest): Capability[] {
  return manifest.permissions.filter(
    (permission) => !(CAPABILITIES as readonly string[]).includes(permission),
  );
}

/** Highest risk in the set, used to decide how loud the consent dialog is. */
export function highestRisk(capabilities: Capability[]): CapabilityInfo["risk"] {
  const order: Array<CapabilityInfo["risk"]> = ["low", "medium", "high"];
  return capabilities.reduce<CapabilityInfo["risk"]>(
    (worst, capability) =>
      order.indexOf(CAPABILITY_INFO[capability].risk) > order.indexOf(worst)
        ? CAPABILITY_INFO[capability].risk
        : worst,
    "low",
  );
}

export function describeRecord(record: PluginRecord): string {
  const labels = record.granted.map((capability) => CAPABILITY_INFO[capability].label.toLowerCase());
  if (!labels.length) return "Needs no access to your notes.";
  return `Can ${labels.join(", ")}.`;
}

/**
 * The methods a plugin may call. Keeping this table in the domain means the
 * worker bootstrap, the host, and the documentation all describe one contract.
 */
export const PLUGIN_METHODS: Record<string, Capability> = {
  readPage: "page:read",
  writePage: "page:write",
  createPage: "page:create",
  readGraph: "graph:read",
  search: "search:read",
  askAi: "ai:use",
  getItem: "storage",
  setItem: "storage",
};

export function capabilityForMethod(method: string): Capability | null {
  // Own properties only: `constructor` and friends must not resolve to a method.
  if (!Object.hasOwn(PLUGIN_METHODS, method)) return null;
  return PLUGIN_METHODS[method] ?? null;
}
