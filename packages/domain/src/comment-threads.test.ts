import { describe, expect, it } from "vitest";

import {
  commentStats,
  filterCommentThreads,
  groupThreadsByBlock,
  threadReplies,
  type CommentLike,
} from "./comment-threads";

const comment = (overrides: Partial<CommentLike> & { id: string }): CommentLike => ({
  pageId: "p1",
  blockId: null,
  parentId: null,
  authorId: "u1",
  body: "body",
  resolvedAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const comments: CommentLike[] = [
  comment({ id: "a", body: "Check the intro", blockId: "b1", createdAt: "2024-01-02T00:00:00.000Z" }),
  comment({ id: "a1", parentId: "a", body: "Agreed, it is thin", authorId: "u2", createdAt: "2024-01-03T00:00:00.000Z" }),
  comment({ id: "b", body: "Needs a source", resolvedAt: "2024-01-04T00:00:00.000Z", createdAt: "2024-01-01T00:00:00.000Z" }),
  comment({ id: "c", body: "Page-level question", createdAt: "2024-01-05T00:00:00.000Z" }),
  comment({ id: "d", body: "Also anchored", blockId: "b1", createdAt: "2024-01-06T00:00:00.000Z" }),
];

describe("comment threads", () => {
  it("counts open, resolved, anchored, and replies", () => {
    expect(commentStats(comments)).toEqual({ open: 3, resolved: 1, anchored: 2, replies: 1 });
  });

  it("filters by status and defaults to open first", () => {
    expect(filterCommentThreads(comments).map((thread) => thread.id)).toEqual(["d", "c", "a"]);
    expect(filterCommentThreads(comments, { status: "resolved" }).map((thread) => thread.id)).toEqual(["b"]);
    expect(filterCommentThreads(comments, { status: "all" }).map((thread) => thread.id)).toEqual(["d", "c", "a", "b"]);
  });

  it("restricts to a block or to anchored threads", () => {
    expect(filterCommentThreads(comments, { blockId: "b1" }).map((thread) => thread.id)).toEqual(["d", "a"]);
    expect(filterCommentThreads(comments, { anchoredOnly: true }).map((thread) => thread.id)).toEqual(["d", "a"]);
  });

  it("searches bodies and replies, case-insensitively", () => {
    expect(filterCommentThreads(comments, { query: "INTRO" }).map((thread) => thread.id)).toEqual(["a"]);
    expect(filterCommentThreads(comments, { query: "thin" }).map((thread) => thread.id)).toEqual(["a"]);
    expect(filterCommentThreads(comments, { query: "u2" }).map((thread) => thread.id)).toEqual(["a"]);
    expect(filterCommentThreads(comments, { query: "nothing here" })).toEqual([]);
  });

  it("groups by anchor with the biggest group first and unanchored last", () => {
    const groups = groupThreadsByBlock(filterCommentThreads(comments, { status: "all" }));
    expect(groups.map((group) => [group.blockId, group.threads.length])).toEqual([
      ["b1", 2],
      [null, 2],
    ]);
    const anchored = groupThreadsByBlock(
      filterCommentThreads(comments, { status: "all", blockId: "b1" }),
    );
    expect(anchored).toEqual([{ blockId: "b1", threads: expect.any(Array) }]);
    expect(anchored[0]?.threads).toHaveLength(2);
  });

  it("returns replies oldest first", () => {
    expect(threadReplies(comments, "a").map((reply) => reply.id)).toEqual(["a1"]);
    expect(threadReplies(comments, "missing")).toEqual([]);
  });
});
