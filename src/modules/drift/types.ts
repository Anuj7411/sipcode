/** Drift detector contract types (v1 — transcript-derived only). */

/** Per-session metrics derived purely from a parsed transcript. */
export interface SessionMetrics {
  readonly sessionId: string;
  /** End time (ms epoch) for ordering newest-first. */
  readonly endedAtMs: number;
  readonly totalTokens: number;
  readonly assistantTurns: number;
  /** totalTokens / max(1, assistantTurns). */
  readonly tokensPerTurn: number;
  /** cacheRead / (cacheRead + input + cacheCreation), 0..1. Higher = better. */
  readonly cacheHitRate: number;
  /** Tokens spent re-reading files already read (waste). */
  readonly duplicateReadTokens: number;
  /** output / (input + output + cacheCreation), 0..1. */
  readonly outputRatio: number;
}

/** Rolling baseline (medians) over the recent history window. */
export interface Baseline {
  readonly count: number;
  readonly medianTokensPerTurn: number;
  readonly medianCacheHitRate: number;
  readonly medianDuplicateReadTokens: number;
}

/** One detected, human-readable regression signal. */
export interface DriftCause {
  readonly label: string;
  readonly detail: string;
}

export interface RegressionResult {
  readonly hasRegression: boolean;
  readonly causes: ReadonlyArray<DriftCause>;
}

/** Aggregated drift report — what the CLI and `get_drift_report` return. */
export interface DriftReport {
  readonly schemaVersion: "sipcode-drift/1";
  readonly hasRegression: boolean;
  readonly summary: string;
  readonly causes: ReadonlyArray<DriftCause>;
  readonly latest?: SessionMetrics;
  readonly baseline?: Baseline;
  readonly note: string;
}
