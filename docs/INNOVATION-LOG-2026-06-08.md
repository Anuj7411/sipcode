# Innovation log — what deep research surfaced (and where each idea landed)

> Companion to `SESSION-HANDOFF-2026-06-08.md`. The handoff covers state and conventions; this doc covers **every idea we evaluated across the recent sessions** and tells you why each is alive, dead, or shipped. Read it before you propose any new product direction — most "fresh ideas" have already been chewed on here.
>
> Each item has the SAME shape: **what it is → research that informed the call → status → if dead, why → if alive, what's needed to build**.

---

## A. SHIPPED (already in `sipcode@1.6.4` on npm)

### A1. `sipcode proxy` — runtime input rewriter
PreToolUse hook that rewrites bulky tool calls to compact forms before Claude sees them (`git log` → `git log --oneline -n 20`, etc.). Eight Bash rewriters + two native-tool injectors (Grep, Glob). Same answer, fewer tokens. **Phase A complete.**

### A2. `sipcode drift` — context-rot smoke alarm
Compares your latest session against a rolling median of recent sessions. Silent unless something genuinely regressed (3+ session baseline + conservative thresholds + absolute floors so it never cries wolf on a 0-turn session). Names the metric, shows norm vs latest, suggests a fix. **The flagship of v1.6.x. Genuinely novel for individual Claude Code devs.**

### A3. The reliability framing ("clean context = right answers")
**Strategic positioning pivot** validated 2026-06-05. Two pillars: token performance stays ≥ RTK (non-negotiable, never degrade) + reliability is the differentiator. Reliability numbers (29% / 40%) cited from research, never claimed as Sipcode's own measurement.

### A4. Honesty-as-brand
The "What Sipcode does NOT do" section, the `--vs-rtk` benchmark as proof not claim, the "cited from research / measured by Sipcode / self-reported" labeling rule. **This IS the product's structural moat.** Incumbents structurally can't match it once they're commercial.

### A5. Transcript-native zero-setup analytics
Reads `~/.claude/projects/*.jsonl` directly. No SDK, no account, no telemetry. Different lane from Braintrust / LangSmith / Helicone / Phoenix / Promptfoo (all need SDK + cloud + team pricing). **This IS the moat against the enterprise FinOps stack** — they can't reach individual Claude Code devs without becoming a different product.

---

## B. DEFERRED — genuinely innovative, still ours to build

### B1. Drift v2 — persistent baselines + config-cause attribution
**What it is:** Current drift recomputes baseline from raw transcripts every run. V2 persists baselines to disk so the detector survives session restarts AND ties drift events to *causes*: "your tokens/turn jumped 34% the same day MCP server X was added and CLAUDE.md grew 2KB."

**Research:** Nobody else does cross-session config-cause attribution for individual devs. The closest things (Datadog AI Agents Console, Dynatrace) need full APM instrumentation, are team-priced, and target enterprise. Academic frontier: [AgentAssay arXiv 2603.02601](https://arxiv.org/abs/2603.02601) is moving here but only for enterprise eval pipelines, not solo devs.

**Status:** Open. The single most valuable next-product item.

**What's needed:**
- A small `~/.sipcode/drift-history/` JSONL store (mirrors the existing `proxy-stats/` pattern)
- A diff layer that snapshots `~/.claude/settings.json` + `CLAUDE.md` size + MCP server list at each session start
- Attribution math: when a drift signal fires, what changed in the snapshot since the baseline window?
- Tests against fixture transcripts that simulate config changes
- Probably ships as `sipcode@1.7.0` (minor — new persistent storage = milestone)

---

### B2. Live `sipcode benchmark --vs-rtk` execution harness
**What it is:** The current `--vs-rtk` is a **heuristic preview** replaying rewriters over the corpus's recorded tool calls. The corpus is static fixtures. Users can't yet see a true apples-to-apples live execution comparison between Sipcode-on and Sipcode-off (or vs RTK).

**Research:** RTK's site has a "30-min session" savings table that's illustrative, not reproducible. Our `sipcode benchmark` corpus median (62.6%) IS reproducible but doesn't prove parity with RTK on like-for-like commands. A live harness would. **Backs the "performance pillar" claim measurably.**

**Status:** Open. Deferred from Phase A explicitly.

**What's needed:**
- An execution runner that actually runs each corpus task twice (with/without proxy), captures real token usage from the API, and tabulates the delta
- Optionally a third run with RTK installed for the comparison side
- Probably 2–3 days of work
- Important for launch credibility: without it the "≥ RTK on tokens" claim is asserted, not proven

---

### B3. AST-aware symbol-level reads — REFRAMED as reliability
**What it is:** Phase B from the old roadmap. When the agent calls `Read("auth.ts")`, return only the symbols relevant to the current session's intent, not the full file. Uses real parsers (TS via @typescript-eslint/parser or ts-morph, Python via tree-sitter-python, etc.).

**Original framing (DEAD):** "Beat RTK on compression % (96% vs their 88%)." Retired — we don't race RTK on percentages.

**Reframed (LIVE):** "Cleanest context, not just compressed context." Symbol-level reads = the leanest context Claude can reason on = the deepest expression of the reliability story. Ties directly to the brand thesis.

**Research:** RTK uses regex/line-based filtering. Their ceiling is bounded by what regex can do. AST gives us:
1. Higher compression on code (a function body is ~10% of a file's tokens after removing imports, comments, dead code)
2. Quality preservation that line filters can't achieve (never drop the line the agent needs)
3. Symbolic anticipation (predict next reads from import graphs)

**Status:** Open, 2–3 weeks for solo dev, ambitious.

**Caveat:** Anthropic is also moving here with native context editing (their published 84%/29% finding). Watch closely. Our angle that doesn't get commoditized: cross-session symbol relevance learned from transcript history.

---

### B4. Compression-integrity scoring (the honesty guardrail)
**What it is:** Every time something is compressed, return a "lost X% information" signal so the user knows when summaries may hide an answer. Surface a tiny indicator: "this file was compressed 87%; if Claude seems confused, click here for the full source."

**Why it matters:** Compression is a savings/quality tradeoff. Nobody tells you when they've crossed the line. This makes the tradeoff visible. **Pure reliability-honesty play.**

**Status:** Open. Probably v1.8.x. Best paired with B3.

---

### B5. Integrated re-read dedup
**What it is:** When the agent tries to Read a file it already read this session AND the file hasn't changed, return "unchanged since turn N" plus a diff, instead of re-sending the whole file.

**Research:** **Already shipped by others** — `read-once` (PreToolUse hook), Read Cache MCP, Codebase Memory MCP (~99% savings claimed on file reads). So this is NOT novel.

**Reason to include anyway:** Users shouldn't need a second tool. Integrate it so Sipcode is the only token-economy tool a Claude Code dev installs. Will not claim novelty, will say "this is included so you don't need a separate tool."

**Status:** Open. Probably the first feature in the "performance-keeps-up-with-RTK" line of work. ~3-5 days.

---

### B6. Adaptive context-pressure compression
**What it is:** Compress LIGHTLY at 50% context fill, AGGRESSIVELY at 70%, summary-only at 90%. The compression strategy adapts to how full the context window is.

**Status:** Open but **risky.** Anthropic ships native context editing (their 84%/29% finding); they are eating this slice at the platform level. Build only if their native version proves to have a clear gap.

---

### B7. MCP tool surface consolidation (12 → 4)
**What it is:** Sipcode currently exposes 13 MCP tools, costing ~1,534 tokens/turn of schema overhead just to be installed (measured, not guessed). Consolidating to ~4 parameterized tools (`sipcode_proxy(action: install|uninstall|status|stats)`, `sipcode_audit(what: last_session|impact|stats|score)`, etc.) drops it to ~325 tokens/turn — **79% less overhead** — with zero feature loss.

**Research:** Looked into MCP Resources (push response from earlier session). Resources are user-pulled, not model-invokable, so they can't replace dynamic queries like "audit my session" — that idea would actually break the product. Tool consolidation is the right move; resources are not.

**Status:** Open. Breaking change for anyone scripting against the current tool names → must ship as **2.0.0**. Real impact on real users is tiny (people speak natural language to Claude, not raw tool names), but tests/docs/release notes need updating.

---

## C. EXPLORED FOR NON-TECH / STUDENT USERS — dropped or partially alive

### C1. "Chat with your file" MCP — RAG over local PDFs/PPT/DOCX
**What it would do:** Student says "analyze my report.pdf." Sipcode's MCP tool extracts text + tables locally, chunks + embeds, returns only the relevant ~3K tokens for the question. 90%+ savings vs drag-dropping the file (PDFs are ~1,500–3,000 tokens per page because Anthropic ingests pages as images + text).

**Why it came up:** Students hit Claude limits fast when attaching PDFs/slides for analysis.

**Research:** Drag-dropped attachments **cannot be intercepted** by any MCP server — closed pipeline. Plain conversion is **already solved** by Microsoft MarkItDown (82k★) and several MCP servers ([markitdown-mcp](https://github.com/trsdn/markitdown-mcp), [markdownify-mcp](https://github.com/zcaceres/markdownify-mcp)). What's NOT solved: **retrieval-not-dump** (top-k chunks per question instead of full document) + **savings transparency** ("attaching = ~52K tokens, this way = ~4K").

**Status: DROPPED for now** because (a) doesn't serve Sipcode's actual audience (Claude Code devs, not students), and (b) requires students to use a tool instead of drag-drop, which is real friction for non-tech users.

**If we ever pivot to file analysis**, the differentiation is the retrieval + savings transparency, not the conversion. MarkItDown owns conversion.

---

### C2. Token-budget guardian — fear-of-limit UX
**What it would do:** Estimate cost of an action BEFORE it runs, warn the user, nudge toward the cheap path. Designed for the "I'm scared of hitting Claude's limit" feeling students have.

**Status:** DROPPED with C1. Same audience issue.

---

### C3. Local AI sidecar — model routing
**What it would do:** A separate companion app classifies queries; cheap ones (summarize a chapter) go to a local model (Phi / Qwen / Gemma), Claude only sees high-value reasoning queries.

**Status: DROPPED.** Architecturally it's a different product, not a Sipcode extension. Claude Desktop can't route a user's typed query out to a local model.

---

### C4. Shared semantic cache / "Claude Cache Network"
**What it would do:** Crowd-sourced cache of common Q&A. When user asks something similar to what someone else asked, serve cached answer; Claude not invoked.

**Status: DROPPED.** ToS concerns (serving one user's answer to another). Correctness risk. Requires sitting in front of Claude — closed pipeline forbids.

---

### C5. Browser extension for claude.ai chat
**What it would do:** A Chrome extension intercepts Claude.ai chat to optimize tokens client-side.

**Research:** CSP on claude.ai blocks injected scripts from doing anything meaningful. Even with an extension, every Anthropic UI change would break it. Plus existing extensions already do (or claim) this. Plus ToS gray area.

**Status: DROPPED.** Not the $5 dev fee — the maintenance burden and ToS risk.

---

### C6. Paste-able terse-style pack for claude.ai
**What it would do:** Sipcode generates a "terse / no preamble / diff-only" instructions block that the user pastes into claude.ai's Custom Instructions or a Project. Cuts output tokens on every turn. Free, no install, browser-friendly.

**Status: PARTIALLY ALIVE.** Modest savings. Sipcode already has the rules logic (the output-compression rules in `sipcode rules`). Generating a paste-able variant for claude.ai would take ~1 day. **Decent post-launch addition for the non-Code-using crowd.**

---

### C7. Pre-paste compression for browser users
**What it would do:** A small Sipcode CLI command: `sipcode compress <file>` produces a compact text version the user pastes into Claude chat instead of attaching the original.

**Status: ALIVE but minor.** Worth doing if someone asks. Not a strategic priority.

---

## D. "WHAT'S ALREADY TAKEN" — research that shaped what NOT to build

### D1. Context-bloat snapshot auditors — TAKEN
[unclog](https://github.com/thomaschill/unclog), context-budget skill, several CLAUDE.md analyzers exist. Don't build another.

### D2. Auto cache-breakpoints — PARTIALLY TAKEN
[flightlesstux/prompt-caching](https://github.com/flightlesstux/prompt-caching) auto-injects breakpoints. The slice that's still open: dynamic cache-aware routing based on context state, but it's a niche niche.

### D3. Anthropic's Tool Search Tool — PLATFORM-LEVEL COMPETITOR
[anthropic.com/engineering/advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use). Native on-demand tool loading, ~85% schema-overhead reduction. Available for API/Claude Code; not clearly for Desktop yet. **Watch closely:** if it lands in Desktop, our MCP-overhead pitch loses force.

### D4. Native context editing (Anthropic) — PLATFORM-LEVEL COMPETITOR
Their published numbers: **84% fewer tokens AND 29% quality lift** from editing stale context. Model-level capability, not a hook. **This is the citation we use to ground the reliability story.** Also a competitor — they may eat the compression layer entirely over 12-18 months.

### D5. Enterprise eval / observability — DIFFERENT LANE
Braintrust ($80M Series B, $800M val), LangSmith, Helicone, Phoenix, Promptfoo. **All need SDK instrumentation.** All target teams building agent products. **All structurally can't reach individual Claude Code devs** without becoming a different (cheaper, instrument-free) product. This is the lane we own.

### D6. AgentAssay (academic) — INSPIRATION
[arXiv 2603.02601](https://arxiv.org/abs/2603.02601). Token-efficient regression testing for non-deterministic agent workflows. 78-100% cost reduction. **Academic frontier of what drift v2 should become.** Open-source on GitHub. Worth reading before building drift v2.

---

## E. THE FOUR FALSE PATHS — ideas that LOOKED smart but research killed

### E1. "Beat RTK on compression %"
**The trap:** Race a 52k★ Rust incumbent on the metric they own (compression %). Even if we win short term, they iterate and re-take it; we burn months of engineering on a war we can only tie at best.

**The lesson:** **Differentiate on positioning** (reliability) **while matching on performance** (don't degrade). The two-pillar approach.

### E2. "Make MCP resources do the work" (the gateway-router idea)
Pushed by another AI's blueprint. Research killed it: resources are user-pulled, not model-invokable. Turning Sipcode's analytics tools into resources would mean Claude can no longer call them — destroys the product.

### E3. "Intercept Claude Desktop / claude.ai chat to optimize tokens"
Closed pipeline. There is no interception point. Verified twice across two research rounds. **This is a fundamental architectural fact; revisiting it wastes time.**

### E4. "Build something for non-tech Claude users"
Sipcode is a Claude Code (terminal/IDE agent) tool. Non-tech students mostly use Claude.ai chat or Claude Desktop. The mismatch is structural. Either pivot the whole product, or accept that students aren't the audience. **We accepted; desktop-first.**

---

## F. THE VALIDATED STRATEGIC POSITION (don't relitigate)

Validated 2026-06-05 via deep research across context-engineering, agent-FinOps, and competitor surveys:

1. **"Context rot" is a real, named, search-trending pain.** Documented in arXiv papers, in Anthropic's own engineering posts, in Claude Code GitHub issues. Not invented.
2. **"Context engineering" is THE 2026 dev skill** — Gartner declared 2026 "Year of Context." Durable narrative, not a buzzword cycle.
3. **The reliability lane for individual Claude Code devs is open.** Enterprise eval has $80M-funded incumbents but they can't reach our user. **Open lane.**
4. **The narrative + the lane fit the product we already shipped** — drift detector, transcript-native analytics, valve+meter pattern. No re-architecting needed.

**Therefore the question for the next phase is NOT "what should Sipcode be?"** That's settled. The question is: *which of B1–B7 do we build next, in what order, and on what timeline?*

---

## G. Recommended next-product priority order (my read, your call)

1. **B5 — Integrated re-read dedup.** Most user-visible savings; gets us to "tokens ≥ RTK" parity claim measurably. ~3-5 days.
2. **B2 — Live `--vs-rtk` benchmark harness.** Proves the performance-pillar claim before launch. ~2-3 days.
3. **B1 — Drift v2 (persistent baselines + config-cause attribution).** Deepens the reliability moat. ~1-2 weeks.
4. **B4 — Compression-integrity scoring.** The honesty-guardrail finishing touch. ~3-5 days.
5. **B3 — AST-aware symbol reads.** Most ambitious; biggest reliability + token win; build after the above are stable. ~2-3 weeks.

These five, in this order, get us to ~v1.9 with a comfortable differentiation lead before Anthropic's native capabilities catch up.

**B6 (adaptive pressure compression) and B7 (MCP consolidation, breaking 2.0.0)** are watch-and-wait — useful but not urgent.

End of log.
