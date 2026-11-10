import { decryptSecret, encryptSecret } from "./secrets";

/**
 * Token material for Sign in with ChatGPT. The `chatgpt` label keeps these
 * ciphertexts from being replayed as an SSO client secret or a workspace AI
 * key, even though all three derive from the same deployment secret.
 */
export function encryptChatGptToken(value: string, keyMaterial: string): string {
  return encryptSecret(value, keyMaterial, "chatgpt");
}

export function decryptChatGptToken(payload: string, keyMaterial: string): string {
  return decryptSecret(payload, keyMaterial, "chatgpt");
}
