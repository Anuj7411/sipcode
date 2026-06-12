/**
 * `forecast_monthly_spend` / `sipcode forecast` — public types.
 *
 * Schema pinned at `sipcode-forecast/1`.
 */

export type ForecastStatus =
  | "ok"
  | "insufficient-data"
  | "near-month-end"
  | "no-recent-activity"
  | "no-data";

export interface ForecastTrajectoryInput {
  readonly windowDays: number;
  readonly isPartial: boolean;
  readonly sessionsSampled: number;
  readonly avgDailySpendUSD: number;
  readonly medianDailySpendUSD: number;
}

export interface ForecastMonthEnd {
  readonly monthLabel: string;
  readonly daysRemaining: number;
  readonly projectedSpendUSD: number;
  readonly confidenceLowUSD: number;
  readonly confidenceHighUSD: number;
  readonly spendSoFarUSD: number;
}

export interface ForecastComparison {
  readonly lastMonthSpendUSD: number | null;
  /** Positive = current month projected higher than last. */
  readonly vsLastMonthPct: number | null;
}

export interface ForecastReport {
  readonly schemaVersion: "sipcode-forecast/1";
  readonly status: ForecastStatus;
  readonly trajectoryInput: ForecastTrajectoryInput | null;
  readonly monthEnd: ForecastMonthEnd | null;
  readonly comparison: ForecastComparison | null;
  readonly headline: string;
}
