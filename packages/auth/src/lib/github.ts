import { decryptSecret, encryptSecret } from "./secrets";

/**
 * Token material for the GitHub connection. The `github` label keeps these
 * ciphertexts from being replayed as an SSO client secret, a workspace AI key,
 * or a ChatGPT credential, even though all of them derive from the same
 * deployment secret.
 */
export function encryptGithubToken(value: string, keyMaterial: string): string {
  return encryptSecret(value, keyMaterial, "github");
}

export function decryptGithubToken(payload: string, keyMaterial: string): string {
  return decryptSecret(payload, keyMaterial, "github");
}
