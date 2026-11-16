"use client";

import { Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fetchLatestRelease,
  formatBytes,
  formatReleasedAt,
  RELEASES_URL,
  resolveDownloads,
  type DownloadTarget,
  type LatestRelease,
} from "@/lib/releases";

const PLATFORMS: Array<{
  platform: DownloadTarget["platform"];
  summary: string;
}> = [
  { platform: "macOS", summary: "Apple Silicon and Intel" },
  { platform: "Windows", summary: "Windows 10 and 11" },
  { platform: "Linux", summary: "AppImage or Debian package" },
];

export function DownloadList() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchLatestRelease().then((result) => {
      if (cancelled) return;
      setRelease(result);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const targets = resolveDownloads(release);
  const releasedAt = formatReleasedAt(release?.published_at ?? null);

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {release
            ? `Latest release ${release.tag_name}${releasedAt ? ` · ${releasedAt}` : ""}`
            : loaded
              ? "Could not load the latest release. The links open GitHub Releases."
              : "Checking the latest release…"}
        </p>
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          All releases <ExternalLink className="size-3" />
        </a>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map(({ platform, summary }) => {
          const platformTargets = targets.filter((target) => target.platform === platform);
          return (
            <div
              key={platform}
              className="rounded-2xl border border-border/70 bg-card p-5 paper-shadow"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="font-display text-xl tracking-[-0.02em]">{platform}</h2>
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {platformTargets[0]?.note}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{summary}</p>
              <div className="mt-4 grid gap-2">
                {platformTargets.map((target) => (
                  <a
                    key={target.id}
                    href={target.href}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-saffron/40"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{target.label}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {target.asset
                          ? `${formatBytes(target.asset.size)} · ${target.asset.name}`
                          : "Open GitHub Releases"}
                      </span>
                    </span>
                    <Download className="size-4 shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Builds are unsigned for now. On macOS, right-click Lattice and choose{" "}
        <span className="text-foreground">Open</span> the first time. On Windows,
        SmartScreen may ask you to confirm the publisher. Prefer no install?{" "}
        <Link href="/app" className="text-foreground underline-offset-4 hover:underline">
          Use the web app instead
        </Link>
        .
      </p>
    </div>
  );
}
