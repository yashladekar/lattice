import { ArrowLeft, ArrowUpRight, Boxes } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DownloadList } from "@/components/marketing/download-list";
import { SiteNav } from "@/components/marketing/site-nav";
import { getDocsUrl } from "@/lib/config";

export const metadata: Metadata = {
  title: "Download Lattice",
  description:
    "Lattice desktop builds for macOS, Windows, and Linux. Local-first, with the same workspace as the web app.",
};

export default function DownloadPage() {
  const selfHosting = `${getDocsUrl().replace(/\/$/, "")}/self-hosting`;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] landing-grid opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-[-300px] -z-10 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--saffron)_14%,transparent),transparent_68%)] blur-3xl" />
      <SiteNav />

      <section className="mx-auto max-w-5xl px-5 pb-24 pt-11 md:pt-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Back to Lattice
        </Link>

        <div className="mt-7 max-w-2xl">
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-saffron">
            Desktop
          </div>
          <h1 className="mt-2 text-balance font-display text-[2.9rem] leading-[0.96] tracking-[-0.035em] md:text-6xl">
            Lattice, off the web.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-muted-foreground md:text-base">
            The same local-first workspace, in a native window with a tray, native
            save dialogs, and the <span className="text-foreground">lattice://</span>{" "}
            deep link. Your notes stay on your device and sync when a server is
            available.
          </p>
        </div>

        <DownloadList />

        <section className="mt-14 flex flex-col gap-5 rounded-2xl border border-border/70 bg-card p-6 paper-shadow sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 bg-background/60">
              <Boxes className="size-5 text-saffron" />
            </div>
            <div>
              <h2 className="font-display text-xl tracking-[-0.02em]">Run it yourself</h2>
              <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground">
                The API ships as a Docker image and works on any Node host. Point the
                desktop or web build at your own instance with one config file.
              </p>
            </div>
          </div>
          <a
            href={selfHosting}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs text-foreground underline-offset-4 hover:underline"
          >
            Self-hosting guide <ArrowUpRight className="size-3.5" />
          </a>
        </section>
      </section>
    </main>
  );
}
