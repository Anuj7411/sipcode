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

/** Thousands-separated integer for readable token counts. */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
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
      metric: "Tokens per turn",
      direction: "up",
      changeDisplay: `up ${pctUp(latest.tokensPerTurn, baseline.medianTokensPerTurn)}%`,
      baselineDisplay: fmt(baseline.medianTokensPerTurn),
      latestDisplay: fmt(latest.tokensPerTurn),
      meaning:
        "Each step is sending far more context than your norm. Bloated context costs more tokens and can bury the detail Claude needs — the heart of context rot.",
      fix: "Start a fresh chat for your next task to reset the context, and run `sipcode why` to see which turns and files are heaviest.",
    });
  }

  if (
    baseline.medianCacheHitRate >= CACHE_MIN_BASELINE &&
    latest.cacheHitRate < baseline.medianCacheHitRate - CACHE_DROP_POINTS
  ) {
    const dropPts = Math.round(
      (baseline.medianCacheHitRate - latest.cacheHitRate) * 100,
    );
    causes.push({
      metric: "Cache reuse",
      direction: "down",
      changeDisplay: `down ${dropPts} points`,
      baselineDisplay: `${Math.round(baseline.medianCacheHitRate * 100)}%`,
      latestDisplay: `${Math.round(latest.cacheHitRate * 100)}%`,
      meaning:
        "Much less of your context is being reused from cache (cached tokens are ~10x cheaper). Usually from settings/MCP servers changing mid-session, or idle gaps longer than the ~5-minute cache window.",
      fix: "Avoid changing MCP servers or config mid-task, and work in steady bursts so the cache stays warm.",
    });
  }

  if (
    latest.duplicateReadTokens > baseline.medianDuplicateReadTokens * DUP_RATIO &&
    latest.duplicateReadTokens > DUP_ABS_FLOOR
  ) {
    causes.push({
      metric: "Repeated file reads",
      direction: "up",
      changeDisplay: `~${fmt(latest.duplicateReadTokens)} tokens wasted`,
      baselineDisplay: fmt(baseline.medianDuplicateReadTokens),
      latestDisplay: fmt(latest.duplicateReadTokens),
      meaning:
        "Claude re-read files it had already seen, paying again for content it already had in context.",
      fix: "Install the Sipcode proxy (`sipcode proxy --install`) — it automatically skips redundant re-reads.",
    });
  }

  return { hasRegression: causes.length > 0, causes };
}
