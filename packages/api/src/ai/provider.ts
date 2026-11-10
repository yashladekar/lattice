import type { AiConfig, Context } from "../context";
import { ChatGptError, streamChatGptResponse } from "./chatgpt";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatResult =
  | { ok: true; content: string; provider: string }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
      requestId: string | null;
      param?: string;
    };

export type ChatFailure = Extract<ChatResult, { ok: false }>;

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; provider: string }
  | {
      type: "error";
      code: string;
      message: string;
      status: number;
      requestId: string | null;
    };

export function aiEnabled(context: Context): context is Context & { ai: AiConfig } {
  return Boolean(context.ai?.apiKey);
}

/**
 * Embeddings and transcription need a real API key; ChatGPT plan usage covers
 * the Responses API only.
 */
export function auxEnabled(context: Context): context is Context & { aiAux: AiConfig } {
  return Boolean(context.aiAux?.apiKey);
}

function chatGptRequest(config: AiConfig, messages: ChatMessage[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n")
    .trim();
  const input = messages.flatMap((message) =>
    message.role === "system"
      ? []
      : [{ role: message.role as "user" | "assistant", content: message.content }],
  );
  return {
    accessToken: config.apiKey,
    model: config.model,
    ...(instructions ? { instructions } : {}),
    input,
  };
}

function chatGptFailure(error: unknown): ChatFailure {
  if (error instanceof ChatGptError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      status: error.status,
      requestId: error.requestId,
      ...(error.param ? { param: error.param } : {}),
    };
  }
  return {
    ok: false,
    code: "chatgpt_unavailable",
    message: "The ChatGPT plan request could not be completed.",
    status: 0,
    requestId: null,
  };
}

/**
 * One chat turn. ChatGPT-plan configurations stream from the Responses API and
 * are collected here; everything else uses the OpenAI-compatible chat endpoint.
 * Failures are returned rather than thrown so callers can degrade to a local
 * answer and still tell the user what happened.
 */
export async function chatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
): Promise<ChatResult> {
  if (config.auth === "chatgpt") {
    const parts: string[] = [];
    try {
      for await (const event of streamChatGptResponse(chatGptRequest(config, messages))) {
        if (event.type === "delta") parts.push(event.text);
      }
    } catch (error) {
      return chatGptFailure(error);
    }
    const content = parts.join("").trim();
    if (!content) {
      return {
        ok: false,
        code: "empty_response",
        message: "ChatGPT plan usage returned an empty answer.",
        status: 200,
        requestId: null,
      };
    }
    return { ok: true, content, provider: config.model };
  }

  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 1200,
        messages,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        code: `http_${response.status}`,
        message: `The AI provider returned ${response.status}.`,
        status: response.status,
        requestId: response.headers.get("x-request-id"),
      };
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return {
        ok: false,
        code: "empty_response",
        message: "The AI provider returned an empty answer.",
        status: response.status,
        requestId: response.headers.get("x-request-id"),
      };
    }
    return { ok: true, content, provider: config.model };
  } catch {
    return {
      ok: false,
      code: "provider_unreachable",
      message: "The AI provider could not be reached.",
      status: 0,
      requestId: null,
    };
  }
}

/**
 * Chat as a stream of deltas. Providers without a streaming endpoint emit their
 * whole answer as one delta so the caller has a single shape to render.
 */
export async function* streamChatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  if (config.auth === "chatgpt") {
    try {
      for await (const event of streamChatGptResponse({
        ...chatGptRequest(config, messages),
        ...(signal ? { signal } : {}),
      })) {
        if (event.type === "delta") yield { type: "delta", text: event.text };
      }
      yield { type: "done", provider: config.model };
    } catch (error) {
      if (signal?.aborted) return;
      const failure = chatGptFailure(error);
      yield {
        type: "error",
        code: failure.code,
        message: failure.message,
        status: failure.status,
        requestId: failure.requestId,
      };
    }
    return;
  }

  const result = await chatCompletion(config, messages);
  if (result.ok) {
    yield { type: "delta", text: result.content };
    yield { type: "done", provider: result.provider };
    return;
  }
  yield {
    type: "error",
    code: result.code,
    message: result.message,
    status: result.status,
    requestId: result.requestId,
  };
}

export function localAnswer(
  question: string,
  sources: Array<{ pageId: string; title: string; excerpt: string }>,
): string {
  if (!sources.length) {
    return "I could not find anything related in this workspace yet. Try adding a note or broadening the question.";
  }
  const lines = [
    "**Local mode** — no AI provider is configured, so this answer is assembled from matching passages in your notes.",
    "",
    `### About “${question.slice(0, 160)}”`,
  ];
  for (const [index, source] of sources.slice(0, 5).entries()) {
    lines.push(`${index + 1}. **${source.title}** — ${source.excerpt.replace(/\s+/g, " ").slice(0, 260)}`);
  }
  lines.push(
    "",
    "### Suggested next step",
    "Open the cited pages and add the missing connection, or configure an OpenAI-compatible provider in the server environment for a synthesized answer.",
  );
  return lines.join("\n");
}

/**
 * OpenAI-compatible embeddings. Returns null when the provider is unreachable
 * or answers with a shape we do not understand, so callers fall back to token
 * retrieval instead of indexing garbage.
 */
export async function embedTexts(
  config: AiConfig,
  inputs: string[],
): Promise<number[][] | null> {
  if (!inputs.length) return [];
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: config.embeddingModel ?? "text-embedding-3-small",
        input: inputs,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      data?: Array<{ embedding?: unknown; index?: number }>;
    };
    if (!Array.isArray(json.data) || json.data.length !== inputs.length) return null;
    const ordered = [...json.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((entry) =>
      Array.isArray(entry.embedding) ? (entry.embedding as unknown[]) : null,
    );
    if (vectors.some((vector) => !vector)) return null;
    return vectors.map((vector) => (vector as number[]).map((value) => Number(value)));
  } catch {
    return null;
  }
}

/**
 * OpenAI-compatible audio transcription (Whisper or a compatible model).
 * Returns null when the provider is unavailable or returns no text.
 */
export async function transcribeAudio(
  config: AiConfig,
  input: { bytes: Uint8Array; filename: string; mime: string },
): Promise<string | null> {
  const endpoint = `${config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`;
  try {
    const copy = new Uint8Array(input.bytes.byteLength);
    copy.set(input.bytes);
    const form = new FormData();
    form.set("model", config.transcribeModel ?? "whisper-1");
    form.set("file", new Blob([copy.buffer], { type: input.mime }), input.filename);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { text?: unknown };
    if (typeof json.text !== "string") return null;
    const text = json.text.trim();
    return text || null;
  } catch {
    return null;
  }
}
