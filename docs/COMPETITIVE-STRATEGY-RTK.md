# Competitive strategy — Sipcode vs RTK

**Decision date:** 2026-05-22
**Status:** Committed strategic path. Updated when post-launch signal arrives.

---

## Context

RTK (https://github.com/rtk-ai/rtk) is a 52k-star Rust CLI proxy created in January 2026. It transparently filters tool outputs (`git status`, `npm ls`, etc.) before they reach the LLM context — claiming 60-90% token savings. It supports 12+ AI agents.

This is a direct competitor on the **token optimizer** axis. As of 2026-05-22, Sipcode does NOT compete with RTK on raw token savings at the tool-call layer. Sipcode is currently an audit-first observatory, not a runtime proxy.

## Decision: Path 2 staged

We are NOT staying the observatory. We are matching RTK's mechanic, then leapfrogging with AST-aware semantic compression that RTK cannot easily replicate.

### Phase 0 — Launch as observatory (now)

- Launch `sipcode@1.2.3` using observatory positioning (MCP-native + forensic audit + reproducible benchmark + integrity contract).
- Acknowledge RTK explicitly in the README — engineers respect honesty about competition. Don't pretend the 52k-star competitor doesn't exist.
- Recommend stacking Sipcode + RTK in the README. They are complementary, not mutually exclusive.
- Establish the MCP wedge while it's still uncontested.

### Phase A — Parity proxy (target: 3-5 days post-launch)

Build `sipcode proxy` as a Claude Code PreToolUse hook. Match RTK's mechanic.

**What to build:**
- PreToolUse hook handler that intercepts tool outputs
- Per-tool heuristic filters for: Read, Grep, Bash, Glob
- Specific command filters: `git status`, `git log`, `npm ls`, `cargo build`, `ls`, `find`, `grep`, `cat`, file reads
- New CLI command: `sipcode proxy --install` / `sipcode proxy --uninstall`
- New MCP tool: `get_proxy_stats` (RTK has `rtk gain` — we should match it)
- New benchmark: `sipcode benchmark --vs-rtk` (run the same corpus with both, report deltas)

**Target:** match RTK's 60-90% savings range as the baseline floor. Within ±5% on the same corpus.

**Effort:** 3-5 days for solo dev. ~2,000 lines of code + tests.

### Phase B — AST-aware compression (target: 2-3 weeks post-Phase A, ships as v1.4.0)

The leapfrog. RTK uses regex/line-based filtering. We use the actual parsers.

**What to build:**
- AST-aware semantic compression for code outputs:
  - TypeScript/JavaScript via `@typescript-eslint/parser` or `ts-morph`
  - Python via `tree-sitter-python` (Node bindings)
  - Rust via `tree-sitter-rust`
  - Go via `tree-sitter-go`
  - YAML/JSON via native parsers (preserve structure, drop noise)
- Symbol-level virtual reads: agent calls `Read auth.ts` → we return only relevant symbols based on session intent inference
- Read-once cache enforcement: not just warning (current `sipcode hygiene`), real LRU cache that returns a "diff since last read" instead of the full file

**Target:** **96%+ reduction** on code-heavy reads (2,000 lines → 80 relevant symbols). RTK gets ~88% with line filters; we go deeper.

**Effort:** 2-3 weeks for solo dev. Significant work — parsing, intent inference, cache architecture.

### Phase C — Predictive (target: v2.0, ~1 month after Phase B)

Genuine moat. Requires features RTK can't easily add without a major redesign.

- **Co-edit prediction**: from git history, anticipate which files the agent will read next; pre-summarize them.
- **Adaptive context-pressure compression**: light at 50% context, aggressive at 70%, summary-only at 90%.
- **Compression integrity scoring**: every compression returns a "lost X% information" signal so users know when summaries may hide answers.
- **Cross-session output recycling**: persistent compressed-file cache that survives session boundaries.

---

## Why this beats RTK structurally (not just by being newer)

RTK's filters are **mechanical**. They look at text and pattern-match. Their ceiling is bounded by what regex can do.

Sipcode's leapfrog is **semantic**. We parse the actual syntax tree. That gives us:

1. **Higher compression ratios** on code (a function body is ~10% of a file's tokens if you remove imports, comments, dead code, unused exports).
2. **Quality preservation** that line filters can't achieve. We never drop the line the agent needs; we drop the lines we can prove aren't referenced.
3. **Predictability** — we can anticipate the agent's next read from semantic relationships (git co-edits, import graphs, call hierarchies).

These are structural advantages. They survive even if RTK adds an MCP server tomorrow.

## What we don't try to compete on

- **Rust binary speed**: we accept the Node.js dependency. The optimization wins compensate.
- **12-agent support on day 1**: we stay Claude Code + Cursor focused. Add agents as users ask for them.
- **52k stars**: that takes time, not features. Real adoption comes from real value.

## How we acknowledge RTK in the README

Add a row to the existing comparison table:

| Tool | What it does well | What it doesn't do |
|---|---|---|
| **RTK** | Transparent CLI proxy. Heuristic filters per command. 12+ agents. 60-90% savings on filtered commands. | No MCP server. No forensic audit. No cost prediction. No benchmark. No semantic compression. |

This is honest and engineers respect it. It also makes Sipcode look like the more complete product even before Phase A ships.

## Recommended stack for users (in the README)

> *"For best results, install both: RTK for the tool-output proxy layer (saves 60-90% on common commands), Sipcode for the audit + MCP + cost-prediction + benchmark layer. They're complementary."*

This is the most honest and most credible positioning. Users get the best of both. We don't fight a war we can't win on day 1.

## Triggers to revisit this strategy

- RTK ships an MCP server within 30 days → don't react, our AST advantage is bigger than the MCP advantage.
- A 3rd competitor ships AST-aware compression first → ship Phase B faster.
- Sipcode's launch underperforms (no signal after 7 days) → consider Phase A first instead of post-launch.
- RTK's savings claims are debunked publicly → don't pile on; stay technical.

---

## Why we didn't build this from the start

The original Sipcode brainstorm (2026-05-18) framed the wedge as "install-free forensic audit." The active optimization features (rules, hygiene, manifest) were add-ons. That design was AUDIT-FIRST.

RTK started OPTIMIZER-FIRST. Different DNA.

This document captures the decision to evolve Sipcode toward OPTIMIZER-PLUS-OBSERVATORY. The observatory side is launched; the optimizer side is the next 3-4 weeks of engineering.
