# Sipcode Drift Detector (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `sipcode drift` + the `get_drift_report` MCP tool — a silent-unless-regression detector that flags when recent Claude Code sessions get more expensive / context-bloated vs the developer's own baseline, using the transcripts Sipcode already reads.

**Architecture:** Pure runners + one I/O seam (the command). Reuse the existing transcript pipeline: `parseTranscript` → `ParsedSession`, `analyzeTokens`, `analyzeDuplicateReads`, `listAllSessions`. The baseline is computed from the last N sessions **on disk** (works on first run, no persistent store). Attribution is **metric-level** only (cost/turn ↑, cache-rate ↓, re-reads ↑). Conservative thresholds — must never cry wolf.

**Tech Stack:** TypeScript, Node 20+, Vitest, Zod (already in use). No new deps.

**Deviation from spec (deliberate, YAGNI):** the persistent per-session store and config-cause attribution (CLAUDE.md/MCP growth) from spec §5.2–5.3 are **deferred to v2** — they require historical config snapshots we can't reconstruct, and v1 stays transcript-only + conservative.

---

## File Structure

**New files:**
```
src/modules/drift/
├── types.ts            SessionMetrics, Baseline, RegressionResult, DriftCause, DriftReport
├── metrics.ts          pure: (SessionMeta, ParsedSession, PricingFile) → SessionMetrics
├── baseline.ts         pure: median, computeBaseline, detectRegression
├── runDrift.ts         pure orchestrator: (latest, history) → DriftReport
├── format-terminal.ts  pure: DriftReport → smoke-alarm text
└── format-json.ts      pure: DriftReport → stable JSON string
src/commands/drift.ts   I/O seam: list sessions → parse → metrics → report → render
```

**Modified files:**
```
src/cli.ts                              register `drift` command
src/mcp/server.ts                       + get_drift_report tool (7 → 8 tools)
tests/e2e/release-smoke.test.ts         tool count 7 → 8 + add name
tests/mcp/server.integration.test.ts    tool count 7 → 8 + add name
README.md                               reposition + document drift (separate increment)
```

---

## Task 1: Drift types

**Files:**
- Create: `src/modules/drift/types.ts`
- Test: `tests/modules/drift/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import type {
  SessionMetrics,
  Baseline,
  DriftReport,
} from "../../../src/modules/drift/types.js";

describe("drift types", () => {
  it("SessionMetrics carries the v1 transcript-derived metrics", () => {
    const m: SessionMetrics = {
      sessionId: "s1",
      endedAtMs: 1,
      totalTokens: 1000,
      assistantTurns: 5,
      tokensPerTurn: 200,
      cacheHitRate: 0.5,
      duplicateReadTokens: 0,
      outputRatio: 0.1,
    };
    expect(m.tokensPerTurn).toBe(200);
  });

  it("DriftReport has a schemaVersion and hasRegression flag", () => {
    const r: DriftReport = {
      schemaVersion: "sipcode-drift/1",
      hasRegression: false,
      summary: "stable",
      causes: [],
      note: "n",
    };
    const b: Baseline = {
      count: 0,
      medianTokensPerTurn: 0,
      medianCacheHitRate: 0,
      medianDuplicateReadTokens: 0,
    };
    expect(r.schemaVersion).toBe("sipcode-drift/1");
    expect(b.count).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/drift/types.test.ts`
Expected: FAIL — cannot find module `types.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
/** Drift detector contract types (v1 — transcript-derived only). */

/** Per-session metrics derived purely from a parsed transcript. */
export interface SessionMetrics {
  readonly sessionId: string;
  /** End time (ms epoch) for ordering newest-first. */
  readonly endedAtMs: number;
  readonly totalTokens: number;
  readonly assistantTurns: number;
  /** totalTokens / max(1, assistantTurns). */
  readonly tokensPerTurn: number;
  /** cacheRead / (cacheRead + input + cacheCreation), 0..1. Higher = better. */
  readonly cacheHitRate: number;
  /** Tokens spent re-reading files already read (waste). */
  readonly duplicateReadTokens: number;
  /** output / (input + output + cacheCreation), 0..1. */
  readonly outputRatio: number;
}

/** Rolling baseline (medians) over the recent history window. */
export interface Baseline {
  readonly count: number;
  readonly medianTokensPerTurn: number;
  readonly medianCacheHitRate: number;
  readonly medianDuplicateReadTokens: number;
}

/** One detected, human-readable regression signal. */
export interface DriftCause {
  readonly label: string;
  readonly detail: string;
}

export interface RegressionResult {
  readonly hasRegression: boolean;
  readonly causes: ReadonlyArray<DriftCause>;
}

/** Aggregated drift report — what the CLI and `get_drift_report` return. */
export interface DriftReport {
  readonly schemaVersion: "sipcode-drift/1";
  readonly hasRegression: boolean;
  readonly summary: string;
  readonly causes: ReadonlyArray<DriftCause>;
  readonly latest?: SessionMetrics;
  readonly baseline?: Baseline;
  readonly note: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/drift/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/drift/types.ts tests/modules/drift/types.test.ts
git commit -m "feat(drift): v1 contract types"
```

---

## Task 2: Per-session metrics (reuse existing analyzers)

**Files:**
- Create: `src/modules/drift/metrics.ts`
- Test: `tests/modules/drift/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { computeSessionMetrics } from "../../../src/modules/drift/metrics.js";
import { parseTranscript } from "../../../src/modules/transcript/parse.js";
import { loadPricingForDate } from "../../../src/lib/pricing/load.js";

const pricing = loadPricingForDate(new Date("2026-06-01"));

// One assistant turn: 100 input, 50 output, 900 cache_read, 0 cache_creation.
const line = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-01T00:00:00.000Z",
  sessionId: "sess-A",
  message: {
    model: "claude-sonnet-4-5",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 0,
    },
    content: [],
  },
});

describe("computeSessionMetrics", () => {
  it("derives tokensPerTurn, cacheHitRate, totals from a parsed session", () => {
    const parsed = parseTranscript(line);
    expect(parsed.ok).toBe(true);
    const session = parsed.ok ? parsed.value : null;
    const m = computeSessionMetrics(
      { sessionId: "sess-A", endedAtMs: 1000 },
      session!,
      pricing,
    );
    expect(m.assistantTurns).toBe(1);
    expect(m.totalTokens).toBe(1050); // 100+50+900+0
    expect(m.tokensPerTurn).toBe(1050);
    // cacheHitRate = 900 / (900 + 100 + 0) = 0.9
    expect(m.cacheHitRate).toBeCloseTo(0.9, 5);
    expect(m.duplicateReadTokens).toBe(0);
    expect(m.sessionId).toBe("sess-A");
  });

  it("returns zeros (never NaN) for an empty session", () => {
    const parsed = parseTranscript("");
    const session = parsed.ok ? parsed.value : null;
    const m = computeSessionMetrics(
      { sessionId: "empty", endedAtMs: 0 },
      session!,
      pricing,
    );
    expect(m.tokensPerTurn).toBe(0);
    expect(m.cacheHitRate).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/drift/metrics.test.ts`
Expected: FAIL — cannot find module `metrics.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * Pure: a parsed session → SessionMetrics. Reuses the existing token and
 * duplicate-read analyzers so drift never reinvents transcript math.
 */
import type { ParsedSession } from "../transcript/parse.js";
import { analyzeTokens } from "../transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../transcript/analyzers/duplicateReads.js";
import type { PricingFile } from "../../lib/pricing/load.js";
import type { SessionMetrics } from "./types.js";

export function computeSessionMetrics(
  meta: { sessionId: string; endedAtMs: number },
  session: ParsedSession,
  pricing: PricingFile,
): SessionMetrics {
  const t = analyzeTokens(session, pricing);
  const dup = analyzeDuplicateReads(session);
  const total =
    t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheCreationTokens;
  const turns = session.assistantTurns.length;
  // Cache hit rate: cache reads vs the new-token denominator. Excludes output
  // (output isn't "context intake"). Higher = caching working well.
  const cacheDenom = t.cacheReadTokens + t.inputTokens + t.cacheCreationTokens;
  return {
    sessionId: meta.sessionId,
    endedAtMs: meta.endedAtMs,
    totalTokens: total,
    assistantTurns: turns,
    tokensPerTurn: turns > 0 ? total / turns : 0,
    cacheHitRate: cacheDenom > 0 ? t.cacheReadTokens / cacheDenom : 0,
    duplicateReadTokens: dup.duplicateReadTokenCost,
    outputRatio: t.outputRatio,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/drift/metrics.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/drift/metrics.ts tests/modules/drift/metrics.test.ts
git commit -m "feat(drift): per-session metrics via existing analyzers"
```

---

## Task 3: Baseline + regression detection

**Files:**
- Create: `src/modules/drift/baseline.ts`
- Test: `tests/modules/drift/baseline.test.ts`

Design: baseline = medians over the history window. Detection is **conservative**
(must not cry wolf):
- cost/turn regresses if `latest.tokensPerTurn > 1.30 × median` (≥ +30%).
- cache regresses if `latest.cacheHitRate < median − 0.15` AND `median ≥ 0.20`
  (only flag a real drop when caching was meaningfully working before).
- re-reads regress if `latest.duplicateReadTokens > 2 × median` AND
  `latest.duplicateReadTokens > 5000` (absolute floor kills noise).
- Need `count ≥ 3` baseline sessions, else no detection.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { median, computeBaseline, detectRegression } from "../../../src/modules/drift/baseline.js";
import type { SessionMetrics } from "../../../src/modules/drift/types.js";

function m(part: Partial<SessionMetrics>): SessionMetrics {
  return {
    sessionId: "x",
    endedAtMs: 0,
    totalTokens: 0,
    assistantTurns: 1,
    tokensPerTurn: 100,
    cacheHitRate: 0.7,
    duplicateReadTokens: 0,
    outputRatio: 0.1,
    ...part,
  };
}

describe("median", () => {
  it("odd + even length", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("computeBaseline", () => {
  it("medians each metric over history", () => {
    const b = computeBaseline([
      m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 0 }),
      m({ tokensPerTurn: 200, cacheHitRate: 0.6, duplicateReadTokens: 0 }),
      m({ tokensPerTurn: 300, cacheHitRate: 0.8, duplicateReadTokens: 0 }),
    ]);
    expect(b.count).toBe(3);
    expect(b.medianTokensPerTurn).toBe(200);
    expect(b.medianCacheHitRate).toBe(0.7);
  });
});

describe("detectRegression", () => {
  const baseline = computeBaseline([
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
    m({ tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 1000 }),
  ]);

  it("flags a >30% cost/turn jump", () => {
    const r = detectRegression(m({ tokensPerTurn: 140 }), baseline);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.some((c) => c.label.includes("cost/turn"))).toBe(true);
  });

  it("does NOT flag a small (<30%) cost/turn change", () => {
    const r = detectRegression(m({ tokensPerTurn: 120 }), baseline);
    expect(r.hasRegression).toBe(false);
  });

  it("flags a cache-hit-rate drop > 15 points", () => {
    const r = detectRegression(m({ cacheHitRate: 0.5 }), baseline);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.some((c) => c.label.includes("cache"))).toBe(true);
  });

  it("does NOT flag when baseline has < 3 sessions", () => {
    const thin = computeBaseline([m({}), m({})]);
    const r = detectRegression(m({ tokensPerTurn: 999 }), thin);
    expect(r.hasRegression).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/drift/baseline.test.ts`
Expected: FAIL — cannot find module `baseline.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { SessionMetrics, Baseline, RegressionResult, DriftCause } from "./types.js";

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

export function computeBaseline(history: ReadonlyArray<SessionMetrics>): Baseline {
  return {
    count: history.length,
    medianTokensPerTurn: median(history.map((h) => h.tokensPerTurn)),
    medianCacheHitRate: median(history.map((h) => h.cacheHitRate)),
    medianDuplicateReadTokens: median(history.map((h) => h.duplicateReadTokens)),
  };
}

const COST_PER_TURN_RATIO = 1.3; // +30%
const CACHE_DROP_POINTS = 0.15; // 15 percentage points
const CACHE_MIN_BASELINE = 0.2; // only flag drops if caching mattered before
const DUP_RATIO = 2.0;
const DUP_ABS_FLOOR = 5000;
const MIN_BASELINE = 3;

function pctUp(latest: number, base: number): number {
  if (base <= 0) return 0;
  return Math.round(((latest - base) / base) * 100);
}

export function detectRegression(
  latest: SessionMetrics,
  baseline: Baseline,
): RegressionResult {
  const causes: DriftCause[] = [];
  if (baseline.count < MIN_BASELINE) {
    return { hasRegression: false, causes };
  }

  if (latest.tokensPerTurn > baseline.medianTokensPerTurn * COST_PER_TURN_RATIO) {
    causes.push({
      label: "cost/turn up",
      detail: `tokens/turn rose ~${pctUp(latest.tokensPerTurn, baseline.medianTokensPerTurn)}% (${Math.round(baseline.medianTokensPerTurn)} → ${Math.round(latest.tokensPerTurn)})`,
    });
  }

  if (
    baseline.medianCacheHitRate >= CACHE_MIN_BASELINE &&
    latest.cacheHitRate < baseline.medianCacheHitRate - CACHE_DROP_POINTS
  ) {
    causes.push({
      label: "cache hit rate down",
      detail: `cache hit rate dropped ${Math.round(baseline.medianCacheHitRate * 100)}% → ${Math.round(latest.cacheHitRate * 100)}% (context prefix is changing mid-session)`,
    });
  }

  if (
    latest.duplicateReadTokens > baseline.medianDuplicateReadTokens * DUP_RATIO &&
    latest.duplicateReadTokens > DUP_ABS_FLOOR
  ) {
    causes.push({
      label: "re-read waste up",
      detail: `~${Math.round(latest.duplicateReadTokens)} tokens spent re-reading unchanged files`,
    });
  }

  return { hasRegression: causes.length > 0, causes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/drift/baseline.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/drift/baseline.ts tests/modules/drift/baseline.test.ts
git commit -m "feat(drift): conservative baseline + regression detection"
```

---

## Task 4: Orchestrator — `buildDriftReport`

**Files:**
- Create: `src/modules/drift/runDrift.ts`
- Test: `tests/modules/drift/runDrift.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { buildDriftReport } from "../../../src/modules/drift/runDrift.js";
import type { SessionMetrics } from "../../../src/modules/drift/types.js";

function m(part: Partial<SessionMetrics>): SessionMetrics {
  return {
    sessionId: "x", endedAtMs: 0, totalTokens: 0, assistantTurns: 1,
    tokensPerTurn: 100, cacheHitRate: 0.7, duplicateReadTokens: 0, outputRatio: 0.1,
    ...part,
  };
}

describe("buildDriftReport", () => {
  const history = [
    m({ tokensPerTurn: 100 }), m({ tokensPerTurn: 100 }), m({ tokensPerTurn: 100 }),
  ];

  it("reports a regression with causes when latest spikes", () => {
    const r = buildDriftReport(m({ tokensPerTurn: 200 }), history);
    expect(r.hasRegression).toBe(true);
    expect(r.causes.length).toBeGreaterThan(0);
    expect(r.summary).toContain("drift");
    expect(r.schemaVersion).toBe("sipcode-drift/1");
  });

  it("reports stable when latest is in range", () => {
    const r = buildDriftReport(m({ tokensPerTurn: 105 }), history);
    expect(r.hasRegression).toBe(false);
    expect(r.summary).toContain("stable");
  });

  it("says not-enough-data with a thin history", () => {
    const r = buildDriftReport(m({ tokensPerTurn: 999 }), [m({})]);
    expect(r.hasRegression).toBe(false);
    expect(r.summary).toContain("not enough");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/drift/runDrift.test.ts`
Expected: FAIL — cannot find module `runDrift.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { SessionMetrics, DriftReport } from "./types.js";
import { computeBaseline, detectRegression } from "./baseline.js";

const MIN_BASELINE = 3;
const NOTE =
  "Drift compares your latest session against the median of recent ones. Conservative by design — it stays silent unless something really moved. Run `sipcode why` for a per-session forensic breakdown.";

export function buildDriftReport(
  latest: SessionMetrics,
  history: ReadonlyArray<SessionMetrics>,
): DriftReport {
  const baseline = computeBaseline(history);

  if (baseline.count < MIN_BASELINE) {
    return {
      schemaVersion: "sipcode-drift/1",
      hasRegression: false,
      summary: `not enough history yet (${baseline.count} prior sessions; need ${MIN_BASELINE}). Keep using Claude Code and re-run.`,
      causes: [],
      latest,
      baseline,
      note: NOTE,
    };
  }

  const reg = detectRegression(latest, baseline);
  const summary = reg.hasRegression
    ? `drift detected — ${reg.causes.length} signal${reg.causes.length === 1 ? "" : "s"} regressed vs your baseline. These cost tokens and degrade answer quality (context rot).`
    : "no drift — context health stable vs your recent baseline.";

  return {
    schemaVersion: "sipcode-drift/1",
    hasRegression: reg.hasRegression,
    summary,
    causes: reg.causes,
    latest,
    baseline,
    note: NOTE,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/drift/runDrift.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/drift/runDrift.ts tests/modules/drift/runDrift.test.ts
git commit -m "feat(drift): buildDriftReport orchestrator"
```

---

## Task 5: Formatters (terminal + JSON)

**Files:**
- Create: `src/modules/drift/format-terminal.ts`
- Create: `src/modules/drift/format-json.ts`
- Test: `tests/modules/drift/format.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { renderDriftTerminal } from "../../../src/modules/drift/format-terminal.js";
import { renderDriftJson } from "../../../src/modules/drift/format-json.js";
import type { DriftReport } from "../../../src/modules/drift/types.js";

const regressed: DriftReport = {
  schemaVersion: "sipcode-drift/1",
  hasRegression: true,
  summary: "drift detected — 1 signal regressed.",
  causes: [{ label: "cost/turn up", detail: "tokens/turn rose ~40% (100 → 140)" }],
  note: "n",
};

const stable: DriftReport = {
  schemaVersion: "sipcode-drift/1",
  hasRegression: false,
  summary: "no drift — context health stable.",
  causes: [],
  note: "n",
};

describe("renderDriftTerminal", () => {
  it("shows the ⚠ alarm and causes on regression", () => {
    const out = renderDriftTerminal(regressed);
    expect(out).toContain("⚠");
    expect(out).toContain("tokens/turn rose");
  });
  it("shows a calm one-liner when stable", () => {
    const out = renderDriftTerminal(stable);
    expect(out).toContain("stable");
    expect(out).not.toContain("⚠");
  });
});

describe("renderDriftJson", () => {
  it("emits parseable JSON with schemaVersion", () => {
    const obj = JSON.parse(renderDriftJson(regressed));
    expect(obj.schemaVersion).toBe("sipcode-drift/1");
    expect(obj.causes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/drift/format.test.ts`
Expected: FAIL — cannot find modules.

- [ ] **Step 3: Write minimal implementations**

`src/modules/drift/format-terminal.ts`:
```typescript
import type { DriftReport } from "./types.js";

export function renderDriftTerminal(report: DriftReport): string {
  if (!report.hasRegression) {
    return `Sipcode drift: ${report.summary}`;
  }
  const lines: string[] = [];
  lines.push(`⚠ Sipcode drift — ${report.summary}`);
  lines.push("  Likely causes:");
  for (const c of report.causes) {
    lines.push(`    • ${c.detail}`);
  }
  lines.push("");
  lines.push(`  ${report.note}`);
  return lines.join("\n");
}
```

`src/modules/drift/format-json.ts`:
```typescript
import type { DriftReport } from "./types.js";

export function renderDriftJson(report: DriftReport): string {
  return JSON.stringify(report, null, 2);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/drift/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/drift/format-terminal.ts src/modules/drift/format-json.ts tests/modules/drift/format.test.ts
git commit -m "feat(drift): terminal + json formatters"
```

---

## Task 6: `sipcode drift` CLI command

**Files:**
- Create: `src/commands/drift.ts`
- Test: `tests/modules/drift/drift-command.test.ts`

Mirrors `src/commands/proxy.ts` deps-injection shape. Lists the most recent
`N+1` sessions, parses each, computes metrics; newest = latest, rest = history.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { runDriftCommand, type DriftDeps } from "../../../src/commands/drift.js";

/** Build a one-assistant-turn transcript with a given per-turn token load. */
function transcript(sessionId: string, inputTokens: number): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-06-01T00:00:00.000Z",
    sessionId,
    message: {
      model: "claude-sonnet-4-5",
      usage: { input_tokens: inputTokens, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      content: [],
    },
  });
}

function deps(files: Record<string, string>, order: string[]): { deps: DriftDeps; out: string[] } {
  const out: string[] = [];
  return {
    out,
    deps: {
      homeDir: "/home/u",
      stdout: (s) => out.push(s),
      // listSessions returns newest-first metadata; readFile returns the transcript.
      listSessions: async () => order.map((id, i) => ({
        sessionId: id, filePath: `/p/${id}.jsonl`, projectHash: "p",
        mtimeMs: 1000 - i, size: files[id]!.length,
      })),
      readFile: async (p: string) => {
        const id = p.replace("/p/", "").replace(".jsonl", "");
        return files[id] ?? "";
      },
      now: new Date("2026-06-02"),
    },
  };
}

describe("runDriftCommand", () => {
  it("flags a regression when the newest session spikes vs history", async () => {
    const files = {
      A: transcript("A", 1000), // latest — spike
      B: transcript("B", 100),
      C: transcript("C", 100),
      D: transcript("D", 100),
    };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D"]);
    const r = await runDriftCommand({}, d);
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("⚠");
  });

  it("is calm when the newest session is in range", async () => {
    const files = {
      A: transcript("A", 105),
      B: transcript("B", 100),
      C: transcript("C", 100),
      D: transcript("D", 100),
    };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D"]);
    await runDriftCommand({}, d);
    expect(out.join("\n")).toContain("stable");
  });

  it("--json emits machine-readable output", async () => {
    const files = { A: transcript("A", 100), B: transcript("B", 100), C: transcript("C", 100), D: transcript("D", 100) };
    const { deps: d, out } = deps(files, ["A", "B", "C", "D"]);
    await runDriftCommand({ json: true }, d);
    const obj = JSON.parse(out.join("\n"));
    expect(obj.schemaVersion).toBe("sipcode-drift/1");
  });

  it("reports not-enough-data with too few sessions", async () => {
    const files = { A: transcript("A", 100) };
    const { deps: d, out } = deps(files, ["A"]);
    await runDriftCommand({}, d);
    expect(out.join("\n")).toContain("not enough");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/modules/drift/drift-command.test.ts`
Expected: FAIL — cannot find module `drift.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
/**
 * `sipcode drift` — silent-unless-regression context/cost drift detector.
 * Lists the most recent N+1 sessions, computes metrics; newest = latest,
 * the rest = baseline history.
 */
import { ASSERT_NO_NETWORK } from "../lib/privacy.js";
void ASSERT_NO_NETWORK;
import os from "node:os";
import { promises as nodeFs } from "node:fs";
import { RealFileSystem } from "../lib/fs.js";
import { RealProcessEnv } from "../lib/process.js";
import { resolveProjectsDir, listAllSessions } from "../modules/transcript/discover.js";
import { parseTranscript } from "../modules/transcript/parse.js";
import { loadPricingForDate } from "../lib/pricing/load.js";
import { computeSessionMetrics } from "../modules/drift/metrics.js";
import { buildDriftReport } from "../modules/drift/runDrift.js";
import { renderDriftTerminal } from "../modules/drift/format-terminal.js";
import { renderDriftJson } from "../modules/drift/format-json.js";
import type { SessionMetrics } from "../modules/drift/types.js";

const WINDOW = 6; // baseline history size

export interface DriftSessionMeta {
  readonly sessionId: string;
  readonly filePath: string;
  readonly projectHash: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface DriftOptions {
  json?: boolean;
}

export interface DriftDeps {
  homeDir?: string;
  stdout?: (s: string) => void;
  /** Newest-first session metadata. */
  listSessions?: () => Promise<DriftSessionMeta[]>;
  readFile?: (absPath: string) => Promise<string>;
  now?: Date;
}

export interface DriftResult {
  readonly exitCode: 0 | 1;
}

export async function runDriftCommand(
  opts: DriftOptions = {},
  deps: DriftDeps = {},
): Promise<DriftResult> {
  const stdout = deps.stdout ?? ((s: string) => process.stdout.write(s + "\n"));
  const now = deps.now ?? new Date();
  const pricing = loadPricingForDate(now);

  const listSessions =
    deps.listSessions ??
    (async () => {
      const env = new RealProcessEnv();
      const fs = new RealFileSystem();
      const dir = resolveProjectsDir(env);
      return listAllSessions(fs, dir);
    });
  const readFile =
    deps.readFile ??
    (async (p: string) => {
      try {
        return await nodeFs.readFile(p, "utf-8");
      } catch {
        return "";
      }
    });

  const sessions = (await listSessions()).slice(0, WINDOW + 1);
  const metrics: SessionMetrics[] = [];
  for (const s of sessions) {
    const contents = await readFile(s.filePath);
    if (!contents) continue;
    const parsed = parseTranscript(contents);
    if (!parsed.ok) continue;
    metrics.push(
      computeSessionMetrics(
        { sessionId: s.sessionId, endedAtMs: s.mtimeMs },
        parsed.value,
        pricing,
      ),
    );
  }

  // Newest-first → latest is [0], history is the rest.
  const latest = metrics[0];
  const history = metrics.slice(1);

  if (!latest) {
    stdout("Sipcode drift: no sessions found yet. Use Claude Code, then re-run.");
    return { exitCode: 0 };
  }

  const report = buildDriftReport(latest, history);
  stdout(opts.json ? renderDriftJson(report) : renderDriftTerminal(report));
  return { exitCode: 0 };
}

// Keep `os` referenced for the default homeDir path even though tests inject it.
void os;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/modules/drift/drift-command.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands/drift.ts tests/modules/drift/drift-command.test.ts
git commit -m "feat(drift): sipcode drift CLI command"
```

---

## Task 7: Register `drift` in the CLI

**Files:**
- Modify: `src/cli.ts` (add a `program.command("drift")` block, mirroring the `proxy` block)

- [ ] **Step 1: Add the command registration**

Insert this block immediately before the `program.command("benchmark")` block:

```typescript
program
  .command("drift")
  .description("Detect context/cost drift — flags when recent sessions get more expensive or context-bloated vs your baseline. Silent unless something regressed.")
  .option("--json", "machine-readable output")
  .action(async (opts) => {
    const { runDriftCommand } = await import("./commands/drift.js");
    const r = await runDriftCommand(opts);
    if (r?.exitCode) process.exit(r.exitCode);
  });
```

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds; no TS errors.

- [ ] **Step 3: Smoke-run the command**

Run: `node dist/cli.js drift`
Expected: prints either a "not enough history" line or a stable/⚠ line — exit 0, no crash.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(drift): register drift command in CLI"
```

---

## Task 8: `get_drift_report` MCP tool (7 → 8 tools)

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `tests/e2e/release-smoke.test.ts`
- Modify: `tests/mcp/server.integration.test.ts`

- [ ] **Step 1: Add the handler** (place after `toolGetProxyStats`)

```typescript
async function toolGetDriftReport(): Promise<CallToolResult> {
  const { runDriftCommand } = await import("../commands/drift.js");
  const buf: string[] = [];
  await runDriftCommand({ json: true }, { stdout: (s: string) => buf.push(s) });
  return ok(buf.join("\n"));
}
```

- [ ] **Step 2: Add the tool definition** (append to the `TOOL_DEFS` array, after `estimate_task_cost`)

```typescript
  {
    name: "get_drift_report",
    description:
      "Detect context/cost drift: whether the user's recent Claude Code sessions regressed (cost/turn up, cache-hit-rate down, re-read waste up) vs their own baseline. Returns JSON. Use when the user asks 'is my agent getting more expensive / sloppier?' or 'has anything regressed?'.",
    inputSchema: { type: "object", properties: {} },
    schema: z.object({}),
  },
```

- [ ] **Step 3: Add the dispatch case** (before `default:` in the `switch (name)`)

```typescript
      case "get_drift_report": {
        return await withTimeout(name, 15_000, toolGetDriftReport());
      }
```

- [ ] **Step 4: Update the tool-count tests**

In `tests/mcp/server.integration.test.ts`: change `toHaveLength(7)` → `toHaveLength(8)` and add `expect(result.tools).toContain("get_drift_report");`.

In `tests/e2e/release-smoke.test.ts`: change `"7 tools"` → `"8 tools"`, and add `"get_drift_report"` into the sorted expected-names array (alphabetical position: after `get_agent_score`/`get_project_manifest` — place it so the array stays sorted; the test sorts both sides, so exact position only needs to be present).

- [ ] **Step 5: Build + run the MCP tests**

Run: `npm run build && npx vitest run tests/mcp/server.integration.test.ts tests/e2e/release-smoke.test.ts`
Expected: PASS — 8 tools registered, `get_drift_report` present.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/server.ts tests/mcp/server.integration.test.ts tests/e2e/release-smoke.test.ts
git commit -m "feat(mcp): get_drift_report — 8th MCP tool"
```

---

## Task 9: Full gate + ship as a patch

**Files:** `package.json`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Run the full suite**

Run: `npm test --silent`
Expected: all green (existing + new drift tests).

- [ ] **Step 2: Bump patch version** in `package.json` and `.claude-plugin/plugin.json` (keep them in sync — e.g. `1.6.1` → `1.6.2`).

- [ ] **Step 3: Commit, tag, push**

```bash
git add -A
git commit -m "feat(drift): sipcode drift + get_drift_report — context/cost regression detector"
git push origin main
git tag v1.6.2
git push origin v1.6.2
```

- [ ] **Step 4: Verify npm** after CI: `npm view sipcode version` → `1.6.2`.

---

## Task 10: README reposition (separate docs increment)

**Files:** `README.md`

This is the positioning increment from the spec (§4) — docs only, no code. Reframe
the headline around **clean context = right answers + lower cost** under the existing
*"sip, don't gulp"* brand; add a short **drift** section; keep every token-saving claim
(the performance pillar) intact as proof. Honesty contract: prove token/context
reduction; *cite* (don't claim) the external reliability numbers (40% fewer errors,
29% lift).

- [ ] **Step 1:** Add a brief "Two things Sipcode does" framing near the top: (1) keeps
  context clean automatically (valve) → cheaper *and* sharper answers; (2) warns when
  context health drifts (`sipcode drift`). Token-savings table stays as the proof.
- [ ] **Step 2:** Add a `### Catch context drift` subsection documenting `sipcode drift`
  and `get_drift_report`, with the "silent unless it regressed" behavior.
- [ ] **Step 3:** Add the honesty line: reliability gains are cited from published
  research, not claimed as Sipcode's measured result; the measured part is token/context reduction.
- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: reposition README — clean context = right answers (token-saving kept as proof)"
```

---

## Self-Review

**Spec coverage:** §3 (nothing deleted) — plan only adds files + reframes README ✓.
§4 (positioning + honesty) — Task 10 ✓. §5.1 silent-unless-regression — Tasks 4/5/6 ✓.
§5.2 metrics: tokens/turn, cache hit rate, re-reads ✓ (context-overhead/CLAUDE.md
metric deferred — see deviation note). §5.3 detection + conservative thresholds —
Task 3 ✓; attribution is metric-level (config-cause deferred, noted). §5.4 CLI +
`get_drift_report` MCP — Tasks 6/8 ✓. §6 architecture (pure runners + one I/O seam,
reuse parser/analyzers) ✓. §7 scope (store + config attribution deferred) — matches
the deviation note ✓.

**Placeholder scan:** none — every code step has full code and exact commands.

**Type consistency:** `SessionMetrics`, `Baseline`, `RegressionResult`, `DriftReport`,
`DriftCause` defined in Task 1 and used unchanged in Tasks 2–8. `computeSessionMetrics`,
`computeBaseline`, `detectRegression`, `buildDriftReport`, `renderDriftTerminal`,
`renderDriftJson`, `runDriftCommand` names consistent across tasks. `parseTranscript`
returns `Result` (`.ok`/`.value`) — used correctly. `listAllSessions`/`SessionMeta`
fields (sessionId, filePath, mtimeMs) match Task 6 usage.

**Deferred (documented, not gaps):** persistent drift store; config-cause attribution
(CLAUDE.md/MCP growth); the live `benchmark --vs-rtk` harness and the token-performance
roadmap (re-read dedup, AST/semantic compression) — all tracked in the spec + competitive doc as later increments.
