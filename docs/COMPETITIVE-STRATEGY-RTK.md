# Competitive strategy — Sipcode vs RTK

**Decision date:** 2026-05-22
**Status:** ⚠️ SUPERSEDED on 2026-06-05 — see the reconciliation note below.

---

## ⚠️ 2026-06-05 — Strategic reconciliation (READ FIRST)

The "beat RTK / leapfrog on compression %" framing in this document is **retired.**
After research + validation (2026-06-05) we concluded we cannot — and should not —
win a head-to-head compression-ratio war against a 52k-star Rust incumbent with the
same mechanic. The validated direction is a **different lane**: position Sipcode as a
**context-reliability** tool for the individual Claude Code developer ("clean context
= right answers, and lower cost as a side effect"), under the existing *"sip, don't
gulp"* brand. Full design: [`superpowers/specs/2026-06-05-sipcode-reliability-reposition-design.md`](superpowers/specs/2026-06-05-sipcode-reliability-reposition-design.md).

**Two pillars (both non-negotiable):**
- **Positioning = DIFFERENT** from RTK → reliability / clean context. We don't fight
  on marketing.
- **Performance = EQUAL-OR-BETTER** than RTK on token savings (compression ratio).
  If a user can save more tokens with RTK, we've failed: they'd split tools and our
  "also saves tokens" proof collapses. **One tool, no splitting.**

This is winnable on the only axis that matters for tokens: RTK filters output with
**regex/line rules**; our Phase-B **AST/semantic** compression parses the syntax tree
and returns only the symbols that matter. Semantic > mechanical on *ratio*. RTK's
Rust *speed* is irrelevant to token count. The same engineering is *also* "cleanest
context," so it serves both pillars at once.

**What this means for the phases below — almost nothing is dropped; only the
trash-talk framing dies:**

| Old phase element | New verdict |
|---|---|
| Phase A — proxy/valve | ✅ Shipped (v1.5.0). Core performance layer — **never degrade.** |
| Phase B — AST/semantic compression + symbol-level *relevant* reads | **KEEP — core performance feature.** Deepest token optimization *and* cleanest context. The engine of both pillars. |
| Phase B — read-once / re-read dedup cache | **KEEP (integrated).** Real token saver; others ship standalone versions, so not claimed as novel — included so users never need a second tool. |
| Phase B — "96% vs RTK 88%" bragging | **Drop the bragging only.** Keep the goal: token savings ≥ RTK, *proven* (not claimed) by the vs-rtk benchmark. |
| Phase C — adaptive context-pressure compression | **KEEP.** Dual-purpose: performance + reliability (manages rot as the window fills). Watch Anthropic's native context editing. |
| Phase C — compression-integrity scoring | **KEEP.** Reliability honesty-guardrail ("we tell you if cleaning hid something"). |
| Phase C — co-edit prediction | **KEEP (ambitious/future).** Genuine moat; speculative. |
| Phase C — cross-session output recycling | **KEEP (future).** Performance; acknowledge overlap with existing memory MCPs. |

**Performance proof:** revive the **live `benchmark --vs-rtk` harness** (deferred in
Phase A) so we can *demonstrate* token parity/superiority honestly — that proof is
what reassures users they don't need RTK.

**Unified roadmap now:** (1) README reposition → (2) `drift` detector [reliability
flagship] → (3) **token-performance depth** (integrated re-read dedup → AST/symbol
relevant reads) to reach/exceed RTK, proven by vs-rtk → (4) adaptive compression +
integrity scoring. RTK is acknowledged as **complementary, different lane** — we beat
it on token *performance* while not competing on its *positioning*.

The phase definitions below are kept **for detail** — they remain live, reframed.

---

### (historical) Decision date: 2026-05-22
**Status:** Committed strategic path. Updated when post-launch signal arrives.

> **This document is the OPERATIONAL plan for executing the North Star captured in [`docs/VISION.md`](VISION.md).** The North Star says: be the best token-saving tool for every AI coding agent, built with latest semantic technologies rather than heuristic filters. This doc is HOW we get there over the next 4 weeks vs. competitors who already hold optimizer ground.

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

### Phase A — Parity proxy ✅ SHIPPED in v1.5.0 (2026-06-04)

`sipcode proxy` is a Claude Code PreToolUse hook that matches RTK's mechanic.

> **Architecture note:** During plan-eng-review we verified Claude Code's hook
> contract and corrected a fabricated assumption: PostToolUse **cannot** replace
> tool output. The shipped design rewrites tool **inputs** via
> `hookSpecificOutput.updatedInput` (PreToolUse) — the same lever RTK uses. A
> regression guard (`proxy-no-fabricated-fields`) locks this in.

**What shipped:**
- ✅ PreToolUse hook that rewrites tool **inputs** (not output filtering)
- ✅ Per-tool injectors for native Grep / Glob (`head_limit`). (Read needs none — Claude Code already caps reads at 2000 lines, so a `limit` injection would be a no-op; we don't claim a saving we don't deliver.)
- ✅ Bash command rewriters: `git status`, `git log`, `npm ls`, `cargo build`, `ls`, `find`, `grep`, `cat`
- ✅ CLI: `sipcode proxy --install` / `--uninstall` / `--diff` / `--stats`
- ✅ MCP tool: `get_proxy_stats` (matches RTK's `rtk gain`)
- ✅ `sipcode benchmark --vs-rtk` — heuristic preview replaying rewriters over the corpus's recorded tool calls (the corpus is static fixtures, so this is a preview, not live re-execution)

**Deferred to a follow-up:** a true live with/without-proxy benchmark harness (the current corpus is a static re-analysis, so an apples-to-apples live comparison needs its own execution runner).

**Actual:** ~1,300 lines of code + tests. Self-contained hook `.mjs` imports the unit-tested `runRewriter` rather than inlining logic.

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
