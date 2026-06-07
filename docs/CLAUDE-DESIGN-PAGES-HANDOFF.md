# Sipcode landing — sections handoff for claude.design

> **For Anuj:** paste everything below the rule into claude.design.
> claude.design designs visuals only. All copy, data, and structure are locked in this doc.
> Edits to content happen in the Sipcode repo, not in claude.design.

---

# Sipcode landing — sections to design

## Context (read once, design accordingly)

Sipcode is an open-source token and context optimizer for Anthropic's Claude. Tagline: **"Sip your tokens. Don't gulp them."** A gulp is a bloated context; a sip is a clean one. Lean context cuts the bill and sharpens the agent at the same time.

The hero and a Why section are already built and live. Reference them for visual cohesion:

- **Hero:** light editorial paper background, faint plot grid with a bezier curve at the bottom, left-edge ruler ticks, corner reticles. Headline left, animated mascot vessel right. The vessel has a face that shifts emotion (happy when sipping, stressed when gulping) and an interactive Sip/Gulp slider.
- **Why:** bento layout (one large card spans two rows, two smaller cards stack beside it), a side-by-side chat comparison showing context rot, an animated 29% counter card, an arXiv paper link card, and a pull quote.

The sections below continue from there. Match the existing palette, type, and quiet voice.

## Brand essentials (do not restyle)

**Colors:**
- Ink `#0A0A0A` (text, lines, vessel outline)
- Sip Violet `#5B4FCF` (accent)
- Paper `#F8F8F6` (background)
- Charcoal `#2D3142` (secondary text)

**Type:**
- Space Grotesk (display, weights 500–700)
- Inter (body, 400–600)
- JetBrains Mono (code, labels, metrics)

**Assets ready to use** (already in the repo's brand kit):
- Vessel icon, sipcode wordmark, favicon, OG image, Product Hunt thumbnail.

## Voice rules (apply to every word added)

- No em-dashes (— or --). Use commas, colons, periods, or parentheses.
- No hype verbs (revolutionize, supercharge, unleash, transform, disrupt).
- No numbered display markers as section labels (01, 02, 03). It reads as AI scaffold.
- No "documented across Claude, GPT, Gemini, and Qwen" style listings.
- Numbers are always labeled. *measured by Sipcode* / *cited from research* / *self-reported*.
- No exclamation points in body copy.

---

## Section 1: Demo

### Purpose
Show what gets compressed and by how much, in numbers a developer can verify. This is the section where someone decides "yes, this is real."

### Layout suggestion
A clean table or card grid is fine; the design call is yours. Six rows minimum. Mono everywhere for the numbers. A small reproducibility line beneath.

### Content (verbatim)

**Eyebrow:** Before and after
**Headline:** Six commands. The same answer, fewer tokens.
**Lede:** Sipcode rewrites the bulky tool calls Claude Code makes for you, before they fire. Same information reaches Claude in a fraction of the tokens.

**Table rows (each row: command, before tokens, after tokens, percent saved):**

| Command | Before | After | Saved |
|---|---|---|---|
| `git status` | 200 | 30 | 85% |
| `git log` | 2,500 | 500 | 80% |
| `git diff` | 21,500 | 1,260 | 94% |
| `grep -r` (recursive) | 12,000 | 2,400 | 80% |
| Native Grep tool | 10,000 | 2,000 | 80% |
| Native Glob tool | 4,500 | 1,500 | 67% |

**Reproducibility line (mono, smaller, beneath the table):** 62.6 percent median across a locked 20-task corpus. Reproduce in 90 seconds with `npx sipcode benchmark`.

**CTA:** Link "See the benchmark methodology →" goes to `/benchmark/METHODOLOGY.md` on GitHub. Visual style: a quiet text link, not a button.

### What to avoid
- Animated counters on every row. One quiet reveal on scroll is enough.
- Color-coded percentage badges in red/green. Use violet for "saved" only.

---

## Section 2: Drift

### Purpose
The flagship feature, and the cleanest visual differentiator on the page. Show the structured `sipcode drift` output as a polished terminal-style mockup. Visitors should read it and immediately understand what the tool tells them.

### Layout suggestion
Centered terminal card, generous padding around it. A short headline above. A small caption beneath. Optional: a thin "live" badge in the corner of the mockup.

### Content (verbatim)

**Eyebrow:** New in 1.6
**Headline:** A smoke alarm for context rot.
**Lede:** Silent unless something actually regressed. When it does, it names the metric, shows your norm vs this session, and tells you what to do.

**Terminal mockup content (render exactly as below, monospace, dark or light theme is your call but keep it light to match the page):**

```
⚠  Context drift detected in your latest Claude Code session

What this means: your newest session is behaving differently from your
recent norm, in ways that waste tokens and can make Claude less reliable.
(This is "context rot": answer quality drops as context gets bloated.)

Signals that regressed (2):

  ▲ Tokens per turn  ·  up 662%
      your norm: 1,050   →   this session: 8,000
      Each step is sending far more context than your norm. Bloated context
      costs more tokens and can bury the detail Claude needs.
      → Fix: Start a fresh chat for your next task to reset the context.

  ▼ Cache reuse  ·  down 90 points
      your norm: 90%   →   this session: 0%
      Much less of your context is being reused from cache (about 10x cheaper).
      → Fix: Avoid changing MCP servers or config mid-task.

Measured against the median of your last 6 sessions.
Conservative by design: silent unless something really moved.
```

**Caption beneath:** Available as `sipcode drift` in the CLI and as the `get_drift_report` MCP tool, so you can ask Claude Desktop directly: "Is my agent drifting?"

### What to avoid
- A fake glow around the terminal.
- Animated typing of the output. It reads slower than static and feels demo-ish.

---

## Section 3: Install

### Purpose
Two clear paths, both fast. One for Claude Code (terminal). One for Claude Desktop (chat). No `curl | sh`. The npm route is what we ship.

### Layout suggestion
Two cards side by side on desktop, stacked on mobile. Each card has a tab label, a short instruction, and a copyable code block. Maybe a small "restart required" note.

### Content (verbatim)

**Eyebrow:** Get running in under a minute
**Headline:** Two surfaces. Same toolkit.

**Card A — For Claude Code (terminal):**

Tab label: `Claude Code`
Instruction line: Install the package, then turn on the proxy hook.
Code block:
```
npm install -g sipcode
sipcode proxy --install
```
Post-install note: Restart Claude Code. You are done.

**Card B — For Claude Desktop (chat):**

Tab label: `Claude Desktop`
Instruction line: Add the MCP server to your config, then restart Desktop.
Code block (JSON):
```json
{
  "mcpServers": {
    "sipcode": { "command": "npx", "args": ["-y", "sipcode-mcp"] }
  }
}
```
Post-install note: After restart, ask Claude "what sipcode tools do you have?" to confirm.

**Below both cards:** A small system requirements line: Node.js 20 or newer. Works on macOS, Linux, Windows.

### What to avoid
- A "one-click install" button that does nothing.
- Selectable language tabs (Python, Go, etc.). There is one stack.

---

## Section 4: What Sipcode does NOT do

### Purpose
The honesty section. This is the most important block for trust. Other tools hide their limits. Sipcode names them on the homepage. Design this section to feel deliberate, not like a footnote.

### Layout suggestion
A short headline, then a tight list of four. Could be a quiet inset, a card with a hairline border, or a row of small cards. Restraint matters more than decoration.

### Content (verbatim)

**Eyebrow:** What we will not pretend
**Headline:** Sipcode does not do these things.

**The four items (each with a one-sentence reason):**

1. **It does not optimize Claude Desktop chat itself.**
   The Desktop pipeline is closed. The proxy hook only works in Claude Code. Desktop users get the analytics tools.

2. **It does not change anything until you turn it on.**
   `npm install -g sipcode` puts the package on your machine. Tokens drop after you run `sipcode proxy --install`.

3. **It does not claim Claude got smarter.**
   The 29% and 40% reliability numbers come from published research, cited not measured. We measure the tokens we save.

4. **It does not phone home.**
   No telemetry. No network calls in any core path. A CI guard fails the build if that ever changes.

### What to avoid
- A "trust badge" row of fake security logos.
- Calling this section "Trust" or "Promise". Let the content speak.

---

## Section 5: FAQ

### Purpose
Answer the six questions a careful developer asks before installing. Each answer is short.

### Layout suggestion
A simple accordion. One column. Each item collapsed by default, except the first if you like. Type hierarchy is enough; no boxes inside boxes.

### Content (verbatim)

**Eyebrow:** Honest answers
**Headline:** Questions people actually ask.

**Q1: What is Sipcode?**
An open-source toolkit that keeps Claude Code's context clean. It rewrites bulky tool calls before they run (the proxy), measures what got saved (the meter), and warns you when a session starts to drift from your baseline (the drift detector). MIT licensed.

**Q2: How is it different from RTK?**
Sipcode covers terminal use through Claude Code and chat use through Claude Desktop's MCP. RTK is terminal only. Beyond that, Sipcode adds a drift detector and a transcript-based meter that nobody else ships. You can use both. They do not conflict.

**Q3: How much will it actually save me?**
The reproducible benchmark shows a 62.6 percent median. Your number will depend on your workload. After install, `sipcode proxy --stats` shows the exact tokens rewritten on your machine.

**Q4: Does it change Claude's answer quality?**
Research shows leaner context lifts agent reliability. We cite that research. Sipcode measures the tokens it saves, not the quality lift, so we do not put a number on the quality side. You will judge for yourself.

**Q5: Is it free?**
Yes. MIT licensed. No account. No telemetry. No paid tier.

**Q6: Why "sip, don't gulp"?**
A gulp is a context dumped into Claude without restraint. It costs more and makes the model worse. A sip is the same information, measured. Sipcode keeps the intake at a sip.

### What to avoid
- Pricing question. There is no pricing.
- "Enterprise" question. There is no enterprise tier.

---

## Section 6: Final CTA

### Purpose
Send the visitor to install with one clear next step.

### Layout suggestion
A compact band. Headline, sub, two CTAs. Centered. Quiet background, not a gradient block.

### Content (verbatim)

**Headline:** Stop gulping your tokens.
**Sub:** Runs locally. No account. No telemetry. About 60 seconds to set up.
**CTAs:** `Install` (primary, anchors to Install section) and `Star on GitHub` (secondary).

---

## Section 7: Footer

### Purpose
The legal/useful row.

### Layout suggestion
Three columns max on desktop, stacked on mobile.

### Content (verbatim)

**Column 1: Docs**
- Quickstart
- MCP guide
- Benchmark methodology

**Column 2: Project**
- GitHub
- npm
- Issues
- Changelog

**Column 3: Brand**
- "Sip your tokens. Don't gulp them."
- Built by Anuj Ojha
- MIT License

**Footer bottom row:**
- Version badge: `v1.6.4`
- Tests badge: `997 tests passing`
- Year: `2026`

### What to avoid
- A newsletter signup form.
- A six-column footer.
- Social icon row with platforms we do not actively post on.

---

## Tech constraints (must hold)

- Static HTML + CSS, JS only where interaction needs it. The page must read without JS enabled.
- Built with Astro. Component libraries allowed (Skiper UI, 21st.dev components) when they save real time. Each must render to static HTML at build time; hydrate per-component only when needed.
- Lighthouse 95+ on Performance, Accessibility, Best Practices, SEO. Hard gate.
- Total page weight under 350KB including hero mark and fonts.
- Mobile-responsive from 360px.
- No analytics, no trackers, no cookies in v1.
- All sections must be deep-linkable (each gets an `id` so the nav anchors work).

## Anti-spec (do not add)

- A mascot or character beyond the existing vessel.
- Coming-soon placeholders.
- A six-column footer.
- A language switcher.
- Stock photography.
- A pricing table.
- Cookie banners.
- Animated counters that tick on every metric.
- "As featured in" logo rows.
- Bounce or elastic easings.

---

## Deliverable

A complete set of section components that drop into the existing Astro project. One section per file. Use the existing brand tokens. Match the existing hero and Why section in tone. Provide a one-line description of how to import each component into `src/pages/index.astro`.

End of brief.
