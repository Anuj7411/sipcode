/**
 * Stats module — cross-session aggregate types.
 *
 * Pure: every type is plain data. The runners under this folder consume
 * these shapes and never reach for I/O.
 */
import type { SipcodeIssue } from "../../lib/errors.js";

export type GroupBy = "none" | "project";

export interface StatsWindow {
  /** Inclusive lower-bound ISO timestamp (UTC, start of day). */
  readonly sinceIso: string;
  /** Exclusive upper-bound ISO timestamp (UTC). */
  readonly untilIso: string;
  /** Number of whole days the window covers (untilIso - sinceIso, rounded). */
  readonly days: number;
  /** The raw flag that produced this window, for echoing back to the user. */
  readonly raw: string;
}

/**
 * Per-session aggregate row — everything the cross-session views need to
 * build totals, trends, and rankings. Built from the existing analyzers.
 */
export interface AggregatedSession {
  readonly sessionId: string;
  readonly sessionIdShort: string;
  readonly projectHash: string;
  /** Resolved human-readable project name (basename of cwd or projectHash). */
  readonly projectName: string;
  /** Earliest assistant timestamp ISO, or file mtime as fallback. */
  readonly startedAt: string;
  /** Last assistant timestamp ISO, or startedAt fallback. */
  readonly endedAt: string;
  /** Wall-clock duration in seconds. */
  readonly durationSec: number;
  /** Human-readable duration ("12h 15m"). */
  readonly durationHuman: string;
  readonly primaryModel: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /** Sum of all billable tokens. */
  readonly totalTokens: number;
  readonly outputRatioPct: number;
  readonly estCostUSD: number;
  readonly toolCallCount: number;
  readonly duplicateReadTokens: number;
  readonly idleContextTokens: number;
  /** Short subject pulled from the session (best-effort, may be ""). */
  readonly label: string;
}

export interface TrendDay {
  /** YYYY-MM-DD (UTC). */
  readonly date: string;
  readonly tokens: number;
  readonly sessions: number;
  readonly estCostUSD: number;
}

export interface ProjectGroup {
  readonly name: string;
  readonly projectHash: string;
  readonly sessionCount: number;
  readonly tokens: number;
  readonly estCostUSD: number;
  /** 0-100 share of total spend across the window. */
  readonly pctOfSpend: number;
}

export interface TopExpensiveRow {
  readonly sessionId: string;
  readonly sessionIdShort: string;
  readonly startedAt: string;
  readonly tokens: number;
  readonly estCostUSD: number;
  readonly durationHuman: string;
  readonly project: string;
  readonly label: string;
}

export interface StatsTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly totalTokens: number;
  readonly outputRatioPct: number;
  readonly estCostUSD: number;
}

export interface StatsSavings {
  readonly duplicateReadsTokens: number;
  readonly idleContextTokens: number;
  readonly cacheCreationTokens: number;
  readonly totalRecoverableUSD: number;
  /** Per-bucket USD attribution (rate-weighted on opus pricing). */
  readonly duplicateReadsUSD: number;
  readonly idleContextUSD: number;
  readonly cacheCreationUSD: number;
}

export interface StatsMetaPricing {
  readonly asOf: string;
  readonly ageDays: number;
}

export interface StatsResult {
  readonly schemaVersion: "sipcode-stats/1";
  readonly window: StatsWindow;
  readonly agent: string;
  readonly primaryModel: string;
  readonly sessionCount: number;
  readonly totals: StatsTotals;
  readonly savings: StatsSavings;
  readonly trendDaily: ReadonlyArray<TrendDay>;
  readonly topExpensive: ReadonlyArray<TopExpensiveRow>;
  readonly byProject: ReadonlyArray<ProjectGroup>;
  readonly sessions: ReadonlyArray<AggregatedSession>;
  readonly groupBy: GroupBy;
  readonly metaPricing: StatsMetaPricing;
  readonly warnings: ReadonlyArray<{ readonly code: string; readonly message: string }>;
}

/** Result shapes for window parser — errors flow through the same Issue system. */
export interface WindowParseError {
  readonly issue: SipcodeIssue;
}
