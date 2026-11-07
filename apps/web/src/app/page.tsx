import { Button } from "@notes-learning/ui/components/button";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  BookOpen,
  Brain,
  Check,
  Cloud,
  Command,
  Frame,
  GitBranch,
  Inbox,
  Layers,
  Lock,
  Monitor,
  MousePointer2,
  Network,
  PenLine,
  Search,
  Shield,
  Smartphone,
  Sparkles,
  WifiOff,
} from "lucide-react";
import Link from "next/link";

import { LatticeLogo, LatticeMark } from "@/components/brand/logo";
import { SiteNav } from "@/components/marketing/site-nav";
import { getDocsUrl } from "@/lib/config";

function PagePreview() {
  return (
    <div className="relative mx-auto mt-14 max-w-5xl px-4">
      <div className="absolute -inset-x-10 top-10 -z-10 h-64 rounded-[50%] bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--saffron)_24%,transparent),transparent_70%)] blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/75 p-1.5 shadow-[0_30px_90px_-30px_color-mix(in_oklch,var(--foreground)_40%,transparent)] backdrop-blur">
        <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
          <div className="flex h-10 items-center justify-between border-b border-border/70 bg-muted/35 px-3">
            <div className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#e8892f]" />
              <span className="size-2 rounded-full bg-[#6f9c7d]" />
              <span className="size-2 rounded-full bg-foreground/15" />
            </div>
            <div className="flex h-6 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 text-[10px] text-muted-foreground">
              <Search className="size-2.5" />
              Search or ask Lattice
              <span className="ml-6 rounded border border-border bg-muted px-1 font-mono text-[9px]">⌘K</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-4 rounded-full bg-moss/40" />
              <span className="size-4 rounded-full bg-saffron/50" />
            </div>
          </div>
          <div className="grid h-[380px] grid-cols-[170px_1fr_190px] md:h-[440px]">
            <div className="hidden border-r border-border/60 bg-sidebar/70 p-2.5 md:block">
              <div className="flex items-center gap-2 px-1 pb-3">
                <LatticeMark className="size-5" />
                <span className="font-display text-sm">lattice</span>
              </div>
              <div className="space-y-0.5 text-[10px]">
                {[
                  { icon: Search, label: "Search", kbd: "⌘K" },
                  { icon: Sparkles, label: "Home" },
                  { icon: Inbox, label: "Inbox", badge: "3" },
                  { icon: Network, label: "Knowledge graph" },
                  { icon: Brain, label: "Learning" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground"
                  >
                    <item.icon className="size-3" />
                    <span className="flex-1">{item.label}</span>
                    {item.kbd ? (
                      <span className="font-mono text-[8px] text-muted-foreground/60">{item.kbd}</span>
                    ) : null}
                    {item.badge ? (
                      <span className="rounded bg-saffron/20 px-1 text-[8px] text-saffron">{item.badge}</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="mt-4 px-2 text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">
                Notebooks
              </div>
              <div className="mt-1.5 space-y-0.5 text-[10px]">
                {[
                  ["◇", "Research"],
                  ["◈", "Product"],
                  ["◒", "Learning"],
                  ["▦", "Architecture"],
                ].map(([icon, label]) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground"
                  >
                    <span className="text-[9px] text-saffron">{icon}</span>
                    {label}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-border/60 bg-background/60 p-2">
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span className="status-dot bg-moss" />
                  Saved locally
                </div>
                <div className="mt-1 text-[8px] text-muted-foreground/70">
                  3 changes queued · synced 2m ago
                </div>
              </div>
            </div>
            <div className="overflow-hidden px-7 py-7 md:px-12">
              <div className="mb-3 flex items-center gap-1.5 text-[9px] text-muted-foreground">
                Research <span className="opacity-40">/</span> Product thinking
              </div>
              <h3 className="max-w-md text-[27px] font-semibold leading-[1.12] tracking-[-0.03em] md:text-[34px]">
                Designing a knowledge engine that thinks in connections
              </h3>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
                <span className="rounded-full border border-border px-2 py-0.5">research</span>
                <span className="rounded-full border border-border px-2 py-0.5">product</span>
                <span className="rounded-full border border-border px-2 py-0.5">draft</span>
                <span className="ml-auto">Edited just now</span>
              </div>
              <div className="mt-6 space-y-3 text-[11px] leading-relaxed text-foreground/80">
                <p>
                  A note is not valuable in isolation. Its value compounds when it can be{" "}
                  <span className="rounded bg-saffron/20 px-1 text-foreground">found in context</span>, linked to
                  other ideas, and turned into something you can use.
                </p>
                <div className="rounded-lg border border-saffron/25 bg-saffron/[0.07] p-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium">
                    <span className="text-saffron">✦</span> Working principle
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Every object is a node. Every view is a lens. Nothing is duplicated to make a new view work.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-saffron">◇</span>
                  <span className="border-b border-primary/30 text-link">The graph is the database</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="grid size-3.5 place-items-center rounded border border-border">
                    <Check className="size-2.5 text-moss" />
                  </span>
                  <span className="line-through opacity-60">Write the outline</span>
                  <span>Connect the prerequisites</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <div className="h-5 w-0.5 animate-pulse bg-saffron" />
                  <span className="text-[10px] text-muted-foreground">Type / for blocks · [[ to link</span>
                </div>
              </div>
            </div>
            <div className="hidden border-l border-border/60 bg-muted/20 p-3 md:block">
              <div className="text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">
                Backlinks
              </div>
              <div className="mt-2 space-y-1.5">
                {["Knowledge graphs", "Local-first sync", "Learning paths"].map((label, index) => (
                  <div key={label} className="rounded-md border border-border/60 bg-background/70 p-2">
                    <div className="text-[9px] font-medium">{label}</div>
                    <div className="mt-1 text-[8px] text-muted-foreground">
                      {index === 0 ? "3 references · 2 concepts" : index === 1 ? "1 reference · design note" : "prerequisite of 4 notes"}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">
                Connections
              </div>
              <svg viewBox="0 0 160 120" className="mt-2 h-24 w-full">
                <line x1="80" y1="60" x2="26" y2="26" stroke="currentColor" strokeOpacity="0.15" />
                <line x1="80" y1="60" x2="134" y2="30" stroke="currentColor" strokeOpacity="0.15" />
                <line x1="80" y1="60" x2="120" y2="96" stroke="currentColor" strokeOpacity="0.15" />
                <line x1="80" y1="60" x2="35" y2="94" stroke="currentColor" strokeOpacity="0.15" />
                <line x1="26" y1="26" x2="134" y2="30" stroke="#e8892f" strokeOpacity="0.5" strokeDasharray="2 3" />
                <circle cx="80" cy="60" r="13" fill="#e8892f" fillOpacity="0.9" />
                <circle cx="26" cy="26" r="7" fill="#6f9c7d" />
                <circle cx="134" cy="30" r="6" fill="currentColor" fillOpacity="0.2" />
                <circle cx="120" cy="96" r="5" fill="currentColor" fillOpacity="0.14" />
                <circle cx="35" cy="94" r="5" fill="currentColor" fillOpacity="0.14" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -left-4 bottom-12 hidden w-52 rotate-[-4deg] rounded-xl border border-border/80 bg-card p-3 shadow-xl lg:block">
        <div className="flex items-center gap-1.5 text-[9px] font-medium">
          <Frame className="size-3 text-moss" />
          Infinite canvas
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <div className="sticky-saffron rounded-md p-2 text-[8px] leading-snug text-ink">
            What if the graph is the navigation?
          </div>
          <div className="sticky-moss rounded-md p-2 text-[8px] leading-snug text-ink">
            Every note is a node
          </div>
          <div className="col-span-2 flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-[8px] text-muted-foreground">
            <MousePointer2 className="size-2.5" />
            Drag a note onto the canvas
          </div>
        </div>
      </div>

      <div className="absolute -right-2 bottom-8 hidden w-56 rotate-[3deg] rounded-xl border border-border/80 bg-card p-3 shadow-xl lg:block">
        <div className="flex items-center justify-between text-[9px] font-medium">
          <span className="flex items-center gap-1.5">
            <Command className="size-3 text-saffron" />
            Command palette
          </span>
          <span className="font-mono text-[8px] text-muted-foreground">⌘K</span>
        </div>
        <div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[9px] text-muted-foreground">
          Turn this page into a mind map
        </div>
        <div className="mt-1 space-y-0.5 text-[8px]">
          {["Create a whiteboard", "Open knowledge graph", "Review 12 cards"].map((label, index) => (
            <div
              key={label}
              className={`flex items-center gap-2 rounded px-2 py-1 ${index === 0 ? "bg-saffron/15 text-foreground" : "text-muted-foreground"}`}
            >
              <span className="text-[7px]">◇</span>
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const features = [
  {
    icon: PenLine,
    title: "Write without friction",
    body: "A block editor that stays out of the way. Slash commands, page links, tables, math, code, and drag-to-reorder blocks.",
    className: "md:col-span-2",
    visual: (
      <div className="mt-5 rounded-xl border border-border/70 bg-background/60 p-3">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="grid size-5 place-items-center rounded bg-saffron/15 text-saffron">/</span>
          <span>Type to filter</span>
          <span className="ml-auto font-mono text-[8px]">ESC</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[9px]">
          {[
            ["Heading", "H1"],
            ["Checklist", "□"],
            ["Callout", "✦"],
            ["Code block", "</>"],
            ["Page link", "◇"],
            ["Mind map", "◈"],
          ].map(([label, icon], index) => (
            <div
              key={label}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${index === 0 ? "bg-saffron/15" : "text-muted-foreground"}`}
            >
              <span className="grid size-4 place-items-center rounded border border-border/60 bg-card font-mono text-[8px]">
                {icon}
              </span>
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    icon: Frame,
    title: "Think spatially",
    body: "An infinite whiteboard with connected cards, not a separate drawing tool. Notes stay live.",
    className: "",
    visual: (
      <div className="mt-5 grid h-24 grid-cols-2 gap-1.5">
        <div className="sticky-saffron flex items-end rounded-lg p-2 text-[8px] text-ink">An idea</div>
        <div className="sticky-moss flex items-end rounded-lg p-2 text-[8px] text-ink">A constraint</div>
        <div className="col-span-2 flex items-center gap-2 rounded-lg border border-dashed border-border p-2 text-[8px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-saffron" /> connected to a live note
        </div>
      </div>
    ),
  },
  {
    icon: Network,
    title: "See the shape of your thinking",
    body: "Typed relationships, backlinks, clusters, and orphan detection — built on the data model, not painted on top.",
    className: "",
    visual: (
      <svg viewBox="0 0 220 96" className="mt-5 h-24 w-full">
        <line x1="110" y1="48" x2="38" y2="24" stroke="currentColor" strokeOpacity="0.15" />
        <line x1="110" y1="48" x2="180" y2="26" stroke="currentColor" strokeOpacity="0.15" />
        <line x1="110" y1="48" x2="52" y2="78" stroke="currentColor" strokeOpacity="0.15" />
        <line x1="110" y1="48" x2="176" y2="74" stroke="currentColor" strokeOpacity="0.15" />
        <line x1="38" y1="24" x2="180" y2="26" stroke="#e8892f" strokeOpacity="0.55" strokeDasharray="2 3" />
        <circle cx="110" cy="48" r="12" fill="#e8892f" fillOpacity="0.9" />
        <circle cx="38" cy="24" r="7" fill="#6f9c7d" />
        <circle cx="180" cy="26" r="6" fill="#8b5cf6" fillOpacity="0.8" />
        <circle cx="52" cy="78" r="5" fill="currentColor" fillOpacity="0.18" />
        <circle cx="176" cy="74" r="7" fill="#3b82f6" fillOpacity="0.7" />
      </svg>
    ),
  },
  {
    icon: Brain,
    title: "Remember what matters",
    body: "Turn notes into cards, review with spaced repetition, and watch mastery grow across connected topics.",
    className: "md:col-span-2",
    visual: (
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          ["What is a knowledge graph?", "A network of concepts connected by typed relationships.", "saffron"],
          ["Why local-first?", "Your device is the source of truth; the cloud is optional.", "moss"],
          ["What is a prerequisite?", "Knowledge that should be learned before a target idea.", "sky"],
        ].map(([front, back, color]) => (
          <div key={front} className="rounded-lg border border-border/70 bg-background/60 p-2.5">
            <div className={`mb-2 h-1 w-6 rounded-full bg-${color} opacity-70`} />
            <div className="text-[9px] font-medium leading-snug">{front}</div>
            <div className="mt-1.5 text-[8px] leading-snug text-muted-foreground">{back}</div>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: Inbox,
    title: "A universal inbox",
    body: "Clip, bookmark, capture, and process later — with suggested tags and connections you approve.",
    className: "",
    visual: (
      <div className="mt-5 space-y-1.5">
        {[
          ["⌁", "The case for calm software", "Bookmark"],
          ["◇", "Interview notes — Maya", "Clip"],
          ["✦", "Idea: graph-native onboarding", "Note"],
        ].map(([icon, title, type]) => (
          <div key={title} className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5">
            <span className="text-[9px] text-saffron">{icon}</span>
            <span className="flex-1 truncate text-[9px]">{title}</span>
            <span className="text-[8px] text-muted-foreground">{type}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: WifiOff,
    title: "Own your knowledge",
    body: "Everything is local-first. Work offline, sync when ready, export anytime. No lock-in, no silent loss.",
    className: "md:col-span-2",
    visual: (
      <div className="mt-5 flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
        <div className="flex flex-1 items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg border border-border/60 bg-card">
            <Monitor className="size-3.5" />
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-moss/50 via-saffron/50 to-sky/50" />
          <span className="grid size-7 place-items-center rounded-lg border border-border/60 bg-card">
            <Smartphone className="size-3.5" />
          </span>
          <span className="h-px flex-1 bg-border" />
          <span className="grid size-7 place-items-center rounded-lg border border-border/60 bg-card">
            <Cloud className="size-3.5" />
          </span>
        </div>
        <div className="text-right text-[8px] text-muted-foreground">
          <div className="flex items-center justify-end gap-1 text-moss">
            <Shield className="size-2.5" /> End-to-end ready
          </div>
          <div>3 devices · 1 source of truth</div>
        </div>
      </div>
    ),
  },
];

const verbs = [
  {
    number: "01",
    title: "Create",
    body: "Capture the thought before it disappears. Write in blocks, paste anything, clip the web.",
    icon: PenLine,
  },
  {
    number: "02",
    title: "Connect",
    body: "Link pages, add typed relationships, and let backlinks reveal the structure you did not plan.",
    icon: GitBranch,
  },
  {
    number: "03",
    title: "Visualize",
    body: "Move ideas onto a canvas and see the architecture, the map, or the story.",
    icon: Frame,
  },
  {
    number: "04",
    title: "Understand",
    body: "Turn notes into retrieval practice. Find gaps, follow prerequisites, and remember.",
    icon: Brain,
  },
  {
    number: "05",
    title: "Build",
    body: "Move from understanding to projects, decisions, documentation, and shipped work.",
    icon: Blocks,
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] landing-grid opacity-70" />
      <div className="pointer-events-none absolute left-1/2 top-[-260px] -z-10 h-[620px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--saffron)_16%,transparent),transparent_68%)] blur-3xl" />
      <SiteNav />

      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 md:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-moss" />
            Local-first · Open architecture · Optional AI
          </div>
          <h1 className="animate-rise-delay mt-7 text-balance font-display text-[3.4rem] leading-[0.94] tracking-[-0.035em] md:text-[5.4rem]">
            Your ideas deserve
            <br />
            a place to <span className="serif-italic text-saffron">connect</span>.
          </h1>
          <p className="animate-rise-delay-2 mx-auto mt-6 max-w-xl text-balance text-[15px] leading-relaxed text-muted-foreground md:text-base">
            Lattice is a knowledge operating system for people who think in connections. Write, draw,
            link, and learn in one local-first workspace — not five disconnected tools.
          </p>
          <div className="animate-rise-delay-2 mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <Button
              size="lg"
              className="h-11 rounded-xl px-5 text-sm shadow-[0_8px_24px_-12px_color-mix(in_oklch,var(--saffron)_80%,transparent)]"
              render={<Link href="/login?mode=signup" />}
            >
              Start your lattice
              <ArrowRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-11 rounded-xl border-border bg-card/50 px-5 text-sm backdrop-blur"
              render={<Link href="/login" />}
            >
              Sign in
            </Button>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Check className="size-3 text-moss" /> Free to start
            </span>
            <span className="opacity-30">·</span>
            <span className="flex items-center gap-1">
              <Check className="size-3 text-moss" /> No credit card
            </span>
            <span className="opacity-30">·</span>
            <span className="flex items-center gap-1">
              <Lock className="size-3 text-moss" /> Your data exports with you
            </span>
          </div>
        </div>

        <PagePreview />
      </section>

      <section id="product" className="mx-auto max-w-6xl px-5 pb-24 pt-10">
        <div className="flex flex-col items-start justify-between gap-4 border-t border-border/70 pt-12 md:flex-row md:items-end">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-saffron">
              One workspace, many lenses
            </div>
            <h2 className="mt-3 max-w-xl text-balance font-display text-4xl leading-[1.02] tracking-[-0.03em] md:text-5xl">
              Everything shares one knowledge model.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            A page, a whiteboard, a topic, and a flashcard are different views of the same idea.
            Nothing is copied to make a new view work.
          </p>
        </div>

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`group relative overflow-hidden rounded-2xl border border-border/70 bg-card/55 p-5 backdrop-blur transition-colors hover:border-border md:p-6 ${feature.className}`}
            >
              <div className="flex size-8 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-saffron">
                <feature.icon className="size-4" />
              </div>
              <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{feature.title}</h3>
              <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">{feature.body}</p>
              {feature.visual}
            </div>
          ))}
        </div>
      </section>

      <section id="verbs" className="border-y border-border/70 bg-muted/20">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-moss">The five verbs</div>
              <h2 className="mt-3 font-display text-4xl tracking-[-0.03em] md:text-5xl">
                Knowledge is a practice, not a folder.
              </h2>
            </div>
            <Layers className="hidden size-10 text-border md:block" />
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 md:grid-cols-5">
            {verbs.map((verb) => (
              <div key={verb.title} className="group bg-background/80 p-5 transition-colors hover:bg-card">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground">{verb.number}</span>
                  <verb.icon className="size-4 text-saffron/80" />
                </div>
                <h3 className="mt-8 font-display text-2xl">{verb.title}</h3>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{verb.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="local-first" className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-sky">Local-first by default</div>
            <h2 className="mt-3 max-w-md text-balance font-display text-4xl leading-[1.02] tracking-[-0.03em] md:text-5xl">
              Your device is the source of truth.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
              Lattice writes every change to IndexedDB before it touches a network. Close the lid,
              lose signal, or ignore the cloud entirely — your workspace still opens, searches, and edits.
              Sync is a feature, not a dependency.
            </p>
            <div className="mt-6 grid gap-2 text-[12px]">
              {[
                ["Offline editing and search", WifiOff],
                ["Versioned sync with conflict snapshots", GitBranch],
                ["Full workspace export in JSON", ArrowUpRight],
                ["Self-host the entire stack", Cloud],
              ].map(([label, Icon]) => (
                <div key={String(label)} className="flex items-center gap-2.5 text-muted-foreground">
                  <span className="grid size-5 place-items-center rounded border border-border/70 bg-card">
                    <Icon className="size-3 text-moss" />
                  </span>
                  {label as string}
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-6 paper-shadow">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="status-dot bg-moss" /> Local copy
                </span>
                <span className="font-mono">1.4 MB · 128 notes</span>
              </div>
              <div className="mt-6 space-y-3">
                {[
                  ["device", "MacBook · offline", "moss", "Editing “Graph-native onboarding”"],
                  ["queue", "3 changes queued", "saffron", "page · document · edge"],
                  ["server", "Reconnect → sync", "sky", "Every op is idempotent"],
                  ["snapshot", "Conflict preserved", "rose", "Choose local or remote — never silent"],
                ].map(([tag, title, color, body]) => (
                  <div key={tag} className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
                    <span className={`mt-1.5 size-2 rounded-full bg-${color}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium">{title}</div>
                      <div className="mt-0.5 text-[9px] text-muted-foreground">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg bg-muted/45 p-3 font-mono text-[9px] leading-relaxed text-muted-foreground">
                <div><span className="text-moss">local</span> → outbox → push(opId)</div>
                <div><span className="text-sky">server</span> → change log → pull(cursor)</div>
              </div>
            </div>
            <div className="absolute -bottom-4 -right-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-[9px] text-muted-foreground shadow-lg">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3 text-moss" /> Optional E2E-ready architecture
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border/70 bg-muted/20">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-saffron">Everywhere you think</div>
              <h2 className="mt-2 font-display text-3xl tracking-[-0.03em] md:text-4xl">
                Web, installable, desktop, mobile.
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                ["Browser", Monitor],
                ["PWA", Layers],
                ["macOS", Monitor],
                ["Windows", Monitor],
                ["Linux", Monitor],
                ["iOS", Smartphone],
                ["Android", Smartphone],
              ].map(([label, Icon]) => (
                <span
                  key={String(label)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-[10px] text-muted-foreground"
                >
                  <Icon className="size-3" />
                  {label as string}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-card paper-shadow">
          <LatticeMark className="size-7" />
        </div>
        <h2 className="mx-auto mt-6 max-w-2xl text-balance font-display text-4xl leading-[1.02] tracking-[-0.03em] md:text-6xl">
          Give your ideas somewhere to become more.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          Start with one note. Connect it to the next. Let the structure emerge.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            size="lg"
            className="h-11 rounded-xl px-5 text-sm"
            render={<Link href="/login?mode=signup" />}
          >
            Start your lattice <ArrowRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 rounded-xl px-5 text-sm"
            render={<Link href="/app" />}
          >
            Open existing workspace
          </Button>
        </div>
        <div className="mt-10 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
          <LatticeLogo href={null} showWordmark={false} className="opacity-50" />
          <span>Built for people who refuse to let good ideas disappear.</span>
        </div>
      </section>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-5 py-8 text-[10px] text-muted-foreground md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <LatticeMark className="size-4 opacity-60" />
            <span>Lattice · a local-first knowledge OS</span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <a href={getDocsUrl()} target="_blank" rel="noreferrer" className="hover:text-foreground">
              Docs
            </a>
            <Link href="/app" className="hover:text-foreground">Workspace</Link>
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
