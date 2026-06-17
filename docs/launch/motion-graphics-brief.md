# Motion Graphics Brief — Sipcode

**Date locked:** 2026-06-15
**For:** Launch hero / brand reel
**Status:** Final. Ready to paste into Veo / Sora / Runway, or hand to a motion designer.

---

## 1. Product

- **Name:** Sipcode
- **One-liner:** A free npm CLI that keeps Claude Code's context clean for sharper answers and lower cost.
- **URL:** https://anuj7411.github.io/sipcode/
- **Audience:** Indie and senior devs who use Claude Code Max, burn through their plan in hours, and care about answer quality and reliability (not just token savings).
- **Brand assets:**
  - **Logo / wordmark:** split form — `sip` in ink black, `code` in violet
  - **Mascot:** a round vessel character with three emotional states (GULP / NEUTRAL / SIP). Plays an emotional arc when it drains.
  - **Primary colors:** paper `#F8F8F6` (background), ink `#0A0A0A` (text), violet `#5B4FCF` (sole accent — liquid, wordmark, install pill)
  - **Secondary:** ochre `#B9831B` (signature marks, diamond ticks), status green `#28C840` (only on the "tests passing" dot), charcoal `#2D3142` (sub-text)
  - **Stressed liquid (GULP only):** `#9a93b8`
  - **Type:** Space Grotesk 600 (display, letter-spacing −0.035em), Inter 400/500 (body), JetBrains Mono (mono accents)

## 2. Format

- **Goal:** Launch hero / brand reel — the single video that circulates everywhere
- **Duration:** 45 seconds
- **Aspect ratio:** 16:9 master at 3840×2160 (4K), 60fps. Same MP4 cropped per platform; no separate cutdowns produced.
- **CTA (verbatim):** install pill `npm i -g sipcode` + `anuj7411.github.io/sipcode` in mono below

## 3. Visual direction

- **Vibe:** Minimal & editorial. Instrumentation-grade, paper-bg restraint, calm camera moves, held frames over big motion.
- **Color strategy:** Brand-locked palette only. Paper `#F8F8F6` as background, violet `#5B4FCF` as the sole accent, ochre `#B9831B` as signature mark, status green `#28C840` only on the tests dot.
- **References:**
  - Vercel Geist's restraint (https://vercel.com/geist)
  - Linear's calm dolly + product-as-hero (https://linear.app/now/behind-the-latest-design-refresh)
  - Raycast's window-is-the-brand
  - Stripe Sessions' continuous-material flow
  - Anthropic's quiet, academic confidence
- **Avoid:** purple/blue radial gradients, Lottie linear easing, stock whoosh on cuts, narrator VO, logo at frame 1, em-dashes on screen, "stops hallucinations" claim, hype verbs (revolutionize / supercharge / transform / disrupt), exclamation marks, floating 3D laptops, sparkle / fire / rocket emoji.

## 4. Story content

- **Must communicate (in order):**
  1. Context rot is real, quantifiable, visible. Cold open + GULP vessel.
  2. Sipcode drains it. 62.6% measured median, from your own transcripts. Drain + stat row.
  3. One line installs it. MIT, 15 MCP tools, 1,317 tests. Install pill + close card.
- **Headline copy (verbatim):**
  ```
  Sip your tokens.
  Don't gulp them.
  ```
  (Word "gulp" muted to `rgba(10,10,10,0.34)` with a violet `−1.5°` strike-through bar drawn across it.)
- **Sub copy (verbatim):**
  ```
  Keep Claude Code's context clean for sharper answers
  and lower cost, automatically.
  ```
- **Proof points to keep on-screen:**
  - `62.6%` median tokens saved (locked corpus, range `37.4%-80.6%`)
  - `+29%` quality lift cited from Anthropic (third-party authority, never claimed as ours)
  - `15` MCP tools available for Claude Desktop
  - `1,317 tests` shown in close card only
- **Featured logos:** none. Pre-launch, no customer logos.
- **Terminal screens to hero (panel parallax shot):**
  - `sipcode proxy --stats` — per-rewriter table with `integrity-kept` column
  - `sipcode drift` — the "no drift" success state with the green tick
  - `sipcode benchmark` — `62.6% median savings · 3,567,170 tokens · $67.43`
  - `sipcode forecast` — month-end projection card

## 5. Audio

- **Music mood:** Sipcode-specific hybrid. Soft piano notes for warmth (matches the paper background, distinct from pure ambient), subtle sub-pad underneath as texture, plucks on each UI element appearance (Linear's precision pattern), one small swell on the drain moment when GULP → SIP, gentle resolution on the wordmark close. DNA: warm precision with one moment of release.
- **Voiceover:** No. Devtool launches (Cursor, Linear, Vercel, Raycast, Anthropic) consistently opt out of narration. VO reads as marketing; silence + score reads as "for builders."
- **SFX notes:** plucks only, on UI element appearances. No stock whoosh on cuts. No mechanical-keyboard cliché. Sound serves the shot, not vice versa.

## 6. Constraints

- **Deadline:** Same day as public launch (Path A this week vs Path B in ~7 days — not yet decided). Video must be ready before launch day.
- **Distribution:**
  - YouTube (full scored)
  - X / Twitter (native video, scored)
  - Instagram (cropped to 9:16 for Reels)
  - Product Hunt (launch-day native video)
  - Indie Hackers (post embed)
  - LinkedIn (scored)
  - Sipcode landing page hero (autoplay loop, muted)
  - **NOT Reddit** (banned-account risk per locked positioning memo)
- **Stock content OK?** No. Pure motion graphics + vessel mascot + real terminal output captured from Anuj's own sessions.
- **Required legal text:** Close card includes one mono row: `v1.6.15 · MIT licensed · 1,317 tests passing`. This is a credibility signal, not a legal disclaimer.
- **Disclaimers / ™ / ®:** None. Sipcode is MIT open source; no trademarks.

## 7. Open items (to be decided by builder)

- Exact piano motif for the swell moment on the drain (composer's call)
- Whether the vessel's blink frequency in NEUTRAL state needs slight tuning to fit the 45s pacing
- Final positioning of the violet strike-through bar across "gulp" — pixel-perfect angle and thickness
- Whether terminal panel parallax tilt should be 10° or 12° (Linear sits at 12°; we can match)
- Whether shot 04.0 → 07.5 holds the mono counter for 4.5s or 3.5s — depends on score pacing

## 8. Suggested mood-board search terms

Paste any of these into Pinterest, Behance, Dribbble, Vimeo, or LottieFiles to pull strong references quickly:

- "Linear app product launch trailer 2026"
- "Vercel Geist kinetic typography reveal"
- "Anthropic Claude Code calm UI motion design"
- "Raycast window product hero shot editorial dark"
- "Editorial dev tool launch video warm paper background"
- "JetBrains Mono terminal motion graphic minimalist"
- "SVG vessel character liquid drain animation cubic ease"
- "Stripe Sessions intro continuous metallic ribbon flow"

---

# Appendix A — Visual tokens block (paste into any prompt)

```
Background paper:    #F8F8F6      (body shows through at #EFEEEA seams)
Ink:                 #0A0A0A
Brand violet:        #5B4FCF      (sole accent — liquid, "code" wordmark,
                                   plot curve, install pill, strike-through)
Violet stressed:     #9a93b8      (only inside GULP-state vessel)
Ochre signature:     #B9831B      (10×10 rotated diamond, segment ticks)
Status green:        #28C840      (only the "tests passing" dot, once)
Charcoal:            #2D3142      (secondary text)

Display type:        Space Grotesk 600, letter-spacing -0.035em,
                     line-height 1.02
Body type:           Inter, 400/500
Mono type:           JetBrains Mono, eyebrows UPPERCASE 12px / 0.16em tracking

Grid texture:        48×48px, rgba(45,49,66,0.05), radial-masked
                     top-right fade
Plot curve:          rgba(91,79,207,0.26) stroke 2px,
                     area fill rgba(91,79,207,0.05)
Corner reticles:     L-shape 14×14px, 1.5px ink, 44px inset from corners
Tick column:         left edge, 26px wide, every 40px,
                     every 5th tick 14px wide

Easing:              ease-out-cubic for drains; spring(280, 22) for
                     chip pops; NO linear easing anywhere
Frame rate:          60fps (NOT lo-fi — Sipcode is instrumentation,
                     not stationery)
```

---

# Appendix B — 12-shot breakdown (the actual film, second-by-second)

| # | Time | What's on frame | Sound |
|---|---|---|---|
| 1 | 00.0 → 03.0 | **Black frame.** Plot grid fades in at 0.4 opacity. Mono in lower-left: `0%  context  used`. Cursor blinks. **No logo, no headline.** | Low sub-pad fades in |
| 2 | 03.0 → 07.5 | Mono counter ticks up: `12% → 34% → 58% → 81% → 94%`. Ochre `#B9831B` diamond appears at 81%. Grid lines drift up. | Soft pluck on each tick |
| 3 | 07.5 → 10.0 | Background snaps to paper. Camera dollies in 6%. **GULP vessel** centered: stressed liquid `#9a93b8`, angled-down brows, oval eyes, blue sweat droplet `#5B8DEF`, two violet drips. Bubble pops in: `"Bloated. I'm losing the thread of your task."` | Pluck on bubble pop |
| 4 | 10.0 → 14.0 | **Bug-story diptych.** Left: `drift   624,940 tokens wasted`. Right: `proxy   ~7,553 tokens saved`. Centered Space Grotesk `50×` with a violet `−1.5°` slash through the gap. | First piano note enters |
| 5 | 14.0 → 16.5 | **Terminal still** on paper. JetBrains Mono. The 4 files we fixed for v1.6.14, typed in at 180ms each. Violet caret blinks. | Mechanical key on each character (sparse) |
| 6 | 16.5 → 19.5 | **Cut back to vessel.** 380ms beat. Then 960ms ease-out-cubic drain: liquid recedes, swaps `#9a93b8 → #5B4FCF`. Face floats up scale 1.06, swaps GULP → HAPPY with violet sparkles. Bubble re-pops: `"Clean context. Sharp answers."` | **One small piano swell** as the drain runs |
| 7 | 19.5 → 22.0 | Camera pulls back 12%. Three mono chips drift in: `git diff −94%`, `cache reuse 90%`, `−2,400 tok`. | Pluck on the three chips |
| 8 | 22.0 → 26.0 | **Cut to headline poster.** Paper bg. Grid + tick column + corner reticles. Headline draws in glyph-by-glyph (18ms stagger). Word `gulp` is muted; violet `−1.5°` bar slashes through over 240ms. Sub appears. | Piano holds, sub-pad sustains |
| 9 | 26.0 → 30.0 | **Stat row.** Four cells, JetBrains Mono: `62.6%` / `15` / `0` / `MIT`. Each cell appears with 120ms stagger. | Pluck on each cell |
| 10 | 30.0 → 34.0 | **Anthropic citation tile.** Ochre diamond above. `Anthropic published: cleaner context gives +29% quality lift and 40% fewer agent errors.` Below in mono 75% opacity: `Sipcode operationalizes that for Claude Code.` | Sub-pad only, very quiet |
| 11 | 34.0 → 40.0 | **Product-UI hero shot.** Four terminal panels (proxy --stats, drift, benchmark, forecast) tilted **12° in 3D**, lit from above-left, parallaxing as camera dollies right at 0.6%/frame. | One pad swell across the shot |
| 12 | 40.0 → 45.0 | **Install pill** types in over 600ms. Below in 12px mono: `v1.6.15 · 1,317 tests passing · MIT`. Last 1.0s: wordmark — `sip` in ink + `code` in violet, Space Grotesk 600, 64px. Cut to black. | Gentle resolution, sub-pad releases |

---

# Appendix C — Anti-checklist (what this brief refuses)

| ✗ | Why |
|---|---|
| Logo at frame 1 | The good launches earn the logo 20-40s in. Vercel, Linear, Stripe all wait. |
| Narrator voiceover | All five devtool refs (Cursor, Linear, Vercel, Raycast, Anthropic) opt out of VO. |
| Purple/blue radial gradient mesh | The AI-slop tell. Our plot grid is the texture. |
| Linear-in / linear-out Lottie easing | Reads as amateur. We use `ease-out-cubic` + `spring(280, 22)`. |
| Stock whoosh on every cut | Cliché. We use piano + sub-pad + plucks only. |
| 3D floating laptop with the UI on the screen | 2017 cliché. Our terminal panels parallax in-frame. |
| Em-dashes on screen | Banned per positioning memo. Use commas, colons, periods. |
| "Sipcode stops hallucinations" | We cite Anthropic's 29% instead. Never claim it as ours. |
| Hype verbs (revolutionize / supercharge / transform) | Banned per positioning memo. |
| Exclamation marks | Banned in body copy per positioning memo. |
| Customer logos | We have none yet. Honesty over false signals. |
| Stock footage | Pure motion graphics + real terminal only. |

---

*This brief is now complete. Sections 1-8 are the brief-gatherer template output. Appendices A-C are production-ready supplements: the visual tokens block for prompts, the shot-by-shot breakdown for designers, and the anti-checklist for grading drafts.*

*Maintained at `docs/launch/motion-graphics-brief.md`. Last updated: 2026-06-15.*
