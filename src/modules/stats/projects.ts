/**
 * Group aggregated sessions by projectHash and compute spend share.
 * Pure.
 */
import type { AggregatedSession, ProjectGroup } from "./types.js";

export function groupByProject(
  sessions: ReadonlyArray<AggregatedSession>,
): ProjectGroup[] {
  const buckets = new Map<
    string,
    { name: string; sessionCount: number; tokens: number; usd: number }
  >();
  let totalUsd = 0;
  for (const s of sessions) {
    totalUsd += s.estCostUSD;
    const cur = buckets.get(s.projectHash);
    if (cur) {
      cur.sessionCount += 1;
      cur.tokens += s.totalTokens;
      cur.usd += s.estCostUSD;
      // Prefer the most-recent observed name; we picked the first one.
    } else {
      buckets.set(s.projectHash, {
        name: s.projectName,
        sessionCount: 1,
        tokens: s.totalTokens,
        usd: s.estCostUSD,
      });
    }
  }
  const out: ProjectGroup[] = [];
  for (const [hash, b] of buckets) {
    const pct =
      totalUsd > 0 ? Math.round((b.usd / totalUsd) * 1000) / 10 : 0;
    out.push({
      name: b.name,
      projectHash: hash,
      sessionCount: b.sessionCount,
      tokens: b.tokens,
      estCostUSD: b.usd,
      pctOfSpend: pct,
    });
  }
  out.sort((a, b) => {
    if (b.estCostUSD !== a.estCostUSD) return b.estCostUSD - a.estCostUSD;
    return a.name.localeCompare(b.name);
  });
  return out;
}
