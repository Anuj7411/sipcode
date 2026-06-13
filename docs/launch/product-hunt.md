# Product Hunt launch — Sipcode v1.6.11

Three copy blocks: tagline, description, first-comment. All fits inside PH's 2025 character limits.

---

## Tagline (60 chars max)

> Keep Claude Code's context clean. Right answers, fewer tokens.

(58 chars. Lead with reliability per the locked positioning.)

## Alternate taglines (in case Hunt requires a swap)

- "Stop context rot in Claude Code. 62.6% fewer tokens." (54)
- "Open-source context engineering for Claude Code devs." (54)
- "Drift detector + token optimizer for Claude Code." (50)

---

## Description (260 chars max for the listing card)

Sipcode is an open-source toolkit that keeps Claude Code's context clean so the model gives you the right answer. It rewrites bulky tool calls before they run, dedups re-reads, scores how much signal each rewrite kept, and warns you when a session starts to drift. MIT licensed, zero telemetry. The reproducible benchmark shows 62.6% median token savings; the reliability lift comes from cleaner context, which Anthropic's own research measured at +29% quality.

(495 chars. Trim for the listing.)

### Listing-card version (260 chars)

Open-source toolkit that keeps Claude Code's context clean. Drift detector, re-read dedup, integrity scoring, AST-aware reads. 62.6% measured token savings on a locked benchmark. 15 MCP tools for Claude Desktop. MIT, zero telemetry.

(259 chars. Use this as the card description.)

---

## First-comment (the long-form pitch from the maker)

> Hey Product Hunt. I'm Anuj. I built Sipcode because I was burning through Claude Code Max in 2 hours and it took me a week to figure out why: my context was rotting. Stale reads, duplicate file fetches, the model losing the thread halfway through a refactor.
>
> Most token optimizers compete on raw compression. Sipcode bets on something else: **the goal isn't fewer tokens, it's right answers**. Token savings are how I prove the engine is working.
>
> What you get when you install:
>
> - **Drift detector** — silent unless your context starts bloating versus your baseline (the v2 flagship)
> - **Re-read dedup** — refuses to reload files Claude already has in context
> - **Integrity scoring** — every rewrite carries a "signal kept" number so you know when truncation might hide an answer
> - **AST-aware reads** — for TS/JS/Python files, returns only the symbol Claude searched for
> - **15 MCP tools** for Claude Desktop, including the two I shipped this week: `get_today_summary` and `forecast_monthly_spend`
>
> Reproducible proof: `npx sipcode benchmark` runs a locked 20-task corpus on your machine. Median saving: 62.6%. Total: 3.57M tokens, ~$67 across the corpus. Same transcripts. Same prompts. Anyone can re-run the numbers.
>
> What I'm NOT claiming: I am not telling you Sipcode stops hallucinations. LLMs hallucinate. What I'm claiming is narrower and provable: cleaner context reduces drift-driven errors. Anthropic measured a 29% quality lift from editing stale context; Sipcode is the tool that makes that lift accessible to individual Claude Code devs.
>
> Honest boundaries:
>
> - I do not have measured "X% fewer hallucinations" numbers. I cite Anthropic's research, not my own.
> - Single-run live benchmarks vary ±20%. The corpus median is the defensible number.
> - It works on Claude Code (terminal). Cursor support is partial today (config injection works, full transcript parsing lands in v2).
>
> Coming in v2 (committed, not vapor):
>
> - **Predictive context** — Sipcode reads your git co-edit history and pre-summarizes the next file Claude will probably need
> - **Cross-session context hygiene** — your context stays clean across days, not just sessions
>
> Install in three lines:
>
> ```
> npm i -g sipcode
> sipcode proxy --install
> sipcode why    # audit your latest session
> ```
>
> Repo: https://github.com/Anuj7411/sipcode
> Site: https://anuj7411.github.io/sipcode/
> MIT licensed. Open issues. Open transcripts. No account, no telemetry, no paid tier.
>
> I'm here all day. Tell me what's broken.

---

## Gallery / media plan (5 images, in this order)

1. **Hero shot:** the landing page hero with the mascot visible. Caption: "Keep Claude's context clean."
2. **Benchmark screenshot:** terminal output of `npx sipcode benchmark` showing the 62.6% median + per-task bar chart. Caption: "62.6% median, reproducible."
3. **Drift detector screenshot:** terminal output of `sipcode drift` after a drifted session. Caption: "Silent unless something regressed."
4. **Integrity scoring screenshot:** `sipcode proxy --stats` showing the per-rewriter "kept %" column. Caption: "Honesty signal RTK doesn't have."
5. **MCP tool screenshot:** Claude Desktop chat asking "how am I doing today?" and Sipcode answering. Caption: "15 MCP tools for Claude Desktop."

---

## PH-specific FAQ replies (have these warm)

**"What's the catch?"**
> No catch. MIT, no telemetry, no paid tier, no account. The repo is public, the benchmark transcripts are public, the test suite is public (1247 passing on v1.6.11).

**"Doesn't Anthropic already do this in Claude Code?"**
> Anthropic ships native context editing at the model layer. We ship at the tool layer — we intercept before the tool runs (PreToolUse hook) and we add features they don't yet ship (drift detector across sessions, per-rewrite integrity scoring, AST-aware reads on your local files). The two are complementary.

**"Is this another LLM ops platform?"**
> No SDK. No cloud. No instrumentation. Sipcode reads the `.jsonl` files Claude Code already writes locally. That's the whole moat against the enterprise FinOps stack — they need SDK + cloud + team pricing, we don't.
