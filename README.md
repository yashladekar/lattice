# Lattice

**A local-first knowledge OS for people who think in connections.**

Lattice combines a block editor, infinite whiteboard, typed knowledge graph, capture inbox, spaced-repetition learning, and optional AI into one workspace with a single knowledge model. It runs on the web, installs as a PWA, packages as a Tauri desktop app, and ships with an Expo mobile companion.

The repository/package names remain `notes-learning` from the original scaffold; the product is **Lattice**.

## What is implemented

- **Multi-tenant workspaces** — personal workspaces, organizations, invites, nested notebooks/pages, roles, visibility, resource permissions, audit log.
- **Block editor** — TipTap 3 with slash menu, `@` mentions, `[[` page links, drag handle with block actions (duplicate, turn into, delete, copy block link), bubble formatting, callouts, tasks, tables, code, math, Mermaid diagrams, media embeds, page embeds, synced blocks, database block, comments, versions, favorites, templates, Markdown mode, focus mode.
- **Infinite whiteboard** — pan/zoom, sticky notes, shapes, text, pen, interactive connectors (labels, styles, arrows), frames that move their contents, image upload/drag-drop, linked live note cards, nested canvases, grouping/alignment/layers, undo/redo, templates, outline generators (mind map, flowchart, concept map), server-backed snapshots, presentation, SVG/PNG/PDF export.
- **Knowledge graph** — automatic page-link and canvas-link edges, typed manual relations, custom topics, force layout, filters by notebook/tag/kind/relation/recency, cluster coloring, local neighborhood view, minimap, temporal playback, orphan detection, node side panel, natural-language graph questions answered locally, dashed AI suggestions with AI provenance on accept, shareable public graph.
- **Local-first storage & sync** — per-user IndexedDB, outbox, versioned server change log, tombstones, idempotent pushes, revision-aware document conflicts, snapshot repair, sync status, full JSON export/import.
- **Capture inbox** — quick capture, links, uploads, URL preview, capture-to-page, email ingestion through an inbound webhook, and tag/related-note suggestions you approve before they apply. Includes a PWA share target and an MV3 browser extension in `extensions/lattice-clip`.
- **Learning** — generated/manual flashcards, SM-2 review, quizzes, mastery, learning paths, knowledge gaps, daily due queue, opt-in due-card reminders.
- **Optional AI** — OpenAI-compatible provider when configured; retrieval + citations + local fallback otherwise. Summarize, explain, compare, examples, connections, cards, mind map, and outdated-page review, all previewed before apply.
- **Navigation** — dashboard with configurable widgets, command palette (`⌘/Ctrl+K`), search with tag/type/notebook filters, tabs with a split pane, keyboard shortcuts, timeline, trash, first-run checklist.
- **Import & export** — full workspace JSON export/import, per-page Markdown, one-way GitHub Markdown import, two-way Git sync with an optional schedule, and an Obsidian-style Markdown vault export that round-trips through the vault importer.
- **Collaboration** — comments with a mention picker, notifications, presence heartbeat, async multi-device sync, public read-only sharing, page/notebook visibility controls, device list with revocation.
- **Platforms** — web/PWA (with an update prompt), Tauri desktop config that opens external links in the OS browser, Expo companion for capture/browse/search/review with an offline query cache.
- **Self-hosting** — Docker Compose, runtime web config, hashed share/invite tokens, rate limiting, authenticated uploads, workspace-chosen trash retention with a scheduled server purge.

## Stack

| Layer | Choice |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Web / PWA / desktop | Next.js 16 static export + Tauri 2 |
| Mobile | Expo + Expo Router + HeroUI Native + Uniwind |
| API | Express 5 + oRPC |
| Database | PostgreSQL + Prisma 7 |
| Auth | Better Auth |
| Editor | TipTap 3 |
| Local storage | Dexie / IndexedDB |
| Docs | Fumadocs |
| Payments | Polar (opt-in) |

## Quick start

Requirements: Node 26+, pnpm 12+, Docker.

```bash
pnpm install
pnpm db:start        # Postgres on localhost:5434
pnpm db:generate
pnpm db:push
pnpm dev             # web: 3101 · API: 3100 · docs: 4000
```

Open:

- Web workspace: <http://localhost:3101>
- API health: <http://localhost:3100>
- Documentation: <http://localhost:4000/docs>

The scaffold's original ports were moved:

| Service | Port |
| --- | --- |
| Web | 3101 |
| API | 3100 |
| Postgres (host) | 5434 |
| Docs | 4000 |
| Expo dev server | 8081 |

### Environment

`apps/server/.env`:

```dotenv
NODE_ENV=development
BETTER_AUTH_SECRET=...
BETTER_AUTH_URL=http://localhost:3100
CORS_ORIGIN=http://localhost:3101
DATABASE_URL=postgresql://postgres:password@localhost:5434/notes-learning
POLAR_ACCESS_TOKEN=
POLAR_SUCCESS_URL=http://localhost:3101/success?checkout_id={CHECKOUT_ID}
# POLAR_ENABLED=true
```

**Payments are opt-in.** Polar is only enabled when `POLAR_ENABLED=true` and a valid token is present, so a stale billing credential cannot block signup.

**AI is optional.** Add:

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=...
AI_MODEL=gpt-4.1-mini
```

Without a key, Ask Lattice uses local retrieval and labeled citations.

## Architecture

```text
apps/web            Next static SPA + Tauri + PWA       full product
apps/native         Expo companion                       capture / read / review
apps/server         Express + oRPC host, uploads
apps/fumadocs       product & architecture docs
extensions          browser capture extension (MV3)
packages/domain     shared types, Zod, graph, learning, editor, canvas, search
packages/db         Prisma schema + generated client
packages/api        routers, authorization, sync engine, AI retrieval
packages/auth       Better Auth
packages/ui         shared UI primitives + design tokens
```

### One knowledge model

Pages, canvases, topics, relations, captures, cards, and learning logs are first-class records. Views are lenses:

- **Explorer** — tree navigation.
- **Editor** — document blocks.
- **Canvas** — spatial arrangement of references.
- **Graph** — relation topology.
- **Database** — structured block views.
- **Timeline** — activity chronology.
- **Learn** — retrieval schedule over source notes.

Page documents and canvases are stored separately from metadata and carry `schemaVersion` + `rev`. Page/canvas revisions drive explicit conflict handling.

### Local-first sync

Writes go to IndexedDB first, then queue an op. The server applies ops in a transaction, increments a per-workspace `syncVersion`, and appends a change-log row per entity. Clients pull with a composite `(version, id)` cursor. Deletes are soft deletes and appear as tombstones. Duplicate pushes are safe through `opId` idempotency. Document `baseRev` mismatches create a version snapshot and a conflict record; the client keeps its local copy and shows a compare/choose dialog.

See [`docs`](./apps/fumadocs/content/docs/local-first-sync.mdx) for the full protocol.

### Workspace access

Roles: `OWNER > ADMIN > MEMBER > EDITOR > VIEWER > GUEST`.

Workspace-scoped procedures verify membership server-side from the session plus `x-workspace-id`. Pull/snapshot filter private pages and dependent graph/comments/attachments for non-creators. Public share links store only token hashes, enforce expiry/revocation, and strip outbound links to unshared pages.

## Platforms

### Desktop (Tauri)

```bash
pnpm --filter web desktop:dev
pnpm --filter web desktop:build
```

The static export is loaded by Tauri. `apps/web/public/config.js` can point the desktop bundle at a self-hosted API without rebuilding.

### Mobile (Expo)

```bash
pnpm --filter native dev
pnpm --filter native ios
pnpm --filter native android
```

The mobile app supports sign-in, workspace switching, recent pages, notebook browse, page reading, quick capture, search, and due-card review. Deep editing and the whiteboard remain web/desktop-first.

### PWA

Production builds register `public/sw.js`: app-shell precache, network-first navigation, cache-first hashed assets, and no caching of `/rpc`, `/api/auth`, or uploads. The manifest includes a share target for capture.

## Commands

```bash
pnpm dev                 # all apps
pnpm dev:web             # web only
pnpm dev:server          # API only
pnpm dev:native          # Expo
pnpm build               # all builds
pnpm check-types         # TypeScript across packages
pnpm test                # domain unit tests
pnpm db:start|stop|down  # Postgres lifecycle
pnpm db:push|generate|migrate|studio
pnpm db:seed             # demo workspace for local dev (--reset to rebuild)
pnpm docker:build|up|down|logs
```

## Verification

```bash
pnpm db:start
pnpm db:generate
pnpm db:push
pnpm db:seed            # optional demo workspace
pnpm --filter @notes-learning/domain test
pnpm check-types
pnpm --filter web build
pnpm --filter server build
pnpm --filter fumadocs build
pnpm --filter native check-types
```

The production build prerenders `/`, `/app`, `/login`, `/invite`, `/share`, `/success`, and the manifest.

## Scope boundaries

This pass is a complete core vertical, not every enterprise subsystem in the original brief. Explicitly deferred:

- CRDT/live co-editing and live cursors (async sync + comments/presence are implemented).
- End-to-end encryption, SSO/SCIM, legal hold.
- App-store signing and native full editor/whiteboard parity.
- Plugin sandbox/runtime, custom object-type editor, automation builder.
- Email ingestion, speech-to-text, two-way Git sync (one-way GitHub Markdown import is implemented), and an executable SQL console.

Those interfaces are modeled/documented in the [roadmap](./apps/fumadocs/content/docs/roadmap.mdx) rather than pretended as complete.

## Documentation

- [Architecture](apps/fumadocs/content/docs/architecture.mdx)
- [Sync protocol](apps/fumadocs/content/docs/local-first-sync.mdx)
- [Editor](apps/fumadocs/content/docs/editor.mdx)
- [Whiteboard](apps/fumadocs/content/docs/whiteboard.mdx)
- [Knowledge graph](apps/fumadocs/content/docs/knowledge-graph.mdx)
- [Learning](apps/fumadocs/content/docs/learning.mdx)
- [Intelligence](apps/fumadocs/content/docs/intelligence.mdx)
- [Security](apps/fumadocs/content/docs/security.mdx)
- [Roadmap](apps/fumadocs/content/docs/roadmap.mdx)

Run the docs app with `pnpm --filter fumadocs dev`.
