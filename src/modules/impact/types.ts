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
  /**
   * Before/after delta. **Null when `status !== "measured"`** — consumers
   * MUST NOT render delta numbers when the status field signals they are
   * unreliable. This null-gate is the contract that prevents misleading
   * "you saved 97%!" output from windows that aren't comparable.
   */
  readonly delta: ImpactDelta | null;
  /**
   * Why `delta` is null (when it is). One of:
   *   "no-install-marker" / "no-baseline" / "no-post-sessions" /
   *   "insufficient-post-data" / "window-asymmetry-<preDays>d-vs-<postDays>d"
   * `null` only when `status === "measured"`.
   */
  readonly warningReason: string | null;
  /**
   * Set ONLY when `status === "no-install-marker"`. Contains an all-time
   * summary of every session the tool found across all of the user's
   * Claude Code projects. Gives the user confidence the tool can SEE their
   * data even when it can't compute a before/after delta (because no install
   * marker exists). Closes the v1.2.2 UX gap where the tool reported
   * "0 sessions" in both windows for users with hundreds of sessions on disk.
   */
  readonly allTime: ImpactBucket | null;
  /** Human-readable headline already rendered (one line). */
  readonly headline: string;
  /** Hints / next steps for the user. */
  readonly notes: ReadonlyArray<string>;
}
