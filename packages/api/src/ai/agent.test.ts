import { describe, expect, it } from "vitest";

import { extractJsonObject, parseAgentReply } from "./agent";

describe("JSON extraction", () => {
  it("finds a bare object", () => {
    expect(extractJsonObject('sure — {"action":"answer","text":"hi"}')).toBe(
      '{"action":"answer","text":"hi"}',
    );
  });

  it("finds a fenced object", () => {
    expect(
      extractJsonObject('```json\n{"action":"answer","text":"hi"}\n```'),
    ).toBe('{"action":"answer","text":"hi"}');
  });

  it("ignores braces inside strings", () => {
    const raw = extractJsonObject('{"action":"answer","text":"use } and { carefully"}');
    expect(raw).toBe('{"action":"answer","text":"use } and { carefully"}');
  });

  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject('{"unterminated": true')).toBeNull();
  });
});

describe("agent replies", () => {
  it("reads a tool call", () => {
    expect(
      parseAgentReply('{"action":"tool","tool":"read_page","input":{"pageId":"p1"}}'),
    ).toEqual({ action: "tool", tool: "read_page", input: { pageId: "p1" } });
  });

  it("defaults a missing tool input to an empty object", () => {
    expect(parseAgentReply('{"action":"tool","tool":"list_pages"}')).toEqual({
      action: "tool",
      tool: "list_pages",
      input: {},
    });
  });

  it("reads an answer", () => {
    expect(parseAgentReply('{"action":"answer","text":"Nothing to change."}')).toEqual({
      action: "answer",
      text: "Nothing to change.",
    });
  });

  it("validates and normalizes a plan", () => {
    const reply = parseAgentReply(
      JSON.stringify({
        action: "plan",
        title: "Add a summary",
        ops: [
          {
            kind: "append_blocks",
            pageId: "p1",
            nodes: [{ type: "paragraph", content: [{ type: "text", text: "Summary" }] }],
          },
        ],
      }),
    );
    expect(reply?.action).toBe("plan");
    if (reply?.action !== "plan") throw new Error("expected a plan");
    expect(reply.plan.title).toBe("Add a summary");
    expect(reply.plan.ops).toHaveLength(1);
    expect(reply.warnings).toEqual([]);
  });

  it("rejects a plan whose only op has no usable blocks", () => {
    const reply = parseAgentReply(
      JSON.stringify({
        action: "plan",
        title: "Embed a page",
        ops: [{ kind: "append_blocks", pageId: "p1", nodes: [{ type: "pageEmbed" }] }],
      }),
    );
    expect(reply).toBeNull();
  });

  it("accepts a plan that writes new notes from general knowledge", () => {
    const reply = parseAgentReply(
      JSON.stringify({
        action: "plan",
        title: "System design, beginner to advanced",
        ops: [
          {
            kind: "create_page",
            title: "System design: fundamentals",
            markdown: "# Fundamentals\n\n- Latency and throughput\n- Read vs write paths",
          },
          {
            kind: "create_page",
            title: "System design: scaling",
            markdown: "# Scaling\n\n- Sharding\n- Caching layers",
          },
        ],
      }),
    );
    expect(reply?.action).toBe("plan");
    if (reply?.action !== "plan") throw new Error("expected a plan");
    expect(reply.plan.ops).toHaveLength(2);
    expect(reply.plan.ops[0]?.kind).toBe("create_page");
    expect(reply.warnings).toEqual([]);
  });

  it("rejects a create_page op with no body", () => {
    expect(
      parseAgentReply(
        JSON.stringify({
          action: "plan",
          title: "Empty",
          ops: [{ kind: "create_page", title: "Nothing", markdown: "" }],
        }),
      ),
    ).toBeNull();
  });

  it("accepts a replace_page op used to repair a blank page", () => {
    const reply = parseAgentReply(
      JSON.stringify({
        action: "plan",
        title: "Fill the blank pages",
        ops: [
          {
            kind: "replace_page",
            pageId: "p1",
            markdown: "# System Design Foundations\n\nWhat system design is.",
          },
        ],
      }),
    );
    expect(reply?.action).toBe("plan");
    if (reply?.action !== "plan") throw new Error("expected a plan");
    expect(reply.plan.ops[0]).toMatchObject({ kind: "replace_page", pageId: "p1" });
  });

  it("rejects a replace_page op with no body", () => {
    expect(
      parseAgentReply(
        JSON.stringify({
          action: "plan",
          title: "Empty",
          ops: [{ kind: "replace_page", pageId: "p1", markdown: "" }],
        }),
      ),
    ).toBeNull();
  });

  it("parses a plan whose page bodies contain mermaid fences", () => {
    const reply = parseAgentReply(
      JSON.stringify({
        action: "plan",
        title: "System design",
        ops: [
          {
            kind: "create_page",
            ref: "ref:one",
            title: "One",
            markdown:
              "Intro\n\n```mermaid\nflowchart TD\n  a[Client] --> b{Healthy?}\n  b --> c[Server]\n```\n\nDone",
          },
        ],
      }),
    );
    expect(reply?.action).toBe("plan");
    if (reply?.action !== "plan") throw new Error("expected a plan");
    expect(reply.plan.ops[0]).toMatchObject({ kind: "create_page" });
  });

  it("finds the reply when prose and a fence precede it", () => {
    const reply = parseAgentReply(
      'Here you go:\n```json\n{"action":"answer","text":"hi"}\n```',
    );
    expect(reply).toEqual({ action: "answer", text: "hi" });
  });

  it("rejects prose and unknown actions", () => {
    expect(parseAgentReply("I will now edit your notes.")).toBeNull();
    expect(parseAgentReply('{"action":"delete_everything"}')).toBeNull();
    expect(parseAgentReply('{"action":"answer"}')).toBeNull();
  });

  it("rejects a tool reply without a name", () => {
    expect(parseAgentReply('{"action":"tool","input":{}}')).toBeNull();
  });
});
