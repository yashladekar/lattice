import { addDays, DAY_MS } from "./dates";
import { extractPlainText, nodePlainText } from "./editor";
import type { Flashcard, TipTapDoc, TipTapNode } from "./types";

export type ReviewRating = 1 | 2 | 3 | 4;

export interface ReviewResult {
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  dueAt: string;
}

export function scheduleReview(
  card: Pick<Flashcard, "interval" | "ease" | "reps" | "lapses">,
  rating: ReviewRating,
  now: Date = new Date(),
): ReviewResult {
  let { interval, ease, reps, lapses } = card;
  if (!Number.isFinite(interval) || interval < 0) interval = 0;
  if (!Number.isFinite(ease) || ease < 1.3) ease = 2.5;

  if (rating === 1) {
    lapses += 1;
    reps = 0;
    interval = 10 / (60 * 24);
    ease = Math.max(1.3, ease - 0.2);
  } else if (rating === 2) {
    interval = Math.max(1, interval * 1.2);
    ease = Math.max(1.3, ease - 0.15);
    reps += 1;
  } else if (rating === 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 3;
    else interval = Math.max(1, interval * ease);
    reps += 1;
  } else {
    if (reps === 0) interval = 2;
    else if (reps === 1) interval = 5;
    else interval = Math.max(1, interval * ease * 1.3);
    ease = Math.min(3.2, ease + 0.15);
    reps += 1;
  }

  const due = new Date(now.getTime() + interval * DAY_MS);
  return {
    interval: Math.round(interval * 1000) / 1000,
    ease: Math.round(ease * 1000) / 1000,
    reps,
    lapses,
    dueAt: due.toISOString(),
  };
}

export function isDue(card: Pick<Flashcard, "dueAt">, now: Date = new Date()): boolean {
  return new Date(card.dueAt).getTime() <= now.getTime();
}

export function dueCards(cards: Flashcard[], now: Date = new Date()): Flashcard[] {
  return cards
    .filter((card) => !card.deletedAt && isDue(card, now))
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
}

export function masteryScore(cards: Array<Pick<Flashcard, "interval" | "ease" | "reps">>): number {
  if (!cards.length) return 0;
  const total = cards.reduce((sum, card) => {
    const intervalScore = Math.min(1, Math.log10(1 + Math.max(0, card.interval)) / 2);
    const repsScore = Math.min(1, card.reps / 8);
    const easeScore = Math.min(1, Math.max(0, (card.ease - 1.3) / 1.9));
    return sum + intervalScore * 0.5 + repsScore * 0.3 + easeScore * 0.2;
  }, 0);
  return Math.round((total / cards.length) * 100) / 100;
}

export interface GeneratedCard {
  front: string;
  back: string;
  blockId?: string;
}

const MAX_GENERATED = 24;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitDefinition(text: string): [string, string] | null {
  const normalized = clean(text);
  if (normalized.length < 12 || normalized.length > 400) return null;
  const colon = /^(.{2,80}?)\s*[:—–-]\s*(.{4,})$/.exec(normalized);
  if (colon && colon[1] && colon[2] && colon[1].split(" ").length <= 8) {
    return [colon[1].trim(), colon[2].trim()];
  }
  const isA = /^(.{2,80}?)\s+(?:is|are|means|refers to)\s+(.{4,})$/.exec(normalized);
  if (isA && isA[1] && isA[2] && isA[1].split(" ").length <= 7) {
    return [isA[1].trim(), isA[2].trim()];
  }
  return null;
}

function blockId(node: TipTapNode): string | undefined {
  const value = node.attrs?.blockId;
  return typeof value === "string" ? value : undefined;
}

export function generateFlashcardsFromDoc(doc: TipTapDoc): GeneratedCard[] {
  const cards: GeneratedCard[] = [];
  const seen = new Set<string>();
  let section = "";

  const push = (front: string, back: string, block?: string) => {
    const key = `${front}::${back}`.toLowerCase();
    if (seen.has(key) || !front.trim() || !back.trim()) return;
    seen.add(key);
    cards.push({ front: clean(front), back: clean(back), blockId: block });
  };

  for (const node of doc.content ?? []) {
    if (node.type === "heading") {
      section = clean(nodePlainText(node));
      continue;
    }

    if (node.type === "paragraph") {
      const text = nodePlainText(node);
      const definition = splitDefinition(text);
      if (definition) {
        push(definition[0], definition[1], blockId(node));
      } else if (section && clean(text).length > 30) {
        push(`What is the key takeaway of “${section}”?`, text, blockId(node));
      }
      continue;
    }

    if (node.type === "bulletList" || node.type === "orderedList" || node.type === "taskList") {
      for (const item of node.content ?? []) {
        const text = nodePlainText(item);
        const definition = splitDefinition(text);
        if (definition) push(definition[0], definition[1], blockId(item));
      }
      continue;
    }

    if (node.type === "callout") {
      const text = extractPlainText({ type: "doc", content: [node] });
      const title = typeof node.attrs?.title === "string" ? node.attrs.title : "Callout";
      if (text.length > 10) push(`What does the “${title}” note say?`, text, blockId(node));
    }

    if (cards.length >= MAX_GENERATED) break;
  }

  if (!cards.length) {
    const text = extractPlainText(doc);
    const sentences = text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 40);
    for (const sentence of sentences.slice(0, 8)) {
      const definition = splitDefinition(sentence);
      if (definition) push(definition[0], definition[1]);
    }
  }

  return cards.slice(0, MAX_GENERATED);
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  sourceCardId?: string;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function buildQuiz(
  cards: Array<Pick<Flashcard, "id" | "front" | "back">>,
  count = 5,
): QuizQuestion[] {
  const questions: QuizQuestion[] = [];
  const pool = cards.filter((card) => card.back.trim().length > 0);
  if (pool.length < 2) return questions;

  const selected = [...pool].sort((a, b) => hashString(a.id) - hashString(b.id)).slice(0, count);
  for (const card of selected) {
    const distractors = pool
      .filter((candidate) => candidate.id !== card.id)
      .map((candidate) => candidate.back)
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 3);
    if (!distractors.length) continue;
    const options = [card.back, ...distractors];
    const rotation = hashString(card.id) % options.length;
    const rotated = [...options.slice(rotation), ...options.slice(0, rotation)];
    questions.push({
      id: card.id,
      prompt: card.front,
      options: rotated,
      correctIndex: rotated.indexOf(card.back),
      sourceCardId: card.id,
    });
  }
  return questions;
}

export function reviewPressure(cards: Flashcard[], now: Date = new Date()): number {
  const due = dueCards(cards, now).length;
  const total = cards.filter((card) => !card.deletedAt).length;
  if (!total) return 0;
  return Math.min(1, due / Math.max(1, total));
}

export function nextReviewDate(cards: Flashcard[]): string | null {
  const future = cards
    .filter((card) => !card.deletedAt && new Date(card.dueAt).getTime() > Date.now())
    .map((card) => card.dueAt)
    .sort();
  return future[0] ?? null;
}

export function cardFreshness(card: Flashcard): string {
  if (isDue(card)) return "Due now";
  const due = new Date(card.dueAt);
  if (due.getTime() - Date.now() < DAY_MS) return "Due today";
  return `Due ${addDays(new Date(), Math.ceil((due.getTime() - Date.now()) / DAY_MS)).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
