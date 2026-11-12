import { randomUUID } from "node:crypto";

import { afterEach, beforeAll, expect, it, vi } from "vitest";

import type { Database } from "@notes-learning/db";

import type { AiConfig } from "../context";
import {
  cleanupTestWorkspace,
  createTestDatabase,
  createTestWorkspace,
  describeWithDatabase,
  type TestWorkspace,
} from "../../test/helpers";
import { runAgent, type AgentEvent } from "../ai/agent";

const { runChat } = vi.hoisted(() => ({ runChat: vi.fn() }));

vi.mock("../ai/provider", () => ({
  chatCompletion: (...args: unknown[]) => runChat(...args),
}));

const ai: AiConfig = {
  baseUrl: "https://provider.example.com/v1",
  apiKey: "test-key",
  model: "test-model",
};

function reply(content: unknown) {
  return { ok: true as const, content: JSON.stringify(content), provider: "test-model" };
}

async function collect(events: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

function finalPlan(events: AgentEvent[]) {
  const done = events.find((event) => event.type === "done");
  if (done?.type !== "done") throw new Error("expected a done event");
  return done;
}

describeWithDatabase("agent run", () => {
  let db: Database;
  let workspace: TestWorkspace;
  let pageId: string;

  beforeAll(() => {
    runChat.mockReset();
  });

  afterEach(async () => {
    runChat.mockReset();
    if (!workspace) return;
    await cleanupTestWorkspace(db, workspace.id);
    await db.$disconnect();
  });

  const setup = async () => {
    db = createTestDatabase();
    workspace = await createTestWorkspace(db);
    pageId = randomUUID();
    await db.page.create({
      data: {
        id: pageId,
        workspaceId: workspace.id,
        title: "Spaced repetition",
        createdById: workspace.ownerId,
        updatedById: workspace.ownerId,
        visibility: "WORKSPACE",
      },
    });
    await db.pageDocument.create({
      data: {
        pageId,
        workspaceId: workspace.id,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { blockId: "block-1" },
              content: [{ type: "text", text: "Reviews spread out over time." }],
            },
          ],
        },
        plainText: "Reviews spread out over time.",
      },
    });
  };

  const run = (question: string) =>
    collect(
      runAgent({
        db,
        workspaceId: workspace.id,
        userId: workspace.ownerId,
        role: "OWNER",
        ai,
        question,
        pageId,
      }),
    );

  it("returns a plan for a page the reader can edit", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "Add a recap",
        ops: [
          {
            kind: "append_blocks",
            pageId,
            nodes: [{ type: "paragraph", content: [{ type: "text", text: "Recap." }] }],
          },
        ],
      }),
    );

    const events = await run("add a recap");
    const done = finalPlan(events);
    expect(done.plan?.title).toBe("Add a recap");
    expect(done.plan?.ops).toHaveLength(1);
    expect(done.warnings).toEqual([]);
    expect(events.some((event) => event.type === "plan")).toBe(true);
  });

  it("proposes new pages when the workspace has nothing to read", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "System design notes",
        ops: [
          {
            kind: "create_page",
            title: "System design: fundamentals",
            markdown: "# Fundamentals\n\nLatency, throughput, and the read/write path.",
          },
        ],
      }),
    );

    const done = finalPlan(await run("create system design notes for me"));
    expect(done.plan?.ops[0]?.kind).toBe("create_page");
    expect(done.warnings).toEqual([]);
  });

  it("keeps a whiteboard op alongside the pages it illustrates", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "Guide with a map",
        ops: [
          {
            kind: "create_page",
            ref: "ref:one",
            title: "One",
            markdown: "# One\n\nBody.",
          },
          {
            kind: "create_canvas",
            title: "Overview",
            layout: "mindmap",
            nodes: [
              { text: "Overview", level: 1 },
              { text: "One", level: 2 },
            ],
          },
        ],
      }),
    );

    const done = finalPlan(await run("write it and draw it"));
    expect(done.plan?.ops).toHaveLength(2);
    expect(done.plan?.ops[1]).toMatchObject({ kind: "create_canvas", layout: "mindmap" });
    expect(done.warnings).toEqual([]);
  });

  it("reads an existing whiteboard when asked about it", async () => {
    await setup();
    const canvasId = randomUUID();
    await db.canvas.create({
      data: {
        id: canvasId,
        workspaceId: workspace.id,
        title: "System design board",
        createdById: workspace.ownerId,
        data: {
          version: 1,
          background: "dots",
          elements: [
            {
              id: "n1",
              type: "note",
              x: 0,
              y: 0,
              width: 200,
              height: 120,
              text: "Load balancer",
              color: "saffron",
            },
            {
              id: "n2",
              type: "note",
              x: 300,
              y: 0,
              width: 200,
              height: 120,
              text: "Database",
              color: "moss",
            },
            {
              id: "c1",
              type: "connector",
              from: { elementId: "n2" },
              to: { elementId: "n1" },
            },
          ],
        },
      },
    });

    runChat
      .mockResolvedValueOnce(reply({ action: "tool", tool: "read_canvas", input: { canvasId } }))
      .mockResolvedValueOnce(reply({ action: "answer", text: "The board shows a load balancer and a database." }));

    const events = await run("what is on my system design board?");
    expect(events.filter((event) => event.type === "step")).toHaveLength(1);

    // The tool result is fed back to the model on the second turn.
    const secondTurn = JSON.stringify(runChat.mock.calls[1]?.[1] ?? []);
    expect(secondTurn).toContain("Load balancer");
    expect(secondTurn).toContain("Database");

    const done = finalPlan(events);
    expect(done.answer).toMatch(/load balancer/i);
  });

  it("proposes rewriting a page body", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "Fill it",
        ops: [{ kind: "replace_page", pageId, markdown: "# Filled\n\nReal content." }],
      }),
    );

    const done = finalPlan(await run("fill the blank page"));
    expect(done.plan?.ops[0]?.kind).toBe("replace_page");
    expect(done.warnings).toEqual([]);
  });

  it("keeps a plan that links the pages it is creating", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "System design",
        ops: [
          { kind: "create_page", ref: "ref:basics", title: "Basics", markdown: "# Basics" },
          { kind: "create_page", ref: "ref:advanced", title: "Advanced", markdown: "# Advanced" },
          {
            kind: "link_pages",
            sourcePageId: "ref:advanced",
            targetPageId: "ref:basics",
            relationType: "PART_OF",
          },
          {
            kind: "link_pages",
            sourcePageId: "ref:basics",
            targetPageId: pageId,
            relationType: "REFERENCES",
          },
        ],
      }),
    );

    const done = finalPlan(await run("create system design notes and connect them"));
    expect(done.plan?.ops).toHaveLength(4);
    expect(done.warnings).toEqual([]);
  });

  it("drops an op that references an alias the plan never declares", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "Broken",
        ops: [
          {
            kind: "link_pages",
            sourcePageId: "ref:missing",
            targetPageId: pageId,
            relationType: "RELATED_TO",
          },
        ],
      }),
    );

    const done = finalPlan(await run("link it"));
    expect(done.plan).toBeNull();
    expect(done.answer).toMatch(/does not create/i);
  });

  it("drops a change that targets a page which does not exist", async () => {
    await setup();
    runChat.mockResolvedValueOnce(
      reply({
        action: "plan",
        title: "Two edits",
        ops: [
          {
            kind: "append_blocks",
            pageId,
            nodes: [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }],
          },
          {
            kind: "append_blocks",
            pageId: randomUUID(),
            nodes: [{ type: "paragraph", content: [{ type: "text", text: "nope" }] }],
          },
        ],
      }),
    );

    const done = finalPlan(await run("edit two pages"));
    expect(done.plan?.ops).toHaveLength(1);
    expect(done.warnings.join(" ")).toMatch(/cannot edit that page/i);
  });

  it("runs a tool call and feeds the result back before answering", async () => {
    await setup();
    runChat
      .mockResolvedValueOnce(
        reply({ action: "tool", tool: "read_page", input: { pageId } }),
      )
      .mockResolvedValueOnce(
        reply({ action: "answer", text: "This page is about spacing reviews." }),
      );

    const events = await run("what is this page about?");
    expect(events.filter((event) => event.type === "step")).toHaveLength(1);
    const done = finalPlan(events);
    expect(done.answer).toMatch(/spacing reviews/);
    expect(done.plan).toBeNull();
  });

  it("does not touch a page when the tool asks for one that is missing", async () => {
    await setup();
    runChat
      .mockResolvedValueOnce(reply({ action: "tool", tool: "read_page", input: { pageId: randomUUID() } }))
      .mockResolvedValueOnce(reply({ action: "answer", text: "I could not find that page." }));

    const events = await run("read a missing page");
    const done = finalPlan(events);
    expect(done.answer).toMatch(/could not find/);
    expect(runChat).toHaveBeenCalledTimes(2);
  });

  it("repairs one malformed reply, then degrades to plain text", async () => {
    await setup();
    runChat
      .mockResolvedValueOnce({ ok: true, content: "I will edit your notes.", provider: "test-model" })
      .mockResolvedValueOnce({ ok: true, content: "Still prose.", provider: "test-model" });

    const events = await run("do something");
    const done = finalPlan(events);
    expect(done.plan).toBeNull();
    expect(done.answer).toBe("Still prose.");
    expect(done.warnings.join(" ")).toMatch(/readable plan/i);
  });

  it("stops at the step cap instead of looping forever", async () => {
    await setup();
    runChat.mockResolvedValue(reply({ action: "tool", tool: "list_pages", input: {} }));

    const events = await run("keep going");
    const done = finalPlan(events);
    expect(done.answer).toMatch(/stopped after/i);
    expect(runChat.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("reports a provider failure as an error event", async () => {
    await setup();
    runChat.mockResolvedValueOnce({
      ok: false,
      code: "subscription_sharing_usage_limit_exceeded",
      message: "Limit reached.",
      status: 429,
      requestId: "req_1",
    });

    const events = await run("hello");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      code: "subscription_sharing_usage_limit_exceeded",
    });
  });
});
