/**
 * Pure runner: AggregatedSession[] + installedAtIso → ImpactReport.
 *
 * Buckets each session into "before" or "after" the install timestamp
 * using its `startedAt`. Computes totals + a delta block.
 *
 * Zero I/O — caller supplies all data.
 */
import type { AggregatedSession } from "../stats/types.js";
import type {
  ImpactBucket,
  ImpactDelta,
  ImpactReport,
  ImpactStatus,
} from "./types.js";

export interface RunImpactInput {
  readonly sessions: ReadonlyArray<AggregatedSession>;
  /** ISO timestamp of the install marker; null means "no marker found". */
  readonly installedAtIso: string | null;
  readonly markerSource: ImpactReport["markerSource"];
  /** Current time, for "today" clamping on the after-bucket upper bound. */
  readonly nowIso: string;
  /** Minimum days of post-install data required to call the result "measured". Default 3. */
  readonly minPostDays?: number;
}

const SCHEMA_VERSION = "sipcode-impact/1" as const;

function emptyBucket(sinceIso: string, untilIso: string): ImpactBucket {
  return {
    sinceIso,
    untilIso,
    days: daysBetween(sinceIso, untilIso),
    sessionCount: 0,
    totalTokens: 0,
    estCostUSD: 0,
    avgCostPerSessionUSD: 0,
    avgTokensPerSession: 0,
    outputRatioPct: 0,
    recoverableTokens: 0,
  };
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function summarize(
  sinceIso: string,
  untilIso: string,
  sessions: ReadonlyArray<AggregatedSession>,
): ImpactBucket {
  if (sessions.length === 0) return emptyBucket(sinceIso, untilIso);

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let totalTokens = 0;
  let usd = 0;
  let recoverable = 0;

  for (const s of sessions) {
    inputTokens += s.inputTokens;
    outputTokens += s.outputTokens;
    cacheReadTokens += s.cacheReadTokens;
    cacheCreationTokens += s.cacheCreationTokens;
    totalTokens += s.totalTokens;
    usd += s.estCostUSD;
    recoverable += s.duplicateReadTokens + s.idleContextTokens + s.cacheCreationTokens;
  }
  void inputTokens;
  void cacheReadTokens;

  const ratioPct =
    totalTokens > 0
      ? Math.round((outputTokens / totalTokens) * 1000) / 10
      : 0;

  return {
    sinceIso,
    untilIso,
    days: daysBetween(sinceIso, untilIso),
    sessionCount: sessions.length,
    totalTokens,
    estCostUSD: round2(usd),
    avgCostPerSessionUSD: round2(usd / sessions.length),
    avgTokensPerSession: Math.round(totalTokens / sessions.length),
    outputRatioPct: ratioPct,
    recoverableTokens: recoverable,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pct(numer: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.round((numer / denom) * 1000) / 10;
}

function computeDelta(before: ImpactBucket, after: ImpactBucket): ImpactDelta {
  const tokenDeltaAbs = after.totalTokens - before.totalTokens;
  const costDeltaAbsUSD = round2(after.estCostUSD - before.estCostUSD);
  const avgDeltaUSD = round2(
    after.avgCostPerSessionUSD - before.avgCostPerSessionUSD,
  );
  return {
    sessionCountDelta: after.sessionCount - before.sessionCount,
    tokenDeltaAbs,
    tokenDeltaPct: pct(tokenDeltaAbs, before.totalTokens),
    costDeltaAbsUSD,
    costDeltaPct: pct(costDeltaAbsUSD, before.estCostUSD),
    avgCostPerSessionDeltaUSD: avgDeltaUSD,
    avgCostPerSessionDeltaPct: pct(
      avgDeltaUSD,
      before.avgCostPerSessionUSD,
    ),
    outputRatioDeltaPp:
      Math.round((after.outputRatioPct - before.outputRatioPct) * 10) / 10,
  };
}

function statusFor(
  before: ImpactBucket,
  after: ImpactBucket,
  installedAtIso: string | null,
  nowIso: string,
  minPostDays: number,
): ImpactStatus {
  if (!installedAtIso) return "no-install-marker";
  const postDays = daysBetween(installedAtIso, nowIso);
  if (postDays < minPostDays) return "insufficient-post-data";
  if (before.sessionCount === 0 && after.sessionCount === 0) {
    return "no-install-marker";
  }
  if (before.sessionCount === 0) return "no-baseline";
  if (after.sessionCount === 0) return "no-post-sessions";
  return "measured";
}

function renderHeadline(
  status: ImpactStatus,
  delta: ImpactDelta,
  before: ImpactBucket,
  after: ImpactBucket,
): string {
  switch (status) {
    case "measured": {
      const direction = delta.costDeltaAbsUSD < 0 ? "saving" : "spending";
      const absUSD = Math.abs(delta.costDeltaAbsUSD).toFixed(2);
      const absPct = Math.abs(delta.costDeltaPct).toFixed(1);
      const arrow = delta.costDeltaAbsUSD < 0 ? "↓" : "↑";
      return `${direction} $${absUSD} (${absPct}% ${arrow}) across ${after.sessionCount} post-install sessions`;
    }
    case "insufficient-post-data":
      return "not enough post-install data yet — come back after a few more sessions";
    case "no-baseline":
      return "no pre-install sessions found — Sipcode can't show before/after without a baseline";
    case "no-install-marker":
      return "no install marker found — run `sipcode rules --install` or pass --since YYYY-MM-DD";
    case "no-post-sessions":
      return "install marker found but no sessions recorded after it yet";
  }
}

function noteFor(status: ImpactStatus): string[] {
  switch (status) {
    case "measured":
      return [
        "Run `sipcode why` on any specific session for a forensic per-session breakdown.",
        "Run `sipcode benchmark` to compare your savings against the published 62.6% corpus median.",
      ];
    case "insufficient-post-data":
      return [
        "Sipcode needs at least a few days of post-install sessions to produce a meaningful comparison.",
        "Use `sipcode why` for per-session forensics in the meantime.",
      ];
    case "no-baseline":
      return [
        "You can still run `sipcode benchmark` to see published savings reproduced on your machine.",
      ];
    case "no-install-marker":
      return [
        "If you've been using Sipcode without `rules --install`, pass --since YYYY-MM-DD to set the pivot manually.",
        "Or run `sipcode rules --install` to start measuring the impact going forward.",
      ];
    case "no-post-sessions":
      return [
        "Use Claude Code for a few sessions, then re-run `sipcode impact`.",
      ];
  }
}

export function runImpact(input: RunImpactInput): ImpactReport {
  const minPostDays = input.minPostDays ?? 3;
  const sortedByStart = [...input.sessions].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  );

  const earliestIso =
    sortedByStart[0]?.startedAt ?? input.nowIso;
  const latestIso = input.nowIso;

  const pivot = input.installedAtIso;
  if (!pivot) {
    const empty = emptyBucket(earliestIso, latestIso);
    const status: ImpactStatus = "no-install-marker";
    const delta = computeDelta(empty, empty);
    return {
      schemaVersion: SCHEMA_VERSION,
      status,
      installedAtIso: null,
      markerSource: input.markerSource,
      before: empty,
      after: empty,
      delta,
      headline: renderHeadline(status, delta, empty, empty),
      notes: noteFor(status),
    };
  }

  const before: AggregatedSession[] = [];
  const after: AggregatedSession[] = [];
  for (const s of sortedByStart) {
    if (s.startedAt < pivot) before.push(s);
    else after.push(s);
  }

  const beforeBucket = summarize(earliestIso, pivot, before);
  const afterBucket = summarize(pivot, latestIso, after);
  const delta = computeDelta(beforeBucket, afterBucket);
  const status = statusFor(
    beforeBucket,
    afterBucket,
    pivot,
    input.nowIso,
    minPostDays,
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    installedAtIso: pivot,
    markerSource: input.markerSource,
    before: beforeBucket,
    after: afterBucket,
    delta,
    headline: renderHeadline(status, delta, beforeBucket, afterBucket),
    notes: noteFor(status),
  };
}
