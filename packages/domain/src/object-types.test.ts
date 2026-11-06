import { describe, expect, it } from "vitest";

import {
  coercePropertyValue,
  isPropertyType,
  parsePropertyDefinitions,
  propertyKeyFromLabel,
} from "./object-types";

describe("object type properties", () => {
  it("builds stable keys from labels", () => {
    expect(propertyKeyFromLabel("Due date")).toBe("due_date");
    expect(propertyKeyFromLabel("  Stage / Status ")).toBe("stage_status");
    expect(propertyKeyFromLabel("!!!")).toBe("field");
  });

  it("parses trusted definitions and drops junk", () => {
    const definitions = parsePropertyDefinitions([
      { label: "Stage", type: "select", options: ["Idea", "Active", "Active"] },
      { label: "Points", type: "number" },
      { label: "" },
      { key: "__type", label: "Reserved" },
      { label: "__internal" },
      "nope",
    ]);
    expect(definitions).toEqual([
      { key: "stage", label: "Stage", type: "select", options: ["Idea", "Active"] },
      { key: "points", label: "Points", type: "number" },
    ]);
  });

  it("de-duplicates by key and caps the schema", () => {
    const definitions = parsePropertyDefinitions([
      { label: "Name", type: "text" },
      { key: "name", label: "Other", type: "text" },
    ]);
    expect(definitions).toHaveLength(1);
    const many = parsePropertyDefinitions(
      Array.from({ length: 50 }, (_, index) => ({ label: `Field ${index}`, type: "text" })),
    );
    expect(many).toHaveLength(40);
  });

  it("recognizes property types", () => {
    expect(isPropertyType("select")).toBe(true);
    expect(isPropertyType("rich")).toBe(false);
  });

  it("coerces stored values to the schema type", () => {
    expect(coercePropertyValue("checkbox", "yes")).toBe(false);
    expect(coercePropertyValue("checkbox", true)).toBe(true);
    expect(coercePropertyValue("number", "42")).toBe(42);
    expect(coercePropertyValue("number", "abc")).toBeNull();
    expect(coercePropertyValue("text", 7)).toBe("7");
    expect(coercePropertyValue("date", null)).toBeNull();
  });
});
