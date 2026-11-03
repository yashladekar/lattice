import Link from "next/link";

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-20">
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs text-fd-muted-foreground">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Lattice documentation
      </div>
      <h1 className="mt-6 text-balance font-serif text-5xl tracking-tight md:text-6xl">
        A knowledge OS for people who think in connections.
      </h1>
      <p className="mt-5 max-w-xl text-sm leading-7 text-fd-muted-foreground">
        Learn how Lattice's editor, whiteboard, graph, learning loop, and local-first sync share one
        knowledge model — and how to run the whole stack yourself.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/docs"
          className="inline-flex h-10 items-center rounded-lg bg-amber-500 px-4 text-sm font-medium text-neutral-950"
        >
          Read the guide
        </Link>
        <Link
          href="/docs/architecture"
          className="inline-flex h-10 items-center rounded-lg border border-fd-border px-4 text-sm font-medium"
        >
          Architecture
        </Link>
      </div>
      <div className="mt-14 grid gap-3 sm:grid-cols-3">
        {[
          ["Create", "A block editor with slash commands, page links, embeds, and databases."],
          ["Connect", "Typed relationships, backlinks, orphan detection, and graph exploration."],
          ["Understand", "Flashcards, spaced repetition, quizzes, and knowledge gaps."],
        ].map(([title, body]) => (
          <div key={title} className="rounded-xl border border-fd-border bg-fd-card p-4">
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-1.5 text-xs leading-5 text-fd-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
