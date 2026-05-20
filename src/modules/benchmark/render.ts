/**
 * Pure: SuiteResult → RenderedBenchmark.
 *
 * The renderer projects a SuiteResult into the lightweight shape the
 * formatters consume. It exists so the formatters don't have to compute
 * derived values (USD per task, attribution percentages).
 */
import type { SuiteResult } from "./types.js";

export interface RenderedTaskRow {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly baselineTokens: number;
  readonly optimizedTokens: number;
  readonly savingsTokens: number;
  readonly savingsPct: number;
  readonly baselineUSD: number;
  readonly optimizedUSD: number;
  readonly savingsUSD: number;
  readonly attribution: {
    readonly s001_manifest: number;
    readonly s021_outputCompression: number;
    readonly s030_readOnceCache: number;
  };
}

export interface RenderedBenchmark {
  readonly schemaVersion: "sipcode-benchmark-rendered/1";
  readonly corpusVersion: string;
  readonly taskCount: number;
  readonly headline: {
    readonly medianSavingsPct: number;
    readonly meanSavingsPct: number;
    readonly minSavingsPct: number;
    readonly maxSavingsPct: number;
    readonly totalSavingsTokens: number;
    readonly totalSavingsUSD: number;
    readonly oneLiner: string;
  };
  readonly attribution: {
    readonly s001_manifest: { readonly tokens: number; readonly pct: number };
    readonly s021_outputCompression: { readonly tokens: number; readonly pct: number };
    readonly s030_readOnceCache: { readonly tokens: number; readonly pct: number };
  };
  readonly tasks: ReadonlyArray<RenderedTaskRow>;
  readonly metaPricing: { readonly asOf: string; readonly ageDays: number };
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
}

function pct1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function renderBenchmark(result: SuiteResult): RenderedBenchmark {
  const tasks: RenderedTaskRow[] = result.tasks.map((t) => ({
    id: t.taskId,
    title: t.title,
    category: t.category,
    baselineTokens: t.baseline.totalTokens,
    optimizedTokens: t.optimized.totalTokens,
    savingsTokens: t.savingsTokens,
    savingsPct: t.savingsPct,
    baselineUSD: Math.round(t.baseline.estCostUSD * 10000) / 10000,
    optimizedUSD: Math.round(t.optimized.estCostUSD * 10000) / 10000,
    savingsUSD: Math.round(t.savingsUSD * 10000) / 10000,
    attribution: {
      s001_manifest: t.attribution.s001_manifest,
      s021_outputCompression: t.attribution.s021_outputCompression,
      s030_readOnceCache: t.attribution.s030_readOnceCache,
    },
  }));

  const headline = {
    medianSavingsPct: pct1(result.summary.medianSavingsPct),
    meanSavingsPct: pct1(result.summary.meanSavingsPct),
    minSavingsPct: pct1(result.summary.minSavingsPct),
    maxSavingsPct: pct1(result.summary.maxSavingsPct),
    totalSavingsTokens: result.summary.totalSavingsTokens,
    totalSavingsUSD: Math.round(result.summary.totalSavingsUSD * 10000) / 10000,
    oneLiner: `median ${pct1(result.summary.medianSavingsPct)}% reduction across ${result.taskCount} tasks (range ${pct1(result.summary.minSavingsPct)}–${pct1(result.summary.maxSavingsPct)}%).`,
  };

  const attr = {
    s001_manifest: {
      tokens: result.summary.attribution.s001_manifest,
      pct: result.summary.attributionPct.s001_manifest,
    },
    s021_outputCompression: {
      tokens: result.summary.attribution.s021_outputCompression,
      pct: result.summary.attributionPct.s021_outputCompression,
    },
    s030_readOnceCache: {
      tokens: result.summary.attribution.s030_readOnceCache,
      pct: result.summary.attributionPct.s030_readOnceCache,
    },
  };

  return {
    schemaVersion: "sipcode-benchmark-rendered/1",
    corpusVersion: result.corpusVersion,
    taskCount: result.taskCount,
    headline,
    attribution: attr,
    tasks,
    metaPricing: result.metaPricing,
    warnings: result.warnings,
  };
}
