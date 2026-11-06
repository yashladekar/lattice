/**
 * Playback across note versions.
 *
 * A graph rebuilt from node timestamps shows notes appearing and disappearing,
 * but not links changing inside a note: a reference added in version 4 and
 * removed in version 6 only exists between those edits. The server sends
 * version events with the page links each version contained, and these helpers
 * answer "which links did this note hold at time t".
 */
export interface VersionTimelineEntry {
  pageId: string;
  version: number;
  createdAt: string;
  title: string;
  links: string[];
}

export interface VersionTimelineBounds {
  min: number;
  max: number;
}

/** Oldest first, so the caller can apply events in order. */
export function sortVersionTimeline(entries: VersionTimelineEntry[]): VersionTimelineEntry[] {
  return [...entries].sort((left, right) => {
    const delta = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return delta !== 0 ? delta : left.version - right.version;
  });
}

export function versionTimelineBounds(entries: VersionTimelineEntry[]): VersionTimelineBounds | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    const time = new Date(entry.createdAt).getTime();
    if (!Number.isFinite(time)) continue;
    if (time < min) min = time;
    if (time > max) max = time;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max };
}

/**
 * Links each page held at `at`, using its most recent version at or before it.
 * Pages without a version in the window are absent rather than empty: their
 * history is unknown, and callers should fall back to the live links instead
 * of pretending the note had none.
 */
export function versionLinksAt(
  entries: VersionTimelineEntry[],
  at: number,
): Map<string, Set<string>> {
  const links = new Map<string, Set<string>>();
  const latest = new Map<string, number>();
  for (const entry of sortVersionTimeline(entries)) {
    const time = new Date(entry.createdAt).getTime();
    if (!Number.isFinite(time) || time > at) continue;
    const seen = latest.get(entry.pageId);
    if (seen !== undefined && seen > time) continue;
    latest.set(entry.pageId, time);
    links.set(entry.pageId, new Set(entry.links));
  }
  return links;
}

/** The most recent version at or before `at`, for a caption like "v4 · Title". */
export function versionEntryAt(
  entries: VersionTimelineEntry[],
  at: number,
): VersionTimelineEntry | null {
  let found: VersionTimelineEntry | null = null;
  for (const entry of sortVersionTimeline(entries)) {
    const time = new Date(entry.createdAt).getTime();
    if (!Number.isFinite(time) || time > at) break;
    found = entry;
  }
  return found;
}

/**
 * Whether a page-to-page link existed at `at`. Unknown histories fall back to
 * "yes", so playback never hides a link it cannot reason about.
 */
export function linkActiveAt(
  links: Map<string, Set<string>>,
  sourcePageId: string,
  targetPageId: string,
): boolean {
  const known = links.get(sourcePageId);
  if (!known) return true;
  return known.has(targetPageId);
}
