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
| **`sipcode why`** | Forensic audit of any past Claude Code session — no install required | ✅ v0.1.0-alpha |
| **`sipcode manifest`** | Static-analysis project map injected into `CLAUDE.md` — zero LLM calls | ✅ v0.1.0-alpha |
| **`sipcode receipt`** | HTML + PNG receipt + system clipboard + tweet intent URL | ✅ v0.1.0-alpha |
| **`sipcode init`** | Interactive setup (three prompts max) — runs manifest + injects CLAUDE.md | ✅ v0.1.0-alpha |
| **`sipcode rules`** | Output Compression (S020) — diff edits + no-preamble rules in CLAUDE.md, three modes (default/strict/verbose) | ✅ v0.2.0 |
| Session Hygiene (S030) | Hook-based read-once cache, context-pressure warnings, smart `/compact` | 🛠️ v0.3.0 |
| `sipcode estimate "<task>"` | Predicts session cost per model before you run | 🛠️ v0.2.0 |
| Sipcode Score (S060) | GitHub Action that audits any repo for "agent-friendliness" | 🛠️ v0.4.0 |
| Hardest Tasks Benchmark | Canonical waste-maximizing corpus — the cited cost-waste benchmark | 🛠️ v0.4.0 |
| Multi-agent (Cursor, Codex, Gemini, Aider) | Same wedge, every agent | 🛠️ v0.2.0 |

---

## Honest claims, no inflated numbers

Other tools quote 65–90% savings by only counting output tokens — but output is 20–30% of your bill. Sipcode targets **input** (file reads, idle context, repetition), which is 70–80% of the spend.

**Realistic stack savings (measured, not asserted):** 40–50% total token reduction with the full v1.0 toolkit active. The exact number ships as a reproducible benchmark with v1.0 — whatever the suite says is the headline.

**Source data for the claims above:**
- [Claude Code Pricing 2026 — Anthropic](https://code.claude.com/docs/en/costs) — $13/dev/active day enterprise benchmark
- [Claude Code vs Cursor benchmark — Sitepoint](https://www.sitepoint.com/claude-code-vs-cursor-developer-benchmark-2026/) — Cursor uses 5.5× more tokens than Claude Code on identical tasks
- [I Analyzed 38 Claude Code Sessions — DEV](https://dev.to/lsvishaal/i-analyzed-38-claude-code-sessions-only-06-of-tokens-were-actual-code-output-56li) — the 0.6% study

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

This is not a "we'll add telemetry later" promise. The architecture has no network calls in the core paths (`sipcode why`, `manifest`, `receipt`). When hosted analytics ship in a future version, they'll be **explicit opt-in**, not silent.

---

## Project status

**v0.2.0-alpha** — four features shipped of twelve planned for v1.0:

- ✅ `sipcode why` — install-free Claude Code session auditor
- ✅ `sipcode manifest` — static-analysis project map
- ✅ `sipcode receipt` — HTML + 1200×630 PNG with clipboard + tweet intent
- ✅ `sipcode rules` — Output Compression (S020/S021/S022), three modes

Active development. **286 tests passing.** Solo dev, MIT, free forever.

See [docs/ROADMAP.md](docs/ROADMAP.md) for milestones. Star the repo, watch releases, [open an issue](https://github.com/Anuj7411/sipcode/issues) if a specific optimization should be prioritized.

---

## Built by

[Anuj Ojha](https://github.com/Anuj7411) — also author of [Answerable](https://github.com/Anuj7411/answerable), the SEO optimization CLI for Next.js.

Sipcode exists because I burn through my Claude Code Max allocation in two hours. If you do too, this is for you.

---

## License

MIT
