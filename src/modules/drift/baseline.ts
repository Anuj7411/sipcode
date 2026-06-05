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
export const MIN_BASELINE = 3;

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
