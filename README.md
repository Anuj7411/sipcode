# Sipcode

> **Sip your tokens. Don't gulp them.**
> Token optimization for Claude Code and other AI coding agents.

[![npm version](https://img.shields.io/npm/v/@sipcode/cli.svg)](https://www.npmjs.com/package/@sipcode/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](#project-status)

---

> An independent study of 38 Claude Code sessions found that **only 0.6% of tokens were actual code output**. The other 99.4% was exploration, re-reads, and repetition. — [DEV Community, March 2026](https://dev.to/lsvishaal/i-analyzed-38-claude-code-sessions-only-06-of-tokens-were-actual-code-output-56li)

Run this in any terminal — **no install, no config, no signup**:

```bash
npx sipcode why
```

You'll see exactly where your tokens went in your last Claude Code session: which files were re-read, which sat idle in context for hours, which tool calls cost the most. **Sipcode runs entirely offline against the `.jsonl` transcripts Claude Code already writes to your machine.**

---

## What `sipcode why` actually shows

Real output from the session that built this very repo:

```
sipcode why · session 84bbf968 · 12h 15m · claude-opus-4-7
project: C--Projects-Sipcode

you burned 40,165,104 tokens. 369,465 were code output.
the other 39,795,639 were exploration, re-reads, and idle context.
output ratio: 0.9% of all tokens

if sipcode had been on, you could have saved ~1,229,837 tokens this session.
  · smart manifest (S001): 959,796 tokens
  · read-once cache (S030): 215,335 tokens
  · diff-output (S021):     54,706 tokens

top leaks (this session):
  1. idle context — 21,441,999 tokens (2 files held without re-reference)
  2. cache-creation overhead — 4,362,711 tokens (context written into cache)
  3. duplicate file reads — 215,335 tokens (1 files read more than once)

est. cost: $162.67 · 105 tool calls · 2 distinct files read
```

That's the demo. Run it yourself: `npx sipcode why`.

---

## Generate a shareable receipt

```bash
npx sipcode receipt
```

Writes a standalone HTML file and a **1200×630 PNG** to `.sipcode/receipts/<id>/`, prints a `file://` link, copies the PNG to your system clipboard, and gives you a pre-filled tweet intent URL. Built for sharing — it's how Sipcode spreads.

The PNG ships with brand typography (Inter Tight + JetBrains Mono), a five-color palette, and zero external dependencies. Open it in your image viewer to see what gets shared.

---

## Install (when you're ready to optimize, not just audit)

```bash
# Run once, save forever — no signup
npm install -g @sipcode/cli
sipcode init                        # interactive, three prompts max
```

`sipcode init` scans your repo with tree-sitter + git, infers conventions, and writes a `.sipcode/manifest.md` (under 2,000 tokens for a 500-file repo) plus a sipcode block in your `CLAUDE.md`. Your AI agent stops blindly exploring on every prompt.

Or non-interactive:

```bash
sipcode manifest --tighten          # regenerate manifest, drop low-signal sections
sipcode why --here                  # audit only sessions from this directory
sipcode receipt --html-only         # skip PNG, faster
```

---

## What you get

| Feature | What it does | Shipped? |
|---|---|---|
| **Privacy guarantee** | Local-first, zero-telemetry, asserted by a test that fails CI if a network module is ever imported in a core path. Full audit: [PRIVACY.md](PRIVACY.md). | ✅ v0.3.0 |
| **Cost framing** | "How much does this actually save you?" — specific dollar comparisons from the 62.1% median savings number. | ✅ v0.3.0 |
| **`sipcode why`** | Forensic audit of any past Claude Code session — no install required | ✅ v0.1.0-alpha |
| **`sipcode manifest`** | Static-analysis project map injected into `CLAUDE.md` — zero LLM calls | ✅ v0.1.0-alpha |
| **`sipcode receipt`** | HTML + PNG receipt + system clipboard + tweet intent URL | ✅ v0.1.0-alpha |
| **`sipcode init`** | Interactive setup (three prompts max) — runs manifest + injects CLAUDE.md | ✅ v0.1.0-alpha |
| **`sipcode rules`** | Output Compression (S020) — diff edits + no-preamble rules in CLAUDE.md, three modes (default/strict/verbose) | ✅ v0.2.0 |
| **`sipcode hygiene`** | Session Hygiene (S030/S031/S032) — read-once rule pack in CLAUDE.md + PreToolUse pressure-band hook (50/70/90%) + PostToolUse smart-`/compact` breakpoint hook | ✅ v0.3.0 |
| **`sipcode estimate "<task>"`** | Predicts session cost per model (opus / sonnet / haiku) before you run — heuristic + historical anchors, zero LLM calls | ✅ v0.2.0 |
| **`sipcode score`** | Static-analysis audit of any repo for "agent-friendliness" — 24 checks, 5 categories, shields.io badge, GitHub Action included | ✅ v0.2.0 |
| Hardest Tasks Benchmark | Canonical waste-maximizing corpus — the cited cost-waste benchmark | 🛠️ v0.4.0 |
| **`sipcode benchmark`** | Reproducible benchmark suite (S110) — 10-task locked corpus, median 62.1% savings, published methodology | ✅ v0.2.0 |
| **Multi-agent (Cursor)** | `sipcode init --agent cursor` writes `.cursor/rules/sipcode.mdc` — same wedge, now in Cursor. Codex / Gemini / Aider planned. | ✅ v0.2.0 (cursor; rules + manifest only — transcript parsing is claude-code-only for now) |

---

## Honest claims, no inflated numbers

Other tools quote 65–90% savings by only counting output tokens — but output is 20–30% of your bill. Sipcode targets **input** (file reads, idle context, repetition), which is 70–80% of the spend.

**Realistic stack savings (measured, not asserted):** **62.1% median** token reduction across a locked 10-task corpus that covers refactor, debug, feature, test, review, docs, migration, onboarding, optimization, and cross-file bugfix work. Range: 37.4% (pure docs) to 80.6% (codebase onboarding). Reproducible — run it yourself:

```bash
npx sipcode benchmark
```

Methodology, corpus, and aggregation formula are published in [`benchmark/METHODOLOGY.md`](benchmark/METHODOLOGY.md) — including a section on how to challenge a number. Per-module attribution from the latest run: S001 manifest 31.8% · S021 output compression 37.5% · S030 read-once cache 30.7%.

**Source data for the claims above:**
- [Claude Code Pricing 2026 — Anthropic](https://code.claude.com/docs/en/costs) — $13/dev/active day enterprise benchmark
- [Claude Code vs Cursor benchmark — Sitepoint](https://www.sitepoint.com/claude-code-vs-cursor-developer-benchmark-2026/) — Cursor uses 5.5× more tokens than Claude Code on identical tasks
- [I Analyzed 38 Claude Code Sessions — DEV](https://dev.to/lsvishaal/i-analyzed-38-claude-code-sessions-only-06-of-tokens-were-actual-code-output-56li) — the 0.6% study

---

## How much does this actually save you?

Anthropic's enterprise benchmark is **$13/dev/active day** on Claude Code. For a 5-person engineering team, that's **~$16,250/year** in token spend.

At Sipcode's measured 62.1% median savings, that team recovers **~$10,090/year** without changing how they work. The $20/month Claude Pro plan (the one Anthropic removed Claude Code from) is now effectively a $5–7/month plan in token economy terms.

**More specifically:**

- A typical solo dev burning $5/day on Opus (~80k tokens × $15/Mtok input + $75/Mtok output) saves ~$3/day → **$1,000/year back in their pocket**.
- A 10-person team at the $13/day benchmark saves ~$30,000/year. Sipcode is MIT — that's $30,000/year for the cost of `npm install`.
- The 0.6% study finding gets concrete here: of every $100 you spend on Claude Code, only 60¢ is actual code output. Sipcode targets the other $99.40.

Run `npx sipcode benchmark` to verify the 62.1% number against the locked corpus. Run `npx sipcode why` against your own session to see what YOUR ratio is — and how much money your specific workflow is leaving on the table.

---

## How Sipcode differs from neighbors

| Tool | Solves | Misses |
|---|---|---|
| **Caveman** (59k★) | Output compression via prompting | Input tokens, file reads, measurement |
| **Graphify** (47k★) | Knowledge graph from code (LLM-extracted) | Token cost to build the graph, staleness |
| **ccusage** | Measures total token spend | Doesn't show *where* the spend went |
| **RTK** | CLI output filtering | Doesn't touch file reads or output |
| **context-mode** | Sandboxes large tool outputs | Doesn't manage manifest or measure |
| **Sipcode** | **Where it went, why it cost that much, how to save next time** — in one offline CLI | — |

---

## Privacy

Sipcode is **local-first, zero-telemetry by default.** Nothing leaves your machine. No analytics, no signup, no account, no signed-in mode. The receipt PNG and HTML are generated locally and stay on disk until you share them yourself.

Not a promise — an asserted property. `tests/privacy/no-network.test.ts` statically scans every file under `src/` and fails CI if any v1.0 core path ever imports a network module. Full audit, allowlist, and future-telemetry policy: **[PRIVACY.md](PRIVACY.md)**.

---

## Get the badge

run `sipcode score --badge` to emit a shields.io-compatible `badge.json` at `.sipcode/badge.json`. commit it (or upload as an artifact via the [composite action](action/)), then pin:

```markdown
![sipcode score](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/<your-org>/<your-repo>/main/.sipcode/badge.json)
```

---

## Project status

**v0.3.0-alpha** — twelve features shipped of twelve planned for v1.0:

- ✅ `sipcode why` — install-free Claude Code session auditor
- ✅ `sipcode manifest` — static-analysis project map
- ✅ `sipcode receipt` — HTML + 1200×630 PNG with clipboard + tweet intent
- ✅ `sipcode rules` — Output Compression (S020/S021/S022), three modes
- ✅ `sipcode estimate "<task>"` — cost predictor across models (S050), zero LLM calls
- ✅ Multi-agent: Cursor (S043) — `sipcode init --agent cursor` writes `.cursor/rules/sipcode.mdc`. Rules + manifest cross-agent; transcript parsing for Cursor lands later.
- ✅ `sipcode stats` — Analytics Dashboard (S040) — cross-session totals, daily-spend sparkline, top-N expensive sessions, per-project breakdown, optional standalone HTML at `.sipcode/stats.html`.
- ✅ `sipcode score` — Sipcode Score (S060) — 24-check static audit of any repo for agent-friendliness across 5 categories (manifest, shape, naming, docs, predictability), tier badge, shields.io endpoint json, composite GitHub Action.
- ✅ `sipcode benchmark` — Reproducible Benchmark Suite (S110) — 10-task locked corpus, median 62.1% savings, published methodology, `--quick`/`--task`/`--html`/`--json`/`--list`.
- ✅ `sipcode hygiene` — Session Hygiene (S030/S031/S032) — read-once rule pack in CLAUDE.md + PreToolUse pressure-band hook (50/70/90%) + PostToolUse breakpoint hook (smart `/compact` suggestions after tests, commits, test-file writes). Honest limit: hooks warn, the model decides — no forced compaction.
- ✅ Privacy guarantee (S090) — local-first, zero-telemetry, asserted by `tests/privacy/no-network.test.ts`. Fails CI if a network module is ever imported in a core path. Full audit: [PRIVACY.md](PRIVACY.md).
- ✅ Cost framing (S100) — README's "How much does this actually save you?" turns the 62.1% number into a $1k/year solo / $10k/year team / $30k/year ten-person dollar comparison.

Active development. **785 tests passing.** Solo dev, MIT, free forever.

See [docs/ROADMAP.md](docs/ROADMAP.md) for milestones. Star the repo, watch releases, [open an issue](https://github.com/Anuj7411/sipcode/issues) if a specific optimization should be prioritized.

---

## Session hygiene

`sipcode hygiene --install` does three things:

1. Writes a named sub-block to `CLAUDE.md` with read-once discipline rules (under 400 tokens — load-bearing in every prompt forever).
2. Generates a `~/.claude/hooks/sipcode-pressure.mjs` and registers it as a **PreToolUse** hook in `~/.claude/settings.json`. Before each tool call, it samples the latest transcript and emits one stderr line if utilization is past 50% / 70% / 90%.
3. Generates a `~/.claude/hooks/sipcode-breakpoint.mjs` and registers it as a **PostToolUse** hook. After a successful `npm test` / `pytest` / `git commit` / test-file write, it suggests `/compact` on stderr.

Honest limit: hooks emit text on stderr. The model decides whether to act. We cannot force a compaction, intercept Read content, or guarantee any agent behavior. The rules + the warnings together are the discipline. `--uninstall` reverses everything; settings.json is byte-identical to its pre-install state modulo the sipcode entries themselves.

---

## Built by

[Anuj Ojha](https://github.com/Anuj7411) — also author of [Answerable](https://github.com/Anuj7411/answerable), the SEO optimization CLI for Next.js.

Sipcode exists because I burn through my Claude Code Max allocation in two hours. If you do too, this is for you.

---

## License

MIT
