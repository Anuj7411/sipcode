# Sipcode

> **Sip your tokens. Don't gulp them.**
> Unified token optimization for Claude Code and other AI coding agents.

[![npm version](https://img.shields.io/npm/v/@sipcode/cli.svg)](https://www.npmjs.com/package/@sipcode/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Why Sipcode exists

> An independent study of 38 Claude Code sessions found that **only 0.6% of tokens were actual code output**. The other 99.4% was exploration, re-reads, and repetition. — [DEV Community, March 2026](https://dev.to/lsvishaal/i-analyzed-38-claude-code-sessions-only-06-of-tokens-were-actual-code-output-56li)

Claude Code, Cursor, Codex, and other AI coding agents burn 80,000–200,000 tokens in a few hours. Anthropic's own enterprise benchmark sits at **$13 per developer per active day**. For indie devs and small teams, that's the difference between shipping and quitting.

The fixes exist — Caveman, RTK, context-mode, Graphify, Headroom, ccusage — but using all of them at once takes a full day of configuration. Most developers never bother.

**Sipcode is the one-command installer that gives you the entire stack.**

```bash
npx sipcode init
```

That's it. Smart project manifest, session budget tracking, read-once cache, output compression, and analytics — all configured for you.

---

## What you get

| Feature | What it does | Typical savings |
|---|---|---|
| **Smart Project Manifest** | AST-generated compressed map of your repo, injected into `CLAUDE.md`. The agent stops blindly exploring. | ~40% input tokens |
| **`sipcode why`** | Audits your past Claude Code sessions and shows exactly where tokens died. Works *before* you install anything else. | Educational — finds the leaks |
| **Shareable Receipt** | After every session, generate a beautiful PNG showing tokens saved. Built for sharing. | Viral measurement loop |
| **Output Compression** *(v0.2)* | Professional response rules (not caveman-speak) — diff output, no preamble, structural compression. | ~15% output tokens |
| **Session Hygiene** *(v0.3)* | Hook-based read-once cache, context-pressure warnings, smart compaction timing. | ~20% across long sessions |
| **Stack Orchestration** *(v0.2)* | Detect, install, and configure RTK + context-mode + the right CLAUDE.md rules. | The remaining gap |

**Honest claim:** real-world sessions show **40–50% total token reduction** with the full stack. Not the misleading 65–90% numbers that count only output tokens.

---

## Install

```bash
npm install -g @sipcode/cli
# or
npx sipcode <command>
```

## Quick start

```bash
# 1. Audit yesterday's sessions — no install required
npx sipcode why

# 2. Set up Sipcode in your project
cd your-project
npx sipcode init

# 3. Watch the savings
npx sipcode stats
```

---

## How it compares

| Tool | What it does | What it misses |
|---|---|---|
| **Caveman** (59k★) | Output compression via prompting | Input tokens, file reads, measurement |
| **Graphify** (47k★) | Codebase knowledge graph | Costs tokens to build, gets stale |
| **RTK** | CLI output filtering | Doesn't touch file reads or output |
| **context-mode** | Sandboxes tool output | Doesn't manage manifest or measure |
| **Headroom** | API-payload compression | Single layer; opaque to user |
| **ccusage** | Measures spend | Doesn't reduce anything |
| **Sipcode** | All of the above, one command | — |

Caveman is the engine. RTK is the transmission. context-mode is the suspension. Graphify is the GPS. **Sipcode is the car.**

---

## Project status

Sipcode is in **active early development (v0.0.1)**. Phase 1 (Smart Manifest + `sipcode why` + Shareable Receipt) lands in v0.1.0. See [ROADMAP.md](docs/ROADMAP.md).

Star the repo, watch releases, [open an issue](https://github.com/Anuj7411/sipcode/issues) if you want a specific optimization prioritized.

---

## Built by

[Anuj Ojha](https://github.com/Anuj7411) — also author of [Answerable](https://github.com/Anuj7411/answerable), the SEO optimization CLI for Next.js.

Sipcode exists because I burn through my Claude Code Max allocation in two hours. If you do too, this is for you.

---

## License

MIT
