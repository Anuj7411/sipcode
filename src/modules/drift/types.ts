/** Drift detector contract types.
 *
 * v2 (sipcode-drift/2):
 *   - persistent baselines (the sessions cache)
 *   - per-project baselines (grouped by projectHash)
 *   - config-cause attribution (MCP server diff)
 * All new fields are optional and additive; v1 consumers still work.
 */

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
  /** v2: project this session belongs to (`~/.claude/projects/<projectHash>/`). */
  readonly projectHash?: string;
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
  /** v2: when a concrete config change explains this regression, name it. */
  readonly attribution?: string;
}

export interface RegressionResult {
  readonly hasRegression: boolean;
  readonly causes: ReadonlyArray<DriftCause>;
}

/** v2: minimal snapshot of the user's Claude Code config at a point in time. */
export interface ConfigSnapshot {
  readonly capturedAtMs: number;
  /** Sorted set of MCP server names. Names only — never values or env. */
  readonly mcpServers: ReadonlyArray<string>;
}

/** v2: diff between two config snapshots, used for cause attribution. */
export interface ConfigDiff {
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
}

/** Aggregated drift report — what the CLI and `get_drift_report` return. */
export interface DriftReport {
  /** v1 consumers also accept "sipcode-drift/2". */
  readonly schemaVersion: "sipcode-drift/1" | "sipcode-drift/2";
  readonly hasRegression: boolean;
  readonly summary: string;
  readonly causes: ReadonlyArray<DriftCause>;
  readonly latest?: SessionMetrics;
  readonly baseline?: Baseline;
  readonly note: string;
  /** v2: which project's baseline this report was built against. */
  readonly projectHash?: string;
  /** v2: how the baseline was scoped. */
  readonly baselineScope?: "project" | "global";
}
