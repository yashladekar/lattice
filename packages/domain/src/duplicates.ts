/**
 * Near-duplicate detection for pages.
 *
 * Two pages can be the same note twice for different reasons: the same title
 * under a different folder, a title that drifted, or a body that was pasted
 * wholesale. Each is checked, and a cluster records which one it matched on so
 * a review can say why two notes were paired.
 */

export interface DuplicateCandidate {
  id: string;
  title: string;
  updatedAt?: string;
}

export interface DuplicateDocument {
  pageId: string;
  plainText: string;
}

export type DuplicateReason = "same-title" | "similar-title" | "similar-body";

export interface DuplicateMember {
  id: string;
  title: string;
  excerpt: string;
}

export interface DuplicateCluster {
  id: string;
  reason: DuplicateReason;
  /** 0 to 1, where 1 is an exact match. */
  score: number;
  members: DuplicateMember[];
  /** The member most worth keeping, when a reviewer has to pick one. */
  survivorId: string;
}

const EXCERPT_LENGTH = 160;
const SHINGLE_SIZE = 5;
const MAX_SHINGLES = 600;
const MIN_BODY_WORDS = 40;

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
  "it", "of", "on", "or", "that", "the", "to", "with",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Title tokens with the noise removed, so "The Notes." equals "notes". */
export function titleTokens(title: string): string[] {
  const tokens = words(title).filter((word) => !STOP_WORDS.has(word));
  // A title made entirely of stop words still needs something to compare.
  return tokens.length ? tokens : words(title);
}

export function normalizedTitle(title: string): string {
  return titleTokens(title).join(" ");
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function shingles(text: string): Set<string> {
  const tokens = words(text);
  const set = new Set<string>();
  for (let index = 0; index + SHINGLE_SIZE <= tokens.length; index += 1) {
    set.add(tokens.slice(index, index + SHINGLE_SIZE).join(" "));
    if (set.size >= MAX_SHINGLES) break;
  }
  return set;
}

function excerpt(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > EXCERPT_LENGTH ? `${collapsed.slice(0, EXCERPT_LENGTH)}…` : collapsed;
}

/** Union-find, so a chain of similar notes lands in one cluster. */
class Groups {
  private parent = new Map<string, string>();
  private reason = new Map<string, DuplicateReason>();
  private score = new Map<string, number>();

  add(id: string) {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id) ?? id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  join(a: string, b: string, reason: DuplicateReason, score: number) {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    const root = rootA === rootB ? rootA : (() => {
      this.parent.set(rootB, rootA);
      return rootA;
    })();
    // Keep the strongest evidence for the merged group.
    this.reason.set(root, strongest(this.reason.get(root), reason));
    this.score.set(root, Math.max(this.score.get(root) ?? 0, score));
  }

  groups(): Map<string, { reason: DuplicateReason; score: number }> {
    const out = new Map<string, { reason: DuplicateReason; score: number }>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (out.has(root)) continue;
      out.set(root, {
        reason: this.reason.get(root) ?? "similar-title",
        score: this.score.get(root) ?? 0,
      });
    }
    return out;
  }
}

const REASON_RANK: Record<DuplicateReason, number> = {
  "similar-title": 0,
  "similar-body": 1,
  "same-title": 2,
};

function strongest(
  current: DuplicateReason | undefined,
  next: DuplicateReason,
): DuplicateReason {
  if (!current) return next;
  return REASON_RANK[next] > REASON_RANK[current] ? next : current;
}

export interface DuplicateOptions {
  titleThreshold?: number;
  bodyThreshold?: number;
}

/**
 * Compares every page against every other. Page counts here are in the
 * thousands at most, and the body pass only runs on pairs that have enough
 * text to be worth comparing, so this stays a synchronous pass.
 */
export function findDuplicates(
  candidates: DuplicateCandidate[],
  documents: DuplicateDocument[],
  options: DuplicateOptions = {},
): DuplicateCluster[] {
  const titleThreshold = options.titleThreshold ?? 0.5;
  const bodyThreshold = options.bodyThreshold ?? 0.55;

  const bodyByPage = new Map(documents.map((entry) => [entry.pageId, entry.plainText]));
  const groups = new Groups();
  const titleSets = new Map<string, Set<string>>();
  const shingleSets = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    groups.add(candidate.id);
    titleSets.set(candidate.id, new Set(titleTokens(candidate.title)));
    const text = bodyByPage.get(candidate.id) ?? "";
    shingleSets.set(
      candidate.id,
      words(text).length >= MIN_BODY_WORDS ? shingles(text) : new Set(),
    );
  }

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i];
      const b = candidates[j];
      if (!a || !b || a.id === b.id) continue;

      const titleScore = jaccard(titleSets.get(a.id) ?? new Set(), titleSets.get(b.id) ?? new Set());
      if (titleScore === 1) {
        groups.join(a.id, b.id, "same-title", 1);
        continue;
      }
      if (titleScore >= titleThreshold) {
        groups.join(a.id, b.id, "similar-title", titleScore);
        continue;
      }

      const bodyScore = jaccard(shingleSets.get(a.id) ?? new Set(), shingleSets.get(b.id) ?? new Set());
      if (bodyScore >= bodyThreshold) {
        groups.join(a.id, b.id, "similar-body", bodyScore);
      }
    }
  }

  const clusters: DuplicateCluster[] = [];

  for (const [root, meta] of groups.groups()) {
    const members = candidates
      .filter((candidate) => groups.find(candidate.id) === root)
      .map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        excerpt: excerpt(bodyByPage.get(candidate.id) ?? ""),
      }));
    if (members.length < 2) continue;

    // The fullest body is the best base to merge the others into.
    const survivor = [...members].sort((a, b) => {
      const lengthDelta = b.excerpt.length - a.excerpt.length;
      if (lengthDelta !== 0) return lengthDelta;
      return a.title.localeCompare(b.title);
    })[0];

    clusters.push({
      id: members.map((member) => member.id).sort().join("+"),
      reason: meta.reason,
      score: Math.round(meta.score * 100) / 100,
      members: members.sort((a, b) => a.id.localeCompare(b.id)),
      survivorId: survivor?.id ?? members[0]?.id ?? "",
    });
  }

  return clusters.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
