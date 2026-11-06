import type { Database } from "@notes-learning/db";
import { decryptAiKey } from "@notes-learning/auth";

import type { AiConfig } from "../context";

export interface AiConfigResolution {
  config: AiConfig | null;
  source: "workspace" | "deployment" | "none";
}

/**
 * Which provider a workspace should use. A workspace key wins over the
 * deployment's environment configuration; without one the deployment config is
 * the fallback. A ciphertext that cannot be decrypted — for example after the
 * deployment secret was rotated — falls back rather than taking AI down, and
 * the admin settings panel shows which source is in effect.
 */
export async function resolveAiConfig(
  db: Database,
  workspaceId: string,
  fallback: AiConfig | null,
  keyMaterial: string | undefined,
): Promise<AiConfigResolution> {
  const row = await db.workspaceAiConfig.findUnique({ where: { workspaceId } });
  if (!row || !keyMaterial) {
    return { config: fallback, source: fallback?.apiKey ? "deployment" : "none" };
  }
  try {
    return {
      config: {
        baseUrl: row.baseUrl,
        apiKey: decryptAiKey(row.apiKey, keyMaterial),
        model: row.model,
        ...(row.embeddingModel ? { embeddingModel: row.embeddingModel } : {}),
        ...(row.transcribeModel ? { transcribeModel: row.transcribeModel } : {}),
      },
      source: "workspace",
    };
  } catch {
    return { config: fallback, source: fallback?.apiKey ? "deployment" : "none" };
  }
}
