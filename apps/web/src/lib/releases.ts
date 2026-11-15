export const RELEASES_REPO = "yashladekar/lattice";
export const RELEASES_URL = `https://github.com/${RELEASES_REPO}/releases`;
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

const CACHE_KEY = "lattice.latest-release";
const CACHE_TTL_MS = 60 * 60 * 1000;

export type ReleaseAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

export type LatestRelease = {
  tag_name: string;
  name: string | null;
  published_at: string | null;
  html_url: string;
  assets: ReleaseAsset[];
};

export type DownloadTarget = {
  id: string;
  platform: "macOS" | "Windows" | "Linux";
  label: string;
  note: string;
  asset: ReleaseAsset | null;
  href: string;
};

const TARGETS: Array<{
  id: string;
  platform: DownloadTarget["platform"];
  label: string;
  note: string;
  match: RegExp;
}> = [
  {
    id: "macos-arm64",
    platform: "macOS",
    label: "Apple Silicon",
    note: "arm64",
    match: /aarch64\.dmg$/i,
  },
  {
    id: "macos-x64",
    platform: "macOS",
    label: "Intel",
    note: "x64",
    match: /(x64|x86_64)\.dmg$/i,
  },
  {
    id: "windows-exe",
    platform: "Windows",
    label: "Installer",
    note: "x64",
    match: /x64[-_].*setup\.exe$/i,
  },
  {
    id: "windows-msi",
    platform: "Windows",
    label: "MSI package",
    note: "x64",
    match: /x64[-_].*\.msi$/i,
  },
  {
    id: "linux-appimage",
    platform: "Linux",
    label: "AppImage",
    note: "x64",
    match: /amd64\.AppImage$/i,
  },
  {
    id: "linux-deb",
    platform: "Linux",
    label: "Debian package",
    note: "x64",
    match: /amd64\.deb$/i,
  },
];

export function resolveDownloads(release: LatestRelease | null): DownloadTarget[] {
  return TARGETS.map((target) => {
    const asset =
      release?.assets.find((candidate) => target.match.test(candidate.name)) ?? null;
    return {
      id: target.id,
      platform: target.platform,
      label: target.label,
      note: target.note,
      asset,
      href: asset?.browser_download_url ?? LATEST_RELEASE_URL,
    };
  });
}

/**
 * The marketing site is a static export, so the release list is read from the
 * public GitHub API in the browser. A failed request still leaves every link
 * pointed at the releases page.
 */
export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  if (typeof window === "undefined") return null;

  try {
    const cached = JSON.parse(
      window.sessionStorage.getItem(CACHE_KEY) ?? "null",
    ) as { at?: number; release?: LatestRelease } | null;
    if (cached?.at && cached.release && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.release;
    }
  } catch {
    // A full or disabled storage just means no cache.
  }

  try {
    const response = await fetch(LATEST_RELEASE_API, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as LatestRelease;
    try {
      window.sessionStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ at: Date.now(), release }),
      );
    } catch {
      // Caching is best effort.
    }
    return release;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatReleasedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
