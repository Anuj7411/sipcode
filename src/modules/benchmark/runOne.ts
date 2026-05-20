/**
 * Single-task runner. Pure: BenchmarkTask + transcript contents → TaskResult.
 *
 * Re-analyzes the locked transcript pair using the existing transcript
 * analyzers. We do NOT call any model — the savings number is the difference
 * between two static .jsonl fixtures.
 */
import { parseTranscript } from "../transcript/parse.js";
import { analyzeTokens } from "../transcript/analyzers/tokens.js";
import { analyzeDuplicateReads } from "../transcript/analyzers/duplicateReads.js";
import type { PricingFile } from "../../lib/pricing/load.js";
import type { SipcodeIssue } from "../../lib/errors.js";
import { issue } from "../../lib/errors.js";
import { ok, err, type Result } from "../../lib/result.js";
import type {
  BenchmarkTask,
  FlavorTotals,
  ModuleAttribution,
  TaskResult,
} from "./types.js";

export interface RunOneInput {
  readonly task: BenchmarkTask;
  readonly baselineJsonl: string;
  readonly optimizedJsonl: string;
  readonly pricing: PricingFile;
}

/**
 * Flatten a parsed session into FlavorTotals. Pure.
 */
function buildFlavorTotals(
  baselineOrOpt: "baseline" | "optimized",
  jsonl: string,
  pricing: PricingFile,
): { totals: FlavorTotals; warnings: SipcodeIssue[] } {
  const warnings: SipcodeIssue[] = [];
  const r = parseTranscript(jsonl);
  if (!r.ok) {
    warnings.push(
      issue(
        "E003",
        `${baselineOrOpt} transcript failed to parse (returned issues array).`,
      ),
    );
    return {
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        estCostUSD: 0,
        outputRatioPct: 0,
        distinctFilesRead: 0,
        duplicateReadTokens: 0,
        toolCallCount: 0,
      },
      warnings,
    };
  }
  const session = r.value;
  const tokens = analyzeTokens(session, pricing);
  const dups = analyzeDuplicateReads(session);
  const total =
    tokens.inputTokens +
    tokens.outputTokens +
    tokens.cacheReadTokens +
    tokens.cacheCreationTokens;
  return {
    totals: {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      cacheCreationTokens: tokens.cacheCreationTokens,
      totalTokens: total,
      estCostUSD: tokens.estCostUSD,
      outputRatioPct:
        Math.round((tokens.outputRatio || 0) * 1000) / 10,
      distinctFilesRead: dups.distinctFilesRead,
      duplicateReadTokens: dups.duplicateReadTokenCost,
      toolCallCount: tokens.toolCallCount,
    },
    warnings,
  };
}

/**
 * Attribute total savings across S001/S021/S030 from the diff between flavors.
 *
 * Heuristic, but defensible:
 *   - cache_creation reduction (baseline - optimized) → S001 manifest.
 *     A manifest replaces the broad cache-creation pass with a tight one.
 *   - duplicate-read reduction (baseline - optimized) → S030 read-once cache.
 *   - output-token reduction (baseline - optimized) → S021 output compression.
 *
 * All three sums are clamped to non-negative. If the three component
 * reductions sum to less than the total token reduction, the remainder is
 * proportionally distributed across the three (so attribution always sums to
 * the total savings figure).
 */
function attribute(
  baseline: FlavorTotals,
  optimized: FlavorTotals,
  totalSavings: number,
): ModuleAttribution {
  const s001 = Math.max(
    0,
    baseline.cacheCreationTokens - optimized.cacheCreationTokens,
  );
  const s030 = Math.max(
    0,
    baseline.duplicateReadTokens - optimized.duplicateReadTokens,
  );
  const s021 = Math.max(0, baseline.outputTokens - optimized.outputTokens);
  const sum = s001 + s030 + s021;

  if (sum === 0) {
    return { s001_manifest: 0, s021_outputCompression: 0, s030_readOnceCache: 0 };
  }
  // Scale so the three components sum exactly to totalSavings (positive only).
  const scale = totalSavings > 0 ? totalSavings / sum : 1;
  const a1 = Math.round(s001 * scale);
  const a2 = Math.round(s021 * scale);
  const a3 = Math.round(s030 * scale);
  // Fix rounding drift onto the largest bucket.
  const drift = totalSavings - (a1 + a2 + a3);
  if (drift !== 0 && totalSavings > 0) {
    if (a1 >= a2 && a1 >= a3) {
      return {
        s001_manifest: a1 + drift,
        s021_outputCompression: a2,
        s030_readOnceCache: a3,
      };
    }
    if (a2 >= a3) {
      return {
        s001_manifest: a1,
        s021_outputCompression: a2 + drift,
        s030_readOnceCache: a3,
      };
    }
    return {
      s001_manifest: a1,
      s021_outputCompression: a2,
      s030_readOnceCache: a3 + drift,
    };
  }
  return {
    s001_manifest: a1,
    s021_outputCompression: a2,
    s030_readOnceCache: a3,
  };
}

export function runOne(
  input: RunOneInput,
): Result<TaskResult, SipcodeIssue[]> {
  const warnings: SipcodeIssue[] = [];
  const baseFlavor = buildFlavorTotals(
    "baseline",
    input.baselineJsonl,
    input.pricing,
  );
  const optFlavor = buildFlavorTotals(
    "optimized",
    input.optimizedJsonl,
    input.pricing,
  );
  warnings.push(...baseFlavor.warnings, ...optFlavor.warnings);

  if (baseFlavor.totals.totalTokens === 0) {
    warnings.push(
      issue(
        "E003",
        `${input.task.id}: baseline transcript has zero tokens — corpus is malformed.`,
      ),
    );
    return err(warnings);
  }

  const savingsTokens = Math.max(
    0,
    baseFlavor.totals.totalTokens - optFlavor.totals.totalTokens,
  );
  const savingsPct =
    baseFlavor.totals.totalTokens > 0
      ? (savingsTokens / baseFlavor.totals.totalTokens) * 100
      : 0;
  const savingsUSD = Math.max(
    0,
    baseFlavor.totals.estCostUSD - optFlavor.totals.estCostUSD,
  );

  const attribution = attribute(
    baseFlavor.totals,
    optFlavor.totals,
    savingsTokens,
  );

  return ok({
    taskId: input.task.id,
    title: input.task.title,
    category: input.task.category,
    baseline: baseFlavor.totals,
    optimized: optFlavor.totals,
    savingsPct: Math.round(savingsPct * 10) / 10,
    savingsTokens,
    savingsUSD,
    attribution,
    warnings: warnings.map((w) => ({ code: w.code, message: w.message })),
  });
}
