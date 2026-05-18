# Sipcode — PROJECT SPEC

> **Status:** v0.0.1 — pre-implementation
> **Owner:** Anuj Ojha
> **Last updated:** 2026-05-18

This document is the single source of truth for *what Sipcode is*, *who it's for*, and *what it must do* to win in its market. Implementation details belong in `AUDIT-FRAMEWORK.md` (the engine spec) and `SESSION-HANDOFF.md` (the executable next-step brief).

---

## 1. Problem statement

AI coding agents (Claude Code, Cursor, Codex, Gemini CLI, Aider, etc.) burn tokens at a rate that has become the #1 friction point in their adoption. Empirical data:

- Anthropic enterprise benchmark: **$13/dev/active day** on Claude Code.
- Typical session: **80,000–200,000 tokens** burned in 2–4 hours.
- Agent-team setups: **~7× higher** burn rate.
- Only **0.6%** of tokens in a typical session are actual code output (38-session dev.to study).
- **77%** of context is repetitive across turns.
- Anthropic removed Claude Code from the $20 Pro plan in 2026, accelerating user migration to Codex/Cursor purely on cost.

The fixes exist as fragmented point solutions (Caveman, RTK, context-mode, Graphify, Headroom, ccusage, etc.). Stacking them gets to 85–92% reduction — but the Pasquale Pillitteri analysis (April 2026) found that the full stack takes **a full day of manual configuration**. Most developers never bother.

**The gap:** no one ships the unified, opinionated, one-command installer.

---

## 2. What Sipcode is

A TypeScript CLI distributed as `@sipcode/cli` on npm. Installed via `npx sipcode init` or `npm install -g @sipcode/cli`. It does three jobs:

1. **Build** a compressed manifest of the user's codebase so the agent stops blindly exploring (Layer 2, original code).
2. **Audit** past Claude Code sessions to show where tokens were wasted, plus generate shareable savings receipts (Layer 2, original code).
3. **Orchestrate** the best existing point solutions (RTK, context-mode, professional CLAUDE.md rules) so the user gets the full stack with one command (Layer 3).

It is *not*:
- Another output compressor (Caveman owns that niche).
- Another knowledge graph (Graphify owns that niche).
- A token *measurement* tool only (ccusage owns that niche).
- A SaaS dashboard (the CLI + local artifacts ship the value).

---

## 3. Target user

**Primary persona — "Indie Anuj":** solo developers, students, bootstrapped founders. Pays for Claude Code Max out of pocket. Feels every token. Migrated to Codex/Cursor at some point purely on cost. Already runs `ccusage` weekly. Has heard of Caveman but hasn't installed it because it feels "meme-y."

**Secondary persona — "Small Team Lead":** tech lead at a 5–15 person startup with shared Anthropic spend. Looking at $4k–$10k/month in token costs. Wants to standardize team setup so junior engineers don't burn the budget.

**Non-goals:**
- Large-enterprise procurement workflows.
- Non-coding LLM use cases.

---

## 4. Positioning

**Tagline:** *Sip your tokens. Don't gulp them.*

**One-liner (non-technical audience, ~50% of readers):**
> Install one command. Your Claude Code sessions last 3× longer. Your token costs drop 40–50%. No configuration. No understanding required.

**One-liner (technical audience, ~50% of readers):**
> Unified token optimization stack for AI coding agents. Auto-configures output compression, CLI filtering, context management, smart file navigation, and session analytics — the same five-layer stack that power users build manually in a day, shipped as a single `npm install`.

**Honesty claim:** Sipcode publishes a reproducible benchmark suite. Every savings number in the README is traceable to a real, runnable test. We never quote output-only reduction as if it were total-token reduction.

---

## 5. The 0.6% Wedge

> *"Only 0.6% of the tokens in a typical Claude Code session are actual code. Sipcode is the first tool that fights all of it — exploration, re-reads, repetition."*

This stat is the entire marketing strategy. It is:
- **Not Sipcode's claim.** It's an independent dev.to study — defensible under cross-examination.
- **Screenshot-ready.** Tweets write themselves.
- **Educational.** Most developers don't know this and once they hear it, they feel the burn.
- **A funnel.** `sipcode why` lets users *prove the 0.6% on their own sessions* before installing anything.

---

## 6. Phase 1 scope (v0.1.0)

Three deliverables. Everything else is Phase 2+.

### 6.1 Smart Project Manifest Generator

`npx sipcode init` and `npx sipcode manifest` produce `.sipcode/manifest.md` and inject a reference into `CLAUDE.md`.

**Contents of manifest:**
- **File tree** with one-line per-file purpose descriptions (~10 words each).
- **Import graph** — for each non-trivial source file, list its 3–5 most important imports.
- **Hot files** — top 20 files by git change frequency over the last 90 days.
- **Detected patterns** — coding conventions auto-inferred: import style (default/named), naming (camel/snake/kebab), test framework, package manager, monorepo layout.
- **Framework fingerprint** — Next.js/Astro/Remix/etc., language(s), build tool.

**Constraints:**
- **Zero LLM calls.** All static analysis via AST (tree-sitter) + git plumbing + filename heuristics. This is the Graphify differentiator.
- **Token budget:** manifest must stay under **2,000 tokens** for a 500-file project; degrades gracefully for larger.
- **Idempotent.** Re-running on an unchanged tree produces byte-identical output.
- **Delta-aware** (stretch goal): `--delta` flag emits only the diff since last manifest.

### 6.2 `sipcode why` — Past-Tense Session Auditor

Reads Claude Code transcripts at `~/.claude/projects/<project-hash>/*.jsonl` and produces a forensic report.

**Outputs:**
- Total tokens for the session, split input/output/cache_read/cache_creation.
- **Top 5 most expensive tool calls** with file paths and reasons.
- **Duplicate reads** — files read more than once with token cost of each redundant read.
- **Idle context** — file contents that stayed in context for N turns without being referenced again.
- **The 0.6% breakdown for this user's actual session.** "Of 87k tokens, 412 were code output. The rest broke down as: exploration 38%, re-reads 22%, repetitive context 31%, output 9%."
- **Savings estimate if Sipcode were installed:** "Read-Once would have saved ~19k. Manifest would have saved ~12k. Net estimated savings: 31k tokens ($0.43)."

**No install required to run `sipcode why`.** This is the install-free demo. `npx sipcode why` works on day one with zero config — read-only against existing transcripts.

### 6.3 Shareable Receipt

After any session, `npx sipcode receipt [session-id]` produces:
- A **terminal table** (always).
- A **`.sipcode/receipts/<id>.html`** standalone HTML file (default).
- A **`.sipcode/receipts/<id>.png`** OG-image (with `--png` or `--share`).

**Receipt content:**
- Big number: tokens saved (or in pre-install case: tokens *wasted*).
- Dollar equivalent at current Anthropic rates.
- Top three optimizations that drove the savings.
- Sipcode wordmark + `sipcode.dev` URL — designed to be embarrassing not to share.

---

## 7. Phase 2 scope (v0.2.0)

- **Output compression module** — professional CLAUDE.md rule set (diff-output enforcement, no preamble, structural compression).
- **Stack orchestration** — detect/install/configure RTK and context-mode if missing; degrade gracefully when absent.
- **Multi-agent support** — Cursor (`.cursorrules`), Codex, Gemini CLI, Aider.
- **`sipcode estimate "<task>"`** — predict per-model cost before running.

## 8. Phase 3 scope (v0.3.0)

- **Session Hygiene module** — hook-based read-once enforcement, context-pressure warnings (50/70/90%), smart `/compact` timing on natural breakpoints (post-test, post-commit).
- **Spec-first mode** — `sipcode plan "<task>"` produces a cheap structured spec before the agent touches the repo.
- **MCP server pruning** — detect unused MCPs bloating the system prompt.
- **Team mode** — `sipcode link <team>` uploads anonymized metrics to an org dashboard ($20/seat/month).

## 9. Phase 4+ (post-v1.0)

- **The Sipcode Index** — quarterly published report on average Claude Code session economics. Becomes the cited source.
- **VS Code / Cursor extension** with real-time token-cost status bar.
- **Distribute as Claude Code plugin/skill** in addition to npm.

---

## 10. Architectural principles (non-negotiable)

These are the rules that govern every PR. They are inherited from Answerable.

1. **Pure runners + I/O wrappers.** Every check or analyzer is a pure function over an in-memory model; I/O lives in thin wrappers. Enables `InMemoryFs` and `ScriptedPrompter` test seams.
2. **Branded types.** `AbsoluteFilePath`, `TokenCount`, `SessionId`, `CheckId` are not raw strings — string-substitution bugs caught at compile time.
3. **Batched errors.** Validation returns `SipcodeValidationError` with full `issues` array, never throws on first failure.
4. **Stable IDs as public API.** `S001`, `S002`, etc. — every check, every optimization, every metric has a stable identifier. Users reference them in config; renames are breaking changes.
5. **Drift-prevention tests.** Snapshot tests on all generated manifests, reports, and CLAUDE.md injections.
6. **Honest defaults.** Default config favors safety over savings. Aggressive modes are opt-in flags, never silent.
7. **Zero LLM calls in the manifest path.** Static analysis only. This is the line that distinguishes Sipcode from Graphify.

---

## 11. Tech stack (locked)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5.5+ | Carries from Answerable, matches Claude Code ecosystem |
| Runtime | Node ≥ 20 | Native fetch, stable ESM, broad availability |
| CLI | Commander 12 | Same as Answerable; well-understood |
| Tests | Vitest 2 | Same as Answerable; fast, ESM-native |
| Static analysis | `tree-sitter` | Multi-language, no LLM, same engine Graphify uses |
| Config schema | `zod` | Runtime validation + inferred TypeScript types |
| Prompts | `prompts` | Lightweight, same as Answerable |
| Output | `chalk` + `ora` | Standard CLI UX |
| Distribution | npm public | `@sipcode/cli` — org already claimed |

---

## 12. Success metrics

**v0.1.0 launch (Phase 1):**
- ≥ 500 GitHub stars in week 1.
- ≥ 5,000 npm downloads in month 1.
- ≥ 1 viral post on Twitter/HN/Reddit driven by the 0.6% framing.
- Reproducible benchmark shows 25–40% real-world token reduction (Phase 1 features alone).

**v0.2.0 (full stack):**
- Reproducible benchmark hits 40–50% real-world reduction.
- ≥ 5k stars.
- First team-mode beta sign-ups.

**v1.0.0:**
- ≥ 10k stars.
- Cited by ≥ 3 major AI-engineering newsletters.
- The Sipcode Index has 2 published editions.

---

## 13. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Anthropic ships native cost optimization in Claude Code | High | High | Cross-agent support from v0.2 — Sipcode wins on Cursor/Codex/Gemini/Aider even if Anthropic ships built-in. |
| Caveman / RTK pivot or break their interfaces | Medium | Medium | Orchestration layer uses thin adapters that degrade gracefully ("RTK not available, falling back to built-in filter"). |
| 0.6% study turns out to be unreproducible | Low | High | Publish our own reproduction methodology with v0.1.0; cite multiple sources, not just one. |
| Token-pricing model changes wipe out the dollar claims | Medium | Low | Receipt prices read from a versioned pricing file shipped with each release; users see "as of release date." |
| Name collision with a coffee/beverage trademark | Low | Medium | Verify USPTO + EUIPO before public launch. |
| Burning out — this is a side project for a budget-constrained dev | Medium | High | Phase 1 is deliberately small (3 features, no orchestration, no team mode). Ship something usable in weeks, not months. |

---

## 14. Out of scope (forever or for a long time)

- A web-based dashboard.
- A hosted SaaS that runs the agent for the user.
- Token optimization for non-coding agents (chat, research, image gen).
- Provider-side compression (let Headroom own that).
- LLM-based code analysis (let Graphify own that).
- A fork of Claude Code itself.
