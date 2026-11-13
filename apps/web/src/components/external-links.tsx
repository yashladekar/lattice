"use client";

import { useEffect } from "react";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function ExternalLinkHandler() {
  useEffect(() => {
    if (!inTauri()) return;
    const onClick = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      const href = anchor?.getAttribute("href") ?? "";
      if (!anchor || !/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(href);
      } catch {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
