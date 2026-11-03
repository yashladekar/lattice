import { describe, expect, it } from "vitest";

import { dedupeChanges, decodeCursor, encodeCursor, isAfterCursor, normalizedSyncOps } from "./sync";

describe("sync cursors", () => {
  it("round-trips a composite cursor", () => {
    const cursor = { version: 42, id: "sc_abc" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("treats a version-only cursor as the start of that version", () => {
    expect(decodeCursor("7")).toEqual({ version: 7, id: "" });
    expect(decodeCursor("nope")).toBeNull();
  });

  it("compares by version before id", () => {
    const cursor = { version: 3, id: "b" };
    expect(isAfterCursor(cursor, 4, "a")).toBe(true);
    expect(isAfterCursor(cursor, 3, "c")).toBe(true);
    expect(isAfterCursor(cursor, 3, "a")).toBe(false);
    expect(isAfterCursor(null, 1, "a")).toBe(true);
  });
});

describe("dedupeChanges", () => {
  it("keeps only the final write per entity", () => {
    const changes = [
      { entity: "pageDocument", entityId: "p1", op: "UPSERT" as const, data: { rev: 0 } },
      { entity: "page", entityId: "p1", op: "UPSERT" as const, data: { title: "A" } },
      { entity: "pageDocument", entityId: "p1", op: "UPSERT" as const, data: { rev: 1 } },
    ];
    const result = dedupeChanges(changes);
    expect(result).toHaveLength(2);
    const document = result.find((change) => change.entity === "pageDocument");
    expect(document?.data).toEqual({ rev: 1 });
  });

  it("treats a later delete as the final state", () => {
    const changes = [
      { entity: "edge", entityId: "e1", op: "UPSERT" as const },
      { entity: "edge", entityId: "e1", op: "DELETE" as const },
    ];
    expect(dedupeChanges(changes)).toEqual([{ entity: "edge", entityId: "e1", op: "DELETE" }]);
  });

  it("keeps different entities and different types apart", () => {
    const changes = [
      { entity: "page", entityId: "a", op: "UPSERT" as const },
      { entity: "node", entityId: "a", op: "UPSERT" as const },
      { entity: "page", entityId: "b", op: "UPSERT" as const },
    ];
    expect(dedupeChanges(changes)).toHaveLength(3);
    expect(dedupeChanges([])).toEqual([]);
  });

  it("preserves extra fields on the surviving change", () => {
    const changes = [
      { entity: "page", entityId: "a", op: "UPSERT" as const, data: { title: "old" } },
      { entity: "page", entityId: "a", op: "UPSERT" as const, data: { title: "new" } },
    ];
    expect(dedupeChanges(changes)[0]).toEqual({
      entity: "page",
      entityId: "a",
      op: "UPSERT",
      data: { title: "new" },
    });
  });
});

describe("normalizedSyncOps", () => {
  it("collapses retries by op id", () => {
    const ops = [
      { opId: "a", entity: "page" },
      { opId: "b", entity: "page" },
      { opId: "a", entity: "page" },
    ] as never;
    expect(normalizedSyncOps(ops)).toHaveLength(2);
  });
});
