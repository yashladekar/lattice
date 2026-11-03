import { describe, expect, it } from "vitest";

import { createConsoleQueryValidator, stripSqlNoise } from "./console";

const validate = createConsoleQueryValidator(["pages", "tags", "page_tags", "edges"]);

const accepts = (sql: string) => {
  const result = validate(sql);
  if ("error" in result) throw new Error(`expected acceptance, got: ${result.error}`);
  return result.sql;
};
const rejects = (sql: string) => {
  const result = validate(sql);
  if (!("error" in result)) throw new Error(`expected rejection, got: ${result.sql}`);
  return result.error;
};

describe("stripSqlNoise", () => {
  it("blanks comments and quoted strings", () => {
    const cleaned = stripSqlNoise("select 'drop table' -- delete everything\n/* drop */ from pages");
    expect(cleaned).not.toContain("drop");
    expect(cleaned).not.toContain("delete");
    expect(cleaned).toContain("pages");
  });
});

describe("console query validation", () => {
  it("accepts a plain select over an allowed view", () => {
    expect(accepts("select * from pages")).toBe("select * from pages");
  });

  it("accepts with-queries that list allowed views", () => {
    const sql = "with recent as (select id, title from pages limit 5) select * from recent";
    expect(accepts(sql)).toBe(sql);
  });

  it("accepts a trailing semicolon but not two statements", () => {
    expect(accepts("select 1 from tags;")).toBe("select 1 from tags");
    expect(rejects("select 1 from tags; select 1 from tags")).toBe("Run one statement at a time.");
  });

  it("rejects anything that is not a read", () => {
    expect(rejects("delete from pages")).toMatch(/^DELETE is not allowed/);
    expect(rejects("update pages set title = 'x'")).toMatch(/^UPDATE is not allowed/);
    expect(rejects("drop table pages")).toMatch(/^DROP is not allowed/);
    expect(rejects("select 1 into tmp from pages")).toMatch(/^INTO is not allowed/);
    expect(rejects("create view v as select 1")).toMatch(/^CREATE is not allowed/);
    expect(rejects("truncate pages")).toMatch(/^TRUNCATE is not allowed/);
    expect(rejects("insert into pages values (1)")).toMatch(/^INSERT is not allowed/);
  });

  it("does not accept a read hidden behind a comment", () => {
    expect(rejects("/* select */ delete from pages")).toMatch(/^DELETE is not allowed/);
    expect(rejects("select 1 from pages /* ; drop table pages */; drop table pages")).toBe(
      "Run one statement at a time.",
    );
  });

  it("treats a trailing comment as whitespace", () => {
    expect(accepts("select 1 from pages -- just a note")).toBe("select 1 from pages -- just a note");
  });

  it("rejects other schemas and system catalogs", () => {
    expect(rejects("select * from public.page")).toBe(
      "Only the console views are queryable; other schemas are blocked.",
    );
    expect(rejects("select * from information_schema.tables")).toBe(
      "Only the console views are queryable; other schemas are blocked.",
    );
    expect(rejects("select * from pg_class")).toBe(
      "Only the console views are queryable; other schemas are blocked.",
    );
  });

  it("rejects real tables that are not exposed as views", () => {
    expect(rejects("select * from page")).toContain('"page" is not a console view');
    expect(rejects("select * from user")).toContain('"user" is not a console view');
    expect(rejects("select * from session")).toContain('"session" is not a console view');
  });

  it("rejects a non-console schema qualifier", () => {
    expect(rejects("select * from other.pages")).toContain('Schema "other" is not queryable');
  });

  it("allows the console schema explicitly and rejects unknown names there", () => {
    expect(accepts("select * from console.pages")).toBe("select * from console.pages");
    expect(rejects("select * from console.secrets")).toContain('"secrets" is not a console view');
  });

  it("checks joined views too", () => {
    expect(accepts("select p.title from pages p join page_tags pt on pt.page_id = p.id")).toBe(
      "select p.title from pages p join page_tags pt on pt.page_id = p.id",
    );
    expect(rejects("select 1 from pages p join workspace_member m on true")).toContain(
      '"workspace_member" is not a console view',
    );
  });

  it("rejects empty input and dollar quoting", () => {
    expect(rejects("   ")).toBe("Write a query to run.");
    expect(rejects("select $$x$$ from pages")).toBe("Dollar-quoted strings are not supported.");
  });

  it("leaves keywords inside strings and identifiers alone", () => {
    expect(accepts("select title from pages where title ilike '%update%'")).toContain("ilike");
    expect(accepts("select created_at, updated_at from pages")).toContain("updated_at");
  });
});
