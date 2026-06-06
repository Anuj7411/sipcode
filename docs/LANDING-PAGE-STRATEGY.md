# Sipcode landing page — strategy & differentiation vs RTK

**Date:** 2026-06-06
**Reference:** [rtk-ai.app](https://www.rtk-ai.app/) (analyzed in detail 2026-06-06)
**Goal:** Plan a landing page that is **stronger and more honest** than RTK's, without copying it.

This is a planning doc. No code/HTML yet — design decisions only.

---

## Headline takeaways from studying RTK's site

**What works on their page (acknowledge):**
- Concrete pain in the hero ("Your AI agent is drowning in CLI noise")
- An interactive before/after demo with real token deltas
- A tool-comparison table that ties savings to *user money* (Pro $200/mo → 3x longer)
- A clean install block with three OS-flavored one-liners
- Social proof everywhere: 59.3k★, 18k+ devs, real user counter (15,720 cmds, 138M tokens)

**What's weak (and where we beat them — earned, not claimed):**
- Visually dated, Viking mascot feels gimmicky for a serious dev tool
- Single message: "compression" → "tokens saved." No story beyond cost.
- They handwave quality: "no" effect on reasoning. **They cite no research.** We can.
- Their "RTK Cloud" coming-soon section is half the page and sells nothing yet
- No clear answer to "WHY does compression matter beyond money?"
- Footer + nav are heavy (six columns) — old-feeling, exactly as Anuj noted

---

## The wedge — *our different story*

RTK sells **"save tokens."** That's an axis they own (52k★, Rust, mature).

Sipcode sells **"clean context = right answers (and lower cost as proof)."** Same engine, deeper story. The repositioning we already locked in (`docs/superpowers/specs/2026-06-05-...`) is *exactly* the differentiation a landing page needs.

This means our page is structurally different — not "RTK but prettier."

| Dimension | RTK | Sipcode (the difference) |
|---|---|---|
| **Promise** | Cheaper bill | Sharper agent + cheaper bill |
| **Anchor concept** | "CLI noise" | **"Context rot"** (academically named, search-trending) |
| **Proof model** | Token compression % | Token reduction *as evidence* of clean context + cited reliability research (29% / 40%) |
| **What it shows** | Compression only | **Valve** (prevent) + **Meter** (measure) + **Drift** (detect) — three coordinated layers |
| **Mascot/visual** | Viking with axe | A measured *sip* visual — meniscus + S mark we already have. Quiet competence, not battle metaphor |
| **MCP integration** | None | We have 13 MCP tools — usable inside Claude Desktop chat (RTK can't reach Desktop users at all) |
| **Honesty contract** | Bold "no effect on reasoning" with no citation | We *cite* research, *measure* what we measure, never claim what we can't prove |
| **Reliability claim** | Absent | "Context engineering is the defining 2026 dev skill" — current wave, backed by Gartner / Anthropic research |

---

## Sections our page MUST have (in order, with stance vs RTK)

### 1. Hero (must be sharper than theirs)
- **Headline:** lead with the reframe, e.g. *"Sip your tokens. Don't gulp them."*
  Subhead: *"Keep Claude Code's context clean — sharper answers and lower cost, automatically."*
- **Hero visual:** our existing **meniscus + S** brand mark (quiet, calm — explicit contrast with their loud Viking).
- **CTAs:** "Install" (npm one-liner) + "Star on GitHub" + the **drift** demo screen as a static screenshot.

### 2. The "context rot" explainer (RTK has nothing like this — our wedge)
- One paragraph + a tiny diagram: bloated context → hedged, forgetful, sloppy Claude.
- **Cited:** Anthropic-published numbers (29% quality lift / 40% fewer agent errors with clean context).
- Disclaimer in the same block: *"We cite these from research. We measure the token/context part ourselves."* → trust, not BS.

### 3. The three-layer story (the visible "we do more")
Three clean cards (not RTK's "three product Forge" loose grouping — *one* product, three layers):
- **Valve** (`sipcode proxy`) — prevents bloat automatically
- **Meter** (`why` / `impact` / `stats` / `benchmark`) — measures honestly
- **Drift** (`sipcode drift`) — silent alarm when context starts rotting (with a screenshot of the new structured output)

### 4. Before / after demo (match their strength — make it ours)
- 4–6 commands side-by-side, with **honest deltas**: `git status`, `git log`, `grep -r`, `npm ls`, native `Grep` tool, native `Glob` tool.
- Numbers come from our actual rewriter logic + benchmark corpus — not invented.
- Below the demo, a small line: *"62.6% median on a locked corpus you can reproduce in 90 seconds: `npx sipcode benchmark`."* (RTK has no reproducible-by-anyone benchmark.)

### 5. Tool-by-tool savings table (mirror their best section, smaller scope)
- Focus only on **Claude Code** (and the **Claude Desktop MCP** angle they can't match).
- Two columns instead of eight — clarity over breadth.

### 6. The drift section (THE differentiator — biggest single block)
- Live screenshot of the new structured drift output.
- Caption: *"Silent until your context actually regresses. No dashboard to babysit."*
- Sub-block: *"Plus the `get_drift_report` MCP tool — ask Claude Desktop 'is my agent drifting?' inside chat."*

### 7. "Works inside Claude Desktop chat too" (RTK has zero presence here)
- The 13 MCP tools, one line on what each does.
- The killer line: *"RTK only works in your terminal. Sipcode also lives in Claude Desktop chat — install, audit, predict cost, all without leaving the chat."*

### 8. Installation (match their 30-second feel; one-liner first)
```
npm install -g sipcode      # 1. install the toolkit
sipcode proxy --install     # 2. turn ON the optimizer
```
Plus the Desktop MCP config block. **One command stack, no shell-script-piped-to-sh** (which scares cautious devs — small win on trust).

### 9. Honesty section (RTK has nothing like this — biggest brand statement)
A short block titled *"What Sipcode does NOT do"*:
- Only optimizes Claude Code; Desktop chat itself can't be intercepted (architectural fact)
- Installing the npm package alone changes nothing until you run `proxy --install`
- Reliability numbers are *cited* from research, not measured by us
- No telemetry, no network calls from any core path

**This is brand differentiation.** RTK doesn't acknowledge any of its limits. Owning ours = the entire "agent reliability" play we're making.

### 10. FAQ (mirror their structure; correct answers)
6 questions:
1. What is Sipcode?
2. How does Sipcode differ from RTK? *(answer: complementary, but Sipcode is the only one with MCP + drift + reliability framing)*
3. How much does it save? *(answer: 62.6% median on our reproducible benchmark; your real number from `sipcode proxy --stats`)*
4. Does it affect Claude's answer quality? *(cite research, then say what we measure)*
5. Is it free? *(MIT, no telemetry)*
6. Why "sip, don't gulp"? *(the brand → the science → the product, one breath)*

### 11. Footer (lean — explicit reject of their six-column heaviness)
Three columns max: Docs / GitHub / Brand. Build/version badge. MIT.

---

## What we DELIBERATELY do NOT take from RTK

- **No Viking / mascot violence.** Our brand is calm sip vs reckless gulp. Tonal contrast = remembered contrast.
- **No "X teams on the waitlist" empty counter.** Theirs reads "0 teams" — embarrassing. We won't put placeholder social-proof on the page until we have it.
- **No "Cloud coming soon" half-empty section.** We don't yet have Cloud. Don't promise.
- **No language switcher (6 langs).** Premature; one good English page beats six mediocre.
- **No telemetry-or-not nuance buried in FAQ.** Ours is a top-level promise.

---

## Honesty constraints (the launch's brand-defining rules)

Any number on the page must be in ONE of three categories — labeled visibly:

1. **Measured by us** (token deltas from real rewriters, benchmark % from reproducible corpus, test count). Show the math.
2. **Cited from research** (the 29% / 40% reliability numbers; "context engineering is the 2026 skill"). Cite the source inline.
3. **Self-reported** (e.g. eventually "X devs installed last month"). Mark "self-reported."

**No placeholders. No vanity counters. No "X teams on the waitlist."** If we don't have a number, we don't fake one. This rule alone is a differentiator and we should mention it in the honesty section.

---

## Tech choice (free, modern)

- **Static HTML + CSS** (or Astro like RTK uses — but a single HTML file is enough for v1)
- **Hosted on GitHub Pages** (free, lives in the existing `Anuj7411/sipcode` repo)
- URL: `anuj7411.github.io/sipcode` — fine for launch; pay for a custom domain only when revenue justifies
- No build step required for v1 (one HTML file, one CSS file)
- Lighthouse 95+ is achievable trivially (no JS, no frameworks)

**Cost: ₹0.**

---

## Open decisions (for Anuj to settle before build)

1. **Hero visual** — confirm we're using the existing meniscus+S brand mark; if it lives in `_brand/` or a Canva, we need the SVG/PNG ready.
2. **GIF demo or static screenshot?** GIF feels alive but is heavier; static is faster + Lighthouse-friendly. Lean static for v1, GIF for v2.
3. **Where does the eventual launch video embed?** Hero (high impact, slows page) or its own section below the three-layer cards (faster page)? Lean below-the-fold for the v1 page.
4. **Is `anuj7411.github.io/sipcode` the launch URL** or do we want `Anuj7411.github.io/sipcode` (capital A) — depends on the GitHub username casing; one minute to confirm.

---

## Outcome of this doc

We now have a clear plan that says *what to build* and *what to deliberately not borrow* — so the page is stronger than RTK's on substance (the reliability + context-rot story, the honesty section, the MCP-in-Desktop angle) without copying their layout. Next step is to draft the actual `index.html`.
