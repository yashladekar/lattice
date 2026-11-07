import { Button } from "@notes-learning/ui/components/button";
import { cn } from "@notes-learning/ui/lib/utils";
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
import type { CSSProperties, ReactNode } from "react";

import { LatticeLogo, LatticeMark } from "@/components/brand/logo";
import { FeatureGraph } from "@/components/marketing/feature-graph";
import { HeroConstellation } from "@/components/marketing/hero-constellation";
import { Reveal } from "@/components/marketing/reveal";
import { SiteNav } from "@/components/marketing/site-nav";
import { getDocsUrl } from "@/lib/config";

function Word({
  children,
  delay,
  className,
}: {
  children: ReactNode;
  delay: number;
  className?: string;
}) {
  return (
    <span className={cn("word-rise", className)} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </span>
  );
}

function PagePreview() {
  return (
    <div className="animate-rise-delay-4 relative mx-auto mt-14 max-w-5xl px-4">
      <div className="absolute -inset-x-10 top-10 -z-10 h-64 rounded-[50%] bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--saffron)_24%,transparent),transparent_70%)] blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/75 p-1.5 shadow-[0_30px_90px_-30px_color-mix(in_oklch,var(--foreground)_40%,transparent)] backdrop-blur">
        <div className="relative overflow-hidden rounded-xl border border-border/70 bg-background">
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
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
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
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  >
                    <span className="text-[9px] text-saffron">{icon}</span>
                    {label}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg border border-border/60 bg-background/60 p-2">
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <span className="status-dot pulse-ring bg-moss" />
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
                  <span className="check-pop grid size-3.5 place-items-center rounded border border-border">
                    <Check className="size-2.5 text-moss" />
                  </span>
                  <span className="task-strike opacity-60">Write the outline</span>
                  <span>Connect the prerequisites</span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="type-line text-[10px] text-muted-foreground">
                    Type / for blocks · [[ to link
                  </span>
                  <span className="h-3.5 w-0.5 animate-pulse bg-saffron" />
                </div>
              </div>
            </div>
            <div className="hidden border-l border-border/60 bg-muted/20 p-3 md:block">
              <div className="text-[8px] font-medium uppercase tracking-[0.16em] text-muted-foreground/60">
                Backlinks
              </div>
              <div className="mt-2 space-y-1.5">
                {["Knowledge graphs", "Local-first sync", "Learning paths"].map((label, index) => (
                  <div
                    key={label}
                    className="rounded-md border border-border/60 bg-background/70 p-2 transition-colors hover:border-saffron/40"
                  >
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
              <svg viewBox="0 0 160 120" className="mt-2 h-24 w-full" aria-hidden="true">
                {[
                  [80, 60, 26, 26],
                  [80, 60, 134, 30],
                  [80, 60, 120, 96],
                  [80, 60, 35, 94],
                ].map(([x1, y1, x2, y2], index) => (
                  <line
                    key={index}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    pathLength={1}
                    stroke="currentColor"
                    strokeOpacity="0.15"
                    className="edge-draw"
                    style={{ animationDelay: `${index * 110}ms` }}
                  />
                ))}
                <line x1="26" y1="26" x2="134" y2="30" stroke="#e8892f" strokeOpacity="0.5" className="dash-flow" />
                <circle cx="80" cy="60" r="13" fill="#e8892f" fillOpacity="0.9" className="node-breathe" />
                <circle cx="26" cy="26" r="7" fill="#6f9c7d" />
                <circle cx="134" cy="30" r="6" fill="currentColor" fillOpacity="0.2" />
                <circle cx="120" cy="96" r="5" fill="currentColor" fillOpacity="0.14" />
                <circle cx="35" cy="94" r="5" fill="currentColor" fillOpacity="0.14" />
              </svg>
            </div>
          </div>
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="preview-cursor pointer-events-none absolute z-20 hidden h-3.5 w-3.5 text-foreground drop-shadow-[0_1px_3px_rgba(0,0,0,0.35)] md:block"
          >
            <path
              d="M5 2.2 19.2 12.4l-6.4 1L9.4 20Z"
              fill="currentColor"
              stroke="var(--background)"
              strokeWidth="1.2"
            />
          </svg>
        </div>
      </div>

      <div
        className="float-soft absolute -left-4 bottom-12 hidden w-52 rounded-xl border border-border/80 bg-card p-3 shadow-xl lg:block"
        style={{ "--tilt": "-4deg" } as CSSProperties}
      >
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

      <div
        className="float-soft absolute -right-2 bottom-8 hidden w-56 rounded-xl border border-border/80 bg-card p-3 shadow-xl lg:block"
        style={{ "--tilt": "3deg", animationDelay: "1.3s" } as CSSProperties}
      >
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
        <div className="relative mt-1">
          <span
            className="palette-cursor pointer-events-none absolute inset-x-0 top-0 h-5 rounded bg-saffron/15"
            aria-hidden="true"
          />
          <div className="relative space-y-0.5 text-[8px]">
            {["Create a whiteboard", "Open knowledge graph", "Review 12 cards"].map((label) => (
              <div
                key={label}
                className="flex h-5 items-center gap-2 rounded px-2 text-muted-foreground"
              >
                <span className="text-[7px]">◇</span>
                {label}
              </div>
            ))}
          </div>
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
              className="slash-cycle flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground"
              style={{ "--cycle-delay": `${index * 620}ms` } as CSSProperties}
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
        <div className="sticky-saffron flex items-end rounded-lg p-2 text-[8px] text-ink transition-transform duration-300 group-hover:-rotate-2 group-hover:-translate-y-0.5">
          An idea
        </div>
        <div className="sticky-moss flex items-end rounded-lg p-2 text-[8px] text-ink transition-transform duration-300 group-hover:rotate-1 group-hover:translate-y-0.5">
          A constraint
        </div>
        <div className="col-span-2 flex items-center gap-2 rounded-lg border border-dashed border-border p-2 text-[8px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-saffron pulse-soft" /> connected to a live note
        </div>
      </div>
    ),
  },
  {
    icon: Network,
    title: "See the shape of your thinking",
    body: "Typed relationships, backlinks, clusters, and orphan detection — built on the data model, not painted on top.",
    className: "",
    visual: <FeatureGraph />,
  },
  {
    icon: Brain,
    title: "Remember what matters",
    body: "Turn notes into cards, review with spaced repetition, and watch mastery grow across connected topics.",
    className: "md:col-span-2",
    visual: (
      <div className="mt-5 grid grid-cols-3 gap-2">
        {[
          {
            front: "What is a knowledge graph?",
            back: "A network of concepts connected by typed relationships.",
            tone: "bg-saffron",
          },
          {
            front: "Why local-first?",
            back: "Your device is the source of truth; the cloud is optional.",
            tone: "bg-moss",
          },
          {
            front: "What is a prerequisite?",
            back: "Knowledge that should be learned before a target idea.",
            tone: "bg-sky",
          },
        ].map((card) => (
          <div key={card.front} className="flip-scene rounded-lg" tabIndex={0}>
            <div className="flip-card relative h-24">
              <div className="flip-face absolute inset-0 rounded-lg border border-border/70 bg-background/60 p-2.5">
                <div className={`mb-2 h-1 w-6 rounded-full opacity-70 ${card.tone}`} />
                <div className="text-[9px] font-medium leading-snug">{card.front}</div>
                <div className="absolute bottom-2 right-2 text-[7px] uppercase tracking-[0.14em] text-muted-foreground/70">
                  flip ↻
                </div>
              </div>
              <div className="flip-face flip-back absolute inset-0 rounded-lg border border-saffron/30 bg-card p-2.5">
                <div className="text-[9px] font-medium leading-snug">{card.back}</div>
                <div className="absolute bottom-2 right-2 text-[7px] uppercase tracking-[0.14em] text-saffron/80">
                  review in 3d
                </div>
              </div>
            </div>
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
          <div
            key={title}
            className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5 transition-transform duration-200 hover:translate-x-0.5"
          >
            <span className="text-[9px] text-saffron">{icon}</span>
            <span className="flex-1 truncate text-[9px]">{title}</span>
            <span className="text-[8px] text-muted-foreground">{type}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[8px] text-muted-foreground">
          <span className="status-dot pulse-soft bg-saffron" />
          Suggested: <span className="text-saffron">#knowledge-graph</span>
          <span className="opacity-40">·</span>
          <span className="text-moss">@Maya</span>
        </div>
      </div>
    ),
  },
  {
    icon: WifiOff,
    title: "Own your knowledge",
    body: "Everything is local-first. Work offline, sync when ready, export anytime. No lock-in, no silent loss.",
    className: "md:col-span-2",
    visual: (
      <div className="relative mt-5 flex items-center gap-3 overflow-hidden rounded-xl border border-border/70 bg-background/60 p-3">
        <span className="sync-packet" aria-hidden="true" />
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
      <noscript>
        <style>{".reveal{opacity:1 !important;transform:none !important}"}</style>
      </noscript>
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] landing-grid opacity-70" />
      <div className="pointer-events-none absolute left-1/2 top-[-260px] -z-10 h-[620px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--saffron)_16%,transparent),transparent_68%)] blur-3xl" />
      <SiteNav />

      <section className="relative isolate">
        <HeroConstellation className="absolute inset-0 -z-10 opacity-80 [mask-image:linear-gradient(to_bottom,black_72%,transparent)]" />
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 md:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="animate-rise inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
              <span className="size-1.5 rounded-full bg-moss pulse-ring" />
              Local-first · Open architecture · Optional AI
            </div>
            <h1 className="mt-7 text-balance font-display text-[3.4rem] leading-[0.94] tracking-[-0.035em] md:text-[5.4rem]">
              <span className="block">
                <Word delay={140}>Your</Word> <Word delay={200}>ideas</Word>{" "}
                <Word delay={260}>deserve</Word>
              </span>
              <span className="mt-1 block">
                <Word delay={320}>a</Word> <Word delay={380}>place</Word>{" "}
                <Word delay={440}>to</Word>{" "}
                <span className="hero-connect relative inline-block">
                  <Word delay={500} className="serif-italic text-saffron">
                    connect.
                  </Word>
                  <svg
                    viewBox="0 0 240 16"
                    className="underline-scribble absolute -bottom-4 left-[-5%] h-3 w-[110%] text-saffron"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 10 C 46 4, 88 14, 130 8 S 200 4, 236 9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                      pathLength={1}
                      className="draw-stroke"
                    />
                  </svg>
                </span>
              </span>
            </h1>
            <p className="animate-rise-delay-3 mx-auto mt-6 max-w-xl text-balance text-[15px] leading-relaxed text-muted-foreground md:text-base">
              Lattice is a knowledge operating system for people who think in connections. Write, draw,
              link, and learn in one local-first workspace — not five disconnected tools.
            </p>
            <div className="animate-rise-delay-3 mt-8 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
              <Button
                size="lg"
                className="group h-11 rounded-xl px-5 text-sm shadow-[0_8px_24px_-12px_color-mix(in_oklch,var(--saffron)_80%,transparent)] transition-transform hover:-translate-y-0.5"
                render={<Link href="/login?mode=signup" />}
              >
                Start your lattice
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-11 rounded-xl border-border bg-card/50 px-5 text-sm backdrop-blur transition-transform hover:-translate-y-0.5"
                render={<Link href="/login" />}
              >
                Sign in
              </Button>
            </div>
            <div className="animate-rise-delay-3 mt-5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
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
        </div>
      </section>

      <section id="product" className="mx-auto max-w-6xl px-5 pb-24 pt-10">
        <Reveal>
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
        </Reveal>

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delay={index * 70} className={feature.className}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border/70 bg-card/55 p-5 backdrop-blur transition-[border-color,background-color,transform] duration-300 hover:-translate-y-0.5 hover:border-border md:p-6">
                <div className="flex size-8 items-center justify-center rounded-lg border border-border/70 bg-background/70 text-saffron transition-transform duration-300 group-hover:scale-105">
                  <feature.icon className="size-4" />
                </div>
                <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em]">{feature.title}</h3>
                <p className="mt-1.5 max-w-md text-[12px] leading-relaxed text-muted-foreground">{feature.body}</p>
                {feature.visual}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="verbs" className="border-y border-border/70 bg-muted/20">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <Reveal>
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-moss">The five verbs</div>
                <h2 className="mt-3 font-display text-4xl tracking-[-0.03em] md:text-5xl">
                  Knowledge is a practice, not a folder.
                </h2>
              </div>
              <Layers className="hidden size-10 text-border md:block" />
            </div>
          </Reveal>
          <div className="mt-12">
            <svg viewBox="0 0 1000 44" className="hidden w-full md:block" aria-hidden="true">
              <path
                d="M100 24 Q200 8 300 24 T500 24 T700 24 T900 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                vectorEffect="non-scaling-stroke"
                className="text-saffron/50 dash-flow"
              />
              {[100, 300, 500, 700, 900].map((x) => (
                <circle key={x} cx={x} cy="24" r="2.6" className="fill-current text-saffron/70" />
              ))}
              <circle r="3.2" className="verb-packet fill-saffron">
                <animateMotion
                  dur="9s"
                  repeatCount="indefinite"
                  path="M100 24 Q200 8 300 24 T500 24 T700 24 T900 24"
                />
              </circle>
            </svg>
            <div className="mt-3 grid gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 md:grid-cols-5">
              {verbs.map((verb, index) => (
                <Reveal key={verb.title} delay={index * 60}>
                  <div className="group h-full bg-background/80 p-5 transition-colors hover:bg-card">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground transition-colors group-hover:text-saffron">
                        {verb.number}
                      </span>
                      <verb.icon className="size-4 text-saffron/80 transition-transform duration-300 group-hover:-translate-y-0.5" />
                    </div>
                    <h3 className="mt-8 font-display text-2xl">{verb.title}</h3>
                    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{verb.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="local-first" className="mx-auto max-w-6xl px-5 py-24">
        <div className="grid items-center gap-12 md:grid-cols-2">
          <Reveal>
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
          </Reveal>
          <Reveal delay={140} className="relative">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-6 paper-shadow">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="status-dot pulse-ring bg-moss" /> Local copy
                </span>
                <span className="font-mono">1.4 MB · 128 notes</span>
              </div>
              <div className="mt-6 space-y-3">
                {[
                  ["device", "MacBook · offline", "bg-moss", "Editing “Graph-native onboarding”"],
                  ["queue", "3 changes queued", "bg-saffron", "page · document · edge"],
                  ["server", "Reconnect → sync", "bg-sky", "Every op is idempotent"],
                  ["snapshot", "Conflict preserved", "bg-rose", "Choose local or remote — never silent"],
                ].map(([tag, title, dot, body]) => (
                  <div key={tag} className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3 transition-colors hover:border-saffron/40">
                    <span className={`mt-1.5 size-2 rounded-full ${dot}`} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium">{title}</div>
                      <div className="mt-0.5 text-[9px] text-muted-foreground">{body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-lg bg-muted/45 p-3 font-mono text-[9px] leading-relaxed text-muted-foreground">
                <div className="log-line"><span className="text-moss">local</span> → outbox → push(opId)</div>
                <div className="log-line" style={{ animationDelay: "-3s" }}><span className="text-sky">server</span> → change log → pull(cursor)</div>
              </div>
            </div>
            <div className="float-soft absolute -bottom-4 -right-3 rounded-lg border border-border/70 bg-card px-3 py-2 text-[9px] text-muted-foreground shadow-lg">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3 text-moss" /> Optional E2E-ready architecture
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="border-t border-border/70 bg-muted/20">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
            <Reveal>
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-saffron">Everywhere you think</div>
                <h2 className="mt-2 font-display text-3xl tracking-[-0.03em] md:text-4xl">
                  Web, installable, desktop, mobile.
                </h2>
              </div>
            </Reveal>
            <div className="flex flex-wrap gap-2">
              {[
                ["Browser", Monitor],
                ["PWA", Layers],
                ["macOS", Monitor],
                ["Windows", Monitor],
                ["Linux", Monitor],
                ["iOS", Smartphone],
                ["Android", Smartphone],
              ].map(([label, Icon], index) => (
                <Reveal key={String(label)} delay={index * 50}>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 py-1.5 text-[10px] text-muted-foreground transition-[border-color,color,transform] duration-200 hover:-translate-y-0.5 hover:border-saffron/40 hover:text-foreground">
                    <Icon className="size-3" />
                    {label as string}
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="relative isolate mx-auto max-w-6xl px-5 py-24 text-center">
        <div className="pointer-events-none absolute left-1/2 top-10 -z-10 h-72 w-[620px] max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--saffron)_14%,transparent),transparent_70%)] blur-3xl" />
        <Reveal>
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-card paper-shadow">
            <LatticeMark className="mark-live size-7" />
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
              className="group h-11 rounded-xl px-5 text-sm transition-transform hover:-translate-y-0.5"
              render={<Link href="/login?mode=signup" />}
            >
              Start your lattice{" "}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-11 rounded-xl px-5 text-sm transition-transform hover:-translate-y-0.5"
              render={<Link href="/app" />}
            >
              Open existing workspace
            </Button>
          </div>
          <div className="mt-10 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
            <LatticeLogo href={null} showWordmark={false} className="opacity-50" />
            <span>Built for people who refuse to let good ideas disappear.</span>
          </div>
        </Reveal>
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
