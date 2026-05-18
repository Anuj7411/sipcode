# Sipcode — AUDIT FRAMEWORK

> The Answerable-equivalent rulebook. Every optimization, metric, and check has a stable ID.
> **Status:** v0.1.0 draft — IDs lock at first public release.

This document defines the *engine* of Sipcode: the set of stable identifiers that internal code, user config, and external integrations reference. Renames are breaking changes. Treat it like a public API.

---

## ID conventions

- **`S###`** — Sipcode optimization or check (e.g., `S001` = manifest generation).
- **`M###`** — Metric emitted by `sipcode why` or `sipcode stats` (e.g., `M001` = total input tokens).
- **`R###`** — Recommendation surfaced to the user (e.g., `R001` = "your CLAUDE.md is over budget").
- **`E###`** — Validation error code (e.g., `E001` = manifest exceeded token budget).

IDs are assigned in order of first appearance. Gaps are permitted (deprecated IDs are never reused).

---

## S — Sipcode Optimizations

Each optimization has: stable ID, name, phase, savings estimate, implementation status.

### Manifest layer

| ID | Name | Phase | Est. savings | Status |
|---|---|---|---|---|
| **S001** | Smart Project Manifest | 1 | 20–35% input | planned |
| **S002** | Hot-files index from git history | 1 | included in S001 | planned |
| **S003** | Detected-patterns inference | 1 | included in S001 | planned |
| **S004** | Import-graph extraction | 1 | included in S001 | planned |
| **S005** | Delta-manifest updates | 1 (stretch) | 5–10% per session | planned |
| **S006** | Token-budget enforcement on manifest (<2k) | 1 | guardrail | planned |

### Session-audit layer

| ID | Name | Phase | Est. savings | Status |
|---|---|---|---|---|
| **S010** | Past-session forensic audit (`sipcode why`) | 1 | educational | planned |
| **S011** | Duplicate-read detection | 1 | feeds S030 | planned |
| **S012** | Idle-context detection | 1 | feeds S031 | planned |
| **S013** | 0.6% breakdown per session | 1 | wedge stat | planned |
| **S014** | Receipt generation (terminal/HTML/PNG) | 1 | viral | planned |

### Output-compression layer

| ID | Name | Phase | Est. savings | Status |
|---|---|---|---|---|
| **S020** | Professional CLAUDE.md rule set | 2 | 10–18% output | planned |
| **S021** | Diff-output enforcement | 2 | 80–95% on edits | planned |
| **S022** | Three-mode toggle (default/strict/verbose) | 2 | configurable | planned |

### Session-hygiene layer

| ID | Name | Phase | Est. savings | Status |
|---|---|---|---|---|
| **S030** | Read-Once Cache (PreToolUse hook) | 3 | 15–25% input | planned |
| **S031** | Context-pressure warnings (50/70/90%) | 3 | enables S030/S032 | planned |
| **S032** | Smart /compact on natural breakpoints | 3 | 10–15% long sessions | planned |
| **S033** | MCP-server pruning detector | 3 | 2–5% system prompt | planned |

### Orchestration layer

| ID | Name | Phase | Est. savings | Status |
|---|---|---|---|---|
| **S040** | RTK detect/install/configure | 2 | 60–90% CLI noise | planned |
| **S041** | context-mode detect/install/configure | 2 | 98% on big tool outputs | planned |
| **S042** | ccusage integration for pricing | 2 | accuracy | planned |
| **S043** | Multi-agent adapter (Cursor) | 2 | breadth | planned |
| **S044** | Multi-agent adapter (Codex) | 2 | breadth | planned |
| **S045** | Multi-agent adapter (Gemini CLI) | 2 | breadth | planned |
| **S046** | Multi-agent adapter (Aider) | 2 | breadth | planned |

### Forecasting layer

| ID | Name | Phase | Status |
|---|---|---|---|
| **S050** | `sipcode estimate "<task>"` cost prediction | 2 | planned |
| **S051** | `sipcode plan "<task>"` spec-first generator | 3 | planned |

---

## M — Metrics

Every value `sipcode why` or `sipcode stats` emits must have a stable metric ID. Snapshot tests assert that metric IDs and units never change without a major version bump.

| ID | Metric | Unit | Source |
|---|---|---|---|
| **M001** | Total input tokens | tokens | transcript `usage.input_tokens` |
| **M002** | Total output tokens | tokens | transcript `usage.output_tokens` |
| **M003** | Cache read tokens | tokens | transcript `usage.cache_read_input_tokens` |
| **M004** | Cache creation tokens | tokens | transcript `usage.cache_creation_input_tokens` |
| **M005** | Session wall-clock duration | seconds | first–last message delta |
| **M006** | Total tool calls | count | transcript |
| **M007** | Distinct files read | count | transcript Read tool uses |
| **M008** | Duplicate-read token cost | tokens | sum of repeat-read sizes |
| **M009** | Idle-context token cost | tokens | files kept N+ turns, never re-referenced |
| **M010** | Output-to-total ratio (the 0.6% number) | percentage | M002 / (M001+M002+M003+M004) |
| **M011** | Estimated cost (USD) | dollars | tokens × pricing-file rate |
| **M012** | Estimated savings if S001 active | tokens | counterfactual via heuristic |
| **M013** | Estimated savings if S030 active | tokens | sum of redundant reads × avg size |
| **M014** | Estimated savings if S021 active | tokens | edits × (full-file – diff) |
| **M020** | Manifest size after generation | tokens | tiktoken count on output |
| **M021** | Manifest generation duration | ms | wall-clock |

---

## R — Recommendations

Surface to the user from `sipcode why`, `sipcode init`, or `sipcode stats`. Each has a `severity: info | warn | error`.

| ID | Severity | Trigger | Recommendation |
|---|---|---|---|
| **R001** | warn | manifest > 2000 tokens | "Manifest exceeds budget. Run `sipcode manifest --tighten`." |
| **R002** | warn | M007 > 50 in single session | "You read 50+ files. Consider Read-Once Cache (Phase 3) when available." |
| **R003** | info | M008 > 5k tokens | "You spent 5k+ tokens re-reading the same files. Top offenders: …" |
| **R004** | info | M010 < 1% | "Only X% of your tokens are code output. Sipcode targets the other Y%." |
| **R005** | warn | session has > 100k input tokens | "Long session detected. Consider `/compact` at natural breakpoints." |
| **R006** | error | no CLAUDE.md found | "Run `npx sipcode init` to set up." |
| **R007** | warn | CLAUDE.md > 4k tokens | "CLAUDE.md is bloated. Run `sipcode rules --tighten`." |
| **R008** | info | unused MCP servers detected | "These MCPs are loaded but never used: …" |

---

## E — Validation errors

Errors batched into `SipcodeValidationError.issues[]`, never thrown individually mid-flight.

| ID | Description |
|---|---|
| **E001** | Manifest exceeded 2k token budget (without `--no-budget`). |
| **E002** | tree-sitter parse failed on file (warn, skip — never fatal). |
| **E003** | Transcript file unreadable or malformed. |
| **E004** | Pricing file out of date (> 30 days). |
| **E005** | CLAUDE.md injection target unsafe to modify (manually edited markers). |
| **E006** | Git not available — hot-files index disabled. |
| **E007** | Unsupported language family — file excluded from manifest. |

---

## Pricing file format

`src/lib/pricing/<version>.json` — one per Anthropic pricing change.

```json
{
  "as_of": "2026-05-01",
  "source_url": "https://www.anthropic.com/pricing",
  "models": {
    "claude-opus-4": {
      "input_per_mtok": 15.00,
      "output_per_mtok": 75.00,
      "cache_read_per_mtok": 1.50,
      "cache_creation_per_mtok": 18.75
    },
    "claude-sonnet-4": {
      "input_per_mtok": 3.00,
      "output_per_mtok": 15.00,
      "cache_read_per_mtok": 0.30,
      "cache_creation_per_mtok": 3.75
    },
    "claude-haiku-4": {
      "input_per_mtok": 0.80,
      "output_per_mtok": 4.00,
      "cache_read_per_mtok": 0.08,
      "cache_creation_per_mtok": 1.00
    }
  }
}
```

Receipts always cite the pricing file version used. If a user runs `sipcode receipt` 6 months from now on an old session, the receipt shows historical prices.

---

## Branded types (in `src/lib/types.ts`)

```ts
type Brand<T, B> = T & { readonly __brand: B };

export type SessionId          = Brand<string, "SessionId">;
export type AbsoluteFilePath   = Brand<string, "AbsoluteFilePath">;
export type RelativeFilePath   = Brand<string, "RelativeFilePath">;
export type TokenCount         = Brand<number, "TokenCount">;
export type USDCents           = Brand<number, "USDCents">;
export type CheckId            = Brand<string, "CheckId">;          // S001, M001, etc.
export type ModelId            = Brand<string, "ModelId">;
export type ManifestVersion    = Brand<string, "ManifestVersion">;
```

These prevent passing raw strings into APIs that expect specific shapes (the same compile-time safety Answerable's branded URL types provide).

---

## Test seams

Mirror the Answerable architecture:

- **`InMemoryFs`** — virtual filesystem for unit tests. No `fs/promises` mocking ever.
- **`ScriptedPrompter`** — pre-scripted answers to `prompts`. Tests don't hang.
- **`FakeClock`** — deterministic dates in receipts.
- **`FixtureTranscripts`** — versioned `.jsonl` files in `tests/fixtures/transcripts/` representing real session shapes.
- **`PERFECT_MANIFEST` fixture** — canonical expected output; snapshot-tested for drift.

---

## Versioning policy

- **Patch:** bug fixes, accuracy improvements that don't change IDs.
- **Minor:** new optimizations/metrics/recommendations with new IDs. No renames.
- **Major:** ID rename or removal, breaking config schema, breaking output format.

Stable IDs are part of the public contract from v0.1.0 onward.
