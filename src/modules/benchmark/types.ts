/**
 * Reproducible Benchmark Suite (S110) — types.
 *
 * Every numerical claim in Sipcode's README ultimately leads back to one of
 * the shapes in this file. Treat them as part of the public contract from
 * v0.2.0 onward; renames are breaking changes.
 */
import type { SipcodeIssue } from "../../lib/errors.js";

/** The 10 categories the corpus must cover. New IDs append, never replace. */
export type TaskCategory =
  | "refactor"
  | "debug"
  | "feature"
  | "test"
  | "review"
  | "docs"
  | "migration"
  | "onboarding"
  | "optimization"
  | "bugfix-cross-file";

/**
 * A benchmark task as discovered on disk. Each is a self-contained directory
 * under `benchmark/corpus/<id>/`. The transcripts are pre-captured fixtures —
 * the benchmark is a static re-analysis, never a live model call.
 */
export interface BenchmarkTask {
  /** Stable ID (BT001..BT010). Never renamed once locked. */
  readonly id: string;
  /** One-line human title. */
  readonly title: string;
  /** Coarse-bucket category. */
  readonly category: TaskCategory;
  /** Free-form difficulty band ("small" | "medium" | "large"). */
  readonly difficulty: string;
  /** Model the original transcripts were captured against. */
  readonly modelRecommended: string;
  /** Indicative cost band, surfaced in the task listing. */
  readonly estimatedCostBand: string;
  /** Free-form note documenting what the task exercises. */
  readonly notes: string;
  /** Absolute path to the task directory. */
  readonly absPath: string;
  /** Absolute path to the baseline transcript .jsonl. */
  readonly baselineTranscriptPath: string;
  /** Absolute path to the optimized transcript .jsonl. */
  readonly optimizedTranscriptPath: string;
}

/** Per-module attribution for a single task. */
export interface ModuleAttribution {
  /** S001 — smart project manifest. */
  readonly s001_manifest: number;
  /** S021 — output compression / diff edits. */
  readonly s021_outputCompression: number;
  /** S030 — read-once cache. */
  readonly s030_readOnceCache: number;
}

/**
 * Token totals for a single transcript flavor (baseline or optimized).
 * Pulled from `analyzeTokens` and rounded to whole tokens.
 */
export interface FlavorTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /** Sum of all four billable buckets. */
  readonly totalTokens: number;
  /** USD cost on the pricing file used for the run. */
  readonly estCostUSD: number;
  /** Output share of all tokens, 0..100. */
  readonly outputRatioPct: number;
  /** Distinct files read (post-dedup). */
  readonly distinctFilesRead: number;
  /** Tokens spent on duplicate reads (subset of input/cache cost). */
  readonly duplicateReadTokens: number;
  /** Number of tool calls. */
  readonly toolCallCount: number;
}

/** Per-task result — the row that drives the suite-level median. */
export interface TaskResult {
  readonly taskId: string;
  readonly title: string;
  readonly category: TaskCategory;
  readonly baseline: FlavorTotals;
  readonly optimized: FlavorTotals;
  /** (baseline - optimized) / baseline as a percentage 0..100. */
  readonly savingsPct: number;
  /** Tokens saved, baseline - optimized. */
  readonly savingsTokens: number;
  /** USD saved at pricing-file rates. */
  readonly savingsUSD: number;
  /** Per-module breakdown of where the savings came from. */
  readonly attribution: ModuleAttribution;
  /** Parse warnings emitted while loading either transcript. */
  readonly warnings: ReadonlyArray<{ code: string; message: string }>;
}

/** Suite-level summary across the full corpus. */
export interface SuiteSummary {
  /** Median savings across tasks (the headline number). */
  readonly medianSavingsPct: number;
  /** Mean savings (reported alongside median for transparency). */
  readonly meanSavingsPct: number;
  /** Minimum task savings (worst case). */
  readonly minSavingsPct: number;
  /** Maximum task savings (best case). */
  readonly maxSavingsPct: number;
  /** Sum of baseline tokens across all tasks. */
  readonly totalBaselineTokens: number;
  /** Sum of optimized tokens across all tasks. */
  readonly totalOptimizedTokens: number;
  /** Sum of tokens saved across all tasks. */
  readonly totalSavingsTokens: number;
  /** Sum of USD saved across all tasks. */
  readonly totalSavingsUSD: number;
  /** Suite-level per-module attribution (sum of task-level attributions). */
  readonly attribution: ModuleAttribution;
  /** Per-module share of total savings as a percentage 0..100. */
  readonly attributionPct: {
    readonly s001_manifest: number;
    readonly s021_outputCompression: number;
    readonly s030_readOnceCache: number;
  };
}

/** Full suite result — what render/format consume. */
export interface SuiteResult {
  readonly schemaVersion: "sipcode-benchmark/1";
  readonly corpusVersion: string;
  /** Total tasks discovered (10 in the locked corpus). */
  readonly taskCount: number;
  /** Per-task rows in stable BT### order. */
  readonly tasks: ReadonlyArray<TaskResult>;
  /** Suite-level rollup. */
  readonly summary: SuiteSummary;
  /** Pricing metadata so the dollar numbers are auditable. */
  readonly metaPricing: { readonly asOf: string; readonly ageDays: number };
  /** Issues encountered while loading the corpus (E003-style). */
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
}

/** Compare two suite runs (regression detection). */
export interface ComparisonReport {
  readonly schemaVersion: "sipcode-benchmark-compare/1";
  readonly before: { readonly label: string; readonly medianSavingsPct: number };
  readonly after: { readonly label: string; readonly medianSavingsPct: number };
  /** after - before, in percentage points. */
  readonly deltaPct: number;
  readonly regressed: boolean;
  /** Per-task deltas in BT### order. */
  readonly perTask: ReadonlyArray<{
    readonly taskId: string;
    readonly beforePct: number;
    readonly afterPct: number;
    readonly deltaPct: number;
  }>;
}

/** Errors specific to the benchmark module. Use existing E### codes. */
export interface BenchmarkLoadError {
  readonly issues: ReadonlyArray<SipcodeIssue>;
}
