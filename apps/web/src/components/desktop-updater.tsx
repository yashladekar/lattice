"use client";

import { useEffect } from "react";
import { toast } from "sonner";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function DesktopUpdater() {
  useEffect(() => {
    if (!inTauri()) return;
    let cancelled = false;

    const checkForUpdate = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!update || cancelled) return;

        toast(`Lattice ${update.version} is ready`, {
          id: "desktop-update",
          duration: Number.POSITIVE_INFINITY,
          description: update.body?.slice(0, 160),
          action: {
            label: "Install",
            onClick: async () => {
              try {
                toast.loading("Downloading update…", { id: "desktop-update" });
                await update.downloadAndInstall();
                const { relaunch } = await import("@tauri-apps/plugin-process");
                await relaunch();
              } catch (error) {
                console.error("Update install failed:", error);
                toast.error("Update failed. Try again later.", { id: "desktop-update" });
              }
            },
          },
        });
      } catch (error) {
        console.error("Update check failed:", error);
      }
    };

    void checkForUpdate();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
