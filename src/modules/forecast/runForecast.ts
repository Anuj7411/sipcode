/**
 * Pure runner for `sipcode forecast` / `forecast_monthly_spend` MCP tool.
 *
 * Logic:
 *  - trajectory window = adaptive 14d → 7d (forecast NEEDS ≥7 days to be useful).
 *  - projected spend = avgDailySpend × daysRemainingInMonth + spendSoFarThisMonth.
 *  - confidence band = ±min(stdev(dailySpend) × daysRemaining, 0.20 × projected).
 *  - vs last month comparison if ≥1 session in previous calendar month.
 *
 * All five ForecastStatus branches handled with structured output. Never throws.
 */
import type {
  ForecastReport,
  ForecastTrajectoryInput,
  ForecastMonthEnd,
  ForecastComparison,
  ForecastStatus,
} from "./types.js";

/** Same session shape as today's runner. */
export interface ForecastSession {
  readonly startedAt: string;
  readonly estCostUSD: number;
}

export interface RunForecastInput {
  readonly sessions: ReadonlyArray<ForecastSession>;
  readonly now: Date;
}

const FORECAST_MIN_DAYS_HISTORY = 7;

export function runForecast(input: RunForecastInput): ForecastReport {
  const { sessions, now } = input;

  if (sessions.length === 0) {
    return empty(
      "no-data",
      "No Claude Code sessions found yet. Run `claude` in any project to start.",
    );
  }

  const daysRemaining = daysRemainingInMonth(now);
  if (daysRemaining <= 1) {
    const monthLabel = monthLabelFor(now);
    return empty(
      "near-month-end",
      `${monthLabel} ${daysRemaining <= 0 ? "ended" : "ends tomorrow"}. Forecast not meaningful at this point.`,
    );
  }

  // Recent activity check: any session in the last 14 days.
  const lookbackMs = now.getTime() - 14 * 86_400_000;
  const hasRecent = sessions.some(
    (s) => Date.parse(s.startedAt) >= lookbackMs,
  );
  if (!hasRecent) {
    return empty(
      "no-recent-activity",
      "No sessions in your last 14 days — can't forecast a trajectory.",
    );
  }

  // Adaptive trajectory window: 14 → 7, requires enough history.
  const earliestMs = Math.min(
    ...sessions.map((s) => Date.parse(s.startedAt)).filter(Number.isFinite),
  );
  const daysAvailable = Math.floor((now.getTime() - earliestMs) / 86_400_000);
  if (daysAvailable < FORECAST_MIN_DAYS_HISTORY) {
    return empty(
      "insufficient-data",
      `Forecast needs at least 7 days of session history. Currently have ${daysAvailable}.`,
    );
  }
  const windowDays = daysAvailable >= 14 ? 14 : 7;
  const isPartial = daysAvailable < 14;

  const trajectoryStartMs = now.getTime() - windowDays * 86_400_000;
  const sampled = sessions.filter(
    (s) => Date.parse(s.startedAt) >= trajectoryStartMs,
  );

  const dailySpend = bucketDailySpend(sampled, windowDays, now);
  const avgDailySpendUSD = mean(dailySpend);
  const medianDailySpendUSD = median(dailySpend);
  const sigma = stdev(dailySpend);

  const monthStart = startOfMonth(now);
  const spendSoFarUSD = sessions
    .filter((s) => Date.parse(s.startedAt) >= monthStart.getTime())
    .reduce((sum, s) => sum + s.estCostUSD, 0);

  const projectedExtra = avgDailySpendUSD * daysRemaining;
  const projectedSpendUSD = spendSoFarUSD + projectedExtra;
  const bandRaw = sigma * daysRemaining;
  const bandCap = Math.max(0, 0.2 * projectedSpendUSD);
  const band = Math.max(0, Math.min(bandRaw, bandCap));
  const confidenceLowUSD = Math.max(0, projectedSpendUSD - band);
  const confidenceHighUSD = projectedSpendUSD + band;

  const trajectoryInput: ForecastTrajectoryInput = {
    windowDays,
    isPartial,
    sessionsSampled: sampled.length,
    avgDailySpendUSD,
    medianDailySpendUSD,
  };

  const monthEnd: ForecastMonthEnd = {
    monthLabel: monthLabelFor(now),
    daysRemaining,
    projectedSpendUSD,
    confidenceLowUSD,
    confidenceHighUSD,
    spendSoFarUSD,
  };

  const comparison = buildLastMonthComparison(sessions, now, projectedSpendUSD);
  const headline = buildHeadline(trajectoryInput, monthEnd, comparison);

  return {
    schemaVersion: "sipcode-forecast/1",
    status: "ok",
    trajectoryInput,
    monthEnd,
    comparison,
    headline,
  };
}

function empty(status: ForecastStatus, headline: string): ForecastReport {
  return {
    schemaVersion: "sipcode-forecast/1",
    status,
    trajectoryInput: null,
    monthEnd: null,
    comparison: null,
    headline,
  };
}

function daysRemainingInMonth(now: Date): number {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

function monthLabelFor(now: Date): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function bucketDailySpend(
  sessions: ReadonlyArray<ForecastSession>,
  windowDays: number,
  now: Date,
): number[] {
  const buckets: number[] = new Array(windowDays).fill(0);
  const baseMs = now.getTime() - windowDays * 86_400_000;
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (!Number.isFinite(t) || t < baseMs) continue;
    const idx = Math.min(
      windowDays - 1,
      Math.max(0, Math.floor((t - baseMs) / 86_400_000)),
    );
    buckets[idx] = (buckets[idx] ?? 0) + s.estCostUSD;
  }
  return buckets;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : (s[mid] ?? 0);
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let sq = 0;
  for (const x of xs) sq += (x - m) * (x - m);
  return Math.sqrt(sq / (xs.length - 1));
}

function buildLastMonthComparison(
  sessions: ReadonlyArray<ForecastSession>,
  now: Date,
  projectedSpendUSD: number,
): ForecastComparison {
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let lastMonthSpend = 0;
  let any = false;
  for (const s of sessions) {
    const t = Date.parse(s.startedAt);
    if (t >= lastMonthStart.getTime() && t < thisMonthStart.getTime()) {
      lastMonthSpend += s.estCostUSD;
      any = true;
    }
  }
  if (!any) {
    return { lastMonthSpendUSD: null, vsLastMonthPct: null };
  }
  const pct =
    lastMonthSpend > 0
      ? ((projectedSpendUSD - lastMonthSpend) / lastMonthSpend) * 100
      : 0;
  return { lastMonthSpendUSD: lastMonthSpend, vsLastMonthPct: pct };
}

function buildHeadline(
  trajectory: ForecastTrajectoryInput,
  monthEnd: ForecastMonthEnd,
  comparison: ForecastComparison,
): string {
  const parts: string[] = [];
  parts.push(
    `At your current pace ($${trajectory.avgDailySpendUSD.toFixed(2)}/day across ${trajectory.windowDays} days of recent sessions), you're on track to spend about $${Math.round(monthEnd.projectedSpendUSD)} by month-end.`,
  );
  if (comparison.lastMonthSpendUSD !== null && comparison.vsLastMonthPct !== null) {
    const dir = comparison.vsLastMonthPct < 0 ? "less than" : "more than";
    parts.push(
      `${Math.abs(comparison.vsLastMonthPct).toFixed(1)}% ${dir} last month ($${comparison.lastMonthSpendUSD.toFixed(2)}).`,
    );
  }
  parts.push(
    `Confidence range: $${monthEnd.confidenceLowUSD.toFixed(0)}–$${monthEnd.confidenceHighUSD.toFixed(0)}.`,
  );
  return parts.join(" ");
}
