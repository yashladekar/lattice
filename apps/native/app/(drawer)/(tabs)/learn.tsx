import { Ionicons } from "@expo/vector-icons";
import { createId } from "@notes-learning/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Input, Spinner, useThemeColor, useToast } from "heroui-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { Sheet } from "@/components/ui/sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { useWorkspace } from "@/contexts/workspace-context";
import { client } from "@/utils/orpc";

const RATINGS = [
  { rating: 1, label: "Again", color: "#b45309", bg: "bg-amber-100" },
  { rating: 2, label: "Hard", color: "#92400e", bg: "bg-amber-50" },
  { rating: 3, label: "Good", color: "#166534", bg: "bg-emerald-50" },
  { rating: 4, label: "Easy", color: "#065f46", bg: "bg-emerald-100" },
] as const;

type Tab = "review" | "decks" | "quiz" | "path";

const TABS: Array<{ id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "review", label: "Review", icon: "albums-outline" },
  { id: "decks", label: "Decks", icon: "layers-outline" },
  { id: "quiz", label: "Quiz", icon: "help-circle-outline" },
  { id: "path", label: "Path", icon: "map-outline" },
];

export default function LearnScreen() {
  const { workspace } = useWorkspace();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const muted = useThemeColor("muted");
  const accent = useThemeColor("accent");

  const [tab, setTab] = useState<Tab>("review");
  const [revealed, setRevealed] = useState(false);
  const [rating, setRating] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [cardSheet, setCardSheet] = useState(false);
  const [deckSheet, setDeckSheet] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deckName, setDeckName] = useState("");
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, number>>({});
  const [quizStarted, setQuizStarted] = useState(false);

  const due = useQuery({
    queryKey: ["native-due", workspace?.id],
    queryFn: async () => client.learning.due({ limit: 30 }),
    enabled: Boolean(workspace),
  });
  const stats = useQuery({
    queryKey: ["native-stats", workspace?.id],
    queryFn: async () => client.learning.stats(),
    enabled: Boolean(workspace),
  });
  const decks = useQuery({
    queryKey: ["native-decks", workspace?.id],
    queryFn: async () => client.learning.decks(),
    enabled: Boolean(workspace),
  });
  const cards = useQuery({
    queryKey: ["native-cards", workspace?.id, selectedDeck],
    queryFn: async () => client.learning.cards(selectedDeck ? { deckId: selectedDeck } : {}),
    enabled: Boolean(workspace),
  });
  const quiz = useQuery({
    queryKey: ["native-quiz", workspace?.id, selectedDeck],
    queryFn: async () => client.learning.quiz({ count: 8, ...(selectedDeck ? { deckId: selectedDeck } : {}) }),
    enabled: Boolean(workspace && tab === "quiz" && quizStarted),
  });
  const paths = useQuery({
    queryKey: ["native-paths", workspace?.id],
    queryFn: async () => client.learning.paths(),
    enabled: Boolean(workspace && tab === "path"),
  });

  const current = due.data?.[0] ?? null;
  const total = stats.data?.totalCards ?? 0;
  const mastery = Math.round((stats.data?.mastery ?? 0) * 100);

  const refreshReview = async () => {
    await Promise.all([due.refetch(), stats.refetch(), cards.refetch()]);
  };

  const review = async (value: 1 | 2 | 3 | 4) => {
    if (!current) return;
    setRating(true);
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await client.learning.review({ flashcardId: current.id, rating: value });
      setRevealed(false);
      await refreshReview();
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not review card",
      });
    } finally {
      setRating(false);
    }
  };

  const createCard = async () => {
    if (!front.trim() || !back.trim()) return;
    try {
      await client.learning.createCard({
        deckId: selectedDeck,
        front: front.trim(),
        back: back.trim(),
      });
      setFront("");
      setBack("");
      setCardSheet(false);
      await Promise.all([cards.refetch(), stats.refetch(), due.refetch()]);
      toast.show({ variant: "success", label: "Card added" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not add the card",
      });
    }
  };

  const removeCard = async (cardId: string) => {
    try {
      await client.learning.removeCard({ flashcardId: cardId });
      await Promise.all([cards.refetch(), stats.refetch()]);
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not remove the card",
      });
    }
  };

  const createDeck = async () => {
    if (!deckName.trim()) return;
    const deckId = createId();
    try {
      await client.sync.push({
        ops: [
          {
            opId: `mobile-deck-${deckId}`,
            entity: "deck",
            entityId: deckId,
            op: "UPSERT",
            payload: { name: deckName.trim(), description: null, color: "#2f6b4f" },
          },
        ],
      });
      setDeckName("");
      setDeckSheet(false);
      await queryClient.invalidateQueries({ queryKey: ["native-decks", workspace?.id] });
      toast.show({ variant: "success", label: "Deck created" });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not create the deck",
      });
    }
  };

  const removeDeck = async (deckId: string) => {
    try {
      await client.sync.push({
        ops: [
          {
            opId: `mobile-deck-delete-${deckId}-${Date.now()}`,
            entity: "deck",
            entityId: deckId,
            op: "DELETE",
            payload: {},
          },
        ],
      });
      if (selectedDeck === deckId) setSelectedDeck(null);
      await queryClient.invalidateQueries({ queryKey: ["native-decks", workspace?.id] });
      await queryClient.invalidateQueries({ queryKey: ["native-cards", workspace?.id] });
    } catch (error) {
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : "Could not delete the deck",
      });
    }
  };

  const questions = quiz.data ?? [];
  const question = questions[quizIndex];
  const answered = question ? quizAnswers[question.id] : undefined;
  const correctCount = questions.filter(
    (entry) => quizAnswers[entry.id] === entry.correctIndex,
  ).length;

  return (
    <Container>
      <ScreenHeader title="Learning" subtitle="Remember what you chose to keep" large />
      <View className="px-5 pb-10">
        <View className="mt-3 flex-row gap-2">
          {[
            ["Due", stats.data?.dueCount ?? 0],
            ["Cards", total],
            ["Streak", stats.data?.streak ?? 0],
            ["Mastery", `${mastery}%`],
          ].map(([label, value]) => (
            <View key={String(label)} className="flex-1 rounded-xl border border-border bg-surface p-2.5">
              <Text className="text-lg font-semibold text-foreground">{value}</Text>
              <Text className="text-[9px] uppercase tracking-wider text-muted">{label}</Text>
            </View>
          ))}
        </View>

        <View className="mt-4 flex-row rounded-xl border border-border bg-surface-secondary p-1">
          {TABS.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => setTab(entry.id)}
              className={`flex-1 flex-row items-center justify-center gap-1 rounded-lg py-1.5 ${
                tab === entry.id ? "bg-surface" : ""
              }`}
            >
              <Ionicons name={entry.icon} size={13} color={tab === entry.id ? accent : muted} />
              <Text
                className={`text-[10px] font-medium ${
                  tab === entry.id ? "text-foreground" : "text-muted"
                }`}
              >
                {entry.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === "review" ? (
          <View className="mt-4">
            {due.isLoading ? (
              <ActivityIndicator color={accent} className="py-12" />
            ) : current ? (
              <View className="rounded-3xl border border-border bg-surface p-5">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[10px] uppercase tracking-widest text-muted">
                    Review · {due.data?.length ?? 0} due
                  </Text>
                  <Text className="text-[10px] text-muted">
                    {new Date(current.dueAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </View>
                <Text className="mt-3 text-xl font-medium leading-8 text-foreground">
                  {current.front}
                </Text>
                {current.hint ? (
                  <Text className="mt-2 text-[11px] italic text-muted">Hint: {current.hint}</Text>
                ) : null}
                {revealed ? (
                  <View className="mt-5 border-t border-border pt-4">
                    <Text className="text-[9px] font-semibold uppercase tracking-widest text-muted">
                      Answer
                    </Text>
                    <Text className="mt-2 text-[15px] leading-7 text-foreground/80">
                      {current.back}
                    </Text>
                  </View>
                ) : null}
                {!revealed ? (
                  <Pressable
                    onPress={() => setRevealed(true)}
                    className="mt-6 items-center rounded-xl bg-accent py-3"
                  >
                    <Text className="text-sm font-semibold text-neutral-900">Reveal answer</Text>
                  </Pressable>
                ) : (
                  <View className="mt-5 flex-row gap-2">
                    {RATINGS.map((entry) => (
                      <Pressable
                        key={entry.rating}
                        disabled={rating}
                        onPress={() => void review(entry.rating)}
                        className={`flex-1 items-center rounded-xl border border-border py-2.5 ${entry.bg}`}
                      >
                        <Text className="text-[11px] font-semibold" style={{ color: entry.color }}>
                          {entry.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            ) : (
              <View className="rounded-3xl border border-dashed border-border p-8">
                <Ionicons
                  name="checkmark-circle-outline"
                  size={30}
                  color={accent}
                  style={{ alignSelf: "center" }}
                />
                <Text className="mt-3 text-center text-sm font-medium text-foreground">
                  {total ? "All caught up" : "No cards yet"}
                </Text>
                <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
                  {total
                    ? "Your next review is scheduled on every device."
                    : "Open a note and generate cards, or add one from the Decks tab."}
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {tab === "decks" ? (
          <View className="mt-4">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row items-center gap-1.5">
                <Pressable
                  onPress={() => setSelectedDeck(null)}
                  className={`rounded-full border px-2.5 py-1 ${
                    selectedDeck === null
                      ? "border-amber-500/50 bg-amber-100"
                      : "border-border bg-surface"
                  }`}
                >
                  <Text
                    className={`text-[10px] ${
                      selectedDeck === null ? "text-neutral-900" : "text-muted"
                    }`}
                  >
                    All cards
                  </Text>
                </Pressable>
                {(decks.data ?? []).map((deck) => (
                  <View key={deck.id} className="flex-row items-center">
                    <Pressable
                      onPress={() => setSelectedDeck(deck.id)}
                      className={`rounded-full border px-2.5 py-1 ${
                        selectedDeck === deck.id
                          ? "border-amber-500/50 bg-amber-100"
                          : "border-border bg-surface"
                      }`}
                    >
                      <Text
                        className={`text-[10px] ${
                          selectedDeck === deck.id ? "text-neutral-900" : "text-muted"
                        }`}
                      >
                        {deck.name}
                      </Text>
                    </Pressable>
                    {selectedDeck === deck.id ? (
                      <Pressable
                        onPress={() => void removeDeck(deck.id)}
                        hitSlop={8}
                        className="ml-1"
                      >
                        <Ionicons name="close-circle-outline" size={13} color={muted} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
                <Pressable
                  onPress={() => setDeckSheet(true)}
                  className="h-7 w-7 items-center justify-center rounded-full border border-border"
                >
                  <Ionicons name="add" size={14} color={muted} />
                </Pressable>
              </View>
            </ScrollView>

            <View className="mt-3 flex-row gap-2">
              <Pressable
                onPress={() => setCardSheet(true)}
                className="flex-row items-center gap-1.5 rounded-xl bg-accent px-3 py-2"
              >
                <Ionicons name="add" size={14} color="#1d1d1a" />
                <Text className="text-[11px] font-semibold text-neutral-900">New card</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setQuizStarted(false);
                  setQuizAnswers({});
                  setQuizIndex(0);
                  setQuizStarted(true);
                  setTab("quiz");
                }}
                className="flex-row items-center gap-1.5 rounded-xl border border-border px-3 py-2"
              >
                <Ionicons name="help-circle-outline" size={14} color={accent} />
                <Text className="text-[11px] text-foreground">Quiz this deck</Text>
              </Pressable>
            </View>

            <View className="mt-4 gap-2">
              {cards.isLoading ? (
                <Spinner size="sm" color="default" />
              ) : cards.data?.length ? (
                cards.data.map((card) => (
                  <View key={card.id} className="rounded-2xl border border-border bg-surface p-3">
                    <View className="flex-row items-start gap-2">
                      <View className="min-w-0 flex-1">
                        <Text className="text-[12px] font-medium text-foreground">{card.front}</Text>
                        <Text className="mt-0.5 text-[11px] text-muted">{card.back}</Text>
                        <Text className="mt-1 text-[9px] text-muted">
                          {card.reps} reps · interval {Math.round(card.interval)}d · due{" "}
                          {new Date(card.dueAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete card"
                        hitSlop={8}
                        onPress={() => void removeCard(card.id)}
                      >
                        <Ionicons name="trash-outline" size={14} color={muted} />
                      </Pressable>
                    </View>
                  </View>
                ))
              ) : (
                <Text className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
                  No cards in this deck yet.
                </Text>
              )}
            </View>
          </View>
        ) : null}

        {tab === "quiz" ? (
          <View className="mt-4">
            {!quizStarted || !questions.length ? (
              <View className="rounded-2xl border border-dashed border-border p-8">
                <Text className="text-center text-sm font-medium text-foreground">
                  {quiz.isLoading ? "Building a quiz…" : "Quiz yourself"}
                </Text>
                <Text className="mt-1 text-center text-[11px] leading-5 text-muted">
                  Multiple choice from the cards in this deck. Needs at least two cards.
                </Text>
                <Pressable
                  onPress={() => {
                    setQuizAnswers({});
                    setQuizIndex(0);
                    setQuizStarted(true);
                    void quiz.refetch();
                  }}
                  className="mt-4 self-center rounded-xl bg-accent px-4 py-2"
                >
                  <Text className="text-xs font-semibold text-neutral-900">
                    {quizStarted ? "Try again" : "Start quiz"}
                  </Text>
                </Pressable>
              </View>
            ) : question ? (
              <View className="rounded-3xl border border-border bg-surface p-5">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[10px] uppercase tracking-widest text-muted">
                    Question {quizIndex + 1} / {questions.length}
                  </Text>
                  <Text className="text-[10px] text-muted">
                    {correctCount} correct
                  </Text>
                </View>
                <Text className="mt-3 text-lg font-medium leading-7 text-foreground">
                  {question.prompt}
                </Text>
                <View className="mt-4 gap-2">
                  {question.options.map((option, index) => {
                    const chosen = answered === index;
                    const isCorrect = index === question.correctIndex;
                    const show = answered !== undefined;
                    return (
                      <Pressable
                        key={index}
                        disabled={show}
                        onPress={() => {
                          setQuizAnswers((current) => ({ ...current, [question.id]: index }));
                          void Haptics.selectionAsync();
                        }}
                        className={`rounded-xl border px-3 py-2.5 ${
                          show
                            ? isCorrect
                              ? "border-emerald-400 bg-emerald-50"
                              : chosen
                                ? "border-rose-400 bg-rose-50"
                                : "border-border bg-surface"
                            : "border-border bg-surface"
                        }`}
                      >
                        <Text className="text-[12px] text-foreground">{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {answered !== undefined ? (
                  <Pressable
                    onPress={() => {
                      if (quizIndex + 1 >= questions.length) {
                        setQuizStarted(false);
                        return;
                      }
                      setQuizIndex((index) => index + 1);
                    }}
                    className="mt-4 items-center rounded-xl bg-accent py-2.5"
                  >
                    <Text className="text-[12px] font-semibold text-neutral-900">
                      {quizIndex + 1 >= questions.length ? "Finish" : "Next"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View className="rounded-2xl border border-border bg-surface p-5">
                <Text className="text-center text-lg font-semibold text-foreground">
                  {correctCount} / {questions.length} correct
                </Text>
                <Text className="mt-1 text-center text-[11px] text-muted">
                  Quiz complete. Start another or review the deck.
                </Text>
                <Pressable
                  onPress={() => {
                    setQuizAnswers({});
                    setQuizIndex(0);
                    setQuizStarted(false);
                  }}
                  className="mt-4 self-center rounded-xl border border-border px-4 py-2"
                >
                  <Text className="text-[11px] text-foreground">Done</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}

        {tab === "path" ? (
          <View className="mt-4">
            {paths.isLoading ? (
              <ActivityIndicator color={accent} className="py-10" />
            ) : (
              <>
                <Text className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Learning path
                </Text>
                <View className="mt-2 gap-1.5">
                  {(paths.data?.path ?? []).slice(0, 12).map((step) => (
                    <View
                      key={step.id}
                      className="flex-row items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"
                    >
                      <View className="h-6 w-6 items-center justify-center rounded-full bg-surface-secondary">
                        <Text className="text-[10px] font-semibold text-foreground">{step.step}</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text numberOfLines={1} className="text-[12px] text-foreground">
                          {step.title}
                        </Text>
                        <View className="mt-1 h-1 overflow-hidden rounded-full bg-surface-secondary">
                          <View
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.round(step.mastery * 100)}%` }}
                          />
                        </View>
                      </View>
                      <Text className="text-[9px] text-muted">
                        {Math.round(step.mastery * 100)}%
                      </Text>
                    </View>
                  ))}
                  {!paths.data?.path?.length ? (
                    <Text className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
                      Link notes with prerequisite relations to build a path.
                    </Text>
                  ) : null}
                </View>

                <Text className="mt-6 text-[10px] font-semibold uppercase tracking-widest text-muted">
                  Knowledge gaps
                </Text>
                <View className="mt-2 gap-1.5">
                  {(paths.data?.gaps ?? []).slice(0, 10).map((gap) => (
                    <View
                      key={gap.id}
                      className="rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2"
                    >
                      <Text className="text-[12px] text-foreground">{gap.title}</Text>
                      <Text className="text-[9px] text-muted">
                        {gap.kind.toLowerCase()} · needs attention
                      </Text>
                    </View>
                  ))}
                  {!paths.data?.gaps?.length ? (
                    <Text className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted">
                      No gaps detected yet.
                    </Text>
                  ) : null}
                </View>
              </>
            )}
          </View>
        ) : null}
      </View>

      <Sheet open={cardSheet} onOpenChange={setCardSheet} title="New card">
        <View className="mt-2 gap-2">
          <Input value={front} onChangeText={setFront} placeholder="Prompt" />
          <TextInput
            value={back}
            onChangeText={setBack}
            placeholder="Answer"
            multiline
            className="min-h-[90px] rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground"
            textAlignVertical="top"
          />
          <Text className="text-[10px] text-muted">
            {selectedDeck
              ? `Adds to ${decks.data?.find((deck) => deck.id === selectedDeck)?.name ?? "deck"}.`
              : "Adds to Daily review."}
          </Text>
          <Pressable
            onPress={() => void createCard()}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Add card</Text>
          </Pressable>
        </View>
      </Sheet>

      <Sheet open={deckSheet} onOpenChange={setDeckSheet} title="New deck">
        <View className="mt-2 gap-2">
          <Input value={deckName} onChangeText={setDeckName} placeholder="Deck name" autoFocus />
          <Pressable
            onPress={() => void createDeck()}
            className="items-center rounded-xl bg-accent py-2.5"
          >
            <Text className="text-[12px] font-semibold text-neutral-900">Create deck</Text>
          </Pressable>
        </View>
      </Sheet>
    </Container>
  );
}
