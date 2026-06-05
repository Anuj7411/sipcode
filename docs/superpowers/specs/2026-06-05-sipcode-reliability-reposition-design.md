# Sipcode — Reliability Repositioning + Drift Detector (Design Spec)

**Date:** 2026-06-05
**Status:** Draft for user review (brainstorming → spec gate)
**Owner:** Anuj

---

## 1. One-line summary

Reposition Sipcode from "token optimizer" (commoditized) to **"keep your agent's
context clean so it gives better answers — and costs less"** (open lane), under
the existing *"sip your tokens, don't gulp them"* brand, and add one new flagship
feature — a **context/cost drift detector** — that is automatic and silent until
something actually regresses.

## 2. Why (validated, 2026-06-05)

- The pain is real and named: **"context rot"** — bloated/redundant context makes
  Claude hedge, forget fixes, mix up codebases. Documented widely + Claude Code
  issue #29971.
- The narrative is durable: "context engineering" = the defining 2026 dev skill
  (Gartner "Year of Context"). Citable external proof: *well-maintained context →
  40% fewer agent errors, 55% faster completion*.
- The gap is open: enterprise eval/observability tools (Braintrust, LangSmith,
  Helicone, Phoenix, Promptfoo) all need SDK instrumentation and target teams
  building agent products. **No zero-setup, transcript-native reliability tool
  exists for the individual Claude Code dev.** That lane is Sipcode's.

## 3. Non-negotiable: nothing is deleted

This is **additive + a reframe**. Explicitly:

| Component | Fate |
|---|---|
| `sipcode proxy` (valve) | **Kept**, unchanged — still rewrites commands, still saves tokens |
| Meter: `why`/`impact`/`stats`/`score`/`estimate`, all MCP tools | **Kept**, unchanged |
| `benchmark` (62.6% corpus), receipt, hygiene, rules, manifest | **Kept**, unchanged |
| 972 tests, CI, release pipeline | **Kept** |
| README / positioning | **Reframed** (story only, no code removed) |
| **Drift detector** | **Added** (new code, new feature) |

**Two pillars, both non-negotiable:**
- **Performance** — token optimization stays **best-in-class: equal-or-better than
  RTK** on compression ratio. We do *not* trade performance for the new story. If a
  user could save more with RTK, the strategy fails (they'd split tools). The
  semantic/AST roadmap (below) is how we stay ahead; the live `benchmark --vs-rtk`
  harness is how we *prove* it.
- **Positioning** — reliability / clean context is the *headline and differentiator*.

The token-saving is therefore **both** a real performance commitment **and** the
verifiable proof that we're actually cleaning context. It is not demoted to a
footnote — it is the floor we must never drop below.

## 4. Positioning (the reframe)

**Brand (unchanged):** *Sip your tokens, don't gulp them.*

**Narrative beneath it:**
> Gulping = dumping bloated, redundant context at your agent → it chokes (context
> rot) → vague answers, forgotten fixes, *and* a bigger bill. Sipping = clean,
> measured context → sharper answers and lower cost. Sipcode keeps the intake
> clean (valve), measures it (meter), and warns you when it starts to rot (drift).

**Three layers, one story:**
1. **Valve** (`proxy`) — automatically trims what enters context.
2. **Meter** (`impact`/`stats`/`score`) — measures the trimming (the proof).
3. **Drift** (new) — catches when context health regresses over time.

**Claims policy (honesty contract — enforced in copy review):**
- We **prove** token/context reduction (we have the numbers).
- We **cite, not claim**, reliability gains (the external 40%/29% figures) — never
  assert "Sipcode makes Claude X% smarter" without our own evidence.
- The drift detector's outputs are measured facts (cost/turn, cache rate, overhead),
  not inferred intelligence.

## 5. Flagship feature: `sipcode drift` — context/cost regression detector

### 5.1 What it does (painkiller, not vitamin)

Silently tracks each Claude Code session's context-health metrics over time from
the transcripts Sipcode already reads. **Surfaces nothing unless a real regression
is detected** — then it names the likely cause. A smoke alarm, not a dashboard.

Example output (only shown when there IS a regression):
```
⚠ Sipcode drift: your cost/turn rose ~34% over the last 3 sessions.
  Likely causes:
    • +2 MCP servers loaded  (+3,100 tokens/turn of tool schema)
    • CLAUDE.md grew 1,800 → 3,600 tokens (prepended every turn)
    • cache hit rate dropped 71% → 48% (context prefix is changing mid-session)
  These also degrade answer quality (context rot), not just cost.
```
No regression → exit quietly (`"no drift — context health stable"` only on demand).

### 5.2 Metrics tracked (v1, all derivable from transcript + local files)

- **tokens/turn** (and input:output ratio) — from transcript usage metadata.
- **context overhead** — MCP tool-schema tokens (count × measured size) + CLAUDE.md
  size. (We already measured the MCP method this session.)
- **cache hit rate** — `cache_read / (cache_read + input)` from usage metadata.
- **re-read count** — repeated Reads of the same path in a session.

### 5.3 Detection + attribution

- **Baseline:** rolling median of the metric over the last N sessions (N≈5, configurable).
- **Regression:** a recent window deviates beyond a threshold (e.g. +30% cost/turn,
  cache rate drop > 15pts). Conservative by default — **must not cry wolf** (a false
  alarm is the one thing that kills trust here).
- **Attribution:** compare detectable, low-ambiguity deltas between the regressed
  window and baseline — MCP server/tool count, CLAUDE.md size, cache-rate change,
  re-read spike. Report only causes we can actually observe; never guess.

### 5.4 Surfaces

- **CLI:** `sipcode drift` (run on demand; `--json`; `--since`).
- **MCP tool:** `get_drift_report` (so it's reachable from Claude Desktop chat too).
- v1 default is **on-demand + silent-unless-regression**. (Auto/background alerting
  via a Stop hook is explicitly **out of v1** — see §7.)

## 6. Architecture (follows existing Sipcode patterns: pure runners + I/O seams)

```
src/modules/drift/
├── metrics.ts        pure: parsed transcript → SessionMetrics
├── baseline.ts       pure: SessionMetrics[] → Baseline + deviation
├── attribution.ts    pure: (regressed, baseline snapshots) → likely causes
├── drift-store.ts    I/O seam: persist per-session metric snapshots (local JSONL,
│                     per-PID, mirrors proxy stats-store)
├── format-json.ts    pure: DriftReport → stable JSON
└── format-terminal.ts pure: DriftReport → smoke-alarm text
src/commands/drift.ts  CLI wiring (mirrors commands/proxy.ts deps-injection shape)
src/mcp/server.ts      + get_drift_report tool (consolidated tool surface, see §8)
```

**Reuses (no rebuild):** existing transcript parser, session enumeration,
pricing tables, install-state, and the MCP server scaffold.

**Data flow:** sessions on disk → `metrics` (pure) → `drift-store` snapshots →
`baseline` (pure) → `attribution` (pure) → `format` → CLI/MCP. All logic pure and
fixture-testable; only `drift-store` touches the filesystem.

**Error handling:** missing/short history → "not enough data yet" (never a false
regression). Malformed transcripts skipped, not fatal (same discipline as stats-store).

**Testing:** pure runners + fixture transcripts with *known* regressions/causes →
assert detection AND attribution AND no-false-positive on stable fixtures.

## 7. Scope — v1 (YAGNI)

**In:** the 4 metrics above, rolling-median baseline, threshold detection,
low-ambiguity attribution, `sipcode drift` CLI + `get_drift_report` MCP tool,
silent-unless-regression.

**Two separate increments (both in this initiative, shipped independently):**
(A) the positioning README rewrite — small, docs-only, ships first; (B) the drift
detector — the build. They don't block each other.

**Out (deliberately deferred):** background/Stop-hook auto-alerts; quality/eval
scoring of answers; multi-project dashboards. The MCP tool-consolidation (§8) is a
*separate* decision, not part of this spec.

**Token-performance roadmap (the other pillar — kept live, NOT dropped).** These reach
or exceed RTK on token savings and are tracked in the reconciliation note in
[`COMPETITIVE-STRATEGY-RTK.md`](../../COMPETITIVE-STRATEGY-RTK.md). Sequenced after the
drift detector, by ROI:
- **Integrated re-read dedup** — return a diff/"unchanged" instead of re-sending a
  file. Real saver; others ship standalone versions, so included (not claimed novel)
  so users never need a second tool.
- **AST/semantic compression + symbol-level relevant reads** — parse the syntax tree,
  return only relevant symbols. Deepest token optimization *and* cleanest context.
- **Adaptive context-pressure compression** + **compression-integrity scoring**
  (the honesty-guardrail).
- **Revive the live `benchmark --vs-rtk` harness** — to *prove* token parity/superiority,
  not claim it.

The old "beat RTK on compression %" *trash-talk* is retired; the *performance bar*
(≥ RTK) is not. RTK = complementary, different lane, beaten on token performance.

## 8. Open decision (not blocking this spec)

The MCP server currently has 12 tools (~1,534 tokens/turn — measured). Adding
`get_drift_report` nudges that up. Consolidating to ~4 parameterized tools
(measured ~325 tokens/turn, 79% less, nothing lost) is a **separate, breaking
(2.0.0) change** we can do alongside or after. Flagged, not decided here.

## 9. Risks (from validation, carried in deliberately)

- **Platform absorption:** Anthropic ships context editing / compaction / Tool
  Search. Defense: cross-session visibility + attribution + drift history is harder
  for the live-session platform to replicate. Monitor.
- **Reliability claim provability:** lead with measurable cost/context facts; cite
  external reliability numbers; never claim Sipcode-specific intelligence gains.
- **Niche + monetization:** the individual-Claude-Code-dev slice is real but
  bounded; free-OSS-reputation vs paid is an unresolved product question (out of
  scope for this spec, but real).

## 10. Definition of done (v1)

- `sipcode drift` and `get_drift_report` ship; pure modules fully fixture-tested;
  no false positive on the stable fixture; honest claims copy in README;
  positioning reframed under the existing brand with nothing deleted.
