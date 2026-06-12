/**
 * `get_today_summary` / `sipcode today` — public types.
 *
 * Schema is part of the public contract from v1.6.10 (or whatever patch this
 * lands in). Renames are breaking changes.
 */

export type TodayStatus =
  | "ok"
  | "no-sessions-today"
  | "no-baseline"
  | "no-data";

export interface TodayLeak {
  readonly kind: "duplicate-reads" | "idle-context" | "other";
  readonly description: string;
  readonly costUSD: number;
}

export interface TodayBlock {
  readonly dateLocal: string;
  readonly sessionCount: number;
  readonly totalSpendUSD: number;
  readonly totalTokens: number;
  readonly outputRatioPct: number;
  readonly topLeak: TodayLeak | null;
}

export interface TodayBaseline {
  readonly windowDays: number;
  readonly isPartial: boolean;
  readonly medianSpendPerDayUSD: number;
  readonly medianTokensPerDay: number;
  readonly medianOutputRatioPct: number;
}

export interface TodayComparison {
  readonly spendDeltaPct: number;
  readonly tokenDeltaPct: number;
  /** Points (NOT percent): outputRatioPct(today) - outputRatioPct(baseline). */
  readonly outputRatioDeltaPp: number;
}

export interface TodayReport {
  readonly schemaVersion: "sipcode-today/1";
  readonly status: TodayStatus;
  readonly today: TodayBlock | null;
  readonly baseline: TodayBaseline | null;
  readonly comparison: TodayComparison | null;
  readonly headline: string;
}
