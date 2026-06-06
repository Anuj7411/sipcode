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
  /** output / (input + output + cacheCreation), 0..1. Reserved — collected but NOT checked in v1 regression detection. */
  readonly outputRatio: number;
}

/** Rolling baseline (medians) over the recent history window. */
export interface Baseline {
  readonly count: number;
  readonly medianTokensPerTurn: number;
  readonly medianCacheHitRate: number;
  readonly medianDuplicateReadTokens: number;
}

/** One detected regression signal, structured for a clear, educational render. */
export interface DriftCause {
  /** Human label, e.g. "Tokens per turn". */
  readonly metric: string;
  readonly direction: "up" | "down";
  /** Headline change, e.g. "up 662%" or "down 90 points". */
  readonly changeDisplay: string;
  /** Recent-norm value, formatted, e.g. "1,050" or "90%". */
  readonly baselineDisplay: string;
  /** This session's value, formatted, e.g. "8,000" or "0%". */
  readonly latestDisplay: string;
  /** Plain-English: what it means + why it matters. */
  readonly meaning: string;
  /** Concrete action the user can take. */
  readonly fix: string;
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
