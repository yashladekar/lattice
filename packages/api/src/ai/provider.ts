import type { AiConfig, Context } from "../context";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderResult {
  content: string;
  provider: string;
}

export function aiEnabled(context: Context): context is Context & { ai: AiConfig } {
  return Boolean(context.ai?.apiKey);
}

export async function chatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
): Promise<ProviderResult | null> {
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
    if (!response.ok) return null;
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    return { content, provider: config.model };
  } catch {
    return null;
  }
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
