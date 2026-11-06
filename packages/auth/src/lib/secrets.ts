import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from "node:crypto";

/**
 * Symmetric encryption for secrets a workspace stores on its own behalf — an
 * SSO client secret, an AI provider key. AES-256-GCM with a key derived from
 * the deployment secret and a per-purpose label, so a ciphertext from one
 * feature cannot be replayed into another. The stored format is
 * `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 */
function keyFor(keyMaterial: string, label: string) {
  return createSecretKey(createHash("sha256").update(`lattice-${label}:${keyMaterial}`).digest());
}

export function encryptSecret(value: string, keyMaterial: string, label: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(keyMaterial, label), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(payload: string, keyMaterial: string, label: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("The stored secret is not in a readable format.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFor(keyMaterial, label),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
