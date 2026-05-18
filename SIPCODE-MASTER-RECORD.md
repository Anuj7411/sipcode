# Sipcode — Master Record

> **Purpose:** the single, authoritative reference document for everything decided about Sipcode.
> **Status:** locked at end of planning session 2026-05-18.
> **Companion docs:** `sipcode-full-conversation-record.md` (prior May-18 Claude.ai brainstorm), `docs/PROJECT-SPEC.md`, `docs/ROADMAP.md`, `docs/AUDIT-FRAMEWORK.md`, `docs/SESSION-HANDOFF.md`.

If you need one document that answers "what is Sipcode, who decided what, when, and why" — this is it. Every other document is downstream of this one.

---

## Table of contents

1. [Project identity](#1-project-identity)
2. [Backstory — decisions made in the prior brainstorm (May 18, 07:05–07:42 UTC)](#2-backstory--prior-brainstorm-decisions)
3. [This session's strategic pivots (May 18, ~13:30–15:30 IST)](#3-this-sessions-strategic-pivots)
4. [The 10 out-of-the-box ideas (this session's contribution)](#4-the-10-out-of-the-box-ideas)
5. [User decisions made in this session](#5-user-decisions-made-in-this-session)
6. [The fat v1.0 scope — 12 features locked](#6-the-fat-v10-scope--12-features-locked)
7. [Deferred to v1.1+](#7-deferred-to-v11)
8. [Feature → version mapping (the full table)](#8-feature--version-mapping)
9. [Research findings (May 18, this session)](#9-research-findings)
10. [Canonical market stats](#10-canonical-market-stats)
11. [Architectural principles (locked, non-negotiable)](#11-architectural-principles)
12. [Tech stack (locked)](#12-tech-stack)
13. [Current state of the repo](#13-current-state-of-the-repo)
14. [Risks and mitigations](#14-risks-and-mitigations)
15. [Open questions / next actions](#15-open-questions--next-actions)
16. [Source index (every URL cited)](#16-source-index)
17. [Glossary of stable IDs](#17-glossary-of-stable-ids)

---

## 1. Project identity

| Field | Value |
|---|---|
| **Name** | Sipcode |
| **Tagline** | *Sip your tokens. Don't gulp them.* |
| **One-liner (non-technical, ~50% of readers)** | Install one command. Your Claude Code sessions last 3× longer. Your token costs drop 40-50%. No configuration. No understanding required. |
| **One-liner (technical, ~50% of readers)** | Unified token optimization stack for AI coding agents. Auto-configures output compression, CLI filtering, context management, smart file navigation, and session analytics — the same five-layer stack power users build manually in a day, shipped as a single `npm install`. |
| **Founder** | Anuj Ojha — GitHub [@Anuj7411](https://github.com/Anuj7411), npm `anujojha18` |
| **Sibling project** | [Answerable](https://github.com/Anuj7411/answerable) — SEO optimization CLI for Next.js (Sipcode borrows its architecture). |
| **Distribution channel (committed)** | npm / terminal CLI install (`npx sipcode <cmd>` and `npm install -g @sipcode/cli`). |
| **Distribution channel (deferred)** | Web UI for non-CLI users — planned for after v1.0. |
| **Distribution channel (re-opened in this session)** | Claude Code plugin marketplace. Initially rejected by user ("limits to myself"). Reopened after gstack research surfaced 98.8k★ on a tool distributed *exclusively* as a Claude Code skill pack — strong evidence the plugin channel is massive, not limiting. User responded "No preference" — decision deferred. **Revisit at v0.9 (pre-launch)**: ship as both npm CLI and Claude Code plugin if budget allows ~1 day extra work. |
| **npm scope** | `@sipcode` (claimed by user this session) |
| **GitHub repo (planned)** | `github.com/Anuj7411/sipcode` (not yet created) |
| **Domain (planned)** | `sipcode.dev` (not yet purchased) |
| **License** | MIT |

---

## 2. Backstory — prior brainstorm decisions

The full transcript of the prior May-18 Claude.ai conversation is preserved in `sipcode-full-conversation-record.md`. Key outcomes Anuj brought into this session:

### 2.1 Answerable rating (Turn 2)

Claude (in the prior session) gave Answerable **7.5/10 for v0.1.0**, citing:
- **Strengths:** professional-grade architecture (pure runners + I/O wrappers, branded types, batched validation, drift-prevention tests), the "fix + audit + teach" triangle, thoughtful CLI UX, 441 tests.
- **Gaps:** only 33/50 checks ship (~63 of 100 points), Next.js App Router only, no content quality checks, docs site doesn't build (Nextra 4 + Next 15 incompatibility), no visual output, single-page audit only.

This rating mattered because it established that **Anuj's engineering standard is already at "rare-for-solo-dev" quality** — Sipcode inherits that standard.

### 2.2 The original 4-module architecture (Turn 3)

The prior session proposed Sipcode as a four-module system:

| # | Module | Estimated savings | What it does |
|---|---|---|---|
| **M1** | **Smart Context** | ~40% input | AST-generated compressed project map, dependency graph, hot-files index from git, detected coding patterns. Injected into `CLAUDE.md`. Zero LLM calls — that's the Graphify differentiator. |
| **M2** | **Output Compression** | ~15% output | Default / Strict / Verbose modes. Format optimization (diffs not full rewrites), not just linguistic compression. More professional than Caveman. |
| **M3** | **Session Hygiene** | ~20% across long sessions | Read-once enforcement, partial reads, context-pressure warnings at 30/50/70%, compaction at natural breakpoints. |
| **M4** | **Analytics Dashboard** | Measurement (the trust layer) | Tokens per session, most expensive reads, wasted reads, before/after comparisons, shareable reports. |

### 2.3 The orchestrator wedge (Turn 4)

After full landscape research, the prior session concluded:
> Caveman is the engine. RTK is the transmission. context-mode is the suspension. Graphify is the GPS. **Nobody has built the car.**

Build the orchestrator — install + configure best existing tools + ship original modules for the gaps + present it all behind `npx sipcode init`.

Three layers:
- **Layer 1:** one-command installer
- **Layer 2:** original Sipcode code (M1–M4 above)
- **Layer 3:** orchestration of RTK, context-mode, professional CLAUDE.md rules

### 2.4 Tech stack agreed (Turn 3)

- TypeScript
- npm (broader reach than pnpm)
- Commander
- Vitest
- Claude Code first; Cursor/Codex/Gemini CLI in v0.2

### 2.5 Build phases agreed (Turn 4)

- Phase 1: M1 + M4 (most compelling demo)
- Phase 2: M2
- Phase 3: M3

### 2.6 Name research (Turn 6)

After 11 web searches, Claude verified collisions:

**Confirmed TAKEN:** tokenwise, lean-ctx, leancode, frugal, ember, pennywise, tokburn, headroom, context-mode, tokscale, toksave.

**Top 5 clean recommendations:**
1. **sipcode** ★ Selected
2. dripfeed
3. parsec (risk: remote-desktop app)
4. distill (risk: scattered npm compounds)
5. whetstone

Anuj confirmed: *"i also think sip code would be good"* — locked.

### 2.7 Immediate action items handed off

1. Create GitHub repo `Anuj7411/sipcode`
2. Create npm org `@sipcode`
3. Buy `sipcode.dev`

(Status as of this record: npm org claimed; GitHub repo + domain still pending.)

---

## 3. This session's strategic pivots

Three pivots happened in this session that materially change the prior plan.

### 3.1 What I (this session's Claude) agreed with from the prior plan

- The orchestrator framing as the *entry strategy* (necessary but insufficient).
- Sipcode as the name — no second-guessing.
- "Honest 40–50%" over the misleading 60–90% competitors quote.

### 3.2 What I pushed back on

| # | Pushback | Reasoning |
|---|---|---|
| **1** | The orchestrator alone is **not the moat**. | Wrapping 5 tools is a weekend's work. Defensibility has to come from data (benchmark), community (receipts), and ecosystem (Sipcode Score badge) — not glue code. |
| **2** | The 40–50% claim is **an assertion, not a measurement**. | Without a reproducible benchmark shipped at launch, the claim is just another inflated number. Promoted benchmark from stretch goal to launch prerequisite. |
| **3** | The "$20/seat/month team mode" pricing is a **SaaS reflex grafted onto OSS**. | Indie devs fork tools they're charged for. Correct monetization is: free CLI forever; paid hosted analytics; sponsorships; enterprise consulting. |
| **4** | Distribution missed Claude Code plugin marketplace. | (User overrode this — see §1. Stays on CLI/terminal channel only.) |
| **5** | Anthropic shipping native cost-control is **underweighted as a risk**. | Mitigation: cross-agent support; trusted-neutral-measurement positioning; build community before Anthropic notices. |
| **6** | The 0.6% headline stat **can backfire** if individual users find their own number is 5–10%. | Mitigation: `sipcode why` shows the user *their own number first* — external study is the framing, personal number is the proof. |
| **7** | Optimization has a **DX cost** the spec ignored. | Every optimization needs a `dx_cost` column alongside `est_savings`. Honest defaults; aggressive modes opt-in. |

### 3.3 What changed structurally as a result

- **Benchmark suite** promoted from stretch goal → v1.0 launch prerequisite.
- **`sipcode why`** added as install-free demo and conversion funnel (was not in the prior plan).
- **Shareable Receipts (HTML + PNG)** added as the viral surface.
- **Honesty positioning** elevated to explicit brand pillar.
- **Cross-agent support** affirmed as defensive necessity, not just a v0.2 nice-to-have.
- **Development methodology adopted:** gstack ([garrytan/gstack](https://github.com/garrytan/gstack), 98.8k★) sprint pipeline — Think → Plan → Build → Review → Test → Ship → Reflect. Skill selection is token-cost-aware (skip multi-role simulations, use `/review` / `/freeze` / `/guard` regularly). See `docs/PROJECT-SPEC.md §14`.
- **Plugin distribution decision re-opened:** gstack's 98.8k★ as a Claude Code skill pack is strong evidence the channel isn't limiting. Decision deferred to v0.9 (pre-launch) — not rejected outright.

---

## 4. The 10 out-of-the-box ideas

Proposed by me in this session. Each was scored on (a) does it differentiate Sipcode? and (b) does it create a moat beyond pure orchestration?

| # | Idea | Status after curation |
|---|---|---|
| 1 | **`sipcode estimate "<task>"`** — predicts cost per model before you run | ✅ Locked in v1.0 |
| 2 | **`sipcode why`** — past-tense session auditor on real transcripts | ✅ Locked in v1.0 |
| 3 | **Predictive pre-summarize (warm cache)** — pre-generates compressed summaries of likely-co-edited files | ⏸️ Deferred to v1.1+ |
| 4 | **Spec-first mode (`sipcode plan "<task>"`)** — cheap planning pass before agent touches repo | ⏸️ Deferred to v1.1+ |
| 5 | **Shareable session receipts (OG-image PNG)** — beautiful screenshot-ready savings receipts | ✅ Locked in v1.0 |
| 6 | **Distribute as Claude Code plugin + skill** | ❌ Rejected by user (CLI/terminal only) |
| 7 | **Team mode → SaaS bridge** ($20/seat/month for org analytics) | ⏸️ Deferred to v1.1+ as **free CLI + paid hosted analytics**, not per-seat on the CLI itself |
| 8 | **The Sipcode Index** — quarterly published report on average Claude Code session economics | ⏸️ Deferred to v1.1+ |
| 9 | **Sipcode Score badge (GitHub Action)** — audits any repo's "agent-friendliness" | ✅ Locked in v1.0 (reframed — see §9.1) |
| 10 | **Bring-your-own-receipts community** — `@sipcode_receipts` X account amplifies user receipts | ✅ Locked in v1.0 (zero dev work, social only) |
| Bonus | **Hardest Tasks Benchmark** — canonical waste-maximizing corpus | ✅ Locked in v1.0 (reframed — see §9.3) |
| Bonus | **Privacy / zero-telemetry** as loud differentiator | ✅ Locked in v1.0 (engineering + README) |
| Bonus | **"5× your Pro plan" framing** | ✅ Locked in v1.0 (marketing copy only) |
| Bonus | **Open-source cookbook of optimization recipes** | ⏸️ Deferred to v1.1+ (community-driven, opens post-launch) |
| Bonus | **Fair plan calculator** — sometimes recommends downgrading | ⏸️ Deferred to v1.1+ |
| Bonus | **Plugin-for-templates partnerships** | ⏸️ Deferred to v1.1+ |
| Bonus | **Sponsored optimization recipes** | ⏸️ Deferred (requires community first) |
| Bonus | **Weekly "TWITO" thread** | ⏸️ Deferred (parallel-to-launch content effort, no dev work) |

---

## 5. User decisions made in this session

Recorded verbatim where possible.

| # | Question | User's answer | Implication |
|---|---|---|---|
| 1 | What is Sipcode at its core? | AI coding assistant / dev tool | Token optimization for AI coding agents confirmed |
| 2 | Primary user? | Individual consumers (B2C) | Indie devs / students primary persona |
| 3 | Stage? | Idea — nothing built yet | Greenfield; scaffold first |
| 4 | What do you want first? | Market positioning + competitive analysis | Strategy before code |
| 5 | Phase 1 shape? | "My version" — Manifest + `sipcode why` + Shareable Receipt | This session's recommendation chosen over prior session's (M1+M4 only) |
| 6 | Infra status? | npm org `sipcode` created; GitHub repo + domain still pending; "all the work you have to do by yourself" | Anuj wants Claude to do every doable task |
| 7 | Build path? | Fat v1.0 with curated curiosity-drivers (rejected both Big Bang v1 *and* thin v0.1) | "primary goal is to make best of cavemen + grapify ... but it like a tool that actually stand out in market so we have to make something that is actually strong, with the integration of all features in claude chat ... like the 4 modules and also + the 10 features ... not all, only those that can actually make the user end curious and which not many have done yet" |
| 8 | Distribution? | CLI / terminal only. No Claude Code plugin. Web UI later for non-CLI users. | "i dont want to make this for claude skill as that will limit to myself only for using it. i want it that user download it from our repo into thier terminal and then everyone can use it. later if we want we can also make an web ui for that as many user can find difficulty to use it." (Note: user's understanding of the Claude plugin reach was incomplete — clarified in §1 — but decision stands.) |

---

## 6. The fat v1.0 scope — 12 features locked

These ship together at the v1.0 launch. Order of internal milestones is in `docs/ROADMAP.md`; this is the *what*, not the *when*.

### 6.1 Core (the wedge — must ship)

| ID | Feature | What it does | Inherited from |
|---|---|---|---|
| **S001** | **Smart Context Manifest** | AST-generated compressed project map injected into `CLAUDE.md`. <2k tokens for 500-file repo. Zero LLM calls. | Module 1 (prior session) |
| **S020** | **Output Compression module** | Professional CLAUDE.md rule set — diff output enforcement, no preamble, structural compression. Three modes: default / strict / verbose. | Module 2 (prior session) |
| **S030** | **Session Hygiene** | Hook-based read-once cache, context-pressure warnings (50/70/90%), smart `/compact` timing at natural breakpoints. | Module 3 (prior session) |
| **S040** | **Analytics Dashboard** | Terminal + HTML report. Per-session breakdown, expensive reads, wasted reads, before/after. | Module 4 (prior session) |
| **S010** | **`sipcode why` — install-free past-tense auditor** | Reads `~/.claude/projects/<hash>/*.jsonl`, generates forensic report on where tokens went. **No install required.** | This session |
| **S014** | **Shareable Receipts (HTML + PNG)** | After any session, generate beautiful PNG/HTML receipt showing tokens saved. Designed to be shared on Twitter/LinkedIn. | This session |

### 6.2 Curiosity-drivers (why people share Sipcode)

| ID | Feature | What it does | Validated unique? |
|---|---|---|---|
| **S050** | **`sipcode estimate "<task>"`** | Predicts cost per model (Opus / Sonnet / Haiku) before you run. Takes task description + manifest as input. | ✅ Fully unique — no agent-session cost predictor exists (§9.2) |
| **S060** | **Sipcode Score (GitHub Action)** | Audits a *codebase* for "agent-friendliness" — directory shape, filename clarity, doc density, manifest quality. Posts a Platinum/Gold/Silver/Bronze badge on PRs. | ✅ Differentiated — `ecc-agentshield` audits agent *config*; nobody audits the *codebase* for agent-friendliness (§9.1) |
| **S080** | **Hardest Tasks Benchmark** | Public canonical corpus of 20 tasks specifically designed to maximize token waste. Becomes the industry-cited cost-waste measurement. | ✅ Differentiated — existing benchmarks (SWE-Bench, Terminal-Bench, Artificial Analysis Index) measure correctness/speed, not cost-waste (§9.3) |
| **S090** | **Privacy / zero-telemetry** | Engineered local-first. No data leaves the user's machine without explicit opt-in. Loud in README. | ✅ Real differentiator vs Cursor / OpenAI / Anthropic in 2026 |

### 6.3 Free marketing wins (zero dev time)

| ID | Feature | What it does |
|---|---|---|
| **S100** | **"5× your Pro plan" framing** | README copy and launch posts. Specific dollar comparisons hit 10× harder than percentage claims. |
| **S110** | **Reproducible benchmark suite + published methodology** | Every savings claim in the README is traceable to a runnable test. Builds the honesty pillar. |

### 6.4 What "fat v1.0" actually contains

**Total: 12 numbered features** — 6 core + 4 curiosity-drivers + 2 marketing wins. Anything else is v1.1+.

---

## 7. Deferred to v1.1+

Explicitly **not** in v1.0, by design.

| Feature | Why deferred |
|---|---|
| **Stack orchestration (RTK auto-config, context-mode auto-config)** | Fragile (depends on upstream tools' stability). Ship in v1.1 once Sipcode's own modules prove the savings. |
| **Multi-agent support (Cursor, Codex, Gemini CLI, Aider)** | Claude Code first. Add others fast in v1.1 once v1.0 proves the playbook. |
| **Cookbook of optimization recipes (community)** | Community-driven; opens after v1.0 launch when there are contributors. |
| **`@sipcode_receipts` social account** | Launches *alongside* v1.0 but is content effort, not dev work. |
| **Weekly "This Week in Token Optimization" thread** | Content / marketing effort. Parallel to v1.0 launch. |
| **Fair Plan Calculator** | Too niche for v1.0 critical mass. |
| **Plugin-for-templates partnerships** | Requires partner outreach. Post-launch. |
| **Sponsored optimization recipes** | Only meaningful once community + cookbook exist. |
| **Predictive pre-summarize (warm cache)** | Complex; needs read-once cache (S030) shipped first to be valuable. |
| **Spec-first mode (`sipcode plan`)** | Risky for vague tasks; need user research first. |
| **The Sipcode Index (quarterly published report)** | Needs cumulative usage data. v1.1 earliest. |
| **Team mode / paid hosted analytics** | Validate free CLI adoption before adding paid layer. |
| **Web UI for non-CLI users** | Per user's stated plan — explicitly post-v1.0. |
| **VS Code / Cursor extension (token cost in status bar)** | Cross-IDE work, post-v1.0. |
| **Distribute as Claude Code plugin/skill** | Rejected by user this session; may revisit post-v1.0. |

---

## 8. Feature → version mapping

The full table, every feature, every version. Use this as the canonical lookup.

| Stable ID | Feature | First ships in | Status as of 2026-05-18 |
|---|---|---|---|
| S001 | Smart Project Manifest Generator | **v1.0** | planned |
| S002 | Hot-files index from git history | **v1.0** | planned (sub-feature of S001) |
| S003 | Detected-patterns inference | **v1.0** | planned (sub-feature of S001) |
| S004 | Import-graph extraction | **v1.0** | planned (sub-feature of S001) |
| S005 | Delta-manifest updates | **v1.1** | deferred |
| S006 | Token-budget enforcement on manifest | **v1.0** | planned (guardrail in S001) |
| S010 | `sipcode why` past-tense session auditor | **v1.0** | planned (first milestone — see `docs/SESSION-HANDOFF.md`) |
| S011 | Duplicate-read detection | **v1.0** | planned (sub-feature of S010) |
| S012 | Idle-context detection | **v1.0** | planned (sub-feature of S010) |
| S013 | 0.6% breakdown per session | **v1.0** | planned (sub-feature of S010) |
| S014 | Shareable receipts (HTML + PNG) | **v1.0** | planned |
| S020 | Output compression module | **v1.0** | planned (Module 2 from prior session) |
| S021 | Diff-output enforcement | **v1.0** | planned (sub-feature of S020) |
| S022 | Three-mode toggle (default/strict/verbose) | **v1.0** | planned |
| S030 | Read-once cache + session hygiene | **v1.0** | planned (Module 3 from prior session) |
| S031 | Context-pressure warnings (50/70/90%) | **v1.0** | planned |
| S032 | Smart `/compact` at natural breakpoints | **v1.0** | planned |
| S033 | MCP-server pruning detector | **v1.1** | deferred |
| S040 | Analytics dashboard (terminal + HTML) | **v1.0** | planned (Module 4 from prior session) |
| S041 | context-mode detect/install/configure | **v1.1** | deferred |
| S042 | ccusage integration | **v1.1** | deferred |
| S043 | Multi-agent: Cursor | **v1.1** | deferred |
| S044 | Multi-agent: Codex | **v1.1** | deferred |
| S045 | Multi-agent: Gemini CLI | **v1.1** | deferred |
| S046 | Multi-agent: Aider | **v1.1** | deferred |
| S050 | `sipcode estimate "<task>"` cost prediction | **v1.0** | planned (this session's addition) |
| S051 | `sipcode plan "<task>"` spec-first generator | **v1.1** | deferred |
| S060 | Sipcode Score (GitHub Action) | **v1.0** | planned (this session — reframed) |
| S080 | Hardest Tasks Benchmark corpus | **v1.0** | planned (this session — reframed) |
| S090 | Privacy / zero-telemetry engineering + claim | **v1.0** | planned |
| S100 | "5× your Pro plan" framing | **v1.0** | planned (README copy) |
| S110 | Reproducible benchmark suite | **v1.0** | planned (launch prerequisite) |
| — | Cookbook of optimization recipes | **v1.1** | deferred (community-driven) |
| — | `@sipcode_receipts` social account | **alongside v1.0 launch** | content, not dev |
| — | Weekly TWITO thread | **alongside v1.0 launch** | content, not dev |
| — | The Sipcode Index quarterly report | **v1.1** | deferred |
| — | Team mode / paid hosted analytics | **v1.1+** | deferred |
| — | Fair Plan Calculator | **v1.1+** | deferred |
| — | Plugin-for-templates partnerships | **post-launch** | deferred |
| — | Web UI for non-CLI users | **post-v1.0** | deferred per user |
| — | VS Code / Cursor extension | **post-v1.0** | deferred |
| — | Claude Code plugin distribution | **rejected** | user decision; may revisit |

**Version meaning:**
- **v0.0.x** = scaffolding (current; first commit landed)
- **v0.1.0-alpha.N** = internal milestone releases on the path to v1.0
- **v1.0.0** = the "fat v1" public launch with all 12 features
- **v1.1.x+** = post-launch waves

---

## 9. Research findings

Run via WebSearch in this session to validate the three new curiosity-driver claims.

### 9.1 Sipcode Score — needs reframing, still differentiated

**Existing adjacent tools (found):**
- **`ecc-agentshield`** (built at Claude Code Hackathon February 2026) — audits agent *configuration*: CLAUDE.md, settings.json, MCP configs, hooks, agent definitions. Tiered Platinum/Gold/Silver/Bronze badge system. 1,282 tests, 98% coverage, 102 static analysis rules. Detects anti-patterns like OVER_CONSTRAINED, EMPTY_DESCRIPTION, MISSING_TRIGGER.
- Another CLI fingerprints projects and generates/syncs AI agent configs (CLAUDE.md, `.cursor/rules/`, `AGENTS.md`) and scores config quality.
- `claude-code-security-review` (Anthropic) — AI-powered security review GitHub Action.

**The gap:** none of these audit the **codebase itself** for agent-friendliness — directory shape, filename clarity, code-doc density, manifest readability. They audit *agent setup*, not *the repo the agent has to navigate*.

**Sharpened framing:** Sipcode Score rates whether your **codebase is easy for AI agents to work in**, not whether your agent's *config* is correct. Distinct angle.

### 9.2 `sipcode estimate` — fully unique, no competition

**Existing adjacent tools:**
- Generic token calculators (token-calculator.net, tokencalculator.ai) — estimate token counts from raw text input.
- Claude Code's internal byte-to-token heuristic for context budgeting.

**The gap:** nothing publicly available takes *"a coding task description + a repo manifest"* and predicts what a multi-turn agent session would actually cost across models.

**Verdict:** Ship as-is. Likely the single most "share-worthy" feature in v1.0.

### 9.3 Hardest Tasks Benchmark — needs reframing, still differentiated

**Existing benchmarks (found):**
- **SWE-Bench-Pro-Hard-AA** — correctness on hard tasks
- **Terminal-Bench v2** — terminal workflow
- **SWE-Atlas-QnA** — repository understanding
- **Artificial Analysis Coding Agent Index** — composite of the three above
- **Sitepoint Claude-Code-vs-Cursor benchmark** — found Cursor uses **5.5× more tokens** than Claude Code (188k vs 33k on identical tasks)

**The gap:** all existing benchmarks measure correctness, speed, and aggregate cost. **None** measures *cost-waste* — tasks specifically designed to expose where agents burn tokens unnecessarily.

**Sharpened framing:** Sipcode Hardest Tasks is the canonical **waste-maximizing corpus** — measures dollars wasted per correct answer, not pass rate. Different question entirely.

### 9.4 Bonus stat surfaced for the README

> *"Cursor uses 5.5× more tokens than Claude Code for identical tasks. Sipcode saves another 30–40% on top of Claude Code's already-lower baseline."*

— Sitepoint benchmark, 2026. Specific, sourced, conversion-grade.

---

## 10. Canonical market stats

Use these in the README, launch posts, and pitch decks. Every one is sourced.

| Stat | Value | Source |
|---|---|---|
| Average Claude Code session burns | **80,000–200,000 tokens** in 2–4 hours | Prior-session research |
| Anthropic enterprise benchmark | **$13 / developer / active day** | Anthropic, [code.claude.com/docs/en/costs](https://code.claude.com/docs/en/costs) |
| Cost per task — Claude Code Max | **$0.28 / task** (100-task average) | Sitepoint 2026 benchmark |
| Cost per task — Cursor Pro | **$0.19 / task** (skewed by simple tasks) | Sitepoint 2026 benchmark |
| Token ratio Cursor : Claude Code | **5.5× more** for identical tasks | Sitepoint 2026 benchmark |
| Tokens that are actual code output | **0.6%** of total session tokens | dev.to study of 38 sessions |
| Context that is repetitive across turns | **77%** | Prior-session research |
| Agent-team token multiplier | **~7× higher** vs solo sessions | Prior-session research |
| Manual 5-tool stack reduction | **85–92%** but takes a **full day** to configure | Pasquale Pillitteri analysis (April 2026) |
| Sipcode honest claim | **40–50%** total reduction (full stack) | Sipcode's own promise — to be benchmarked at launch |
| Caveman output reduction | **65% output / ~15–20% total** (output is 20–30% of spend) | Caveman README + Claude's analysis |

---

## 11. Architectural principles

Locked. Non-negotiable. Inherited from Answerable.

1. **Pure runners + I/O wrappers.** Every analyzer is a pure function over an in-memory model. I/O lives in thin wrappers that pure code never imports. Enables `InMemoryFs` and `ScriptedPrompter` test seams.
2. **Branded types.** `AbsoluteFilePath`, `TokenCount`, `SessionId`, `CheckId` are not raw strings. String-substitution bugs caught at compile time.
3. **Batched errors.** Validation returns `SipcodeValidationError` with full `issues[]` array. Never throws on first failure mid-flight.
4. **Stable IDs as public API.** Every check, optimization, metric has a stable identifier (`S001`, `M001`, `R001`, `E001`). Users reference them in config. Renames are breaking changes.
5. **Drift-prevention snapshot tests.** Snapshot tests on every generated manifest, report, and CLAUDE.md injection.
6. **Honest defaults.** Default config favors safety over savings. Aggressive modes are opt-in flags, never silent.
7. **Zero LLM calls in the manifest path.** Static analysis only. This is the line that distinguishes Sipcode from Graphify.
8. **DX-cost accounting (this session's addition).** Every optimization carries a `dx_cost` rating alongside `est_savings`. We never trade silent quality loss for token savings.

---

## 12. Tech stack

Locked.

| Concern | Choice | Version | Reasoning |
|---|---|---|---|
| Language | TypeScript | ≥ 5.5 | Carries from Answerable. Matches Claude Code ecosystem. |
| Runtime | Node.js | ≥ 20 | Native fetch, stable ESM, broad availability. |
| CLI framework | Commander | ^12.1 | Same as Answerable. Well-understood. |
| Tests | Vitest | ^2.0 | Same as Answerable. Fast, ESM-native. |
| Static analysis | tree-sitter | ^0.21 | Multi-language, no LLM. Same engine Graphify uses. |
| Config schema | zod | ^3.23 | Runtime validation + inferred TypeScript types. |
| Prompts | prompts | ^2.4 | Same as Answerable. Lightweight. |
| Terminal UX | chalk + ora | ^5 / ^8 | Standard CLI UX. |
| Distribution | npm | public — `@sipcode/cli` | Org claimed this session. |

---

## 13. Current state of the repo

As of first commit (`d5d4d41`, this session).

```
C:\Projects\Sipcode\
├── .gitignore
├── LICENSE                                 (MIT, copyright Anuj Ojha 2026)
├── README.md                               (drafted with 0.6% wedge + comparison table)
├── SIPCODE-MASTER-RECORD.md                (this file)
├── sipcode-full-conversation-record.md     (prior brainstorm transcript, Anuj's version)
├── package.json                            (@sipcode/cli, all deps declared)
├── tsconfig.json                           (strict mode, NodeNext, ES2022)
├── vitest.config.ts                        (node env, v8 coverage)
├── docs/
│   ├── PROJECT-SPEC.md                     (will be updated to fat v1.0 scope next)
│   ├── ROADMAP.md                          (will be updated to v0.1.0-alpha → v1.0.0)
│   ├── AUDIT-FRAMEWORK.md                  (stable IDs locked; will extend with S050+/S060+/S080+/S090+)
│   └── SESSION-HANDOFF.md                  (brief for first milestone: sipcode why)
├── src/
│   ├── cli.ts                              (Commander entry; all subcommands registered)
│   ├── commands/
│   │   ├── why.ts                          (stub — first impl milestone)
│   │   ├── init.ts                         (stub)
│   │   ├── manifest.ts                     (stub)
│   │   ├── receipt.ts                      (stub)
│   │   └── stats.ts                        (stub)
│   └── lib/
│       ├── types.ts                        (branded types: SessionId, AbsoluteFilePath, etc.)
│       ├── errors.ts                       (SipcodeValidationError, E001–E007)
│       ├── result.ts                       (Result<T, E> discriminated union)
│       └── messages.ts                     (centralized user-facing strings)
├── tests/.gitkeep                          (folder placeholder)
└── _export/                                (gitignored: Claude.ai data export + transcript)
```

**Repo status:**
- Git initialized, branch `main`, one commit (`d5d4d41`).
- No GitHub remote yet (`Anuj7411/sipcode` not created).
- `npm install` has not been run.
- No code runs yet — all commands print "not yet implemented" stubs.

**Memory files at** `C:\Users\ojhaa\.claude\projects\C--Projects-Sipcode\memory\` cross-reference this record:
- `MEMORY.md` — index
- `user_anuj.md` — Anuj profile
- `project_sipcode.md` — Sipcode positioning + market stats
- `project_sipcode_architecture.md` — architecture + module breakdown
- `reference_prior_session.md` — pointer to prior brainstorm transcript

---

## 14. Risks and mitigations

Most are from PROJECT-SPEC §13; this session added rows 1, 6, and 7.

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Anthropic ships native cost optimization in Claude Code** | High | High | Cross-agent support post-v1.0 (Cursor/Codex/Gemini). Win on the *neutral measurement* role. |
| 2 | Caveman / RTK / context-mode pivot or break their interfaces | Medium | Medium | Orchestration uses thin adapters with graceful degradation. (Mostly moot in v1.0 since orchestration is deferred to v1.1.) |
| 3 | 0.6% study turns out to be unreproducible | Low | High | Publish Sipcode's own reproduction methodology. Cite multiple sources. `sipcode why` shows users their *own* number. |
| 4 | Token-pricing model changes wipe out dollar claims | Medium | Low | Pricing read from versioned pricing file shipped with each release. Receipts cite "as of <release>". |
| 5 | Name collision with a beverage trademark for "Sipcode" | Low | Medium | Verify USPTO + EUIPO before public launch. (Outstanding action.) |
| 6 | **Reproducible benchmark shows < 30% real-world savings** | Medium | High | Honesty is the brand. Ship whatever the real number is. 28% is still ~$1,800/year/dev — that's the story. |
| 7 | **Sipcode Score badge feels gimmicky / no one adopts** | Medium | Medium | Seed adoption: ship Sipcode's own repo with a Platinum score badge. Add to Anuj's other projects. Pitch to template authors. |
| 8 | Anuj burnout — solo dev, budget-constrained | Medium | High | Fat v1.0 is still scoped (12 features, not 30). Most "free marketing wins" are zero-dev. Implementation broken into clear milestones via SESSION-HANDOFF docs. |

---

## 15. Open questions / next actions

### 15.1 Outstanding for Anuj (can't be done by Claude)

1. **Create GitHub repo** `github.com/Anuj7411/sipcode` (Private is fine for now.) Then: `git remote add origin … && git push -u origin main`.
2. **Buy `sipcode.dev`** (target ≤ $15).
3. **Trademark gut-check** "Sipcode" against beverage industry — quick USPTO + EUIPO search.
4. **Install gstack** (Anuj decided to adopt the sprint-pipeline methodology). Touches global `~/.claude/skills/`, so Claude won't auto-run it:
   ```bash
   git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack \
     && cd ~/.claude/skills/gstack \
     && ./setup
   ```
   Prerequisites: Bun ≥ 1.0. Reference: [garrytan/gstack](https://github.com/garrytan/gstack) (98.8k★).
5. **Decision point at v0.9 (pre-launch):** revisit Claude Code plugin distribution. gstack proves the channel is massive (98.8k★ as a CC skill pack). Currently deferred — "No preference" answer in this session.

### 15.2 Outstanding for Claude (next session)

1. **Update `docs/PROJECT-SPEC.md`** to reflect fat v1.0 scope (replace §6 "Phase 1 scope" with the 12-feature v1.0 scope; collapse Phases 2–4 into v1.1+ in §7–9).
2. **Update `docs/ROADMAP.md`** — restructure as v0.0.x → v0.1.0-alpha.N → v1.0.0 → v1.1.x.
3. **Extend `docs/AUDIT-FRAMEWORK.md`** with the new stable IDs: S050 (estimate), S060 (Sipcode Score), S080 (Hardest Tasks), S090 (Privacy), S100 ("5× Pro" framing), S110 (benchmark suite). Add `dx_cost` column to the optimization tables.
4. **Update `README.md`** with sharpened framings: Sipcode Score = codebase-agent-friendliness, Hardest Tasks = waste-maximizing benchmark. Add the 5.5× Cursor stat. Add the explicit "How it differs from neighbors" section (ecc-agentshield, everything-claude-code, SWE-Bench).
5. **Create `docs/COMPETITORS.md`** — explicit positioning against neighbors (Caveman, RTK, context-mode, Graphify, Headroom, ccusage, ecc-agentshield, everything-claude-code, SWE-Bench / Artificial Analysis).
6. **Commit the doc updates** as `docs: lock fat v1.0 scope`.
7. **Optional:** run `npm install` and verify `npx tsx src/cli.ts --help` works.
8. **Begin implementation of `sipcode why`** per `docs/SESSION-HANDOFF.md` — first milestone.

### 15.3 Decision points still open

None blocking. All major scope, naming, distribution, and architecture decisions are locked.

---

## 16. Source index

Every URL cited across this record and the planning docs, organized by topic.

### Anthropic / Claude Code official

- [Manage costs effectively — Claude Code Docs](https://code.claude.com/docs/en/costs)
- [Pricing — Claude API Docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [`claude-code-security-review` — Anthropic](https://github.com/anthropics/claude-code-security-review)

### Competitor / reference repos

- [Caveman — JuliusBrussee](https://github.com/juliusbrussee/caveman) — 59.2k★, output compression
- [Graphify — safishamsi](https://github.com/safishamsi/graphify) — 47.2k★, codebase knowledge graph
- [everything-claude-code — affaan-m](https://github.com/affaan-m/everything-claude-code) — skills + memory + research framework

### Benchmarks and cost analysis

- [Claude Code vs Cursor: Speed, Accuracy & Cost Benchmark 2026 — Sitepoint](https://www.sitepoint.com/claude-code-vs-cursor-developer-benchmark-2026/)
- [AI Coding Agent Index & Performance Analysis — Artificial Analysis](https://artificialanalysis.ai/agents/coding-agents)
- [AI Coding Agent Cost Comparison 2026 — DevTk.AI](https://devtk.ai/en/blog/ai-coding-agent-cost-comparison-2026/)
- [AI Coding Agents Compared 2026 — ofox.ai](https://ofox.ai/blog/claude-code-vs-codex-cli-vs-cursor-vs-deepseek-tui-2026/)
- [AI Coding Benchmark: Claude Code vs Cursor — AIMultiple](https://aimultiple.com/ai-coding-benchmark)
- [14 Best AI Coding Agents in 2026 — Morph](https://www.morphllm.com/best-ai-coding-agents-2026)
- [The Real Cost of AI Coding in 2026 — Morph](https://www.morphllm.com/ai-coding-costs)
- [Codex vs Claude Code (May 2026) — Morph](https://www.morphllm.com/comparisons/codex-vs-claude-code)

### Pricing and plan guides

- [Claude Code Pricing 2026 — Verdent](https://www.verdent.ai/guides/claude-code-pricing-2026)
- [Claude Code Pricing 2026 — Finout](https://www.finout.io/blog/claude-code-pricing-2026)
- [Token Calculator & Cost Estimator (2026)](https://token-calculator.net/)
- [AI Token Calculator](https://tokencalculator.ai/)

### Token-optimization analyses

- [Claude Code Token Optimization: Stop the $1,600 Bill (2026) — Build to Launch](https://buildtolaunch.substack.com/p/claude-code-token-optimization)
- [Claude Code Token: 10 GitHub Repos That Cut Up to 90% — Pasquale Pillitteri](https://pasqualepillitteri.it/en/news/1181/claude-code-token-10-github-repos-savings)
- [I Analyzed 38 Claude Code Sessions. Only 0.6% of Tokens Were Actual Code Output — DEV Community](https://dev.to/lsvishaal/i-analyzed-38-claude-code-sessions-only-06-of-tokens-were-actual-code-output-56li)
- [AI Agent Token Budget Management — MindStudio](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)
- [Claude Code Token Limits — Faros AI](https://www.faros.ai/blog/claude-code-token-limits)

### Development methodology

- [gstack — garrytan](https://github.com/garrytan/gstack) — 98.8k★, Claude Code skill pack simulating a multi-role engineering team. Adopted as Sipcode's sprint-pipeline methodology.

### Agent ecosystems / awesome lists

- [awesome-agent-skills — VoltAgent](https://github.com/VoltAgent/awesome-agent-skills)
- [awesome-claude-skills — BehiSecc](https://github.com/BehiSecc/awesome-claude-skills)
- [awesome-ai-agents-2026 — caramaschiHG](https://github.com/caramaschiHG/awesome-ai-agents-2026)
- [awesome-ai-agents-2026 — ARUNAGIRINATHAN-K](https://github.com/ARUNAGIRINATHAN-K/awesome-ai-agents-2026)
- [Dive-into-Claude-Code — VILA-Lab](https://github.com/VILA-Lab/Dive-into-Claude-Code)
- [agents — wshobson](https://github.com/wshobson/agents)
- [claude-code-ultimate-guide audit-prompt — FlorianBruniaux](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/tools/audit-prompt.md)

---

## 17. Glossary of stable IDs

Live registry. When adding a new ID, update both this record and `docs/AUDIT-FRAMEWORK.md` simultaneously. IDs never get reused after deprecation.

| ID prefix | Meaning |
|---|---|
| **S###** | Sipcode optimization or feature (e.g., S001 = manifest generator) |
| **M###** | Metric emitted by `sipcode why`, `sipcode stats`, etc. |
| **R###** | Recommendation surfaced to the user |
| **E###** | Validation error code |

Active IDs at end of this session:

- **S001–S006** (manifest layer), **S010–S014** (session-audit layer), **S020–S022** (output compression), **S030–S033** (session hygiene), **S040–S046** (orchestration), **S050–S051** (forecasting), **S060** (Sipcode Score), **S080** (Hardest Tasks), **S090** (Privacy), **S100** ("5× Pro plan" framing), **S110** (benchmark suite).
- **M001–M014**, **M020–M021** (metrics).
- **R001–R008** (recommendations).
- **E001–E007** (validation errors).

See `docs/AUDIT-FRAMEWORK.md` for the full definition of each.

---

*End of Master Record. If anything in this document conflicts with another doc in `docs/`, this file wins until the doc is updated to match.*
