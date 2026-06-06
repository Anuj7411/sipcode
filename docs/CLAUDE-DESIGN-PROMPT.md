# Sipcode landing page — claude.design brief

> Copy everything below this line into claude.design. It is self-contained:
> claude.design needs no extra context to design the page.

---

# Design brief: Sipcode landing page

You are designing the **public marketing landing page** for Sipcode, an open-source token-optimization + agent-reliability toolkit for Claude. The page is the single entry point for our launch. It must be visually distinctive, beginner-friendly, and project quiet confidence (the opposite of generic dev-tool noise).

---

## 1. What Sipcode is (product summary)

Sipcode is **one tool with three coordinated layers**, for Claude users:

| Layer | What it does | The promise |
|---|---|---|
| **Valve** (`sipcode proxy`) | A PreToolUse hook that automatically rewrites Claude Code commands to compact forms (e.g. `git log` → `git log --oneline -n 20`) before they run. | Tokens never enter context if they don't need to. |
| **Meter** (`sipcode why` / `impact` / `stats` / `benchmark` + 13 MCP tools) | Reads your local Claude transcripts and tells you where tokens went, what you'd save, and how cost trends over time. | Honest measurement, never guessing. |
| **Drift** (`sipcode drift`) | A silent-unless-something-regressed detector: compares your latest session's context health against your recent baseline (tokens/turn, cache reuse, repeated reads) and only speaks up if something actually moved. | Smoke alarm for "context rot." |

**It is open-source (MIT)**, lives on npm as `sipcode`, and runs entirely on the user's machine (zero network calls from any core path).

### The deeper story (THIS is our differentiator)

Most token-optimization tools sell "save money." Sipcode sells something more important:

> **Clean context = right answers. Bloated context = a confused, hedging agent.**

The phenomenon is called **"context rot"** — as a conversation grows, the model gets worse: it hedges, forgets fixes you already made, mixes up files. It's an academically-named, search-trending problem (Anthropic's own research shows ~29% better outcomes and ~40% fewer agent errors with clean context). Sipcode is positioned as the tool that *prevents* and *detects* context rot — and saves tokens *as proof* the cleaning is real.

**Tagline (lock this everywhere):** *"Sip your tokens. Don't gulp them."*

The sip ↔ gulp metaphor carries the entire brand:
- **Gulp** = bloated, redundant context → expensive AND sloppy agent.
- **Sip** = clean, measured context → cheaper AND sharper agent.

---

## 2. Brand & visual identity (already designed — preserve it)

A complete brand kit already exists (built earlier via claude.design). Reuse it:

- **Mark:** a **meniscus + S** letterform — a calm sip silhouette. Already designed; we have SVG/PNG.
- **Wordmark:** "Sipcode" — alongside the mark.
- **Mood:** calm, confident, slightly nerdy precision. NOT loud, NOT mascot-heavy.
- **Voice:** honest, plainspoken, slight engineer humility. Never hype-speak. (No "REVOLUTIONIZE your workflow!" — see the Tone section below.)

If anything from the existing brand kit conflicts with this brief, **the existing brand kit wins** — don't restyle the mark.

---

## 3. The reference page we are DIFFERENT from (anti-reference)

Our biggest competitor is **RTK** (https://www.rtk-ai.app/) — 52k★, Rust, mature. We've analyzed their page in detail. Useful things to know:

**Their visual feel** (what we are deliberately moving AWAY from):
- Loud Viking-with-axe mascot
- Six-column footer
- Six-language switcher
- A half-empty "Cloud coming soon" section
- "0 teams on the waitlist" empty vanity counter
- Sells one thing: compression %

**Our visual feel** (the contrast we want):
- Quiet, professional, almost editorial calm
- Lean, focused (max 3 footer columns)
- Single language, single product story
- No placeholder counters — if we don't have a number, we don't fake one
- Sells the story: *clean context → right answers, with measured tokens as proof*

**We are not "RTK but prettier."** We are a structurally different story. The visual should make that obvious in the first three seconds — calm beats loud, story beats stat-stuffing.

---

## 4. Page structure (what we need, in order)

Design **one page** (`index.html`) for v1. Eleven sections:

### Section 1 — Hero
- **Headline:** *Sip your tokens. Don't gulp them.*
- **Sub-head:** *Keep Claude Code's context clean — sharper answers and lower cost, automatically.*
- **Hero visual:** the meniscus + S mark, large. Possibly a subtle animated "sip" effect (slow, not gimmicky).
- **CTAs:** `[ Install ]` (primary, copies an npm one-liner) · `[ Star on GitHub ]` (secondary) · small live "996 tests passing" badge under the buttons.
- **Quiet stat row** beneath: *62.6% median tokens saved (reproducible benchmark) · 13 MCP tools · zero network calls · open source (MIT)* — all measurable facts only.

### Section 2 — The context-rot explainer (our wedge, RTK has nothing like this)
- Header: *"It's not just your bill — your agent gets sloppy."*
- One short paragraph: as context gets bloated, Claude hedges, forgets fixes, mixes up files. Anthropic's research shows leaner context lifts answer quality ~29% and reduces agent errors ~40%.
- A tiny diagram: "Gulp → bloated → hedging" vs "Sip → clean → sharp."
- Honesty footnote in same block: *"We cite the quality numbers from research. We measure the token/context part ourselves."*

### Section 3 — The three layers
Three clean cards (not separate products — three views of one thing):

1. **Valve — prevent the gulp.** `sipcode proxy --install` adds a hook that quietly rewrites bulky commands to compact forms before Claude sees them.
2. **Meter — measure the sip.** `sipcode why`, `impact`, `stats`, `benchmark`. Reads your local transcripts; tells you where tokens went and what you saved.
3. **Drift — catch context rot before it spreads.** `sipcode drift` runs a silent baseline-comparison. Only speaks when something actually regressed.

### Section 4 — Live before/after demo (match RTK's strongest section, with honesty)
Side-by-side terminal blocks for 4–6 commands — these numbers come from our actual rewriters, not invention. Use these as the spec; design freely:

```
git status         200 tokens  → 30 tokens   (-85%)
git log            2,500       → 500         (-80%)
git diff           21,500      → 1,260       (-94%)
grep -r            12,000      → 2,400       (-80%)
Grep tool          10,000      → 2,000       (-80%)
Glob tool          4,500       → 1,500       (-67%)
```

Beneath the demo, a single quiet line: *"62.6% median across a locked corpus. Reproduce in 90 seconds: `npx sipcode benchmark`."*

### Section 5 — The drift screen (our biggest visual differentiator)
A polished mockup of the actual `sipcode drift` output (terminal-style block). Real content to render:

```
⚠  Context drift detected in your latest Claude Code session

What this means: your newest session is behaving differently from your
recent norm — in ways that waste tokens and can make Claude less reliable.
(This is "context rot": answer quality drops as context gets bloated or stale.)

Signals that regressed (2):

  ▲ Tokens per turn — up 662%
      your norm: 1,050   →   this session: 8,000
      Each step is sending far more context than your norm. Bloated context
      costs more tokens and can bury the detail Claude needs.
      → Fix: Start a fresh chat for your next task to reset the context.

  ▼ Cache reuse — down 90 points
      your norm: 90%   →   this session: 0%
      Much less of your context is being reused from cache (~10x cheaper).
      → Fix: Avoid changing MCP servers or config mid-task.

How this was measured: your latest session vs the median of your last 6 sessions.
Conservative by design — silent unless something really moved.
```

Caption: *"Silent until your context actually regresses. No dashboard to babysit."*

### Section 6 — Works inside Claude Desktop chat (RTK can't reach this surface)
Show that Sipcode's 13 MCP tools work inside Claude Desktop. A small visual of someone in Claude chat asking *"is my agent drifting?"* and getting the drift report inline. This is a **structural advantage** over RTK — they're terminal-only.

### Section 7 — Installation
Two side-by-side cards.

**A) For Claude Code (terminal):**
```bash
npm install -g sipcode      # 1. install
sipcode proxy --install     # 2. turn it on
```
Then restart Claude Code. Done.

**B) For Claude Desktop chat:**
```json
{
  "mcpServers": {
    "sipcode": { "command": "npx", "args": ["-y", "sipcode-mcp"] }
  }
}
```
Add to `claude_desktop_config.json`, restart Claude Desktop, ask Claude "what sipcode tools do you have?"

Important: **no `curl … | sh`** style installs. The npm route is more trusted by careful devs — a small but real edge over RTK.

### Section 8 — Honesty section (THIS is our biggest brand differentiator — design lovingly)
A short block titled **"What Sipcode does NOT do."** Bulleted, brief, plain-spoken:

- Only works in Claude Code; the Desktop chat itself can't be intercepted (architectural fact, not a bug).
- Installing the npm package alone changes nothing until you run `sipcode proxy --install`.
- The reliability numbers (29% / 40%) are *cited from published research,* not measured by Sipcode.
- No telemetry. No network calls from any core path. Open source, audit it yourself.

Design this calmly — not as a warning, but as a quiet promise. Maybe a different background tone. RTK's page has nothing like this; it's a brand differentiator on its own.

### Section 9 — Quick FAQ
6 questions:
1. What is Sipcode?
2. How is it different from RTK? (answer: complementary; we work in Claude Desktop chat too, and we measure agent reliability)
3. How much does it actually save? (62.6% median on the reproducible benchmark; your real number from `sipcode proxy --stats`)
4. Does it affect Claude's answer quality? (cite research, then say what we measure)
5. Is it free? (MIT, no telemetry, no account)
6. Why "sip, don't gulp"? (one paragraph: gulping = bloated context, sipping = clean)

### Section 10 — Final CTA
- Headline: *"Stop gulping your tokens."*
- Subhead: *"Sipcode runs locally. No account. No telemetry. ~60 seconds to set up."*
- `[ Install ]` + `[ Read the docs ]`.

### Section 11 — Footer (lean — max 3 columns)
| Docs | Project | Brand |
|---|---|---|
| Quickstart | GitHub | Sip, don't gulp |
| MCP | npm | Built by [Anuj Ojha](https://github.com/Anuj7411) |
| Benchmark | Issues | MIT License |

Tiny "v1.6.4 · 997 tests passing" badge.

**No social-proof counter unless we have one earned** (no "X teams waiting" — we will not put placeholders).

---

## 5. Tone & voice rules (for every word on the page)

- **Plain, honest, slightly humble.** "Sipcode cuts noise" not "Sipcode REVOLUTIONIZES YOUR WORKFLOW."
- **Show, don't tell.** Numbers > adjectives. "62.6% median" > "massive savings."
- **Engineer-grade precision.** When we cite, we say "cited from research." When we measure, we link to the corpus. When we don't have a number, we don't fake one.
- **No emojis in body copy.** (✓ and ⚠ inside the drift terminal mockup are fine — they're product UI, not marketing.)
- **No hype verbs.** Banned: "supercharge," "unleash," "transform," "revolutionize." Allowed: "cut," "trim," "keep clean," "catch," "measure."

---

## 6. Visual direction

- **Calm > loud.** Generous whitespace. Strong typographic hierarchy beats decoration.
- **Type:** Crisp sans for UI/headings. Monospace inside terminal blocks (e.g. JetBrains Mono — we already bundle it for receipts).
- **Color:** Two anchor colors max, ideally drawn from the existing brand kit. Cool, considered palette. No gradients-as-personality.
- **Imagery:** No mascots. No stock dev illustrations. The hero mark and a few clean terminal mockups carry the page.
- **Density:** Each section should breathe. The page should feel scannable in 30 seconds AND rewarding to read in detail.
- **Motion (if any):** subtle and meaningful — a slow "sip" on the hero, a fade-in on the drift terminal. Nothing distracting. RTK has no real motion; we don't need much either.
- **Dark mode:** required (devs view in dark by default). Light mode is a nice-to-have.

---

## 7. Tech & constraints

- **Static HTML + CSS** (Astro is OK; one HTML file is also fine). No heavy framework.
- **Hosted on GitHub Pages** (zero cost). URL: `Anuj7411.github.io/sipcode`.
- **Lighthouse 95+** is the bar. No tracking scripts. No analytics in v1.
- **Mobile-responsive** (many devs browse on phone). Keep all 11 sections functional on a 360px-wide screen.
- **One page only** for launch. Docs live on the GitHub README; we're not building a docs site in v1.
- **Total page weight target: under 300KB** including hero mark.

---

## 8. What we DELIBERATELY do NOT want

(Anti-spec — please don't add any of these, even if they're "best practice"):
- A mascot or character
- Empty "X teams waiting" / "Coming soon" sections
- A six-column footer
- Language switchers
- Stock photography of "diverse developers"
- A pricing table (we're free)
- A telemetry-or-cookie banner (we don't track)
- Anything that requires JavaScript to display the main content

---

## 9. Deliverable

A single `index.html` + `style.css` (and any small SVG/PNG assets) that can be pushed to a `docs/` folder in our GitHub repo and served via GitHub Pages. If you generate componentized code, also include a flat "view source" HTML build we can deploy without a toolchain.

Open questions for us to settle if it'd help your design:
1. Confirm we're using the existing brand mark (we are — please request it if not in your context).
2. Confirm two-color palette from the brand kit.
3. Confirm: dark-mode-first or both modes at launch.

---

End of brief.
