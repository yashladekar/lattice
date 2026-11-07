"use client";

import { useEffect } from "react";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function handleUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== "lattice:") return;

  // OIDC callbacks are completed server-side; hand the URL to whoever listens.
  if (url.host === "auth" || url.pathname.startsWith("/auth")) {
    window.dispatchEvent(new CustomEvent("lattice:auth-callback", { detail: raw }));
    return;
  }

  const target = url.searchParams.get("path") ?? url.pathname;
  // Only navigate to same-origin app paths, never to //host.
  if (!target.startsWith("/") || target.startsWith("//")) return;
  window.location.assign(target);
}

export function DesktopDeepLink() {
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    const start = async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
        const current = await getCurrent();
        if (!disposed) current?.forEach(handleUrl);
        const off = await onOpenUrl((urls) => urls.forEach(handleUrl));
        if (disposed) off();
        else unlisten = off;
      } catch (error) {
        console.error("Deep link listener failed:", error);
      }
    };

    void start();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return null;
}
