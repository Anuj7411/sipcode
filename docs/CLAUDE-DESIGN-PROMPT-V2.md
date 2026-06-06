# Sipcode landing page — claude.design brief (v2)

> **For the human (Anuj):** Copy everything below the line into claude.design.
> The brief is self-contained — no extra context required.
> Reviewed and structured using three agent frameworks: Brand Guardian (brand
> foundation), Visual Storyteller (narrative arc), UI Designer (design system
> + accessibility). v1 is preserved at `CLAUDE-DESIGN-PROMPT.md` for comparison.

---

# Design brief: Sipcode launch landing page

You are designing the **public marketing landing page** for **Sipcode**, an open-source token-optimization + agent-reliability toolkit for Anthropic's Claude. The page is our single launch entry point. Design it to feel **quietly confident, structurally honest, and visually unlike every other dev-tool launch page on the internet**.

---

## A. BRAND FOUNDATION

A landing page is the brand made visible. Before sections — these are the immovable anchors.

### Brand Purpose (why we exist beyond profit)
To make AI coding agents both **cheaper** and **smarter** at the same time — by treating *context* (not tokens) as the thing that matters, and giving individual developers the tools that until now only enterprises had.

### Brand Vision (where we're going)
A world where every Claude-powered developer can see, measure, and protect the *health* of their agent's context — and where "context engineering" is as routine a skill as version control.

### Brand Mission (what we do, for whom)
Sipcode equips individual Claude developers with a local, zero-setup toolkit that **prevents context bloat (Valve)**, **measures token cost honestly (Meter)**, and **detects context-rot regressions (Drift)** — using only the transcripts Claude already writes, with zero network calls.

### Brand Values (how we behave — guide every design choice)
1. **Honesty over hype** — we cite what we cite, measure what we measure, and never fake numbers. If we don't have a stat, the placeholder doesn't appear at all.
2. **Calm over loud** — quiet competence beats marketing theater. No mascots, no exclamation points, no hype verbs.
3. **Engineer respect** — we assume our reader knows their craft; we explain context rot, not "what's a token."
4. **Local-first dignity** — your code never leaves your machine. Privacy is engineered, not promised.
5. **One coherent product** — Valve, Meter, Drift are three views of one thing, not three SKUs.

### Brand Promise (what users can always expect)
*"We will save your tokens AND make your agent sharper — and we'll show you the math, not the marketing."*

### Brand Personality (human traits)
- **Precise** — every number on the page is sourced or labeled.
- **Considered** — measured cadence, generous whitespace, no rushed urgency.
- **Slightly self-aware** — the brand admits its own limits (the explicit "What Sipcode does NOT do" section is brand-signature).
- **Welcoming** — beginner-friendly without being condescending.

### Brand Voice rules (apply to every word on the page)
- **Banned verbs:** revolutionize, supercharge, unleash, transform, disrupt, blast, crush.
- **Preferred verbs:** sip, trim, keep clean, catch, measure, prevent, prove.
- **Sentence rhythm:** plain English, no jargon stacks. "Cuts the noise" not "leverages compression heuristics."
- **No emojis in marketing copy.** (✓, ⚠, ▲, ▼ inside the drift terminal mockup are product UI, fine.)
- **Numbers are always labeled:** *measured* / *cited from research* / *self-reported* — never bare.

### Tagline (lock everywhere)
**"Sip your tokens. Don't gulp them."**

The sip ↔ gulp duality carries the whole brand:
- **Gulp** = bloated, redundant context → expensive AND a hedging, forgetful agent.
- **Sip** = clean, measured context → cheaper AND a sharper agent.

---

## B. THE NARRATIVE ARC (design TO this story)

The page is not a list of sections. It is a **five-act story** the visitor experiences while scrolling. Each section serves the arc.

| Act | Emotional beat | Page section(s) |
|---|---|---|
| **1. Setup — Recognition** | "Yes, this happens to me." | Hero + Context-rot explainer |
| **2. Tension — Cost on two axes** | "Wait, it's not just my bill?" | Context rot impact (cited research) |
| **3. Discovery — A better way** | "Oh, there's a different framing." | The three layers — Valve / Meter / Drift |
| **4. Resolution — Proof** | "And here's the math." | Before/after demo + Drift screen + Claude Desktop reach |
| **5. Trust — Honest invitation** | "These people don't lie. I'll try it." | Honesty section + Install + Final CTA |

**Design implication:** scrolling the page should feel like reading a short essay, not browsing a feature matrix. Whitespace, type rhythm, and visual pacing should support the arc — denser at the proof act, more spacious at the trust act.

---

## C. WHAT SIPCODE *IS* (concrete product summary)

One open-source toolkit (MIT, npm `sipcode`), three coordinated layers:

| Layer | What it does | The promise |
|---|---|---|
| **Valve** (`sipcode proxy`) | A PreToolUse hook that automatically rewrites Claude Code commands to compact forms (e.g. `git log` → `git log --oneline -n 20`) *before* they run. | Tokens never enter context if they don't need to. |
| **Meter** (`sipcode why` / `impact` / `stats` / `benchmark` + 13 MCP tools) | Reads your local Claude transcripts; tells you where tokens went and what you saved. | Honest measurement, never guessing. |
| **Drift** (`sipcode drift`) | Silent-unless-something-regressed detector: compares your latest session's context health vs your recent baseline (tokens/turn, cache reuse, repeated reads). | A smoke alarm for "context rot." |

**Runs entirely on the user's machine. Zero network calls from any core path. CI-enforced.**

### The deeper story (this is our wedge vs the entire competitive landscape)

Other token tools sell **"save money."** Sipcode sells:

> **Clean context = right answers. Bloated context = a confused, hedging agent.**

This phenomenon is named **"context rot"** — as a conversation grows, the model gets worse: it hedges, forgets fixes you already made, mixes up files. Anthropic's research shows leaner context lifts outcomes by ~29% and reduces agent errors by ~40%. Sipcode is positioned as the tool that *prevents* and *detects* context rot — and the token savings are the **proof** the cleaning is real.

---

## D. THE ANTI-REFERENCE (RTK)

Our biggest competitor is **RTK** (rtk-ai.app) — 52k★, Rust, mature. We've studied their page in detail. Use this as the **counter-example**, not the model.

**What their page does that we move AWAY from:**
- Loud Viking-with-axe mascot
- Six-column footer
- Six-language switcher
- Half-empty "Cloud coming soon" section
- "0 teams on the waitlist" empty vanity counter
- Sells one thing: compression %

**What we do INSTEAD:**
- Calm meniscus + S mark, no character
- Three-column footer, lean
- One language, one product story
- No "coming soon" placeholders. If we don't have it, it isn't on the page.
- Sells the *story*: clean context → right answers, with measured tokens as the proof
- An explicit **"What Sipcode does NOT do"** section — brand-defining honesty RTK has nothing like

> **The first three seconds of our page must make it visually obvious we are not "RTK but prettier."** Calm beats loud. Story beats stat-stuffing.

---

## E. PAGE STRUCTURE — 11 sections, mapped to the arc

### 1. Hero — Act 1 (Setup)
- **Headline:** *Sip your tokens. Don't gulp them.*
- **Sub-head:** *Keep Claude Code's context clean — sharper answers and lower cost, automatically.*
- **Hero visual:** the existing **meniscus + S** brand mark, large. Optional very subtle "sip" motion (slow, deliberate — not gimmicky).
- **CTAs:** `[ Install ]` (copies an npm one-liner) · `[ Star on GitHub ]` (secondary) · small live "v1.6.4 · 997 tests passing" badge.
- **Quiet stat row beneath, every stat labeled:**
  - *measured:* 62.6% median tokens saved (reproducible benchmark)
  - *measured:* 13 MCP tools, zero network calls
  - *measured:* MIT-licensed, no telemetry

### 2. Context rot explainer — Act 2 (Tension) — OUR WEDGE
- **Header:** *"It's not just your bill — your agent gets sloppy."*
- One short paragraph: as context gets bloated, Claude hedges, forgets fixes, mixes up files. Anthropic's research shows leaner context lifts answer quality ~29% and reduces agent errors ~40%.
- A small diagram: "Gulp → bloated → hedging" vs "Sip → clean → sharp."
- Inline honesty footnote: *"We cite these quality numbers from research. We measure the token/context part ourselves."*

### 3. The three layers — Act 3 (Discovery)
Three clean cards. NOT three products — three views of one thing.

1. **Valve — prevent the gulp.** `sipcode proxy --install` adds a hook that quietly rewrites bulky commands to compact forms before Claude sees them.
2. **Meter — measure the sip.** `sipcode why` / `impact` / `stats` / `benchmark`. Reads your local transcripts; tells you where tokens went and what you saved.
3. **Drift — catch context rot before it spreads.** `sipcode drift` runs a silent baseline-comparison. Only speaks when something actually regressed.

### 4. Live before/after demo — Act 4 (Resolution / proof)
Side-by-side terminal blocks for 4–6 commands. Numbers are from our real rewriters — DO NOT INVENT:

```
git status         200 tokens  → 30 tokens   (-85%)
git log            2,500       → 500         (-80%)
git diff           21,500      → 1,260       (-94%)
grep -r            12,000      → 2,400       (-80%)
Grep tool          10,000      → 2,000       (-80%)
Glob tool          4,500       → 1,500       (-67%)
```

Below the demo, one quiet line: *"62.6% median across a locked corpus. Reproduce in 90 seconds: `npx sipcode benchmark`."*

### 5. The drift screen — Act 4 (Resolution) — biggest visual differentiator
A polished mockup of the actual structured `sipcode drift` output. **Render this content exactly:**

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

### 6. Inside Claude Desktop chat — Act 4 (Resolution / unique reach)
A small visual of someone in Claude Desktop chat asking *"is my agent drifting?"* and getting the drift report inline. Caption: *"RTK only works in your terminal. Sipcode also lives inside Claude Desktop chat — all 13 tools, no terminal needed."* This is a **structural advantage** worth one section.

### 7. Installation — Act 5 (Trust / invitation)
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

**No `curl | sh` style install.** The npm path is more trusted by careful devs — a small but real edge.

### 8. Honesty section — Act 5 (Trust) — biggest brand statement
Header: **"What Sipcode does NOT do."** Bulleted, brief, plain:

- Only works in Claude Code. Claude Desktop chat itself can't be intercepted (architectural fact, not a bug).
- Installing the npm package alone changes nothing until you run `sipcode proxy --install`.
- The reliability numbers (29% / 40%) are *cited from published research,* not measured by Sipcode.
- No telemetry. No network calls from any core path. Open source — audit it yourself.

**Design this calmly — not a warning, a quiet promise.** RTK's page has nothing like it; in our brand, this section *is* the case for trust.

### 9. Quick FAQ — Act 5 (Trust)
1. What is Sipcode?
2. How is it different from RTK? *(complementary; we also work in Claude Desktop chat, and we frame around reliability)*
3. How much does it actually save? *(62.6% median on the reproducible benchmark; your real number from `sipcode proxy --stats`)*
4. Does it affect Claude's answer quality? *(cite research, then say what we measure)*
5. Is it free? *(MIT, no telemetry, no account)*
6. Why "sip, don't gulp"? *(one paragraph)*

### 10. Final CTA — Act 5 close
- **Headline:** *Stop gulping your tokens.*
- **Subhead:** *Sipcode runs locally. No account. No telemetry. ~60 seconds to set up.*
- `[ Install ]` + `[ Read the docs ]`.

### 11. Footer — lean (anti-RTK)
Three columns max:

| Docs | Project | Brand |
|---|---|---|
| Quickstart | GitHub | "Sip, don't gulp." |
| MCP guide | npm | Built by [Anuj Ojha](https://github.com/Anuj7411) |
| Benchmark | Issues | MIT License |

Tiny `v1.6.4 · 997 tests passing` badge. **No social-proof counter unless earned.**

---

## F. DESIGN SYSTEM (must establish foundation BEFORE styling individual screens)

Apply *design-system-first*: before drawing any section, lock the foundation. Document the system inline (claude.design's output should include this block):

### Typography
- **Headings:** Crisp sans (Inter or system) — 700/600 weight. Hero ~64px, section heads ~36px, sub ~20px.
- **Body:** Same family, 400 weight, ~17px, generous line-height (~1.65).
- **Mono:** JetBrains Mono inside all terminal blocks.
- **Hierarchy beats decoration.** Strong type contrast does the work; no underlines, no rules.

### Color
- **Two-anchor palette** from existing brand kit. Document tokens (`--color-bg`, `--color-fg`, `--color-accent`, `--color-muted`).
- **Dark-mode-first.** Light mode is a nice-to-have for v1.
- High contrast (WCAG AA minimum on all text + UI; AAA on body text).

### Spacing
- A consistent spacing scale (4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px). Document tokens.
- **Generous whitespace.** Each section should breathe. The page should feel scannable in 30 seconds AND reward a slow read.

### Accessibility (non-negotiable)
- **WCAG 2.1 AA minimum** — color contrast, keyboard navigation, focus rings, semantic HTML, proper headings (h1 → h2 → h3).
- All terminal mockups must include `aria-label`s describing what the mockup shows.
- All interactive elements (CTA buttons, copy-to-clipboard) keyboard-reachable.
- Motion respects `prefers-reduced-motion`.

### Responsive
- Mobile-first. All 11 sections must remain readable, navigable, and visually intentional at 360px width.
- The drift terminal mockup may horizontally scroll on mobile — that's fine; it must stay legible.

---

## G. WHAT WE DELIBERATELY DO NOT WANT

(Anti-spec — don't add these even if "best practice"):
- A mascot or character
- Empty "X teams waiting" / "Coming soon" placeholder sections
- A six-column footer
- Language switchers
- Stock photography of "diverse developers"
- A pricing table (we're free)
- A telemetry-or-cookie banner (we don't track)
- Anything that requires JavaScript to display the main content
- Animated counters that tick up (vanity)
- "As featured in" logo strip we haven't earned

---

## H. TECH & DELIVERY CONSTRAINTS

- **Static HTML + CSS.** Single page (`index.html`) + `style.css`. Astro is OK; raw HTML is also fine.
- **No frameworks.** No React/Vue/Svelte. The whole page should work without JS.
- **Hosted on GitHub Pages** at `Anuj7411.github.io/sipcode`. Lives in our existing repo under `docs/`.
- **Lighthouse 95+** on Performance, Accessibility, Best Practices, SEO.
- **Page weight under 300KB total**, including hero mark.
- **Mobile-responsive** (360px → desktop).
- **No analytics, no trackers** in v1.

---

## I. DELIVERABLE

A single `index.html` + `style.css` (+ small SVG/PNG assets if needed) ready to push to a `docs/` folder and deploy on GitHub Pages — no build step required.

Include in your output:
1. Design system tokens (CSS variables) explicitly listed and used.
2. Semantic HTML structure (`<header>`, `<main>`, `<section>`, `<footer>` — not div soup).
3. Accessibility annotations (alt text, aria-labels, focus styles).
4. A short README block describing the file structure and how to deploy to GitHub Pages.

### Open questions you may ask back if needed
1. Do we have the hero brand mark (meniscus + S) as SVG/PNG ready to use? (Yes — request it from Anuj.)
2. Are the two anchor palette colors locked in the brand kit, or should you propose them from scratch? (Propose; we'll confirm.)
3. Dark-mode-only at launch or both at launch? (Lean dark-only for v1; document the light-mode tokens for v2.)

---

End of brief.
