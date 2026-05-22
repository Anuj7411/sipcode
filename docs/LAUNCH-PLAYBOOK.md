# Sipcode launch playbook

**For the day you actually post.** Everything below is ready to copy-paste with light edits. Built around the v1.2.3 integrity contract + the **observatory positioning** (Sipcode is the audit + MCP + cost-prediction layer; RTK is the optimizer proxy layer; they pair).

> **POSITIONING DECISION (LAUNCH-DAY ONLY — not the long-term vision):** On launch day, Sipcode does NOT lead with "best token optimizer." That ground is held by RTK (https://github.com/rtk-ai/rtk, 52k stars) and we don't fight head-on day 1. Sipcode leads with the OBSERVATORY angle — *where did your tokens go, how much will the next task cost, is it actually saving me anything, and it lives inside Claude Desktop chat*.
>
> **The North Star is in [`docs/VISION.md`](VISION.md): Sipcode IS being built to be the best token-saving tool for every AI coding agent.** Multi-agent (Cursor, Codex, Gemini, Aider, ...) is the v2.0+ horizon. Phase A (parity proxy ~week 1) + Phase B (AST-aware semantic compression ~week 4) is the engineering path to "best optimizer." The OBSERVATORY framing is a LAUNCH-DAY positioning to avoid an unwinnable head-on fight, not a permanent product identity.
>
> When launch posts ship, do NOT say "Sipcode will never be the optimizer." Say *"Sipcode launches today as the observatory. Phase A ships the optimizer parity in a week. Phase B ships the semantic-compression leapfrog in a month. Multi-agent expansion follows."* That's the truthful framing of the journey.

---

## The defensible positioning (after the RTK analysis)

Sipcode is the **token observatory** for Claude Code, not the optimizer:
- **See** where your tokens died (`sipcode why`)
- **Predict** what the next task will cost (`sipcode estimate`)
- **Prove** whether optimizations are working on your own data (`sipcode impact`)
- **Live in chat** — 6 MCP tools that surface all of the above inside Claude Desktop conversation

RTK is the better TOKEN OPTIMIZER (60-90% savings via transparent proxy). Sipcode is the better TOKEN OBSERVATORY. **Pair them.** The README and posts should recommend stacking both.

## The two claims that survived skeptical scrutiny

A Claude Desktop reader analyzed Sipcode's own output on 2026-05-22 and pushed back hard on the dollar-savings framing. **These two claims survived:**

### Claim A — defensible savings (use freely)

> *"Output ratio improved 70% relative in my first 2 days of dogfooding sipcode v1.0 (0.7% → 1.2%) — but the tool itself flagged my sample as `insufficient-post-data` for a true A/B. That's the integrity contract: Sipcode refuses to confirm a savings claim it can't defend, even with its own author's data."*

**Why this works:**
- The relative improvement (70%) is a defensible normalization-resistant signal.
- The honest caveat (`insufficient-post-data`) IS the trust-builder, not a weakness.
- Survived a skeptical analyst who would have shredded a "$12K saved" version.

### Claim B — the 62.6% benchmark median (use freely)

> *"Median savings across the published 20-task benchmark corpus: 62.6%. Range: 37.4% – 80.6%. Reproducible on your machine with `npx sipcode benchmark` in 90 seconds. No marketing claims, no proxies — same code path that produced the README number."*

**Why this works:**
- Locked corpus + published methodology.
- Anyone can verify it themselves.
- The range (37.4% – 80.6%) is wide enough to be honest about variance.

---

## The credibility flex

**Take one screenshot of Claude in your Desktop pushing back on the savings claim using the v1.2.2 structured output.** That image is the most powerful endorsement Sipcode can ship — *"my own tool just refused to confirm a claim I wanted to make."*

The phrase to lift verbatim from the reader's analysis:

> *"Anyone who tells you otherwise — including a future marketing page — is overreading 2 days of data."*

This is a tool refusing to mislead its own author. Engineers will trust that.

**How to use it:** embed the screenshot in one of the Twitter thread tweets (probably the privacy/trust tweet — tweet 7) with a caption like:

> *"sipcode v1.2.2 ships a structural integrity contract: when the windows aren't comparable, `delta` is null and the headline names the reason. So I cannot lie to you with my own tool, even if I wanted to. That's the trust I want this brand to have."*

---

## Drafted posts (final versions — light edits before posting)

### Twitter / X thread (8 tweets)

**Tweet 1 — the hook:**
> An independent study of 38 Claude Code sessions found that only **0.6%** of all tokens spent were actual code output.
>
> The other 99.4% was exploration, re-reads, idle context, and repetition.
>
> I built a tool that audits exactly where the waste went. One command. No install. 🧵

*(Embed: `.sipcode/receipts/<id>/receipt.png`)*

**Tweet 2 — the problem:**
> Anthropic's own benchmark: **$13 per developer per active day** on Claude Code.
>
> A 5-person team: ~$16,250/year in tokens.
>
> They removed Claude Code from the $20 Pro plan — pushing entry-level cost out of reach for many indie devs.
>
> The waste is the opportunity.

**Tweet 3 — the one-liner:**
> Sipcode runs on the `.jsonl` transcripts Claude Code already writes to your disk. No signup, no config, no telemetry.
>
> ```
> npx sipcode why
> ```
>
> That's it. It tells you exactly where your tokens went in your last session.

**Tweet 4 — the wow output:**
> Real output from a 60-hour session:
>
> ```
> sipcode why · session 84bbf968 · 60h 26m
> ─────────────────────────────────────────
> total tokens          4,551,742
> output ratio              0.3%  ← only 0.3% was code
> top leak: 18 re-reads of CONTEXT.md  ($3.94)
> top leak: idle context after compact  ($2.78)
> sipcode would have saved              $14.34
> ```

**Tweet 5 — the measured savings:**
> I built a 20-task reproducible benchmark. Locked corpus, published methodology.
>
> **Median savings: 62.6%.** Range: 37.4% – 80.6%.
>
> Run it yourself in 90 seconds:
>
> ```
> npx sipcode benchmark
> ```
>
> Numbers are on your machine. No marketing claims, no benchmark proxy.

**Tweet 6 — the MCP differentiator:**
> Sipcode is the first token-optimization tool that lives inside the Anthropic Claude Desktop chat itself.
>
> Ask Claude *"audit my last session"* and it calls sipcode in the chat.
>
> 6 MCP tools registered. Works in Claude Desktop, Cursor, Continue — any MCP-aware client.

**Tweet 7 — the trust line + credibility flex** (embed the Claude-pushback screenshot here):
> Privacy is engineered, not promised. A static CI test fails the build if anyone adds `node:http/https/net/dns/tls` to a core path.
>
> **And: sipcode refuses to mislead you with its own data.** When the comparison windows aren't fair, the tool returns `delta: null` and names the reason. Here's it pushing back on my own savings claim ↓

*(Embed: screenshot of Claude in Desktop analyzing the impact tool output and refusing to confirm a savings number)*

**Tweet 8 — CTA:**
> Open source, MIT, npm `sipcode`, 831 tests passing.
>
> If it saves you $1, leave a ⭐
>
> 🔗 github.com/Anuj7411/sipcode
>
> Built solo. Would love to hear what you find when you run `sipcode why` on your own sessions.

---

### Show HN post

**Title (≤80 chars):**
> Show HN: Sipcode – install-free Claude Code token auditor (62.6% measured savings)

**Body:**

```
Hi HN — I'm Anuj. I built Sipcode because my Claude Code Max plan was
burning out in ~2 hours and I wanted to know where the tokens actually went.

The wedge: an independent dev.to study of 38 Claude Code sessions found
that only 0.6% of tokens in a typical session were actual code output.
The other 99.4% was exploration, re-reads, idle context, and repetition.
Sipcode targets the other 99.4%.

The install-free demo is:

  npx sipcode why

That command reads the .jsonl transcripts Claude Code already writes to
your machine and shows you exactly where your tokens went — re-read
files, idle context after auto-compact, cache-creation overhead, top
expensive tool calls. No install, no signup, no config, no network
calls. Runs in under 5 seconds on a multi-hour session.

The headline savings number is 62.6% median across a locked 20-task
benchmark; range 37.4% – 80.6%. Fully reproducible:

  npx sipcode benchmark

Methodology published at benchmark/METHODOLOGY.md.

What I think makes this different from existing tools (Caveman, RTK,
Graphify, Headroom, ccusage):

- One install, not five. Existing fixes get to ~85% reduction but take
  a day of manual config. Sipcode unifies them.
- An MCP server (sipcode-mcp) — 6 tools that Claude Desktop / Cursor /
  Continue can call live during a chat. Ask "audit my last session" and
  Claude pulls the forensic report into the conversation.
- Privacy is engineered, not promised — a static CI test fails the build
  if anyone adds node:http/https/net/dns/tls to a core path. Zero
  network calls, zero telemetry, asserted by a test.
- An integrity contract on the savings tool. When the before/after
  comparison windows aren't comparable, `verify_sipcode_impact` returns
  `delta: null` and names the reason ("window-asymmetry-39d-vs-2d").
  Output ratio leads the headline because it's the only normalization-
  resistant metric. I can't lie to you with my own tool.

Engineering caveats I want on the record:

- All measurements assume Claude Code v1.x's .jsonl format. If
  Anthropic changes the schema, the parser will need an update.
- 62.6% is on MY benchmark corpus. Your real workload will vary
  (37.4–80.6% range). Run `sipcode impact` after a few days for your
  own number — and if your post-install window is too short to be
  comparable, the tool will tell you so instead of inventing a savings
  claim.
- Not magic. Savings come from: output compression (shorter responses),
  manifest injection (a 2k-token map instead of grepping 200k tokens),
  context-pressure hooks (warns at 50/70/90% so /compact happens at the
  right moment), and read-once rules.

What I'd love feedback on:

1. What's the most useful MCP tool you'd want in Claude Desktop that I
   haven't shipped yet?
2. Anyone benchmarked their own savings with `npx sipcode benchmark` —
   what's your spread vs the 62.6% median?
3. For folks running Cursor / Codex / Aider — would multi-agent support
   (`sipcode init --agent cursor`) actually move the needle, or is the
   Claude Code wedge enough?

Repo: https://github.com/Anuj7411/sipcode
npm:  https://www.npmjs.com/package/sipcode

MIT. 831 tests passing. 5-gate release pipeline. v1.2.2 on npm.
```

---

### Reddit r/ClaudeAI post

**Title:**
> I built a CLI that audits where your Claude Code tokens are actually going — measured 62.6% savings, install-free demo

**Body:**

```
Hey r/ClaudeAI — I'm Anuj. Solo indie dev.

My Claude Code Max plan was burning out in ~2 hours and I had no idea
where the tokens were going. I went looking for an audit tool and found
fragments — Caveman for output, RTK for CLI filtering, ccusage for
measurement, Headroom for API compression. Stacking all of them gets
to ~85% reduction but takes a full day of manual config. I bounced off
the setup and decided to build my own unified tool.

Sipcode is what I wish existed when I started.

The install-free demo:

    npx sipcode why

That command reads the .jsonl transcripts Claude Code already writes
to ~/.claude/projects/ and tells you exactly where your tokens went in
your last session. No install needed, no signup, no telemetry, no
network calls (asserted by a CI test).

Real output from one of my sessions:

    sipcode why · session 84bbf968 · 60h 26m
    ─────────────────────────────────────────
    total tokens          4,551,742
    output ratio              0.3%  ← only 0.3% was code
    top leak: 18 re-reads of CONTEXT.md  ($3.94)
    top leak: idle context after compact  ($2.78)
    sipcode would have saved              $14.34

The output ratio is the punchline. There's an independent dev.to study
of 38 Claude Code sessions that found only 0.6% of tokens were actual
code output — the other 99.4% was waste. That's the wedge sipcode targets.

Features I'm most proud of:

* `sipcode benchmark` — runs a locked 20-task corpus on YOUR machine,
  prints the savings number. Median is 62.6%. Methodology published.
  Reproducible — you don't have to trust me.

* `sipcode-mcp` — sipcode also ships as an MCP server. Add 4 lines to
  Claude Desktop's config and Claude can call sipcode's 6 analysis
  tools live during a chat. Ask "audit my last session" and Claude
  pulls the forensic report into the conversation.

* `sipcode impact` (and the matching `verify_sipcode_impact` MCP tool) —
  compares your token spend before/after you installed Sipcode. The
  "is this actually saving me tokens?" tool. Refuses to mislead: if
  your post-install window is too short to compare, the tool returns
  `delta: null` and names why instead of inventing a savings number.

* `sipcode receipt` — generates a shareable PNG receipt (auto-clipboard,
  pre-filled tweet intent).

Install:

    npm install -g sipcode

Repo (open source, MIT): https://github.com/Anuj7411/sipcode
npm: https://www.npmjs.com/package/sipcode

If you try it and `sipcode why` shows something interesting in your
sessions, I'd love to hear about it. Specifically:

- What's your output ratio? (0.3% was me; expect 0.5–2%)
- What's your top leak?
- Did `sipcode benchmark` give you a number near 62.6%, or was your
  workload really different?

Happy to answer anything about the engineering side too — 5-gate
release pipeline, 831 passing tests, OIDC-based npm publishing, the
privacy guard test, etc.

Cheers.
```

---

## Distribution checklist (when actually posting)

- [ ] Take the credibility-flex screenshot (Claude pushing back on impact tool) before posting Tweet 7.
- [ ] Verify `sipcode@1.2.2` is still latest on npm (`npm view sipcode version`).
- [ ] Verify GitHub repo is public and the README still flows top-to-bottom.
- [ ] Post Twitter thread first (warm up the lead).
- [ ] Post Show HN ~30 minutes later (weekday morning US Eastern, 9-11am EST).
- [ ] Wait 2-4 hours for HN signal before posting Reddit (Reddit can suck attention away from HN if posted simultaneously).
- [ ] **Do NOT ask friends to upvote on HN** — vote rings get dead-posted.
- [ ] Watch HN/Reddit/Twitter for comments. Reply within 60 minutes of every comment in the first 6 hours.
- [ ] Every comment is a feature signal. Note what users ASK FOR — that's the v1.3.0 backlog.

## Bonus channels (optional secondary distribution)

- `r/LocalLLaMA` — very technical, will love the engineering rigor
- `r/AnthropicAI`
- Indie Hackers
- Lobste.rs (only if you have an invite)
- Anthropic developer Discord

## What NOT to say

| Don't say | Why |
|---|---|
| "Sipcode saved me $12,000" | The reader's analysis explicitly shredded this framing. Use the 70% relative output-ratio claim instead. |
| "97% cost reduction" | Same. Confounded by window asymmetry. |
| "AI-powered" | HN downvotes vague buzzwords. Sipcode is *zero-LLM* — say that instead. |
| "Revolutionary" / "Game-changing" | Indie launches die on hype words. |
| "Always-fresh latest version" | We don't have auto-update yet. DXT is on the v2 roadmap. Don't overclaim. |
| "Sipcode is the best token optimizer" | RTK (52k stars) holds that ground for now via runtime proxy. Don't fight head-on — lead with observatory + MCP wedge. Phase A (parity proxy) ships ~5 days post-launch and we'll re-pitch then. |
| "RTK is bad / Sipcode replaces RTK" | Engineers will fact-check. They're complementary, not competing. Recommend stacking both. |

## What TO say

- *"829 tests passing"* (or whatever count is current at post time)
- *"Reproducible benchmark — run it yourself in 90 seconds"*
- *"Privacy is engineered, not promised — there's a static CI test"*
- *"Refuses to mislead you with its own data"* (the v1.2.2 integrity contract)
- *"Zero network calls. Zero telemetry."*
- *"Solo indie dev. Built because my own Max plan was burning out in 2 hours."*
