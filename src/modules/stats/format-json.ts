/**
 * JSON formatter — stable schema. Pure.
 *
 * Idempotent: same StatsResult → byte-identical string. Numbers that come
 * out of float arithmetic are rounded to 4 decimals so snapshots don't drift.
 */
import type { StatsResult } from "./types.js";

function round(n: number, dp = 4): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

export function formatJson(report: StatsResult): string {
  // Project a copy of the report with rounded USD fields so the output is
  // reproducible. We do NOT mutate the input.
  const projected = {
    schemaVersion: report.schemaVersion,
    window: report.window,
    agent: report.agent,
    primaryModel: report.primaryModel,
    sessionCount: report.sessionCount,
    totals: {
      ...report.totals,
      outputRatioPct: round(report.totals.outputRatioPct, 1),
      estCostUSD: round(report.totals.estCostUSD),
    },
    savings: {
      duplicateReadsTokens: report.savings.duplicateReadsTokens,
      idleContextTokens: report.savings.idleContextTokens,
      cacheCreationTokens: report.savings.cacheCreationTokens,
      duplicateReadsUSD: round(report.savings.duplicateReadsUSD),
      idleContextUSD: round(report.savings.idleContextUSD),
      cacheCreationUSD: round(report.savings.cacheCreationUSD),
      totalRecoverableUSD: round(report.savings.totalRecoverableUSD),
    },
    trendDaily: report.trendDaily.map((d) => ({
      date: d.date,
      tokens: d.tokens,
      sessions: d.sessions,
      estCostUSD: round(d.estCostUSD),
    })),
    topExpensive: report.topExpensive.map((t) => ({
      sessionId: t.sessionId,
      sessionIdShort: t.sessionIdShort,
      startedAt: t.startedAt,
      tokens: t.tokens,
      estCostUSD: round(t.estCostUSD),
      durationHuman: t.durationHuman,
      project: t.project,
      label: t.label,
    })),
    byProject: report.byProject.map((p) => ({
      name: p.name,
      projectHash: p.projectHash,
      sessionCount: p.sessionCount,
      tokens: p.tokens,
      estCostUSD: round(p.estCostUSD),
      pctOfSpend: round(p.pctOfSpend, 1),
    })),
    groupBy: report.groupBy,
    metaPricing: report.metaPricing,
    warnings: report.warnings,
  };
  return JSON.stringify(projected, null, 2);
}
