/**
 * Stats renderer — pure. AggregatedSession[] + window → StatsResult.
 *
 * Builds totals, trend, top-N, by-project, and savings. The runner above
 * (commands/stats.ts) handles I/O; everything in this file is pure.
 */
import {
  computeTotals,
  dominantModel,
} from "./aggregate.js";
import { buildTrend } from "./trend.js";
import { groupByProject } from "./projects.js";
import { topNExpensive } from "./topN.js";
import type {
  AggregatedSession,
  GroupBy,
  StatsResult,
  StatsSavings,
  StatsWindow,
} from "./types.js";
import { priceForModel, type PricingFile } from "../../lib/pricing/load.js";

export interface RenderStatsInput {
  readonly window: StatsWindow;
  readonly agent: string;
  readonly sessions: ReadonlyArray<AggregatedSession>;
  readonly topN: number;
  readonly groupBy: GroupBy;
  readonly pricing: PricingFile;
  readonly pricingAgeDays: number;
  readonly warnings: ReadonlyArray<{ code: string; message: string }>;
}

/**
 * Money-cost USD of a token bucket priced as cache-readable input on the
 * dominant model. Used to give "you could have saved $X" a sane USD anchor.
 */
function tokensToUSD(
  pricing: PricingFile,
  model: string,
  tokens: number,
  rate: "input" | "cache_read" | "cache_creation",
): number {
  const row = priceForModel(pricing, model);
  if (!row) return 0;
  const perMtok =
    rate === "input"
      ? row.input_per_mtok
      : rate === "cache_read"
        ? row.cache_read_per_mtok
        : row.cache_creation_per_mtok;
  return (tokens * perMtok) / 1_000_000;
}

function buildSavings(
  sessions: ReadonlyArray<AggregatedSession>,
  pricing: PricingFile,
  model: string,
): StatsSavings {
  let dup = 0;
  let idle = 0;
  let cacheCreation = 0;
  for (const s of sessions) {
    dup += s.duplicateReadTokens;
    idle += s.idleContextTokens;
    cacheCreation += s.cacheCreationTokens;
  }
  // Duplicate reads + idle context are "cache-read style" tokens — they get
  // billed at the cache-read rate. Cache-creation overhead is a separate rate.
  const dupUSD = tokensToUSD(pricing, model, dup, "cache_read");
  const idleUSD = tokensToUSD(pricing, model, idle, "cache_read");
  const cacheCreationUSD = tokensToUSD(
    pricing,
    model,
    Math.round(cacheCreation * 0.3), // S001 manifest-style discount
    "cache_creation",
  );
  return {
    duplicateReadsTokens: dup,
    idleContextTokens: idle,
    cacheCreationTokens: cacheCreation,
    totalRecoverableUSD: dupUSD + idleUSD + cacheCreationUSD,
    duplicateReadsUSD: dupUSD,
    idleContextUSD: idleUSD,
    cacheCreationUSD: cacheCreationUSD,
  };
}

export function renderStats(input: RenderStatsInput): StatsResult {
  const sessions = input.sessions;
  const totals = computeTotals(sessions);
  const trend = buildTrend(sessions, input.window);
  const byProject = groupByProject(sessions);
  const top = topNExpensive(sessions, input.topN);
  const model = dominantModel(sessions);
  const savings = buildSavings(sessions, input.pricing, model);
  return {
    schemaVersion: "sipcode-stats/1",
    window: input.window,
    agent: input.agent,
    primaryModel: model,
    sessionCount: sessions.length,
    totals: {
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheReadTokens: totals.cacheReadTokens,
      cacheCreationTokens: totals.cacheCreationTokens,
      totalTokens: totals.totalTokens,
      outputRatioPct: totals.outputRatioPct,
      estCostUSD: totals.estCostUSD,
    },
    savings,
    trendDaily: trend,
    topExpensive: top,
    byProject,
    sessions,
    groupBy: input.groupBy,
    metaPricing: {
      asOf: input.pricing.as_of,
      ageDays: input.pricingAgeDays,
    },
    warnings: input.warnings,
  };
}
