export const PROPERTY_TYPES = ["text", "number", "date", "select", "checkbox"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface ObjectPropertyDefinition {
  key: string;
  label: string;
  type: PropertyType;
  options?: string[];
}

export type PropertyValue = string | number | boolean | null;

export function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === "string" && (PROPERTY_TYPES as readonly string[]).includes(value);
}

/** Deterministic key from a label, stable for property storage and filters. */
export function propertyKeyFromLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field"
  );
}

/**
 * Parses an untrusted property schema (from JSON or a form) and drops entries
 * that cannot be rendered rather than trusting their shape.
 */
export function parsePropertyDefinitions(value: unknown): ObjectPropertyDefinition[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const definitions: ObjectPropertyDefinition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim().slice(0, 80) : "";
    if (!label) continue;
    const rawKey = typeof record.key === "string" ? record.key.trim() : "";
    // `__`-prefixed keys are reserved for the page record itself (like `__type`).
    if (rawKey.startsWith("__") || label.startsWith("__")) continue;
    const type = isPropertyType(record.type) ? record.type : "text";
    const key = rawKey ? propertyKeyFromLabel(rawKey) : propertyKeyFromLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const options =
      type === "select" && Array.isArray(record.options)
        ? [...new Set(record.options.filter((option): option is string => typeof option === "string" && Boolean(option.trim())).map((option) => option.trim().slice(0, 60)))]
        : undefined;
    definitions.push({
      key,
      label,
      type,
      ...(options && options.length ? { options } : {}),
    });
    if (definitions.length >= 40) break;
  }
  return definitions;
}

/** Coerces a stored value to the type the schema expects. */
export function coercePropertyValue(type: PropertyType, value: unknown): PropertyValue {
  if (type === "checkbox") return value === true;
  if (type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 2000);
}
