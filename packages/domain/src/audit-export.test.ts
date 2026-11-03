import { describe, expect, it } from "vitest";

import { auditExportFilename, auditLogToCsv, csvCell } from "./audit-export";

const row = (overrides: Partial<Parameters<typeof auditLogToCsv>[0][number]> = {}) => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  action: "page.create",
  resourceType: "page",
  resourceId: "page-1",
  actorId: "user-1",
  metadata: {},
  ...overrides,
});

describe("csvCell", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvCell("page.create")).toBe("page.create");
  });

  it("quotes a value containing a comma", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("doubles embedded quotes", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a value containing a line break, so the row is not split", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("carriage\rreturn")).toBe('"carriage\rreturn"');
  });

  it("renders empty for null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("stringifies numbers and booleans", () => {
    expect(csvCell(42)).toBe("42");
    expect(csvCell(false)).toBe("false");
  });

  it("does not treat a lone quote as a delimiter", () => {
    expect(csvCell("it's")).toBe("it's");
  });
});

describe("auditLogToCsv", () => {
  it("writes a header and one line per entry", () => {
    const csv = auditLogToCsv([row()], { bom: false });
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("timestamp,action,resourceType,resourceId,actorId,metadata");
    expect(lines[1]).toContain("page.create");
  });

  it("orders rows oldest first regardless of input order", () => {
    const csv = auditLogToCsv(
      [
        row({ createdAt: "2026-03-01T00:00:00.000Z", action: "third" }),
        row({ createdAt: "2026-01-01T00:00:00.000Z", action: "first" }),
        row({ createdAt: "2026-02-01T00:00:00.000Z", action: "second" }),
      ],
      { bom: false },
    );
    const actions = csv.trimEnd().split("\r\n").slice(1).map((line) => line.split(",")[1]);
    expect(actions).toEqual(["first", "second", "third"]);
  });

  it("keeps a malicious value inside its own cell", () => {
    const csv = auditLogToCsv(
      [row({ resourceId: 'x","injected": "yes' })],
      { bom: false },
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"x"",""injected"": ""yes"');
  });

  it("survives an action containing a newline without adding a row", () => {
    const csv = auditLogToCsv([row({ action: "line\nbreak" })], { bom: false });
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });

  it("serialises metadata as JSON in one cell", () => {
    const csv = auditLogToCsv([row({ metadata: { a: 1, b: "two" } })], { bom: false });
    expect(csv).toContain('"{""a"":1,""b"":""two""}"');
  });

  it("omits a leading byte order mark when asked", () => {
    expect(auditLogToCsv([], { bom: false }).startsWith("\uFEFF")).toBe(false);
    expect(auditLogToCsv([]).startsWith("\uFEFF")).toBe(true);
  });

  it("accepts Date values and writes them as ISO", () => {
    const csv = auditLogToCsv([row({ createdAt: new Date("2026-02-03T04:05:06.000Z") })], {
      bom: false,
    });
    expect(csv).toContain("2026-02-03T04:05:06.000Z");
  });

  it("still writes the header for an empty log", () => {
    expect(auditLogToCsv([], { bom: false })).toBe(
      "timestamp,action,resourceType,resourceId,actorId,metadata\r\n",
    );
  });
});

describe("auditExportFilename", () => {
  it("slugifies the workspace and stamps the date", () => {
    expect(auditExportFilename("Collab's Lattice", new Date("2026-05-04T10:00:00Z"))).toBe(
      "collab-s-lattice-audit-2026-05-04.csv",
    );
  });

  it("falls back when the name has nothing usable", () => {
    expect(auditExportFilename("!!!", new Date("2026-05-04T10:00:00Z"))).toBe(
      "workspace-audit-2026-05-04.csv",
    );
  });
});
