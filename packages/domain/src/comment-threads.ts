/**
 * Discussion filtering and grouping.
 *
 * Page threads are cheap to write and expensive to read once a note has a
 * hundred of them, so the panel filters, searches, and groups locally — the
 * same work a server-side query would do, without a round trip per keystroke.
 */
export interface CommentLike {
  id: string;
  pageId: string;
  blockId: string | null;
  parentId: string | null;
  authorId: string;
  body: string;
  resolvedAt: string | null;
  createdAt: string;
}

export type CommentStatusFilter = "open" | "resolved" | "all";

export interface CommentFilterOptions {
  status?: CommentStatusFilter;
  /** Case-insensitive substring of any comment in the thread, body or author. */
  query?: string;
  /** Restrict to threads anchored to this block. */
  blockId?: string;
  /** Only threads anchored to a block at all. */
  anchoredOnly?: boolean;
}

export interface CommentStats {
  open: number;
  resolved: number;
  anchored: number;
  replies: number;
}

export function threadReplies<T extends CommentLike>(comments: T[], parentId: string): T[] {
  return comments
    .filter((comment) => comment.parentId === parentId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function commentStats(comments: CommentLike[]): CommentStats {
  let open = 0;
  let resolved = 0;
  let anchored = 0;
  let replies = 0;
  for (const comment of comments) {
    if (comment.parentId) {
      replies += 1;
      continue;
    }
    if (comment.resolvedAt) resolved += 1;
    else open += 1;
    if (comment.blockId) anchored += 1;
  }
  return { open, resolved, anchored, replies };
}

/**
 * Root threads matching the filters. Open threads come first, then newest
 * first, so the panel does not reorder as replies arrive.
 */
export function filterCommentThreads<T extends CommentLike>(
  comments: T[],
  options: CommentFilterOptions = {},
): T[] {
  const status = options.status ?? "open";
  const query = options.query?.trim().toLowerCase() ?? "";
  const repliesByParent = new Map<string, T[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const bucket = repliesByParent.get(comment.parentId);
    if (bucket) bucket.push(comment);
    else repliesByParent.set(comment.parentId, [comment]);
  }

  return comments
    .filter((comment) => {
      if (comment.parentId) return false;
      if (status === "open" && comment.resolvedAt) return false;
      if (status === "resolved" && !comment.resolvedAt) return false;
      if (options.blockId && comment.blockId !== options.blockId) return false;
      if (options.anchoredOnly && !comment.blockId) return false;
      if (query) {
        const haystack = [comment.body, comment.authorId, ...(repliesByParent.get(comment.id) ?? []).flatMap((reply) => [reply.body, reply.authorId])];
        if (!haystack.some((value) => value.toLowerCase().includes(query))) return false;
      }
      return true;
    })
    .sort((left, right) => {
      const resolvedDelta = Number(Boolean(left.resolvedAt)) - Number(Boolean(right.resolvedAt));
      if (resolvedDelta !== 0) return resolvedDelta;
      return right.createdAt.localeCompare(left.createdAt);
    });
}

export interface CommentGroup<T extends CommentLike> {
  blockId: string | null;
  threads: T[];
}

/**
 * Threads grouped by block anchor, biggest group first, with the unanchored
 * page-level discussion last. Within a group the order from the filter holds.
 */
export function groupThreadsByBlock<T extends CommentLike>(threads: T[]): Array<CommentGroup<T>> {
  const groups = new Map<string, T[]>();
  const unanchored: T[] = [];
  for (const thread of threads) {
    if (!thread.blockId) {
      unanchored.push(thread);
      continue;
    }
    const bucket = groups.get(thread.blockId);
    if (bucket) bucket.push(thread);
    else groups.set(thread.blockId, [thread]);
  }
  const ordered: Array<CommentGroup<T>> = [...groups.entries()]
    .map(([blockId, grouped]) => ({ blockId, threads: grouped }))
    .sort((left, right) => right.threads.length - left.threads.length);
  if (unanchored.length) ordered.push({ blockId: null, threads: unanchored });
  return ordered;
}
