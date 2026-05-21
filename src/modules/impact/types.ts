/**
 * Impact module — A/B comparison of token spend before vs after a Sipcode
 * optimizer was installed.
 *
 * Pure data shapes. The runner under `runImpact.ts` consumes these and
 * never reaches for I/O.
 */

export interface ImpactBucket {
  /** Inclusive lower-bound ISO timestamp (UTC). */
  readonly sinceIso: string;
  /** Exclusive upper-bound ISO timestamp (UTC). */
  readonly untilIso: string;
  /** Number of whole days the bucket covers. */
  readonly days: number;
  readonly sessionCount: number;
  readonly totalTokens: number;
  readonly estCostUSD: number;
  readonly avgCostPerSessionUSD: number;
  readonly avgTokensPerSession: number;
  readonly outputRatioPct: number;
  /** Tokens recoverable across the bucket — duplicates + idle + cache. */
  readonly recoverableTokens: number;
}

export interface ImpactDelta {
  readonly sessionCountDelta: number;
  readonly tokenDeltaAbs: number;
  /** Negative number when after < before; positive when after > before. */
  readonly tokenDeltaPct: number;
  readonly costDeltaAbsUSD: number;
  readonly costDeltaPct: number;
  readonly avgCostPerSessionDeltaUSD: number;
  readonly avgCostPerSessionDeltaPct: number;
  /** Percentage points (e.g. +0.7pp from 0.4% to 1.1%). */
  readonly outputRatioDeltaPp: number;
}

export type ImpactStatus =
  /** Enough data on both sides to make a meaningful claim. */
  | "measured"
  /** Sipcode was installed less than `minDays` ago. */
  | "insufficient-post-data"
  /** No sessions before the install date — new user, no baseline. */
  | "no-baseline"
  /** No install marker found and no --since override given. */
  | "no-install-marker"
  /** Install marker found but produced no after-sessions yet. */
  | "no-post-sessions";

export interface ImpactReport {
  readonly schemaVersion: "sipcode-impact/1";
  readonly status: ImpactStatus;
  /** The pivot timestamp the bucket boundaries hinge on. */
  readonly installedAtIso: string | null;
  /** Free-text explanation of *which* install marker was used. */
  readonly markerSource:
    | "install-state.json (rules)"
    | "install-state.json (hygiene)"
    | "--since flag"
    | "none";
  readonly before: ImpactBucket;
  readonly after: ImpactBucket;
  readonly delta: ImpactDelta;
  /** Human-readable headline already rendered (one line). */
  readonly headline: string;
  /** Hints / next steps for the user. */
  readonly notes: ReadonlyArray<string>;
}
