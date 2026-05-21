# Post-v1.2.2 backlog — features surfaced by real signal

**Source:** Claude Desktop's critical analysis of `verify_sipcode_impact` output on 2026-05-22 (39d before vs 2d after). The reader (1) confirmed v1.2.2's integrity contract works, (2) surfaced three follow-up ideas that would make Sipcode's "proof of savings" claim more defensible. **None of these are launch blockers.** Triage them against real user signal post-launch — don't proactively build before users ask.

---

## 1. `sipcode ab-test "<task>"` — controlled head-to-head

**The reader's exact words:** *"Run a controlled comparison. Take one task you'd do twice anyway (a feature add, a refactor) and run it once with Sipcode optimizers on, once off. Same task, same model, same you. That's an A/B test. What you have now is a before/after with everything else changing too."*

**What it does:** runs the same task description twice through Claude Code:
- Pass 1: with Sipcode rules/hygiene/manifest disabled
- Pass 2: with them all enabled
- Captures both sessions, computes the delta, renders an honest head-to-head

**Why it matters:** the verify_sipcode_impact tool can only do before/after. An A/B test controls for the confound that the reader called out: *"whether the output-ratio improvement is from Sipcode's optimizers or from you working differently post-launch."*

**Estimated build:** ~4 hours. New command + new module + new MCP tool. Tests + e2e regression guard.

**Triggers to build:**
- Real user explicitly asks for it.
- More than 1 launch comment / HN reply says *"how do I prove the savings are from Sipcode and not from me working differently?"*

**Status:** Don't build until triggered.

---

## 2. `sipcode trend <metric> --since 90d` — single-metric time-series

**The reader's exact words:** *"Track output ratio over time, not totals. It's the one metric that's robust to session-length and project-mix variation. If it trends upward across the next month, Sipcode is doing something."*

**What it does:** plots a single metric (output ratio, cost-per-session, recoverable-tokens-per-session) as a daily/weekly trend line over a configurable window. Sparkline + structured data + optional HTML.

**Why it matters:** `sipcode stats` already shows a sparkline, but it's for total spend — that's the noisiest possible metric. The reader's point is that **output ratio is the only metric robust to session-length confound.** A standalone trend command surfaces that signal.

**Estimated build:** ~1-2 hours. Mostly wraps the existing stats `trendDaily` data into a new view. Tests + format-terminal + format-html.

**Triggers to build:**
- Users asking *"how do I see if sipcode is working over time?"*
- Anuj himself wanting to dogfood this 2 weeks post-launch.

**Status:** Strong candidate. Lowest cost of the three. Could be a quick v1.2.3 if a real signal comes in within a week.

---

## 3. Wait-14-days reminder system

**The reader's exact words:** *"Wait 14 days minimum for the post-install window to stabilize. The tool tells you this itself."*

**What it does:** when a user runs `verify_sipcode_impact` and the tool returns `insufficient-post-data`, the response includes a one-time prompt: *"Want me to remind you in 14 days?"* — if yes, writes a `.sipcode/impact-reminder.json` with the reminder date. When user runs `verify_sipcode_impact` after that date, the tool says *"the 14-day window you wanted has elapsed — here's the comparison you requested."*

**Why it matters:** closes the loop on the reader's recommendation. Users won't remember to come back; the tool should remember for them.

**Estimated build:** ~30 minutes. Tiny feature, all I/O on `.sipcode/`. Could ship alongside #2.

**Triggers to build:**
- Multiple users running `verify_sipcode_impact` repeatedly within the same 24-hour window (signals impatience for results).
- Anuj himself wanting the dogfood feedback loop.

**Status:** Low priority. Nice-to-have.

---

## Decision framework — when to pull these forward

Don't build any of these speculatively. Use this rubric:

- **0 real user mentions in 7 days post-launch** → leave them in backlog, focus on what users actually asked for.
- **1+ real user mention of #1** → build it as v1.3.0 — strongest credibility lever.
- **1+ real user mention of #2** → build it as v1.2.3 — cheap win.
- **Author's own dogfooding pain at day 7+** → counts as a real signal. Build the one that matters most.

---

## What v1.2.2 already covers (don't rebuild)

The reader's analysis also confirmed these are now properly handled — no further work needed:

| Reader's concern | Where v1.2.2 handles it |
|---|---|
| "97.8% cost reduction" misleading | `delta: null` when `status !== "measured"` |
| Window asymmetry (39d vs 2d) | `warningReason: "window-asymmetry-39d-vs-2d"` + headline says "window asymmetry — N before vs M after" |
| Output ratio as the honest metric | Measured-case headline now leads with output ratio |
| "tool itself flagged insufficient-post-data" | Already present in JSON output; v1.2.2 makes it impossible to override |

**The integrity contract is done.** Don't tighten it further until a real user finds another loophole.
