import { describe, expect, it } from "vitest";

import {
  isSafeWebhookUrl,
  isWebhookEvent,
  WEBHOOK_EVENTS,
  webhookEventForChange,
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
