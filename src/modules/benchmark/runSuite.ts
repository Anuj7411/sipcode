/**
 * Suite-level aggregation. Pure: TaskResult[] → SuiteResult.
 *
 * The headline number is the MEDIAN of per-task savings, not the mean.
 * Median is defensible against outliers (a single task with 80% savings
 * doesn't get to dominate the published number).
 */
import type { ModuleAttribution, SuiteResult, SuiteSummary, TaskResult } from "./types.js";

const CORPUS_VERSION = "1.0.0";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface RunSuiteInput {
  readonly tasks: ReadonlyArray<TaskResult>;
  readonly pricingMeta: { readonly asOf: string; readonly ageDays: number };
  readonly warnings: ReadonlyArray<{ code: string; message: string }>;
}

export function runSuite(input: RunSuiteInput): SuiteResult {
  const taskResults = input.tasks;
  const savingsPcts = taskResults.map((t) => t.savingsPct);

  const totalBaseline = taskResults.reduce(
    (a, t) => a + t.baseline.totalTokens,
    0,
  );
  const totalOptimized = taskResults.reduce(
    (a, t) => a + t.optimized.totalTokens,
    0,
  );
  const totalSavingsTokens = Math.max(0, totalBaseline - totalOptimized);
  const totalSavingsUSD = taskResults.reduce((a, t) => a + t.savingsUSD, 0);

  const attrSum: ModuleAttribution = taskResults.reduce(
    (acc, t) => ({
      s001_manifest: acc.s001_manifest + t.attribution.s001_manifest,
      s021_outputCompression:
        acc.s021_outputCompression + t.attribution.s021_outputCompression,
      s030_readOnceCache:
        acc.s030_readOnceCache + t.attribution.s030_readOnceCache,
    }),
    {
      s001_manifest: 0,
      s021_outputCompression: 0,
      s030_readOnceCache: 0,
    } as ModuleAttribution,
  );
  const attrTotal =
    attrSum.s001_manifest +
    attrSum.s021_outputCompression +
    attrSum.s030_readOnceCache;
  const attrPct = {
    s001_manifest:
      attrTotal > 0 ? round1((attrSum.s001_manifest / attrTotal) * 100) : 0,
    s021_outputCompression:
      attrTotal > 0
        ? round1((attrSum.s021_outputCompression / attrTotal) * 100)
        : 0,
    s030_readOnceCache:
      attrTotal > 0 ? round1((attrSum.s030_readOnceCache / attrTotal) * 100) : 0,
  };

  const summary: SuiteSummary = {
    medianSavingsPct: round1(median(savingsPcts)),
    meanSavingsPct: round1(mean(savingsPcts)),
    minSavingsPct:
      savingsPcts.length > 0 ? round1(Math.min(...savingsPcts)) : 0,
    maxSavingsPct:
      savingsPcts.length > 0 ? round1(Math.max(...savingsPcts)) : 0,
    totalBaselineTokens: totalBaseline,
    totalOptimizedTokens: totalOptimized,
    totalSavingsTokens,
    totalSavingsUSD,
    attribution: attrSum,
    attributionPct: attrPct,
  };

  return {
    schemaVersion: "sipcode-benchmark/1",
    corpusVersion: CORPUS_VERSION,
    taskCount: taskResults.length,
    tasks: taskResults,
    summary,
    metaPricing: input.pricingMeta,
    warnings: input.warnings,
  };
}
