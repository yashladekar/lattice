# Brag Plan: Lattice

## What is this app?

Lattice is a local-first knowledge OS: a block editor, an infinite whiteboard, a typed knowledge graph, a capture inbox, and spaced-repetition learning that all read and write one knowledge model — with the device itself as the source of truth.

## The angle

Every productivity app asks you to pick a shape for a thought: write it, or draw it, or link it, or drill it. Lattice's actual claim is that those are not separate tools — **"Everything shares one knowledge model."** and a page, a whiteboard, a topic and a flashcard are "different views of the same idea. Nothing is copied to make a new view work."

So the video is that sentence, proven in twenty seconds. One small idea — a note called *Feedback loops* — goes into the editor, gets linked with `[[`, shows up as a node in the graph with a relation edge attached, lands on a whiteboard as a live card, and comes back as a flashcard you get right. Five surfaces, one object, no copy-paste, no cloud round-trip. The whole thing happens with the status bar reading `All changes local`.

The supporting claim stays quiet and in the chrome rather than in a caption: **"Your device is the source of truth."** is the app's own section heading, and it is truer bit-for-bit than any line we could write.

## Hook (first 2-3 seconds)

The product's own hero, at full scale on warm paper: **"Your ideas deserve / a place to connect."** — blurring in word by word, with *connect.* in Instrument Serif italic saffron and a hand-drawn underline that draws itself under it. Behind it, the real hero background: a hairline network of pastel dots with faint lowercase labels (`note`, `idea`, `question`). The promise lands, then the first cut answers it.

## Key moments (the middle)

- **The link menu opening mid-sentence.** The cursor types `[[` in the middle of a note and four real page names drop in. The moment a note stops being a page and becomes a node.
- **The graph growing an edge.** Node pills pop in one at a time on the beat (saffron pages, a moss topic), then the relation edge draws itself between *Systems thinking* and *Feedback loops* and the counter line ticks to `12 nodes · 9 edges · 2 orphans · 3 clusters`. Orphan count is a real product feature, and it is a lovely thing to admit in a launch video.
- **The whiteboard takes notes, not screenshots.** The same idea lands on the canvas as a live sticky plus a linked page card, wired up with a connector labelled `builds` and framed as `The review loop`.
- **The card flip.** The note comes back as a flashcard — *"Why does spacing beat cramming?"* — flips, and gets a click on **Good**. The loop closes: what you wrote is what you review.

## Outro / punchline

Clean warm stage, one line at full confidence: **"Everything shares one knowledge model."** — the project's own H2, and now literally demonstrated. Then the wordmark `lattice` lands with its real footer tagline, **"a local-first knowledge OS"**, with the status line `All changes local · No conflicts` still sitting under it.

## User flow worth showing

The real happy path in this product is not a landing page: it is **write → link → see the shape → use it**.

1. **Entry** — a note is open in the block editor (`Systems notes / Feedback loops`), being written.
2. **Key action** — typing `[[` links it to another page; that link is an edge, not a mention.
3. **Result** — the knowledge graph grows the node and the edge; the whiteboard arranges the same live objects; the learning deck turns the note into retrieval practice, and the review answers correctly.

The closing shot is the same workspace, unchanged, still local.

## Tone

- Preset: `default`
- Creative direction: warm paper, high-craft product film — quiet confidence, zero hype, the network of ideas is the hero
- Interpretation: mixed-case type, comfortable rhythm, no exclamation marks, no history-of-work language. Pacing is driven by fast motion and hard cuts between surfaces, never by flashing text. Six scenes rather than the preset's four or five, because the point of the film is the *number* of surfaces one object can wear — but no scene drops below 2.6s and every line holds long enough to read.

## Format: landscape — 1920x1080
## Duration: 20.0s

## Visual identity (from the project)

- Background: `#FCF9F2` (warm paper, `--background`)
- Panel / card: `#FFFFFF`; sidebar `#F7F3EB`; muted surface `#F3F0E9`
- Text: `#17130E` (`--foreground` / `--ink`); muted text `#6F685E`
- Accent: `#E57C20` (`--primary`), graph page node `#E07A2E`, `--saffron` `#CB7227`
- Secondary brand: moss `#33724C` (canvas/topic node `#2F6B4F`), sky `#1B8ABD`, lilac `#9970C4`, rose `#D06265`
- Sticky notes: `#FFDBA7`, `#B9E4C6`, `#B8E1FA`, `#E6D5FC`, `#FFD1D1`
- Hairlines: `#E2DDD5`
- Relation edge colours: related-to `#8C7659`, part-of `#4B8A63`, explains `#347EC4`, prerequisite-of `#0089A7`
- Display font: **Instrument Serif** 400 (normal + italic) — real `.woff2` pulled from the project's own build
- Body font: **Geist** variable 100–900; mono/chrome: **Geist Mono**
- Strongest visual element: the hero's hairline idea-network on warm paper, carrying straight into the app's own dot-grid surfaces (graph, canvas)

## Share copy (draft)

Lattice: a local-first knowledge OS. Write, draw, link, and learn in one workspace — a page, a whiteboard, a topic, and a flashcard are the same object wearing different lenses.

## Audio direction

- Role: warm bed with a small number of motion-matched accents
- Music: `happy-beats-business-moves-vol-11-by-ende-dot-app.mp3` (114.84 BPM, 87.6s) — warm and business-y, matches the paper/saffron temperament
- Music treatment: start at 0.0, volume ≈ 0.34, present but never the subject; a 0.35s fade-in so the first word isn't punched; fade out under the final logo lockup so the last beat is the wordmark, not the track
- Music cue guidance: bundled preset at `assets/music/cues/happy-beats-business-moves-vol-11-by-ende-dot-app.music-cues.json` (tempo 114.84, beat grid ≈ 0.53s spacing). Three strong-cue locks: hook line lands at **1.60s**, the graph's relation edge completes at **9.50s**, the wordmark lands at **17.91s**. Beat-grid windows for two sequences: the graph's node pops on **7.38 / 7.91 / 8.44 / 8.96**, the whiteboard's sticky notes on **10.54 / 11.06 / 11.60**. Everything else keeps its natural motion timing — the typing cadence must not snap to the grid.
- Audio-reactive treatment: subtle; use music RMS to breathe the saffron hero glow and the halo behind the graph's selected node. No waveform, equalizer or particle visuals, no text scaling
- SFX posture: sparse-to-moderate, motion-matched. One coherent palette: keyboard keypresses under typing, soft drops/paper placements for arrivals, one cleaner click for the review answer, one soft bell for the wordmark landing
- Audio-coupled moments: the `[[` typing (per-character keypresses, randomized across the set), `[[` menu dropping, node pills arriving, the edge drawing, sticky notes landing, the card flip, the cursor clicking **Good**, the logo landing
- Restraint rule: no sound under the two hero copy moments beyond the music bed; the film's two quietest seconds are the hook line and the outro line

## Storyboard

> **Final cut (20.54s).** The beats below are the plan; the shipped edit retimed scene boundaries onto the music's beat grid and gave the closing lockup a longer hold. Final scene windows: 0.00–3.18 · 3.18–6.34 · 6.34–10.01 · 10.01–12.65 · 12.65–15.81 · 15.81–20.54. See `composition-brief.md` for the shot-by-shot final timings.

### Scene 1 — Hook: "Your ideas deserve a place to connect." — 3.18s
Warm paper ground `#FCF9F2`, a soft saffron radial glow behind centre at ~20%, the hero's hairline idea-network faint but visible, with three small lowercase labels on nodes: `note`, `idea`, `question`. The real headline arrives on two lines, word by word, blurring in (`blur(6px)` → 0, 0.13s each, 0.067s apart, no translate). The final word *connect.* is Instrument Serif italic in saffron, and beneath it a hand-drawn underline stroke draws left to right, slightly overshooting the word the way a marker would.
Sequential/interaction: yes — per-word blur-in in reading order, then the underline draws.
Audio intent: open, unhurried, confident. This is the promise, not the product.
Audio-coupled idea: none. Let the music bed and the glow carry it — the hook's silence is what makes the next cut land.
Music: bed only, no SFX
Transition mood: hard cut at the beat → Scene 2

### Scene 2 — Write: the note gets a link — 3.68s
The real workspace, recreated from the product's own components: browser/app chrome with the top search bar `Search or ask` and its `⌘K` chip, a light sidebar (`Home`, `Inbox` with a `3` badge, `Knowledge graph`, `Learning`; section `NOTEBOOKS`, then the seed's real notebook names `Learning lab` and `Systems notes`), and the editor in the middle. Breadcrumb `Systems notes / Feedback loops`, page title `Feedback loops`, a body line already written, and a callout the seed actually uses. The window sits at ~1.18 scale and pushes in to ~1.32 as the action starts, so the typing stays legible. The cursor types — character by character — `See ` then `[[`, and the page-link menu drops in with the project's real seed page names: `Spaced repetition`, `Active recall`, `How memory works`, `Systems thinking`. A soft highlight moves down to `Systems thinking`. The status bar reads `All changes local`.
Sequential/interaction: yes — typing is simulated character by character, then the menu drops and the selection highlight moves one row.
Audio intent: concentrated, tactile, quiet. The sound of writing, not of software.
Audio-coupled idea: randomized `keyboard/keypress-*.wav` under the typed characters (thinned, not one per character); one soft `interface/drop_001` as the link menu appears; one `interface/select_008` as the row highlights.
Music: bed continues
Transition mood: hard cut with a matching push-in direction → Scene 3

### Scene 3 — Connect: the graph grows an edge — 3.68s
Cut to the knowledge graph full-frame on its dot grid. Node pills arrive one by one on the beat — `Feedback loops` (saffron `#E07A2E`), `Systems thinking` (saffron), the topic `Systems` (moss `#2F6B4F`), and `Spaced repetition` — each pill carrying a coloured kind dot, the title, and the `kind · notebook` subtitle the real view renders. Then the relation edge draws itself from `Systems thinking` to `Feedback loops`, arrowhead landing last, and the relation label appears on the highlighted edge. The bottom legend ticks up to `12 nodes · 9 edges · 2 orphans · 3 clusters`; the small minimap in the corner fills in as nodes land. No node is selected for long — the halo behind the freshest node breathes with the music.
Sequential/interaction: yes — four node pills arrive one at a time (beat grid), then the edge draws, then the legend counter ticks.
Audio intent: the idea acquiring structure. Satisfying, slightly mechanical, precise.
Audio-coupled idea: `casino/card-place-*` or `interface/drop_*` per node arrival on consecutive beats; one short `impact/impactPlate_light_*` as the edge completes at the strong cue; the counter ticks with `casino/chips-stack-*`.
Music: bed, with the edge landing locked to the 9.50s strong cue
Transition mood: clean slide → Scene 4

### Scene 4 — Draw: the same idea, spatially — 3.16s
The whiteboard `Learning map` on its dot grid, with the real title card and `Saved locally · N elements`. Two sticky notes land in the brand's sticky colours with the seed's own canvas text — `Retrieval beats re-reading…` (saffron) and `Space the sessions…` (moss) — followed by the two seed shapes `Practice` and `Long-term memory`. A connector draws between the shapes and takes its label `builds`, and a dashed frame labelled `The review loop` settles around the whole arrangement. A live page card for `Spaced repetition` sits on the canvas, updating from the note rather than holding a copy of it.
Sequential/interaction: yes — two stickies and two shapes land in sequence (beat grid), then the connector draws, then the frame closes.
Audio intent: hands on paper. Softer and warmer than the graph scene — different material, same idea.
Audio-coupled idea: `casino/card-slide-*` for the stickies landing; a light `impact/impactWood_light_*` as the frame closes.
Music: bed
Transition mood: hard cut → Scene 5

### Scene 5 — Learn: the note comes back — 2.64s
The learning view: header `Learning` with `Turn notes into retrieval practice. Remember what you chose to keep.` A single large flashcard sits centre — prompt `Why does spacing beat cramming?` — flips over to its answer, and the rating row `Again / Hard / Good / Easy` settles underneath. A cursor moves in and clicks **Good**; the button presses, a `review in 3d` chip appears, and the mastery bar behind the card advances a notch. This is the same note from scene two, now used instead of stored.
Sequential/interaction: yes — flip, then the rating row arrives, then a simulated click on `Good`.
Audio intent: the payoff. Small, quick, pleasurable.
Audio-coupled idea: one card-flip sound; `ui/mouseclick1` on the click; a short soft success accent (`impact/impactGlass_light_001`) under the `review in 3d` chip.
Music: bed
Transition mood: soft, short fade — the only soft seam in the film → Scene 6

### Scene 6 — Outro — 3.66s
Warm paper again, the hairline network returning quietly. One line, centred, at full confidence: **"Everything shares one knowledge model."** — Geist, heavy, the same voice the site uses for its section headings. It exits per word with a fast blur-out, and the lockup lands: the `lattice` wordmark with the four-node mark (`#E87F2F` orange, `#6F9C7D` moss, two cream nodes on the dark tile), and beneath it the real footer tagline `a local-first knowledge OS`. A thin status line stays at the bottom: `All changes local · No conflicts`.
Sequential/interaction: yes — headline in, headline out word by word, then the mark and wordmark land, then the tagline.
Audio intent: calm certainty. The film stops rather than ends.
Audio-coupled idea: one `impact/impactBell_heavy_000` as the wordmark lands, riding the 17.91s strong cue, allowed to ring over the music as it fades.
Music: bed fades out under the lockup
Transition mood: hold to end

**Music mood for this video:** warm, steady, quietly upbeat — a workshop, not a launch party
**Audio summary:** a warm 114 BPM bed carries a nearly unbroken run of five hard cuts between one idea's five appearances, with three strong-cue locks (hook line, graph edge, wordmark), two beat-grid sequences (graph nodes, canvas stickies), and only a handful of tactile, motion-matched accents — typing, cards, one click, one bell.

## Audio-reactive treatment (detail)

Subtle. Extract per-frame RMS via the `media-use` audio-reactive workflow and drive exactly three things: the saffron radial glow behind the hook and outro, the halo behind the graph's most recently arrived node, and the vignette warmth of the whiteboard's dot grid. Nothing else moves with the music. If extraction is unavailable, the composition renders fine without it and the brief notes the failure.
