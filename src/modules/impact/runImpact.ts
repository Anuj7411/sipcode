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

/** Severe asymmetry threshold: post-window must be ≥ 25% of pre-window length. */
const ASYMMETRY_RATIO_THRESHOLD = 0.25;

interface StatusResult {
  readonly status: ImpactStatus;
  readonly warningReason: string | null;
}

function statusFor(
  before: ImpactBucket,
  after: ImpactBucket,
  installedAtIso: string | null,
  nowIso: string,
  minPostDays: number,
): StatusResult {
  if (!installedAtIso) {
    return { status: "no-install-marker", warningReason: "no-install-marker" };
  }
  const postDays = daysBetween(installedAtIso, nowIso);
  if (postDays < minPostDays) {
    return {
      status: "insufficient-post-data",
      warningReason: `insufficient-post-data-${postDays}d-vs-min-${minPostDays}d`,
    };
  }
  if (before.sessionCount === 0 && after.sessionCount === 0) {
    return { status: "no-install-marker", warningReason: "no-sessions" };
  }
  if (before.sessionCount === 0) {
    return { status: "no-baseline", warningReason: "no-baseline" };
  }
  if (after.sessionCount === 0) {
    return { status: "no-post-sessions", warningReason: "no-post-sessions" };
  }
  // Severe window asymmetry: even if both buckets have data and minPostDays
  // is satisfied, comparing wildly mismatched windows is misleading.
  // Example: 39 days before vs 2 days after is not a fair A/B.
  const preDays = before.days;
  if (preDays > 0 && postDays / preDays < ASYMMETRY_RATIO_THRESHOLD) {
    return {
      status: "insufficient-post-data",
      warningReason: `window-asymmetry-${preDays}d-vs-${postDays}d`,
    };
  }
  return { status: "measured", warningReason: null };
}

function fmtTokensCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return n.toString();
  if (abs < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function renderHeadlineNoMarker(allTime: ImpactBucket): string {
  if (allTime.sessionCount === 0) {
    return "no install marker found AND no sessions on disk yet — run `claude` in a project to create some, then `sipcode rules --install` to start measuring.";
  }
  const tokens = fmtTokensCompact(allTime.totalTokens);
  const dollars = allTime.estCostUSD.toFixed(2);
  return (
    `found ${allTime.sessionCount} sessions across all time `
    + `(${tokens} tokens, $${dollars} total) — `
    + `but no install marker, so no before/after split is possible. `
    + `Run \`sipcode rules --install\` in your project, or pass since=YYYY-MM-DD, to enable a real comparison.`
  );
}

function renderHeadline(
  status: ImpactStatus,
  delta: ImpactDelta,
  before: ImpactBucket,
  after: ImpactBucket,
  warningReason: string | null,
): string {
  void before;
  switch (status) {
    case "measured": {
      // Output ratio is the normalization-resistant metric — it's a ratio,
      // not an absolute, so it doesn't shift with window length. Lead with it.
      const ratioBefore = before.outputRatioPct;
      const ratioAfter = after.outputRatioPct;
      const ratioRelPct =
        ratioBefore > 0
          ? Math.round(((ratioAfter - ratioBefore) / ratioBefore) * 1000) / 10
          : 0;
      const ratioDir = ratioRelPct >= 0 ? "improved" : "regressed";
      const ratioArrow = ratioRelPct >= 0 ? "↑" : "↓";

      const tokenDir = delta.tokenDeltaAbs < 0 ? "saved" : "spent extra";
      const absTokens = fmtTokensCompact(Math.abs(delta.tokenDeltaAbs));
      const dollars = Math.abs(delta.costDeltaAbsUSD).toFixed(2);

      return (
        `output ratio ${ratioDir} ${Math.abs(ratioRelPct).toFixed(1)}% ${ratioArrow} `
        + `(${ratioBefore.toFixed(1)}% → ${ratioAfter.toFixed(1)}%, the normalization-resistant signal); `
        + `${tokenDir} ${absTokens} tokens (≈ $${dollars}) across ${after.sessionCount} post-install sessions — `
        + `interpret the absolute numbers against the window lengths`
      );
    }
    case "insufficient-post-data":
      if (warningReason?.startsWith("window-asymmetry-")) {
        return `window asymmetry — ${warningReason.replace("window-asymmetry-", "").replace("-", " before vs ")} after. Comparison would be misleading; come back when both windows are comparable.`;
      }
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
    const computedDelta = computeDelta(empty, empty);
    // Populate allTime so the user sees their actual session count — closes
    // the "0 sessions" confusion from the user-test playbook results.
    const allTime = summarize(earliestIso, latestIso, sortedByStart);
    return {
      schemaVersion: SCHEMA_VERSION,
      status,
      installedAtIso: null,
      markerSource: input.markerSource,
      before: empty,
      after: empty,
      delta: null, // gated — see types.ts contract
      warningReason: "no-install-marker",
      allTime,
      headline: renderHeadlineNoMarker(allTime),
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
  const computedDelta = computeDelta(beforeBucket, afterBucket);
  const { status, warningReason } = statusFor(
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
    // Null-gate: delta numbers only present when status is "measured".
    // This is the contract that prevents misleading "97% savings!" output
    // from windows that aren't comparable.
    delta: status === "measured" ? computedDelta : null,
    warningReason,
    // allTime is only populated in the no-install-marker case (above).
    allTime: null,
    headline: renderHeadline(status, computedDelta, beforeBucket, afterBucket, warningReason),
    notes: noteFor(status),
  };
}
