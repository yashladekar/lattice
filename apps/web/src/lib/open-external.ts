/**
 * Opens an http(s) URL outside the app. The desktop build must hand this to the
 * system browser: an embedded webview is the wrong place to complete an OAuth
 * consent screen, and OpenAI may reject it outright.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // Fall through to a normal tab.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
