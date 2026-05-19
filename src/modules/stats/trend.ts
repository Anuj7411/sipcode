/**
 * Bucket sessions into daily rollups across the window.
 * Pure.
 */
import { enumerateDays } from "./window.js";
import type { AggregatedSession, StatsWindow, TrendDay } from "./types.js";

export function buildTrend(
  sessions: ReadonlyArray<AggregatedSession>,
  window: StatsWindow,
): TrendDay[] {
  const buckets = new Map<
    string,
    { tokens: number; sessions: number; usd: number }
  >();
  for (const day of enumerateDays(window)) {
    buckets.set(day, { tokens: 0, sessions: 0, usd: 0 });
  }
  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    const b = buckets.get(day);
    if (!b) continue; // outside window (shouldn't happen post-filter)
    b.tokens += s.totalTokens;
    b.sessions += 1;
    b.usd += s.estCostUSD;
  }
  const out: TrendDay[] = [];
  for (const [date, b] of buckets) {
    out.push({
      date,
      tokens: b.tokens,
      sessions: b.sessions,
      estCostUSD: b.usd,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
