/**
 * Pick top-N most expensive sessions, by token spend (tiebreaker: cost USD,
 * then most-recent first).
 * Pure.
 */
import type { AggregatedSession, TopExpensiveRow } from "./types.js";

export function topNExpensive(
  sessions: ReadonlyArray<AggregatedSession>,
  n: number,
): TopExpensiveRow[] {
  if (n <= 0) return [];
  const sorted = sessions.slice().sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
    if (b.estCostUSD !== a.estCostUSD) return b.estCostUSD - a.estCostUSD;
    return b.startedAt.localeCompare(a.startedAt);
  });
  return sorted.slice(0, n).map((s) => ({
    sessionId: s.sessionId,
    sessionIdShort: s.sessionIdShort,
    startedAt: s.startedAt,
    tokens: s.totalTokens,
    estCostUSD: s.estCostUSD,
    durationHuman: s.durationHuman,
    project: s.projectName,
    label: s.label,
  }));
}
