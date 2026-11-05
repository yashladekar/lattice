"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export default function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      // A worker left over from a production build would keep serving the
      // cached shell and fetching /app.html, which dev never serves. Retire it.
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      void caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((key) => key.startsWith("lattice-")).map((key) => caches.delete(key))),
        );
      return;
    }
    let refreshing = false;
    const promptUpdate = (worker: ServiceWorker) => {
      toast("A new version of Lattice is ready", {
        id: "pwa-update",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Refresh",
          onClick: () => {
            refreshing = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    };
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        registration.update().catch(() => undefined);

        if (registration.waiting && navigator.serviceWorker.controller) {
          promptUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptUpdate(installing);
            }
          });
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!refreshing) return;
          refreshing = false;
          window.location.reload();
        });
      } catch (error) {
        console.error("Service worker registration failed:", error);
      }
    };
    void register();
  }, []);

  return null;
}
