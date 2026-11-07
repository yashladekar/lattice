# Hyperframes Composition Brief: Lattice

## Objective
Create a short launch-style brag video for **Lattice**, a local-first knowledge OS. The film proves one sentence: *everything shares one knowledge model.* A single note is written, linked, seen as a graph edge, placed on a whiteboard, and reviewed as a flashcard — five surfaces, one object, all local.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30 fps
- Duration: 20.54 seconds (hard — the root `data-duration` is 20.54)

## Source Material
- Project root: `/Users/yashladekar/yash/side-income/notes-learning`
- Primary files read: `README.md`, `apps/web/src/app/page.tsx`, `apps/web/src/components/marketing/*`, `apps/web/src/views/{home,graph,canvas,learn,inbox}-view.tsx`, `apps/web/src/components/editor/page-editor.tsx`, `apps/web/src/components/workspace/{command-palette,workspace-shell}.tsx`, `packages/domain/src/graph.ts`, `packages/db/prisma/seed.ts`, `packages/ui/src/styles/globals.css`, `apps/web/src/index.css`
- Product name: **Lattice**
- Tagline / strongest claim: "Your ideas deserve a place to connect." / "Everything shares one knowledge model."
- Key UI or visual moment to recreate: the workspace itself — editor with a `[[` page-link menu, the force-laid knowledge graph with relation edges and its legend counter, the `Learning map` whiteboard, and the flashcard review with its Again/Hard/Good/Easy row
- Copy that must appear verbatim:
  - `Your ideas deserve` / `a place to connect.` (hero, *connect.* in Instrument Serif italic saffron with a hand-drawn underline)
  - `Search or ask`, `⌘K`, `Home`, `Inbox`, `Knowledge graph`, `Learning`, `NOTEBOOKS`, `Learning lab`, `Systems notes`
  - `Systems notes / Feedback loops` (breadcrumb + page title)
  - `Spaced repetition`, `Active recall`, `How memory works`, `Systems thinking` (the `[[` menu's real seed pages)
  - `12 nodes · 9 edges · 2 orphans · 3 clusters` (graph legend counter line)
  - `Learning map`, `Saved locally · N elements`, `Retrieval beats re-reading…`, `Space the sessions…`, `Practice`, `Long-term memory`, `builds`, `The review loop`
  - `Learning`, `Turn notes into retrieval practice. Remember what you chose to keep.`, `Why does spacing beat cramming?`, `Again`, `Hard`, `Good`, `Easy`, `review in 3d`
  - `All changes local`, `No conflicts`
  - `Everything shares one knowledge model.`
  - `lattice` wordmark + `a local-first knowledge OS`

## Creative Direction
- Tone preset: `default`
- Creative direction: warm paper, high-craft product film — quiet confidence, zero hype, the network of ideas is the hero
- Interpretation: mixed-case, comfortable rhythm, no exclamation marks, no history-of-work language. Pace comes from fast motion and hard cuts between surfaces, never from flashing text. Six scenes in 20s; no scene under 2.6s; every line a viewer must read holds long enough to read it (short label ~0.8s settled; sentence ~0.3s per word).
- Angle: every productivity app makes you pick a shape for a thought — write it, draw it, link it, or drill it. Lattice's claim is that these are one object wearing five lenses, and the film demonstrates it rather than asserting it.
- Hook: the product's own hero at full scale on warm paper, words blurring in, with *connect.* in serif italic and a hand-drawn underline that draws itself.
- Outro / punchline: `Everything shares one knowledge model.` → `lattice` wordmark → `a local-first knowledge OS`, with `All changes local · No conflicts` still in the chrome.
- Avoid:
  - Generic SaaS language (nothing the project does not say)
  - Abstract filler visuals, waveform/equalizer graphics, particle fields
  - Unrelated visual redesign: this is the project's own palette, its own fonts, its own copy

## Visual Identity
- Background: `#FCF9F2` (warm paper). Panels `#FFFFFF`, sidebar `#F7F3EB`, muted `#F3F0E9`
- Text: `#17130E`; muted text `#6F685E`; hairlines `#E2DDD5`
- Accent: `#E57C20` primary, `#E07A2E` graph page node, `#CB7227` saffron
- Secondary: moss `#33724C` / `#2F6B4F`, sky `#1B8ABD`, lilac `#9970C4`, rose `#D06265`
- Sticky notes: `#FFDBA7`, `#B9E4C6`, `#B8E1FA`, `#E6D5FC`, `#FFD1D1`
- Relation edges: related-to `#8C7659`, part-of `#4B8A63`, explains `#347EC4`, prerequisite-of `#0089A7`
- Display font: **Instrument Serif 400** (normal + italic) — real font files copied into `assets/fonts/`
- Body font: **Geist** variable 100–900; chrome/mono: **Geist Mono** — also copied into `assets/fonts/`
- Font files already in place (declare `@font-face`, do not rely on bundled names):
  - `assets/fonts/geist-latin.woff2` (weight `100 900`)
  - `assets/fonts/geist-mono-latin.woff2` (weight `100 900`)
  - `assets/fonts/instrument-serif.woff2` (400 normal)
  - `assets/fonts/instrument-serif-italic.woff2` (400 italic)
- LOOK: warm paper `#FCF9F2` ground; a saffron `#E57C20` radial glow at 15–24% behind the hero and outro only; ink `#17130E`; Geist variable for all UI at real app weights, Instrument Serif 400 italic reserved for *connect.* and the wordmark; 1.5px hairlines in `#E2DDD5`; white cards at 12–16px radius with a 6%-ink shadow; dot grids at 24px spacing in ~8% ink for the graph and canvas surfaces; node pills 260x72 with a 12px kind dot; arrivals 0.3–0.6s on `power4.out`/`expo.out` long tails, word entrances as `blur(6px)`→0 in 0.13s; BANNED — purple-blue gradients, glassmorphism, sub-10% accent washes, breathing/pulsing idle loops, centered text sliding up on every scene
- Visual references from the project: the hero's hairline idea-network with faint `note` / `idea` / `question` labels; the dot-grid graph and canvas surfaces; the saffron italic + hand-drawn underline; the four-node brand mark; sticky-note colour set

## Storyboard
Use `brag-output/brag-plan.md` as the creative contract. Scene boundaries are chosen to sit on the music's beat grid.

Scene summary (final cut — boundaries chosen on the music's beat grid):
1. **Hook** — 0.00–3.18s — hero headline, word-by-word blur-in; *connect.* in serif italic saffron with a self-drawing underline on the 1.60s strong cue; hairline idea-network on warm paper
2. **Write** — 3.18–6.34s — the workspace: sidebar, editor, breadcrumb `Systems notes / Feedback loops`; cursor types `See [[`; link menu drops with real seed page names under the `PAGES` group; selection moves to `Systems thinking`; the row zooms through into the next scene; status `All changes local · No conflicts`
3. **Connect** — 6.34–10.01s — full-frame knowledge graph; node pills arrive on the beat (6.86 / 7.38 / 7.91 / 8.44); the typed relation edge draws and completes on the 9.50s strong cue; `Prerequisite of` label; legend `12 nodes · 9 edges · 2 orphans · 3 clusters`; minimap
4. **Draw** — 10.01–12.65s — `Learning map` whiteboard inside the existing `The review loop` frame; two stickies and the seed shapes land on beats; connector labelled `builds`; live page card `Spaced repetition`
5. **Learn** — 12.65–15.81s — flashcard `Why does spacing beat cramming?` flips to `Retrieval beats re-reading.`; rating row settles; cursor clicks **Good** on the 15.28s beat; mastery advances
6. **Outro** — 15.81–20.54s — `Everything shares one knowledge model.` in and out word by word; `lattice` lockup lands on the 17.91s strong cue with the bell; `a local-first knowledge OS`; `All changes local · No conflicts`

## Audio
- Audio role: warm bed with a small number of motion-matched accents
- Audio arc: steady from 0.0, three strong-cue locks (hook 1.60s, graph edge 9.50s, wordmark 17.91s), a soft seam only before the outro, fade out under the lockup
- Music: `assets/music/happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` — 87.6s, 114.84 BPM
- Music treatment: single `<audio>`, volume ≈ 0.34, 0.35s `data-fade-in`, `data-fade-out` over the last ≈ 1.4s so the final beat is the wordmark. Never above 0.5
- Music cue guidance: bundled preset at `~/.commandcode/skills/brag/assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json` — `strongCues` at 1.60 / 3.70 / 5.80 / 6.34 / 8.96 / **9.50** / 12.65 / **17.91** / 22.65, beat grid ≈ 0.53s apart (1.60, 2.12, 2.65, 3.18, 3.70, 4.23, 4.75, 5.28, 5.80, 6.34, 6.86, 7.38, 7.91, 8.44, 8.96, 9.50, 10.01, 10.54, 11.06, 11.60, 12.12, 12.65, 13.18, 13.70, 14.22, 14.76, 15.28, 15.81, 16.34, 16.86, 17.39, 17.91, 18.44, 18.96, 19.49)
  - Strong-cue locks (3): hook line land ≈ **1.60**, graph relation edge completes ≈ **9.50**, wordmark lands ≈ **17.91** — mark each `// beat-locked`
  - Beat-grid sequences: graph node pops **7.38 / 7.91 / 8.44 / 8.96**; canvas stickies **10.54 / 11.06 / 11.60** — mark each `// beat-grid`
  - Typing keypresses must NOT snap to the grid; character cadence should feel like a person
  - Cues are hints only and lose to readability, scene pacing and the product story
- Audio-reactive treatment: subtle; use per-frame RMS from the `media-use` audio-reactive workflow to breathe the saffron hero/outro glow, the halo behind the graph's newest node, and the canvas dot-grid warmth. No waveform, equalizer, note or particle visuals; no strobing. If extraction is unavailable, note it in the composition and continue
- Audio-coupled moments:
  - Scene 2 — typed characters (randomized `keyboard/keypress-*.wav`, thinned), `interface/drop_001` as the link menu appears, `interface/select_008` as the row highlights
  - Scene 3 — `casino/card-place-*` or `interface/drop_*` per node arrival, a short plate/metal accent as the edge completes, `casino/chips-stack-*` ticks on the counter
  - Scene 4 — `casino/card-slide-*` for stickies, `impactWood_light_*` as the frame closes
  - Scene 5 — one flip, `ui/mouseclick1` on **Good**, a soft `impactGlass_light_*` under `review in 3d`
  - Scene 6 — one `impactBell_heavy_000` as the wordmark lands, ringing over the fading bed
- SFX selection guidance: motion-matched and sparse. Prefer low/medium high-frequency-risk files for anything repeated (typing, node pops, counters). No sound beyond the music bed under the hook line and the outro line. SFX fire at the first visible frame of the animation they support
- SFX analysis guidance: `~/.commandcode/skills/brag/assets/sfx/sfx-analysis.md` and `.json`
- Exact SFX choice: choose filenames, timestamps, density and volume after the animation exists
- Level policy: SFX 0.55–0.75, softer for the bell-adjacent moments; copy chosen files into `assets/sfx/<family>/` and reference them as `assets/sfx/...` (relative, no leading slash)
- Audio files already in the project: the music above; fonts as listed. Copy SFX in as selected

## Hyperframes Instructions
Load the composition-building Hyperframes skills — `hyperframes` (composition contract + `data-*` timing, `references/format.md`; motion, eases and seek-safe keyframes in `references/motion.md`; look in `references/look.md`), `hyperframes-registry` (ready-made effects, transitions, titles), `media-use` (music, SFX, audio-reactive data), and `hyperframes-cli` (lint/check/render). The skills ship inside the installed package at `~/.npm/_npx/702923228c2ce1e6/node_modules/hyperframes/dist/skills/` (version 0.9.20) — resolve them there if they are not registered as standalone skills.

/brag is its own workflow: skip the `hyperframes` storyline step — don't read `references/types/*` or `references/story.md`, don't propose storylines, and don't write a `SPEC.md`. This brief plus `brag-plan.md` replace them, including the LOOK line `references/look.md` asks for. Also skip its `usage`, `history`, `feedback` and REVIEW.md steps; `check` is brag's gate. Do not route into its generic launch-video workflow.

Requirements:
- Show at least one real UI, copy, or visual element from the source project — this film recreates four of the product's own screens with its real copy.
- Keep all text readable in the final render. Recreate the UI at a scale where the words that matter are legible (window ≈ 1.18→1.32 scale in scene 2; oversized pills, stickies and cards elsewhere).
- Keep the video at 20.0 seconds; scene boundaries at 3.18 / 6.86 / 10.54 / 13.70 / 16.34.
- Include the planned music/SFX layer.
- Treat the audio notes above as guidance, not a fixed cue sheet. Choose SFX after the visual animation exists.
- Treat music cue metadata as optional timing hints; ignore cues that hurt readability or pacing. Only the three strong-cue locks and the two beat-grid sequences should be forced.
- Use local assets. Fonts and music are already in `assets/`; no network fetches at runtime.
- Run `npx hyperframes check` before render — it is brag's single gate.
- Keep creation and rendering local.

## Self-review checklist (for the composer)
- [ ] Root `data-duration` is exactly 20; the last clip ends at or before 20.
- [ ] Six scene files under `compositions/`, ids matching their hosts and timeline keys.
- [ ] Every frame-0 state is set inside `fromTo`, never CSS `transform` or `from`.
- [ ] Scene 2's typing is character-by-character and does not snap to the beat grid.
- [ ] Three `// beat-locked` comments and two `// beat-grid` comments exist and match the timings above.
- [ ] Music is one `<audio>` at ≈0.34 with fade-in/out; every overlapping SFX has its own ascending `data-track-index`.
- [ ] At most three visual properties respond to audio RMS.
- [ ] Every on-screen string appears verbatim in the plan's copy list above.
- [ ] `npx hyperframes check` passes with zero errors.
