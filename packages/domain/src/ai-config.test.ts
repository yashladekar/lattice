import { describe, expect, it } from "vitest";

import { maskApiKey, normalizeAiBaseUrl, normalizeModelName } from "./ai-config";

describe("ai provider settings", () => {
  it("accepts https base urls and strips trailing slashes", () => {
    expect(normalizeAiBaseUrl("https://api.example.com/v1")).toBe("https://api.example.com/v1");
    expect(normalizeAiBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeAiBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    expect(normalizeAiBaseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });

  it("refuses schemes and shapes that could be abused", () => {
    expect(normalizeAiBaseUrl("http://api.example.com")).toBeNull();
    expect(normalizeAiBaseUrl("https://user:pass@api.example.com")).toBeNull();
    expect(normalizeAiBaseUrl("https://api.example.com/v1?x=1")).toBeNull();
    expect(normalizeAiBaseUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeAiBaseUrl("")).toBeNull();
    expect(normalizeAiBaseUrl(42)).toBeNull();
  });

  it("masks keys down to a recognisable tail", () => {
    expect(maskApiKey("sk-proj-abcdefgh1234wxyz")).toBe("••••wxyz");
    expect(maskApiKey("short")).toBe("••••");
    expect(maskApiKey("")).toBe("");
  });

  it("normalizes model names", () => {
    expect(normalizeModelName(" gpt-4.1-mini ")).toBe("gpt-4.1-mini");
    expect(normalizeModelName("")).toBeNull();
    expect(normalizeModelName("x".repeat(200))).toBeNull();
    expect(normalizeModelName(7)).toBeNull();
  });
});
