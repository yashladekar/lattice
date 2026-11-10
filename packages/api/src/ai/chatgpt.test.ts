import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
} from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatGptError,
  buildChatGptAuthorizeUrl,
  createSseDecoder,
  listChatGptModels,
  streamChatGptResponse,
  verifyChatGptIdToken,
} from "./chatgpt";

function streamOf(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function sseFrame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authorization URL", () => {
  const base = {
    clientId: "oaiapp_example",
    hostId: "urn:uuid:11111111-1111-4111-8111-111111111111",
    redirectUri: "http://127.0.0.1:1455/auth/callback",
    state: "state-value",
    nonce: "nonce-value",
    codeChallenge: "challenge-value",
  };

  it("sends every parameter the open-source flow requires", () => {
    const url = new URL(buildChatGptAuthorizeUrl(base));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("oaiapp_example");
    expect(url.searchParams.get("ext_agent_host_id")).toBe(base.hostId);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:1455/auth/callback");
    expect(url.searchParams.get("resource")).toBe("https://api.openai.com/v1");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("nonce")).toBe("nonce-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
      [
        "openid",
        "profile",
        "email",
        "offline_access",
        "resource.invoke",
        "chatgpt.tokens.use.direct",
      ].sort(),
    );
  });

  it("adds the agent name only on first registration", () => {
    expect(new URL(buildChatGptAuthorizeUrl(base)).searchParams.get("agent_name_hint")).toBeNull();
    expect(
      new URL(buildChatGptAuthorizeUrl({ ...base, agentNameHint: "Lattice" })).searchParams.get(
        "agent_name_hint",
      ),
    ).toBe("Lattice");
  });

  it("carries the retained identity hints on reauthorization", () => {
    const url = new URL(
      buildChatGptAuthorizeUrl({
        ...base,
        idTokenHint: "header.payload.signature",
        loginHint: "person@example.com",
        prompt: "consent",
      }),
    );
    expect(url.searchParams.get("id_token_hint")).toBe("header.payload.signature");
    expect(url.searchParams.get("login_hint")).toBe("person@example.com");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });
});

describe("SSE decoding", () => {
  it("keeps a partial frame for the next chunk", () => {
    const push = createSseDecoder();
    expect(push('data: {"type":"one"}\n\ndata: {"type":"tw')).toEqual(['{"type":"one"}']);
    expect(push('o"}\n\n')).toEqual(['{"type":"two"}']);
  });

  it("ignores comments and event names", () => {
    const push = createSseDecoder();
    expect(push(': ping\n\nevent: message\ndata: {"type":"one"}\n\n')).toEqual(['{"type":"one"}']);
  });
});

describe("Responses streaming", () => {
  const collect = async (frames: string[]) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(streamOf(frames), {
          status: 200,
          headers: { "openai-request-id": "req_test" },
        }),
      ),
    );
    const deltas: string[] = [];
    for await (const event of streamChatGptResponse({
      accessToken: "token",
      model: "gpt-test",
      instructions: "be brief",
      input: [{ role: "user", content: "hello" }],
    })) {
      if (event.type === "delta") deltas.push(event.text);
    }
    return deltas;
  };

  it("accumulates output text and ends on response.completed", async () => {
    const deltas = await collect([
      sseFrame({ type: "response.created" }),
      sseFrame({ type: "response.output_text.delta", delta: "Hello" }),
      sseFrame({ type: "response.output_text.delta", delta: ", world" }),
      sseFrame({ type: "response.completed", response: { id: "resp_1" } }),
    ]);
    expect(deltas).toEqual(["Hello", ", world"]);
  });

  it("sends store:false and stream:true and never a temperature", async () => {
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(
      async () => new Response(streamOf([sseFrame({ type: "response.completed" })]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    for await (const _event of streamChatGptResponse({
      accessToken: "token",
      model: "gpt-test",
      input: [{ role: "user", content: "hello" }],
    })) {
      // drain
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("instructions");
    expect(body.input).toEqual([{ role: "user", content: "hello" }]);
  });

  it("surfaces a usage-limit failure with its code", async () => {
    await expect(
      collect([
        sseFrame({
          type: "response.failed",
          response: {
            error: {
              code: "subscription_sharing_usage_limit_exceeded",
              message: "Limit reached.",
            },
          },
        }),
      ]),
    ).rejects.toMatchObject({
      name: "ChatGptError",
      code: "subscription_sharing_usage_limit_exceeded",
      requestId: "req_test",
    });
  });

  it("refuses a stream that ends without response.completed", async () => {
    await expect(
      collect([sseFrame({ type: "response.output_text.delta", delta: "partial" })]),
    ).rejects.toBeInstanceOf(ChatGptError);
  });

  it("treats an incomplete response as a failure", async () => {
    await expect(collect([sseFrame({ type: "response.incomplete" })])).rejects.toMatchObject({
      code: "incomplete",
    });
  });
});

describe("model list", () => {
  it("keeps only displayable models and preserves order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              models: [
                { slug: "gpt-b", display_name: "GPT B", visibility: "list" },
                { slug: "hidden", visibility: "hidden" },
                { slug: "gpt-a", visibility: "list" },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    expect(await listChatGptModels("token")).toEqual([
      { slug: "gpt-b", displayName: "GPT B" },
      { slug: "gpt-a", displayName: "gpt-a" },
    ]);
  });

  it("reports a refused request instead of returning an empty catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "nope" }), { status: 403 })),
    );
    await expect(listChatGptModels("token")).rejects.toMatchObject({ code: "http_403" });
  });
});

describe("ID token validation", () => {
  const issuer = "https://auth.openai.com";
  const clientId = "oaiapp_example";
  const nonce = "nonce-value";

  const sign = async (options: {
    audience?: string;
    issuer?: string;
    nonce?: string;
    expiresIn?: string;
  }) => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = (await exportJWK(publicKey)) as JWK;
    const keySet = createLocalJWKSet({
      keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
    });
    const idToken = await new SignJWT({
      nonce: options.nonce ?? nonce,
      email: "Person@Example.com",
      email_verified: true,
      name: "Person",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? clientId)
      .setSubject("openai-subject")
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);
    return { idToken, keySet };
  };

  it("returns the verified identity", async () => {
    const { idToken, keySet } = await sign({});
    expect(await verifyChatGptIdToken({ idToken, clientId, nonce, keySet })).toEqual({
      subject: "openai-subject",
      email: "person@example.com",
      emailVerified: true,
      name: "Person",
    });
  });

  it("rejects a mismatched nonce", async () => {
    const { idToken, keySet } = await sign({ nonce: "other" });
    await expect(verifyChatGptIdToken({ idToken, clientId, nonce, keySet })).rejects.toThrow(
      /does not match this sign-in attempt/,
    );
  });

  it("rejects a token minted for another client", async () => {
    const { idToken, keySet } = await sign({ audience: "oaiapp_other" });
    await expect(verifyChatGptIdToken({ idToken, clientId, nonce, keySet })).rejects.toThrow();
  });

  it("rejects a token from another issuer", async () => {
    const { idToken, keySet } = await sign({ issuer: "https://example.com" });
    await expect(verifyChatGptIdToken({ idToken, clientId, nonce, keySet })).rejects.toThrow();
  });
});
