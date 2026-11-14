import { describe, expect, it, vi } from "vitest";

import { createOutbound, isIpLiteral, isPublicAddress } from "./outbound";

const PUBLIC = "93.184.216.34";

function makeOutbound(addresses: Record<string, string[]> = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue: Response[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return queue.shift() ?? new Response("ok", { status: 200 });
  });
  const lookup = vi.fn(async (hostname: string) => addresses[hostname] ?? [PUBLIC]);
  return { outbound: createOutbound({ fetch, lookup }), calls, queue, lookup };
}

describe("outbound address policy", () => {
  it("recognises public addresses", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("1.1.1.1")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("rejects private, loopback, link-local, and documentation ranges", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "2001:db8::1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("tells literals apart from hostnames", () => {
    expect(isIpLiteral("8.8.8.8")).toBe(true);
    expect(isIpLiteral("[2606:4700:4700::1111]")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });
});

describe("outbound request policy", () => {
  it("rejects credentials and non-https schemes", async () => {
    const { outbound } = makeOutbound();
    await expect(outbound.fetch("https://user:pass@example.com")).rejects.toThrow(/credentials/i);
    await expect(outbound.fetch("http://example.com")).rejects.toThrow(/https/i);
  });

  it("allows http only when the caller opts in", async () => {
    const { outbound } = makeOutbound();
    await expect(
      outbound.fetch("http://example.com", {}, { allowHttp: true }),
    ).resolves.toBeInstanceOf(Response);
  });

  it("rejects a hostname that resolves to a private address", async () => {
    const { outbound } = makeOutbound({ "internal.example": ["10.0.0.5"] });
    await expect(outbound.fetch("https://internal.example/hook")).rejects.toThrow(/non-public/i);
  });

  it("allows loopback only when asked", async () => {
    const { outbound } = makeOutbound({ localhost: ["127.0.0.1"] });
    await expect(outbound.fetch("https://localhost:3000")).rejects.toThrow(/non-public/i);
    await expect(
      outbound.fetch("http://localhost:3000", {}, { allowLoopback: true }),
    ).resolves.toBeInstanceOf(Response);
  });

  it("never allows the metadata address, even for a private-network caller", async () => {
    const { outbound } = makeOutbound({ "metadata.example": ["169.254.169.254"] });
    await expect(
      outbound.fetch("https://metadata.example", {}, { allowPrivate: true }),
    ).rejects.toThrow(/non-public/i);
  });

  it("revalidates every redirect hop before fetching it", async () => {
    const { outbound, calls, queue } = makeOutbound({
      "public.example": [PUBLIC],
      "internal.example": ["10.0.0.5"],
    });
    queue.push(
      new Response(null, { status: 302, headers: { location: "https://internal.example/x" } }),
    );
    await expect(outbound.fetch("https://public.example/x")).rejects.toThrow(/non-public/i);
    expect(calls).toHaveLength(1);
  });

  it("drops credentials when a redirect changes origin", async () => {
    const { outbound, calls, queue } = makeOutbound();
    queue.push(
      new Response(null, { status: 307, headers: { location: "https://other.example/x" } }),
    );
    await outbound.fetch("https://public.example/x", {
      headers: { authorization: "Bearer secret", cookie: "a=b", "x-test": "1" },
    });
    const forwarded = new Headers(calls[1]?.init.headers);
    expect(forwarded.get("authorization")).toBeNull();
    expect(forwarded.get("cookie")).toBeNull();
    expect(forwarded.get("x-test")).toBe("1");
  });

  it("stops after the redirect budget", async () => {
    const { outbound, queue } = makeOutbound();
    for (let index = 0; index < 5; index += 1) {
      queue.push(
        new Response(null, {
          status: 302,
          headers: { location: `https://public.example/${index}` },
        }),
      );
    }
    await expect(outbound.fetch("https://public.example/start")).rejects.toThrow(/too many/i);
  });
});
