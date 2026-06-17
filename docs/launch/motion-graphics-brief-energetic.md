# Motion Graphics Brief — Sipcode (ENERGETIC version)

**Date locked:** 2026-06-15
**For:** Launch hero / brand reel — energetic SaaS launch energy
**Status:** Final. Ready to paste into Veo / Sora / Runway.

This is the **energetic** version. Pair / contrast with the calm-editorial version at [`motion-graphics-brief.md`](motion-graphics-brief.md). Pick whichever fits the moment — or generate both and A/B them on your audience.

**Key differences from the calm version:**

| | Calm (minimal & editorial) | This one (energetic SaaS launch) |
|---|---|---|
| Hero claim | Token savings as the headline | **Save AI from context rot** as the headline; tokens as proof |
| Pacing | 45s, calm, held frames | 50s, fast-cut act structure with a bass drop |
| Music | Soft piano + sub-pad + plucks | Full electronic groove, 130 BPM, layered synths, one bass drop at 26s |
| Demo | Static terminal hero shot | **Cursor types commands live, output streams in line-by-line** |
| Vessel role | Single drain moment | Drains during proxy install (the emotional hero moment) + reappears in Act 3 |
| Reveal moment | Headline at 22s, calm | **Headline at 26s after hard cut + bass drop** |
| Number reveals | Stat row in calm columns | Four large hero tiles with spring overshoot + percussive hits |
| Website preview | None | **Live landing-page shot at 32-36s with copy-to-clipboard interaction** |
| Energy curve | Flat-warm throughout | **Tension build → drop → sustain → release** |

---

## THE PROMPT (paste this whole block)

```
A 50-second high-energy product launch film for SIPCODE, an open-source
npm CLI that prevents AI context rot in Claude Code. Render at 4K 60fps,
cinematic 16:9.

═══════════════════════════════════════════════════════════════════════
ABOUT THE BRAND (so AI video generators can reference visual identity)
═══════════════════════════════════════════════════════════════════════

Website (visit and sample if possible):  https://anuj7411.github.io/sipcode/

The live website is paper-cream background (#F8F8F6) with violet accent
(#5B4FCF) and ink black (#0A0A0A) text. The landing page features the
SIPCODE VESSEL MASCOT — a round, friendly vessel character that fills with
violet liquid and has expressive eyes and brows. The hero headline reads
"Sip your tokens. Don't gulp them." with a violet strike-through bar across
the word "gulp." The install pill at the top shows: npm i -g sipcode.

If the website is accessible to you, sample its color palette, the vessel
mascot proportions and styling, the typography weights, and the install
pill design. Reproduce these exactly in the video. If not accessible, use
the explicit hex codes, font specs, and shot details below.

Color palette (use only these):
- Paper:           #F8F8F6  (background)
- Ink:             #0A0A0A  (primary text)
- Brand violet:    #5B4FCF  (sole accent — liquid, wordmark "code", install
                              pill, plot curve, headline strike-through)
- Violet stressed: #9a93b8  (only inside the vessel during GULP state)
- Ochre signature: #B9831B  (small diamond marks, tick accents)
- Status green:    #28C840  (only on the ✓ tests-passing dot, sparingly)
- Charcoal:        #2D3142  (secondary text)
- Warn red:        #FF6347  (the ⚠ glyph in Act 1, sparingly)

Typography:
- Display:  Space Grotesk 600, letter-spacing -0.035em
- Body:     Inter 400/500
- Mono:     JetBrains Mono (for terminals + technical accents)

═══════════════════════════════════════════════════════════════════════
REFERENCE EXAMPLES — STUDY BEFORE GENERATING
═══════════════════════════════════════════════════════════════════════

This is a SaaS launch reel in the style of big-company product launches.
Borrow energy, pacing, and audio sensibility from:

- VERCEL SHIP 2024 keynote intro — search "Vercel Ship 2024 keynote intro"
  on YouTube. Note the kinetic-type confidence, the held-then-released pacing,
  the way one word lands with weight.

- NOTION AI launch reel (2024) — note how they show the chat input → AI
  response pattern that we replicate with terminal commands here.

- CURSOR launch trailer — note the speed of typing/completing,
  the way real editor footage feels like authentic dev work.

- STRIPE SESSIONS 2025 keynote opener — note the swelling synth pad
  building to a bass drop, the continuous-material aesthetic.

- REPLIT AGENT reveal — note the command-typed → agent-runs → output-streams
  pattern that defines the genre.

- ANTHROPIC's Code with Claude product reveal — note the calm restraint
  in the close + the seriousness of the demo composition.

The DNA we want: Vercel Ship's confident kinetic type + Notion AI's
input-response demo pattern + Cursor's authentic dev-tool feel + Stripe
Sessions' building energy + Anthropic's honest close.

═══════════════════════════════════════════════════════════════════════
ACT 1 — THE ROT (0:00 → 0:15)
═══════════════════════════════════════════════════════════════════════

0.0-2.5s — Cold open on a TERMINAL window centered on dark paper-cream
background. A cursor blinks. Mono text appears character-by-character at
80ms per character with realistic typing rhythm (occasional 200ms pause):

  $ sipcode drift

Cursor pauses 300ms. Output streams in line-by-line at 60ms per line:

  ⚠ context drift detected — 2 signals regressed
  
  tokens per turn       19,936 → 322,721      ↑ 1519%
  repeated reads             0 → 624,940       ↑ NEW

The ⚠ glyph PULSES bright #FF6347 on first appearance, holds at 70%.
The "↑ 1519%" is in 32px Space Grotesk 600 — the largest text in frame.

AUDIO 0.0-2.5s: subtle room tone (40Hz floor). Each typed character has
a soft, brief mechanical-keyboard tick — NOT the cliché loud clack, more
like a Steno-style soft "tk" at 65dB. Each output line lands with a
percussive sub-bass tick (60Hz, 80ms decay). The ⚠ glyph pulse triggers
a single low "thoom" (35Hz). A bass note enters at 2.0s and SUSTAINS.

2.5-5.0s — Camera DOLLIES IN 8% on "624,940 tokens." Quick CUT to the
SIPCODE VESSEL MASCOT appearing on the right side of frame in GULP state:
round vessel filled with stressed violet liquid (#9a93b8), angled-down
brows, oval eyes, blue sweat droplet (#5B8DEF) dripping, two violet drips
forming under the vessel. Face pulses, distressed. Speech bubble pops in:
"Bloated. I'm losing the thread."

AUDIO 2.5-5.0s: The vessel appearance triggers a soft "drop" sound — a
single water droplet effect at -8dB (think Anthropic's ambient water
samples). The speech bubble pops with a subtle "pop" sound at 220Hz.
Bass note swells slightly. A second sub-bass pulse enters underneath.

5.0-9.0s — Quick-cut MONTAGE, 4 frames at 0.8s each, each frame is a
stylized representation of context rot:
  Frame A: bloated context — overlapping windows of repeated file content,
           opacity 60%, blurred edges.
  Frame B: cursor typing "explain auth.ts" in a chat box. Above it, a
           token counter ticks UP rapidly: 12K → 23K → 41K → 67K.
           Number turns red when it crosses 50K.
  Frame C: a "Claude" reply visibly FRAGMENTING — words appearing in
           wrong order, then settling. Brief glitch effect.
  Frame D: a money counter spinning, $0 → $128 in 800ms. Red flash.

AUDIO 5.0-9.0s: Energy builds. Each frame transition triggers a
percussive snare-like hit (NOT a stock whoosh — a tight 200Hz transient,
80ms attack, 120ms decay). The token counter has a rising digital
"counting" sound (sawtooth synth, pitch climbs as numbers climb). The
fragmenting Claude reply triggers a brief digital glitch sound effect
(stuttered noise, 80ms). The money counter is overlaid with a coin-drop
sound effect — three coin clicks distinct over 800ms. Bass note
continues to build.

9.0-13.0s — Cut HARD to a full-frame text card on paper-cream:

  context rot is real.
  it is measurable.
  it is killing your tokens.

Set in Space Grotesk 600, 56px, line-height 1.05, left-aligned, ink.
Each line appears with 200ms stagger, 18ms per-glyph fade-in within
each line. Below the three lines, in JetBrains Mono 14px charcoal:

  measured from real Claude Code sessions, not a brochure.

AUDIO 9.0-13.0s: The hard cut HITS with a tight kick drum (50Hz
fundamental, 100ms decay, single pulse). The three lines of text each
land with a softer kick variation — slightly higher pitch each line.
Bass note holds. Tension builds.

13.0-15.0s — Beat. Hold the type. Bass swells to its peak. Cursor
blinks below the last line. Screen flashes WHITE for 80ms.

AUDIO 13.0-15.0s: The bass note resolves to a higher pitch, then
SILENCE for 200ms before the white flash. The flash itself is silent
— deliberately, because the next sound is the entry of the synth in
Act 2. The silence is the comma before the new sentence.

═══════════════════════════════════════════════════════════════════════
ACT 2 — THE FIX (0:15 → 0:36)
═══════════════════════════════════════════════════════════════════════

15.0-16.5s — White flash resolves into a fresh terminal. Familiar
prompt appears:

  $ npm i -g sipcode

Each character types at 50ms — faster than Act 1. Energy is building.
The install command finishes in 600ms. Cursor pauses 200ms. Output
streams rapid-fire:

  + sipcode@1.6.15
  added 1 package in 2.4s

AUDIO 15.0-16.5s: Warm synth pad enters underneath at 15.0s — major
chord, slow attack. Typing is faster, brighter mechanical ticks (more
agency in the sound). Each output line lands with a brief confirmation
chirp (small sine at 880Hz, 40ms decay). The mood has SHIFTED from
ominous to capable.

16.5-18.0s — Cursor types FASTER (35ms per character):

  $ sipcode init

Style-C SETUP card streams in:

  SETUP
  
  ✓ project manifest         .sipcode/manifest.md
  ✓ CLAUDE.md updated        manifest + rules
  ✓ Claude Code detected     v2.1.170
  ✓ proxy hook installed     signature v4, sipcode v1.6.15
  ✓ install marker set       impact baseline starts now
  ✓ MCP server verified      15 tools registered

Each ✓ row appears with 80ms stagger. The violet color pulses on each
✓ glyph as it appears.

AUDIO 16.5-18.0s: Each ✓ row triggers a brief, bright confirmation tick
— think Notion's task-complete sound, but at 1100Hz, very short (30ms).
A subtle hi-hat pattern enters underneath, 130 BPM, marking the rhythm
that will lock in on the drop. The synth pad swells slightly.

18.0-22.0s — CUT to SPLIT-SCREEN: terminal on LEFT, vessel mascot on
RIGHT. Cursor types in the terminal:

  $ sipcode drift

Output streams. Meanwhile, the vessel TRANSFORMS:
  - Liquid drains downward from full to 30% over 800ms (cubic ease-out)
  - Liquid color shifts: #9a93b8 → #5B4FCF
  - Face floats up + scales 1.06x
  - Eyes close briefly in relief, then open as a smile
  - Two violet sparkles flank the head
  - Drips beneath the vessel disappear

In terminal:

  ✓ Sipcode drift: no drift — context health stable
                   vs your recent baseline.

THE ✓ APPEARS GREEN (#28C840) AND PULSES.

AUDIO 18.0-22.0s: This is the EMOTIONAL HERO MOMENT. The vessel drain
triggers an ascending synth sweep (sawtooth filter opening from 200Hz
to 4000Hz over the 800ms drain). When the liquid completes its color
shift, a single warm "ahh" sound effect — like a soft sigh of relief —
plays at -15dB. The sparkles flanking the head are accompanied by two
delicate bell tones (1320Hz and 1760Hz, 60ms apart). The green ✓
appearing triggers a confident affirmative chord (perfect 5th, two
brief notes). Synth pad sustains. Hi-hat pattern continues. THE DROP
IS COMING.

22.0-26.0s — Camera PULLS BACK from split-screen, revealing a wider
DESKTOP composition with FOUR terminal panels in a 2x2 grid, tilted
12° in 3D space, lit from above-left with soft violet glow underneath:

  TOP-LEFT:    sipcode proxy --stats — 144 rewrites, 288K saved
  TOP-RIGHT:   sipcode drift          — "no drift" ✓
  BOTTOM-LEFT: sipcode benchmark      — 62.6% median, $67.43
  BOTTOM-RIGHT: sipcode forecast      — $17K projected

Camera dollies right at 0.6%/frame, panels parallax slightly. Each
catches a brief specular highlight as it crosses the lighting axis.

THIS IS THE HERO PRODUCT SHOT. Hold for 4 seconds.

AUDIO 22.0-26.0s: Music BUILDS toward the drop. Bass note rises one
semitone. Snare hit on every beat (130 BPM). Synth pad widens stereo.
At 25.5s, a brief moment of suspended silence (200ms breath), then —

26.0-28.0s — THE DROP. Cut hard. Black frame for 80ms. Then giant
on-paper text reveal — the locked tagline at 96px Space Grotesk 600:

  Sip your tokens.
  Don't gulp them.

Word "gulp" muted to rgba(10,10,10,0.34) with a violet bar slashing
through diagonally at -1.5°, 4px thick, drawing in 240ms with overshoot.
Below in Inter 22px charcoal:

  Keep Claude Code's context clean for sharper answers
  and lower cost, automatically.

AUDIO 26.0-28.0s: THE BASS DROPS. A 50Hz fundamental kick + sub-bass
slam triggers at exactly 26.0s, synchronized with the headline appearance.
The synth pad, bass, percussion ALL LOCK IN for the sustain. This is the
lift. 130 BPM groove pattern continues with confidence — kick on 1,
snare on 3, hi-hat 16ths.

28.0-32.0s — Four stat tiles appear with 100ms stagger as big hero
numbers:

  62.6%        15           0            1,317
  median       MCP          network      tests
  saved        tools        calls        passing

Each number in 56px Space Grotesk 600. Each label below in 12px
JetBrains Mono uppercase. Each tile has 1px hairline ink border, paper
background, 8px corner radius. Each appears with scale 1.05 → 1.0
(spring overshoot).

Sub-line in 14px mono italic, 70% opacity:

  Anthropic published: cleaner context gives +29% quality lift.
  Sipcode operationalizes that for Claude Code.

AUDIO 28.0-32.0s: Each tile appearance triggers a punchy synth hit
— short, bright, 100ms decay, at 660Hz with rising harmonics. The
groove sustains. At 31.5s, the synth pad opens its filter, creating
a moment of brightness anticipating the website reveal.

32.0-36.0s — WEBSITE PREVIEW MOMENT.

Cut to a clean transition: the four stat tiles slide off-screen, and
the actual SIPCODE LANDING PAGE appears in frame — full browser shot
of https://anuj7411.github.io/sipcode/. Show the hero section with:
- The "Sip your tokens. Don't gulp them." headline
- The vessel mascot beside it in SIP state
- The install pill: npm i -g sipcode
- The v1.6.15 · MIT licensed eyebrow badge

The browser appears with a slight 3D tilt (8°), lit from above. Camera
holds for 2 seconds, then cursor moves to the install pill, clicks it,
and a small "copied" toast appears. Hold for 2 more seconds.

Then a small lower-third text bar slides in:

  anuj7411.github.io/sipcode

AUDIO 32.0-36.0s: The website appearance is accompanied by a single
warm bell tone (440Hz, 200ms decay) — calmer than the drop, signaling
"the destination." The mouse click triggers a soft "tk" sound. The
"copied" toast triggers a brief affirmative chirp. The groove continues
but slightly softer — we're transitioning to Act 3.

═══════════════════════════════════════════════════════════════════════
ACT 3 — THE INVITATION (0:36 → 0:50)
═══════════════════════════════════════════════════════════════════════

36.0-41.0s — Cut to clean paper frame. Vessel mascot (HAPPY SIP state,
clean violet liquid, smiling) appears centered, scaled 1.4x. Three
orbital mono chips drift slowly around it:

  top-right:   git diff −94%
  upper-left:  cache reuse 90%
  lower-right: −2,400 tokens

The vessel BREATHES — gentle scale 1.0 → 1.02 → 1.0 over 2 seconds.

AUDIO 36.0-41.0s: The groove softens — kick and hi-hat continue but
the bass note simplifies to a held tonic. Each chip arrival triggers
a brief percussive tick (woodblock-like, 80ms). The vessel's breathing
is accompanied by a subtle sub-bass swell that follows the scale curve.

41.0-45.0s — Install pill animates in from the bottom. Violet
(#5B4FCF) background, white mono text, 8px corner radius:

  $ npm i -g sipcode

Violet caret types the command into the pill over 600ms, then briefly
inverts to white-on-violet on a "copy" feedback flash.

Below in small mono charcoal:

  v1.6.15  ·  MIT licensed  ·  1,317 tests passing

AUDIO 41.0-45.0s: The install pill arrival is a single confident snare
hit + a brief synth note. The typing animation has more emphasized
mechanical ticks — bolder than Act 1's soft ticks. The copy-feedback
flash triggers a satisfying confirmation tone (perfect 5th interval).

45.0-48.5s — Wordmark draws on. "sip" in ink Space Grotesk 600 at
72px, then "code" in violet appears beside it. Letter spacing -0.03em.
Each pair of characters fades in over 60ms total, left-to-right.

Below the wordmark, in 14px mono:

  anuj7411.github.io/sipcode

AUDIO 45.0-48.5s: The wordmark draw-on is accompanied by the synth
pad rising one final time — a triumphant but restrained chord. NO
crash cymbal. The bass note resolves to the root, sustained.

48.5-50.0s — Final breath. Music releases on a held synth chord
fading over 1.5 seconds. Hold the wordmark frame. Cut to black.

AUDIO 48.5-50.0s: The held synth chord fades from -3dB to silence
over 1.2 seconds, with the bass note releasing last. The final 300ms
is silence before cut to black. NO outro stinger.

═══════════════════════════════════════════════════════════════════════
SOUND DESIGN SUMMARY — THE FULL AUDIO STACK
═══════════════════════════════════════════════════════════════════════

LAYER 1 — Foundation
- Sub-bass note (40-60Hz), evolving through three acts
- Subtle room tone at -50dB throughout (never silent until 49.7s)

LAYER 2 — Rhythm (enters at 16.5s, drops at 26.0s)
- Kick drum: 50Hz fundamental, on beat 1
- Snare hit: on beat 3, 200Hz transient
- Hi-hat 16ths: sparkly, panned slightly left
- Tempo: 130 BPM throughout Act 2 and Act 3
- Time signature: 4/4

LAYER 3 — Harmonic warmth
- Synth pad (warm major chord), enters at 15.0s, sustains through Act 3
- Sub-bass pulse, accompanies key moments

LAYER 4 — Per-shot add-on sounds (the texture)
- Typing: soft mechanical "tk" at 65dB per character, 30ms attack
- ⚠ glyph: single "thoom" at 35Hz on first appearance
- Vessel drop appearance: soft water droplet sound, -8dB
- Speech bubble pop: brief 220Hz "pop" sound
- Token counter ascending: sawtooth synth, pitch climbs with numbers
- Money counter: three coin clicks across 800ms
- Glitch frame: stuttered digital noise, 80ms
- Drop hit (26.0s): full kick + sub-bass slam at 50Hz
- Vessel drain swell: ascending synth sweep, 200Hz → 4000Hz over 800ms
- Vessel "ahh" relief: warm vocal sigh sample at -15dB
- Sparkles: two delicate bell tones, 1320Hz + 1760Hz
- Green ✓ pulse: confident affirmative chord, perfect 5th
- Stat tiles: punchy synth hits, 660Hz with harmonics, 100ms decay
- Website reveal: warm bell tone at 440Hz, 200ms decay
- Copy feedback: perfect 5th interval confirmation
- Final hold: synth chord fading -3dB to silence over 1.2s

NEVER USE:
- Stock whoosh sound on cuts (cliché)
- Reverse-cymbal swell (cliché)
- Mechanical keyboard clack at high volume (cliché)
- Voice-over of any kind (devtools win silent + scored)
- Crash cymbal at the end (anticlimactic)
- Stock "drop" sample (use the synthesized bass slam we specified)

═══════════════════════════════════════════════════════════════════════
CAMERA + MOTION RULES
═══════════════════════════════════════════════════════════════════════

- Easing: ease-out-cubic (drains, dollies) or spring(280, 22) (tile
  reveals, chip pops). NO LINEAR easing anywhere.
- Camera dollies: slow and weighted, 0.4 to 1.0% per frame. They have
  inertia.
- Cuts: HARD ON BEAT during Act 2 + 3. No dissolves except white-flash
  transition at 15.0s.
- 60fps capture, deliberately. NOT lo-fi / handmade.

═══════════════════════════════════════════════════════════════════════
WHAT THIS PROMPT REFUSES
═══════════════════════════════════════════════════════════════════════

- Logo at frame 1 (logo earns its way in by 45.0s)
- Voiceover (devtools win silent + scored)
- Purple/blue radial gradient mesh (AI-slop tell)
- 3D floating laptop with UI on screen (2017 cliché)
- Stock footage (pure motion graphics + real terminal output)
- Linear easing (looks Lottie-amateur)
- Em-dashes in any on-screen copy (use commas, colons, periods)
- Hype verbs: revolutionize, supercharge, transform, disrupt, blast
- Exclamation marks anywhere
- "Stops hallucinations" claim — cite Anthropic's 29% instead
- Sparkle / rocket / fire emoji
- Crash cymbals on the close
- Stock whoosh / reverse-cymbal cliché transitions

═══════════════════════════════════════════════════════════════════════
PROMPT END
═══════════════════════════════════════════════════════════════════════
```

---

*Maintained at `docs/launch/motion-graphics-brief-energetic.md`. Last updated: 2026-06-15.*
