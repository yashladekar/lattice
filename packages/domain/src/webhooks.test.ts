import { describe, expect, it } from "vitest";

import {
  EMPTY_WEBHOOK_FILTERS,
  isSafeWebhookUrl,
  isWebhookEvent,
  parseWebhookFilters,
  WEBHOOK_EVENTS,
  webhookEventForChange,
  webhookMatchesFilters,
} from "./webhooks";

describe("webhooks", () => {
  it("maps change-log entities to subscribed events", () => {
    expect(webhookEventForChange("page", "UPSERT")).toBe("page.updated");
    expect(webhookEventForChange("page", "DELETE")).toBe("page.deleted");
    expect(webhookEventForChange("canvas", "UPSERT")).toBe("canvas.updated");
    expect(webhookEventForChange("capture", "UPSERT")).toBe("capture.updated");
    expect(webhookEventForChange("comment", "DELETE")).toBeNull();
    expect(webhookEventForChange("pageDocument", "UPSERT")).toBeNull();
    expect(webhookEventForChange("member", "UPSERT")).toBeNull();
  });

  it("recognizes known event names only", () => {
    for (const event of WEBHOOK_EVENTS) expect(isWebhookEvent(event)).toBe(true);
    expect(isWebhookEvent("page.created")).toBe(false);
    expect(isWebhookEvent(42)).toBe(false);
  });

  it("accepts public https endpoints", () => {
    expect(isSafeWebhookUrl("https://hooks.example.com/lattice")).toBe(true);
    expect(isSafeWebhookUrl("https://8.8.8.8/hook")).toBe(true);
  });

  it("rejects http, local, and private targets", () => {
    expect(isSafeWebhookUrl("http://hooks.example.com/x")).toBe(false);
    expect(isSafeWebhookUrl("https://localhost:3000/x")).toBe(false);
    expect(isSafeWebhookUrl("https://app.local/x")).toBe(false);
    expect(isSafeWebhookUrl("https://127.0.0.1/x")).toBe(false);
    expect(isSafeWebhookUrl("https://10.0.0.5/x")).toBe(false);
    expect(isSafeWebhookUrl("https://192.168.1.2/x")).toBe(false);
    expect(isSafeWebhookUrl("https://172.20.0.1/x")).toBe(false);
    expect(isSafeWebhookUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isSafeWebhookUrl("https://intranet/x")).toBe(false);
    expect(isSafeWebhookUrl("not a url")).toBe(false);
  });
});

const change = (data: Record<string, unknown>, op: "UPSERT" | "DELETE" = "UPSERT") => ({
  entity: "page",
  op,
  data,
});

describe("webhook filters", () => {
  it("normalizes untrusted filters and caps lists", () => {
    const filters = parseWebhookFilters({
      titleContains: "  Roadmap  ",
      notebookIds: ["n1", "n1", "", 7],
      pageTypes: ["document", "canvas"],
      operations: ["UPSERT", "NOPE"],
      actorIds: Array.from({ length: 40 }, (_, index) => `u${index}`),
    });
    expect(filters.titleContains).toBe("Roadmap");
    expect(filters.notebookIds).toEqual(["n1"]);
    expect(filters.pageTypes).toEqual(["DOCUMENT", "CANVAS"]);
    expect(filters.operations).toEqual(["UPSERT"]);
    expect(filters.actorIds).toHaveLength(25);
  });

  it("treats junk as no conditions", () => {
    expect(parseWebhookFilters(null)).toEqual(EMPTY_WEBHOOK_FILTERS);
    expect(parseWebhookFilters("nope")).toEqual(EMPTY_WEBHOOK_FILTERS);
  });

  it("matches everything when no conditions are set", () => {
    expect(webhookMatchesFilters(EMPTY_WEBHOOK_FILTERS, change({ title: "Anything" }), null)).toBe(
      true,
    );
  });

  it("applies title, notebook, type, operation, and actor conditions", () => {
    const filters = parseWebhookFilters({
      titleContains: "road",
      notebookIds: ["n1"],
      pageTypes: ["document"],
      operations: ["UPSERT"],
      actorIds: ["u1"],
    });
    expect(
      webhookMatchesFilters(
        filters,
        change({ title: "Roadmap", notebookId: "n1", type: "DOCUMENT" }),
        "u1",
      ),
    ).toBe(true);
    expect(
      webhookMatchesFilters(
        filters,
        change({ title: "Roadmap", notebookId: "n2", type: "DOCUMENT" }),
        "u1",
      ),
    ).toBe(false);
    expect(
      webhookMatchesFilters(
        filters,
        change({ title: "Roadmap", notebookId: "n1", type: "DOCUMENT" }, "DELETE"),
        "u1",
      ),
    ).toBe(false);
    expect(
      webhookMatchesFilters(
        filters,
        change({ title: "Roadmap", notebookId: "n1", type: "DOCUMENT" }),
        "u2",
      ),
    ).toBe(false);
  });

  it("excludes changes that lack a field the condition needs", () => {
    const filters = parseWebhookFilters({ notebookIds: ["n1"] });
    expect(webhookMatchesFilters(filters, change({ title: "No notebook" }), "u1")).toBe(false);
    const titleFilter = parseWebhookFilters({ titleContains: "road" });
    expect(webhookMatchesFilters(titleFilter, change({ body: "no title" }), "u1")).toBe(false);
  });
});
