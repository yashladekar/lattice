import { describe, expect, it } from "vitest";

import {
  findDuplicates,
  normalizedTitle,
  titleTokens,
  type DuplicateCandidate,
  type DuplicateDocument,
} from "./duplicates";

const page = (id: string, title: string): DuplicateCandidate => ({ id, title });
const doc = (pageId: string, plainText: string): DuplicateDocument => ({ pageId, plainText });

const body = (sentence: string, times = 12) => Array.from({ length: times }, () => sentence).join(" ");

describe("title normalisation", () => {
  it("drops stop words and punctuation", () => {
    expect(normalizedTitle("The Notes.")).toBe("notes");
    expect(titleTokens("A Guide to the Graph!")).toEqual(["guide", "graph"]);
  });

  it("keeps a title that is nothing but stop words", () => {
    expect(titleTokens("The And")).toEqual(["the", "and"]);
  });
});

describe("findDuplicates", () => {
  it("clusters pages that share a title", () => {
    const clusters = findDuplicates([page("a", "Meeting notes"), page("b", "meeting Notes")], []);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toBe("same-title");
    expect(clusters[0].score).toBe(1);
    expect(clusters[0].members.map((member) => member.id)).toEqual(["a", "b"]);
  });

  it("clusters titles that drifted", () => {
    const clusters = findDuplicates(
      [page("a", "Lattice architecture overview"), page("b", "Lattice architecture notes")],
      [],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toBe("similar-title");
    expect(clusters[0].score).toBeGreaterThanOrEqual(0.5);
    expect(clusters[0].score).toBeLessThan(1);
  });

  it("clusters a pasted body under a different title", () => {
    const text = body("the quick brown fox jumps over the lazy dog every single morning");
    const clusters = findDuplicates(
      [page("a", "Morning routine"), page("c", "Copy of notes")],
      [doc("a", text), doc("c", text)],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].reason).toBe("similar-body");
    expect(clusters[0].score).toBe(1);
  });

  it("prefers the title signal when a pair matches both ways", () => {
    const text = body("identical wording repeated throughout the entire document here");
    const clusters = findDuplicates(
      [page("a", "Same title"), page("b", "Same title")],
      [doc("a", text), doc("b", text)],
    );
    expect(clusters[0].reason).toBe("same-title");
  });

  it("does not pair unrelated pages", () => {
    const clusters = findDuplicates(
      [page("a", "Grocery list"), page("b", "Quarterly planning"), page("c", "Reading log")],
      [doc("a", "milk eggs bread"), doc("b", "revenue targets for the quarter"), doc("c", "books")],
    );
    expect(clusters).toEqual([]);
  });

  it("ignores bodies too short to judge", () => {
    const clusters = findDuplicates(
      [page("a", "First"), page("b", "Second")],
      [doc("a", "same words"), doc("b", "same words")],
    );
    expect(clusters).toEqual([]);
  });

  it("merges a chain of near matches into one cluster", () => {
    const clusters = findDuplicates(
      [page("a", "Alpha"), page("b", "Beta"), page("c", "Gamma")],
      [doc("a", body("shared opening line used by every one of these notes")), doc("b", body("shared opening line used by every one of these notes")), doc("c", body("shared opening line used by every one of these notes"))],
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toHaveLength(3);
  });

  it("keeps separate pairs apart", () => {
    const clusters = findDuplicates(
      [page("a", "Recipe"), page("b", "Recipe"), page("c", "Budget"), page("d", "Budget")],
      [],
    );
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.members.map((member) => member.id).join("+")).sort()).toEqual([
      "a+b",
      "c+d",
    ]);
  });

  it("picks the fullest note as the survivor", () => {
    const clusters = findDuplicates(
      [page("short", "Same title"), page("long", "Same title")],
      [doc("short", "a line"), doc("long", body("a much longer body with plenty of detail in it"))],
    );
    expect(clusters[0].survivorId).toBe("long");
  });

  it("is deterministic and ordered by score", () => {
    const candidates = [page("a", "Same"), page("b", "Same"), page("c", "Lattice architecture notes"), page("d", "Lattice architecture overview")];
    const first = findDuplicates(candidates, []);
    const second = findDuplicates([...candidates].reverse(), []);
    expect(first.map((cluster) => cluster.id)).toEqual(second.map((cluster) => cluster.id));
    expect(first[0].score).toBeGreaterThanOrEqual(first[1].score);
  });

  it("builds an excerpt for review without dumping the whole body", () => {
    const long = body("word", 200);
    const clusters = findDuplicates(
      [page("a", "Notes"), page("b", "Notes")],
      [doc("a", long), doc("b", long)],
    );
    expect(clusters[0].members[0].excerpt.length).toBeLessThanOrEqual(161);
    expect(clusters[0].members[0].excerpt.endsWith("…")).toBe(true);
  });

  it("returns nothing for an empty workspace", () => {
    expect(findDuplicates([], [])).toEqual([]);
  });
});
