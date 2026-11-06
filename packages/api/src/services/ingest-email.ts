import { randomUUID } from "node:crypto";

import type { Database } from "@notes-learning/db";
import { captureFromEmail, type EmailIngestPayload } from "@notes-learning/domain";

import { hashToken } from "../authz";
import { pushSync } from "./sync";

/**
 * Inbound email capture. The token identifies the workspace and is stored as a
 * hash; the message is turned into an EMAIL capture through the normal sync
 * path, so it reaches every device and shows up in the change log. Kept out of
 * the server entry file so the request rules can be tested.
 */
export type EmailIngestResult =
  | { status: 202; captureId: string }
  | { status: 400 | 401 | 404 | 500; error: string };

export async function ingestEmail(
  db: Database,
  input: { token: string; body: unknown },
): Promise<EmailIngestResult> {
  if (!input.token) {
    return { status: 401, error: "Missing x-lattice-ingest-token header" };
  }
  const ingest = await db.workspaceIngestToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
  });
  if (!ingest || ingest.revokedAt) {
    return { status: 401, error: "Unknown or revoked ingest token" };
  }
  const workspace = await db.workspace.findFirst({
    where: { id: ingest.workspaceId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!workspace) return { status: 404, error: "Workspace not found" };

  const draft = captureFromEmail((input.body ?? {}) as EmailIngestPayload);
  if (!draft) {
    return { status: 400, error: "Nothing to capture: send subject, text, or html" };
  }

  const captureId = randomUUID();
  try {
    await pushSync(db, {
      workspaceId: workspace.id,
      userId: workspace.ownerId,
      ops: [
        {
          opId: `email-ingest-${captureId}`,
          entity: "capture",
          entityId: captureId,
          op: "UPSERT",
          payload: {
            type: "EMAIL",
            title: draft.title,
            content: draft.content,
            source: draft.source,
            status: "INBOX",
            metadata: draft.metadata,
          },
        },
      ],
    });
  } catch (error) {
    console.error("Email ingestion failed", error);
    return { status: 500, error: "Could not store the capture" };
  }
  return { status: 202, captureId };
}
