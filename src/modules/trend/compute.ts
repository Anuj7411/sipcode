/**
 * `sipcode trend` — single-metric time-series across a window.
 *
 * Different from `sipcode stats` (which shows totals): trend tracks ONE
 * metric per day, designed to be robust to session-length variance and
 * project-mix variance. The single most-useful metric per the v1.2.2
 * post-launch reader: `output_ratio` (output_tokens / total_tokens). If
 * Sipcode is working, this trends UP across the next month even as your
 * project mix changes.
 *
 * Pure compute. Loaders, formatters, and the CLI handler live in sibling
 * files. Mirrors stats/ module layout.
 */

export type TrendMetric =
  | "output-ratio"
  | "cost-per-session"
  | "recoverable-tokens-per-session";

export interface TrendSession {
  /** ISO date when the session started (used to bucket by day). */
  readonly startedAt: string;
  readonly totalTokens: number;
  readonly outputTokens: number;
  readonly estCostUSD: number;
  /** Tokens that could have been recovered by re-read dedup. */
  readonly duplicateReadTokens: number;
}

export interface TrendDay {
  readonly date: string;
  readonly sessions: number;
  readonly value: number;
  /** Sum of the metric numerator (e.g. output tokens) for inspection. */
  readonly numerator: number;
  /** Sum of the metric denominator (e.g. total tokens) for inspection. */
  readonly denominator: number;
}

export interface TrendResult {
  readonly metric: TrendMetric;
  readonly window: { since: string; until: string };
  readonly days: TrendDay[];
  /** Median value across days, ignoring empty days. */
  readonly median: number;
  /** Sloped %/day (positive = improving for ratio, negative for cost). */
  readonly slopePerDay: number;
  /** Plain-language verdict for terminal display. */
  readonly verdict: TrendVerdict;
}

export type TrendVerdict =
  | "insufficient-data"
  | "improving"
  | "stable"
  | "regressing";

/** Minimum non-empty days needed to compute a slope. */
export const MIN_DAYS_FOR_SLOPE = 5;

/** Window threshold (in absolute value of slopePerDay) for stable verdict. */
const STABLE_SLOPE_MAGNITUDE = 0.001;

export function computeTrend(
  sessions: ReadonlyArray<TrendSession>,
  metric: TrendMetric,
  since: string,
  until: string,
): TrendResult {
  const days = bucketByDay(sessions, metric, since, until);
  const nonEmpty = days.filter((d) => d.sessions > 0);
  const median = computeMedian(nonEmpty.map((d) => d.value));
  const slopePerDay = nonEmpty.length >= MIN_DAYS_FOR_SLOPE ? linearSlope(nonEmpty) : 0;
  const verdict = decideVerdict(nonEmpty.length, slopePerDay, metric);

  return {
    metric,
    window: { since, until },
    days,
    median,
    slopePerDay,
    verdict,
  };
}

function bucketByDay(
  sessions: ReadonlyArray<TrendSession>,
  metric: TrendMetric,
  since: string,
  until: string,
): TrendDay[] {
  const buckets = new Map<
    string,
    { num: number; den: number; sessions: number }
  >();
  for (const day of enumerateDays(since, until)) {
    buckets.set(day, { num: 0, den: 0, sessions: 0 });
  }
  for (const s of sessions) {
    const day = s.startedAt.slice(0, 10);
    const b = buckets.get(day);
    if (!b) continue;
    b.sessions += 1;
    switch (metric) {
      case "output-ratio":
        b.num += s.outputTokens;
        b.den += s.totalTokens;
        break;
      case "cost-per-session":
        b.num += s.estCostUSD;
        b.den += 1; // per session
        break;
      case "recoverable-tokens-per-session":
        b.num += s.duplicateReadTokens;
        b.den += 1;
        break;
    }
  }
  const out: TrendDay[] = [];
  for (const [date, b] of buckets) {
    const value = b.den > 0 ? b.num / b.den : 0;
    out.push({
      date,
      sessions: b.sessions,
      value,
      numerator: b.num,
      denominator: b.den,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Inclusive ISO day enumeration. Pure. */
export function enumerateDays(since: string, until: string): string[] {
  const out: string[] = [];
  const s = isoToTime(since);
  const u = isoToTime(until);
  if (s > u) return out;
  for (let t = s; t <= u; t += 86_400_000) {
    out.push(toIso(t));
  }
  return out;
}

function isoToTime(iso: string): number {
  return Date.parse(iso + "T00:00:00Z");
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function computeMedian(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2 : s[mid] ?? 0;
}

/** Linear-regression slope using least squares. Pure. */
function linearSlope(days: ReadonlyArray<TrendDay>): number {
  const n = days.length;
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = days[i]!.value;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  if (denom === 0) return 0;
  return (sumXY - n * meanX * meanY) / denom;
}

function decideVerdict(
  daysWithData: number,
  slope: number,
  metric: TrendMetric,
): TrendVerdict {
  if (daysWithData < MIN_DAYS_FOR_SLOPE) return "insufficient-data";
  if (Math.abs(slope) < STABLE_SLOPE_MAGNITUDE) return "stable";
  // For output-ratio: higher = better (more output per total). Positive slope = improving.
  // For cost-per-session: lower = better. Negative slope = improving.
  // For recoverable-tokens-per-session: lower = better. Negative slope = improving.
  const higherIsBetter = metric === "output-ratio";
  if (higherIsBetter) return slope > 0 ? "improving" : "regressing";
  return slope < 0 ? "improving" : "regressing";
}
