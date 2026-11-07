"use client";

import {
  buildQuiz,
  cardFreshness,
  knowledgeGaps,
  learningPath,
  masteryScore,
  type QuizQuestion,
  type ReviewRating,
} from "@notes-learning/domain";
import { Button } from "@notes-learning/ui/components/button";
import { Input } from "@notes-learning/ui/components/input";
import { Textarea } from "@notes-learning/ui/components/textarea";
import { cn } from "@notes-learning/ui/lib/utils";
import {
  ArrowRight,
  Bell,
  BellRing,
  Brain,
  Check,
  ChevronRight,
  CircleHelp,
  Flame,
  GraduationCap,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppData } from "@/components/app-data-provider";
import {
  disableReminders,
  enableReminders,
  remindersEnabled,
} from "@/components/learning-reminders";
import {
  useGraph,
  useLearningStats,
  useWorkspacePages,
} from "@/hooks/use-local-data";
import {
  createDeckLocal,
  createFlashcardLocal,
  deleteFlashcardLocal,
  ensureDeckLocal,
  generateCardsFromPageLocal,
  reviewFlashcardLocal,
  updateFlashcardLocal,
} from "@/lib/local/repository";
import { appRouteObject } from "@/lib/navigation";

type Tab = "review" | "decks" | "quiz" | "path";

const RATING: Array<{ rating: ReviewRating; label: string; hint: string; className: string }> = [
  { rating: 1, label: "Again", hint: "1", className: "border-destructive/30 text-destructive hover:bg-destructive/10" },
  { rating: 2, label: "Hard", hint: "2", className: "border-saffron/30 text-saffron hover:bg-saffron/10" },
  { rating: 3, label: "Good", hint: "3", className: "border-sky/30 text-sky hover:bg-sky/10" },
  { rating: 4, label: "Easy", hint: "4", className: "border-moss/30 text-moss hover:bg-moss/10" },
];

export function LearnView() {
  const router = useRouter();
  const { db, user, activeWorkspaceId } = useAppData();
  const learning = useLearningStats();
  const pages = useWorkspacePages();
  const graph = useGraph();
  const [tab, setTab] = useState<Tab>("review");
  const [revealed, setRevealed] = useState(false);
  const [pageToGenerate, setPageToGenerate] = useState("");
  const [addingCard, setAddingCard] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deckName, setDeckName] = useState("");
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [reminders, setReminders] = useState(false);

  useEffect(() => {
    setReminders(remindersEnabled());
  }, []);

  const toggleReminders = async () => {
    if (reminders) {
      disableReminders();
      setReminders(false);
      toast.success("Due reminders turned off");
      return;
    }
    const granted = await enableReminders();
    if (!granted) {
      toast.error("Notifications are blocked in this browser.");
      return;
    }
    setReminders(true);
    toast.success("You will get a nudge when cards are due");
  };

  const current = learning.due[0] ?? null;
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);

  const masteryByPage = useMemo(() => {
    const byPage = new Map<string, typeof learning.cards>();
    for (const card of learning.cards) {
      if (!card.pageId) continue;
      const list = byPage.get(card.pageId) ?? [];
      list.push(card);
      byPage.set(card.pageId, list);
    }
    const map = new Map<string, number>();
    for (const [pageId, cards] of byPage) map.set(pageId, masteryScore(cards));
    return map;
  }, [learning.cards]);

  const path = useMemo(
    () => learningPath(graph.nodes, graph.edges, masteryByPage),
    [graph.nodes, graph.edges, masteryByPage],
  );
  const gaps = useMemo(
    () => knowledgeGaps(graph.nodes, graph.edges, masteryByPage),
    [graph.nodes, graph.edges, masteryByPage],
  );

  const [quiz, setQuiz] = useState<QuizQuestion[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);

  const rate = async (rating: ReviewRating) => {
    if (!current || !db || !user) return;
    await reviewFlashcardLocal(db, current.id, rating, user.id);
    setRevealed(false);
  };

  useEffect(() => {
    if (tab !== "review" || !current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void rate(Number(event.key) as ReviewRating);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, current, revealed]);

  const generate = async () => {
    if (!db || !activeWorkspaceId || !pageToGenerate) return;
    const cards = await generateCardsFromPageLocal(db, {
      workspaceId: activeWorkspaceId,
      pageId: pageToGenerate,
    });
    toast.success(cards.length ? `${cards.length} cards generated` : "No new cards found");
    setTab("review");
  };

  const addCard = async () => {
    if (!db || !activeWorkspaceId || !front.trim() || !back.trim()) return;
    const deck = await ensureDeckLocal(db, activeWorkspaceId);
    await createFlashcardLocal(db, {
      workspaceId: activeWorkspaceId,
      deckId: deck.id,
      front: front.trim(),
      back: back.trim(),
      source: "MANUAL",
    });
    setFront("");
    setBack("");
    setAddingCard(false);
    toast.success("Card added to Daily review");
  };

  const saveCard = async (cardId: string) => {
    if (!db || !editFront.trim() || !editBack.trim()) return;
    await updateFlashcardLocal(db, cardId, {
      front: editFront.trim(),
      back: editBack.trim(),
    });
    setEditingCardId(null);
    toast.success("Card updated");
  };

  const addDeck = async () => {
    if (!db || !activeWorkspaceId || !deckName.trim()) return;
    await createDeckLocal(db, {
      workspaceId: activeWorkspaceId,
      name: deckName.trim(),
    });
    setDeckName("");
    toast.success("Deck created");
  };

  const startQuiz = () => {
    const questions = buildQuiz(learning.cards, 8);
    if (!questions.length) {
      toast.error("Add at least two cards to generate a quiz.");
      return;
    }
    setQuiz(questions);
    setQuizIndex(0);
    setQuizAnswer(null);
    setQuizScore(0);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg border border-border/70 bg-card">
            <GraduationCap className="size-4 text-moss" />
          </span>
          <div>
            <h1 className="font-display text-3xl tracking-[-0.03em]">Learning</h1>
            <p className="text-[10px] text-muted-foreground">
              Turn notes into retrieval practice. Remember what you chose to keep.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[9px] text-muted-foreground">
            <Flame className="size-3 text-saffron" /> {learning.streak} day streak
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-[9px] text-muted-foreground">
            <Target className="size-3 text-moss" /> {Math.round(learning.mastery * 100)}% mastery
          </span>
          <button
            type="button"
            onClick={() => void toggleReminders()}
            title={reminders ? "Turn off due reminders" : "Notify me when cards are due"}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[9px] transition-colors",
              reminders
                ? "border-moss/50 bg-moss/10 text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {reminders ? <BellRing className="size-3 text-moss" /> : <Bell className="size-3" />}
            {reminders ? "Reminders on" : "Remind me"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          ["Due now", learning.due.length],
          ["Cards", learning.cards.length],
          ["Reviews / 60d", learning.logs.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5">
            <div className="text-2xl font-semibold tracking-[-0.03em]">{value}</div>
            <div className="text-[8px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center gap-1 border-b border-border/60 pb-2">
        {(
          [
            ["review", "Review", Brain],
            ["decks", "Decks", Layers],
            ["quiz", "Quiz", CircleHelp],
            ["path", "Learning path", ChevronRight],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] transition-colors",
              tab === value
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 rounded-md text-[9px] text-muted-foreground"
          onClick={() => setAddingCard(true)}
        >
          <Plus className="size-3" /> Add card
        </Button>
      </div>

      {tab === "review" ? (
        <div className="mt-4">
          {current ? (
            <div className="rounded-2xl border border-border/70 bg-card/40 p-5">
              <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-saffron" />
                  {learning.due.length} due · {cardFreshness(current)}
                </span>
                {current.pageId && pageById.get(current.pageId) ? (
                  <button
                    type="button"
                    onClick={() =>
                      router.push(appRouteObject({ view: "page", id: current.pageId as string }))
                    }
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    {pageById.get(current.pageId)?.title} <ArrowRight className="size-2.5" />
                  </button>
                ) : null}
              </div>
              <div className="mt-6 min-h-32">
                <div className="text-[8px] uppercase tracking-[0.16em] text-muted-foreground">Prompt</div>
                <p className="mt-2 whitespace-pre-wrap text-[17px] font-medium leading-relaxed">
                  {current.front}
                </p>
                {revealed ? (
                  <div className="mt-6 border-t border-border/60 pt-4">
                    <div className="text-[8px] uppercase tracking-[0.16em] text-muted-foreground">Answer</div>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                      {current.back}
                    </p>
                  </div>
                ) : null}
              </div>
              <div className="mt-5">
                {!revealed ? (
                  <Button className="h-9 w-full rounded-lg text-[11px]" onClick={() => setRevealed(true)}>
                    Reveal answer <span className="kbd ml-1">space</span>
                  </Button>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {RATING.map((entry) => (
                      <button
                        key={entry.rating}
                        type="button"
                        onClick={() => void rate(entry.rating)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 rounded-lg border bg-background/60 px-2 py-2 text-[10px] transition-colors",
                          entry.className,
                        )}
                      >
                        <span className="font-medium">{entry.label}</span>
                        <span className="text-[7px] opacity-60">{entry.hint}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-border py-14 text-center">
              <Check className="mx-auto size-6 text-moss" />
              <p className="mt-3 text-[13px] font-medium">
                {learning.cards.length ? "All caught up" : "No cards yet"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {learning.cards.length
                  ? "Your next review is scheduled. Come back when it is due."
                  : "Generate cards from a page, or add one manually."}
              </p>
              <div className="mx-auto mt-4 flex max-w-sm items-center gap-2">
                <select
                  value={pageToGenerate}
                  onChange={(event) => setPageToGenerate(event.target.value)}
                  className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-[10px]"
                >
                  <option value="">Choose a page…</option>
                  {pages.map((page) => (
                    <option key={page.id} value={page.id}>
                      {page.title}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="h-8 rounded-md text-[9px]"
                  disabled={!pageToGenerate}
                  onClick={() => void generate()}
                >
                  <Sparkles className="size-3" /> Generate
                </Button>
              </div>
            </div>
          )}
          {learning.cards.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
              <span>Review queue refreshes after each rating.</span>
              <button
                type="button"
                onClick={() => setTab("quiz")}
                className="ml-auto inline-flex items-center gap-1 text-link hover:underline"
              >
                Test yourself with a quiz <ArrowRight className="size-2.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "decks" ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            {learning.byDeck.map((entry) => (
              <div key={entry.deckId} className="rounded-xl border border-border/70 bg-card/40 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-md bg-moss/15 text-[10px] text-moss">
                      ◒
                    </span>
                    <div>
                      <div className="text-[11px] font-medium">{entry.deck?.name ?? "Deck"}</div>
                      <div className="text-[8px] text-muted-foreground">
                        {entry.cards.length} cards · {entry.due} due
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{Math.round(entry.mastery * 100)}%</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-moss/70" style={{ width: `${Math.round(entry.mastery * 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setTab("review")}
                    className="text-[8px] text-link hover:underline"
                  >
                    Review due
                  </button>
                  <span className="text-[8px] text-muted-foreground">
                    {entry.cards.filter((card) => card.source === "NOTE").length} generated
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border/60 bg-card/30 p-3">
            <div className="text-[9px] font-medium">New deck</div>
            <div className="mt-2 flex gap-2">
              <Input
                value={deckName}
                onChange={(event) => setDeckName(event.target.value)}
                placeholder="Deck name"
                className="h-8 rounded-md text-[10px]"
              />
              <Button size="sm" className="h-8 rounded-md text-[9px]" onClick={() => void addDeck()}>
                <Plus className="size-3" /> Create
              </Button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[8px] uppercase tracking-[0.14em] text-muted-foreground">All cards</div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {learning.cards.slice(0, 40).map((card) =>
                editingCardId === card.id ? (
                  <div key={card.id} className="space-y-1 rounded-md border border-primary/30 bg-background p-2">
                    <Input
                      value={editFront}
                      onChange={(event) => setEditFront(event.target.value)}
                      placeholder="Front"
                      aria-label="Card front"
                      className="h-7 rounded-md text-[10px]"
                      autoFocus
                    />
                    <Input
                      value={editBack}
                      onChange={(event) => setEditBack(event.target.value)}
                      placeholder="Back"
                      aria-label="Card back"
                      className="h-7 rounded-md text-[10px]"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void saveCard(card.id);
                        if (event.key === "Escape") setEditingCardId(null);
                      }}
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 rounded-md text-[8px]"
                        onClick={() => setEditingCardId(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="h-6 rounded-md text-[8px]"
                        disabled={!editFront.trim() || !editBack.trim()}
                        onClick={() => void saveCard(card.id)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div key={card.id} className="group flex items-center gap-2 rounded-md border border-border/50 bg-background/50 px-2 py-1.5">
                    <span className="text-[9px]">◒</span>
                    <span className="min-w-0 flex-1 truncate text-[9.5px]">{card.front}</span>
                    <span className="text-[8px] text-muted-foreground">{cardFreshness(card)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCardId(card.id);
                        setEditFront(card.front);
                        setEditBack(card.back);
                      }}
                      className="hover:text-foreground hover-quiet"
                      aria-label="Edit card"
                    >
                      <Pencil className="size-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => db && void deleteFlashcardLocal(db, card.id)}
                      className="hover:text-destructive hover-quiet"
                      aria-label="Delete card"
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "quiz" ? (
        <div className="mt-4">
          {!quiz.length ? (
            <div className="rounded-2xl border border-border/70 bg-card/40 p-6 text-center">
              <CircleHelp className="mx-auto size-7 text-saffron" />
              <h2 className="mt-3 font-display text-2xl">Test recall, not recognition.</h2>
              <p className="mx-auto mt-1 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
                A quiz is built from your cards with plausible distractors. It does not grade your
                knowledge permanently; it is a quick retrieval check.
              </p>
              <Button className="mt-4 h-9 rounded-lg text-[11px]" onClick={startQuiz}>
                Start {Math.min(8, learning.cards.length)}-question quiz
              </Button>
            </div>
          ) : quizIndex >= quiz.length ? (
            <div className="rounded-2xl border border-border/70 bg-card/40 p-8 text-center">
              <div className="text-4xl font-semibold tracking-[-0.04em]">
                {quizScore}/{quiz.length}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {quizScore === quiz.length ? "Perfect recall." : "Use the gaps to choose what to review next."}
              </p>
              <Button
                className="mt-4 h-8 rounded-lg text-[10px]"
                onClick={() => {
                  setQuiz([]);
                  setQuizScore(0);
                }}
              >
                <RotateCcw className="size-3" /> Try again
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/70 bg-card/40 p-5">
              <div className="flex items-center justify-between text-[9px] text-muted-foreground">
                <span>Question {quizIndex + 1} of {quiz.length}</span>
                <span>{quizScore} correct</span>
              </div>
              <p className="mt-4 text-[16px] font-medium leading-relaxed">{quiz[quizIndex]?.prompt}</p>
              <div className="mt-5 space-y-1.5">
                {quiz[quizIndex]?.options.map((option, index) => {
                  const question = quiz[quizIndex];
                  const isCorrect = question ? index === question.correctIndex : false;
                  const answered = quizAnswer !== null;
                  return (
                    <button
                      key={`${index}-${option}`}
                      type="button"
                      disabled={answered}
                      onClick={() => {
                        setQuizAnswer(index);
                        if (isCorrect) setQuizScore((score) => score + 1);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] transition-colors",
                        answered && isCorrect && "border-moss/40 bg-moss/10",
                        answered && quizAnswer === index && !isCorrect && "border-destructive/40 bg-destructive/10",
                        !answered && "border-border/60 hover:bg-muted/50",
                      )}
                    >
                      <span className="grid size-4 place-items-center rounded border border-border/60 text-[8px]">
                        {String.fromCharCode(65 + index)}
                      </span>
                      {option}
                    </button>
                  );
                })}
              </div>
              {quizAnswer !== null ? (
                <Button
                  className="mt-3 h-8 rounded-lg text-[10px]"
                  onClick={() => {
                    setQuizAnswer(null);
                    setQuizIndex((index) => index + 1);
                  }}
                >
                  Next question <ArrowRight className="size-3" />
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {tab === "path" ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card/40 p-4">
            <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <Target className="size-3" /> Suggested path
            </div>
            <div className="mt-3 space-y-1.5">
              {path.slice(0, 10).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() =>
                    node.pageId && router.push(appRouteObject({ view: "page", id: node.pageId }))
                  }
                  className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-background/50 px-2 py-2 text-left hover:bg-muted/40"
                >
                  <span className="grid size-5 place-items-center rounded-full border border-border text-[8px] text-muted-foreground">
                    {node.step}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px]">{node.title}</span>
                    <span className="mt-0.5 flex items-center gap-1">
                      <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-moss/70"
                          style={{ width: `${Math.round(node.mastery * 100)}%` }}
                        />
                      </span>
                      <span className="text-[7px] text-muted-foreground">{Math.round(node.mastery * 100)}%</span>
                    </span>
                  </span>
                  <ChevronRight className="size-3 text-muted-foreground/50" />
                </button>
              ))}
              {!path.length ? (
                <p className="py-6 text-center text-[9px] text-muted-foreground">
                  Add concepts and dependency edges in the graph to build a path.
                </p>
              ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/40 p-4">
            <div className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              <CircleHelp className="size-3" /> Knowledge gaps
            </div>
            <p className="mt-1 text-[8px] text-muted-foreground">
              Topics with incoming dependencies but low mastery.
            </p>
            <div className="mt-3 space-y-1.5">
              {gaps.slice(0, 8).map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() =>
                    node.pageId && router.push(appRouteObject({ view: "page", id: node.pageId }))
                  }
                  className="flex w-full items-center gap-2 rounded-lg border border-saffron/20 bg-saffron/[0.04] px-2 py-2 text-left text-[10px] hover:bg-saffron/[0.08]"
                >
                  <span className="size-1.5 rounded-full bg-saffron" />
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                  <span className="text-[8px] text-muted-foreground">
                    {Math.round((masteryByPage.get(node.id) ?? 0) * 100)}%
                  </span>
                </button>
              ))}
              {!gaps.length ? (
                <p className="py-6 text-center text-[9px] text-muted-foreground">
                  No obvious gaps yet. Add prerequisite relationships to reveal them.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {addingCard ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-foreground/25 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold">Add a flashcard</div>
              <button type="button" onClick={() => setAddingCard(false)} aria-label="Close">
                <X className="size-4 text-muted-foreground" />
              </button>
            </div>
            <Input
              value={front}
              onChange={(event) => setFront(event.target.value)}
              placeholder="Front / prompt"
              className="mt-3 h-9 rounded-lg text-[11px]"
              autoFocus
            />
            <Textarea
              value={back}
              onChange={(event) => setBack(event.target.value)}
              placeholder="Back / answer"
              className="mt-2 min-h-24 rounded-lg text-[11px]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setAddingCard(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-8" onClick={() => void addCard()}>
                Add card
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
