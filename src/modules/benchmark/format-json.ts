/**
 * JSON formatter for `sipcode benchmark`. Pure, idempotent.
 *
 * Rounds floats so output is byte-stable across runs.
 */
import type { RenderedBenchmark } from "./render.js";

function round(n: number, dp = 4): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export function formatJson(report: RenderedBenchmark): string {
  const out = {
    schemaVersion: report.schemaVersion,
    corpusVersion: report.corpusVersion,
    taskCount: report.taskCount,
    headline: {
      medianSavingsPct: round(report.headline.medianSavingsPct, 1),
      meanSavingsPct: round(report.headline.meanSavingsPct, 1),
      minSavingsPct: round(report.headline.minSavingsPct, 1),
      maxSavingsPct: round(report.headline.maxSavingsPct, 1),
      totalSavingsTokens: report.headline.totalSavingsTokens,
      totalSavingsUSD: round(report.headline.totalSavingsUSD),
      oneLiner: report.headline.oneLiner,
    },
    attribution: {
      s001_manifest: {
        tokens: report.attribution.s001_manifest.tokens,
        pct: round(report.attribution.s001_manifest.pct, 1),
      },
      s021_outputCompression: {
        tokens: report.attribution.s021_outputCompression.tokens,
        pct: round(report.attribution.s021_outputCompression.pct, 1),
      },
      s030_readOnceCache: {
        tokens: report.attribution.s030_readOnceCache.tokens,
        pct: round(report.attribution.s030_readOnceCache.pct, 1),
      },
    },
    tasks: report.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      baselineTokens: t.baselineTokens,
      optimizedTokens: t.optimizedTokens,
      savingsTokens: t.savingsTokens,
      savingsPct: round(t.savingsPct, 1),
      baselineUSD: round(t.baselineUSD),
      optimizedUSD: round(t.optimizedUSD),
      savingsUSD: round(t.savingsUSD),
      attribution: t.attribution,
    })),
    metaPricing: report.metaPricing,
    warnings: report.warnings,
  };
  return JSON.stringify(out, null, 2);
}
