import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { appName } from "./shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="flex items-center gap-2 font-serif text-xl tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-neutral-900 text-xs text-amber-50">
            ✦
          </span>
          {appName}
        </span>
      ),
    },
    links: [
      { text: "Product", url: "/", active: "nested-url" },
      { text: "Architecture", url: "/docs/architecture" },
      { text: "Sync", url: "/docs/local-first-sync" },
      { text: "Security", url: "/docs/security" },
    ],
  };
}
