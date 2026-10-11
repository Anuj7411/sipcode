/**
 * The `sipcode limits` report, and the window the `today` line names. Pure.
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";
import {
  attribute,
  summarizeShares,
  type AutoReviewUse,
  type LimitRequest,
  type SessionUse,
} from "./attribute.js";
import { projectRunOut, type Projection } from "./pace.js";
import { buildPeriods, compareReadings, type LimitPeriod, type LimitWindow } from "./periods.js";
import { tokensPerPercent, type ShrinkSeries } from "./shrink.js";

/** 300 → "5-hour", 10,080 → "Weekly", 43,200 → "30-day"; otherwise "N-day" or "N-hour". */
export function windowLabel(minutes: number): string {
  if (minutes === 10_080) return "Weekly";
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`;
  return `${Number((minutes / 60).toFixed(1))}-hour`;
}

export interface WindowReport {
  readonly limitId: string;
  readonly windowMinutes: number;
  readonly label: string;
  /** The window's newest period (the current one, unless it has reset since). */
  readonly period: LimitPeriod;
  readonly periodCount: number;
  readonly projection: Projection;
  /** Sessions in the newest period that --here keeps, highest percent first. */
  readonly usedBy: readonly SessionUse[];
  readonly autoReview: AutoReviewUse | null;
  readonly unattributedPercent: number;
  readonly shrink: ShrinkSeries;
}

export interface LimitsReport {
  readonly planType: string | null;
  /** Time of the newest reading, epoch ms. */
  readonly asOf: number;
  readonly windows: readonly WindowReport[];
}

export interface BuildLimitsReportInput {
  readonly readings: readonly LimitReading[];
  readonly requests: readonly LimitRequest[];
  readonly now: Date;
  /** Start of the tokens-per-1% history (--since), epoch ms. */
  readonly sinceMs: number;
  /** --here: the requests the "what used it" list keeps. Default: all. */
  readonly include?: ((r: LimitRequest) => boolean) | undefined;
}

/** The newest reading (last in reading order), or undefined for none. */
export function newestReading(readings: readonly LimitReading[]): LimitReading | undefined {
  let newest: LimitReading | undefined;
  for (const r of readings) if (!newest || compareReadings(r, newest) > 0) newest = r;
  return newest;
}

export function buildLimitsReport(input: BuildLimitsReportInput): LimitsReport | null {
  const newest = newestReading(input.readings);
  if (!newest) return null;
  const asOf = newest.at;
  const built = buildPeriods(input.readings);
  // Every reading stale (logged after its own reset time): no windows, same as no readings.
  if (built.length === 0) return null;
  const windows = built.map((w): WindowReport => {
    const period = w.periods[w.periods.length - 1]!;
    const a = attribute(period, input.requests);
    const used = summarizeShares(a.shares, input.include);
    return {
      limitId: w.limitId,
      windowMinutes: w.windowMinutes,
      label: windowLabel(w.windowMinutes),
      period,
      periodCount: w.periods.length,
      projection: projectRunOut(period, input.now),
      usedBy: used.sessions,
      autoReview: used.autoReview,
      unattributedPercent: a.unattributedPercent,
      shrink: tokensPerPercent(w, input.requests, { asOf, sinceMs: input.sinceMs }),
    };
  });
  return { planType: newest.planType ?? null, asOf, windows };
}

export interface TodayWindow {
  readonly label: string;
  readonly period: LimitPeriod;
  readonly projection: Projection;
}

interface Candidate {
  readonly window: TodayWindow;
  /** When it runs out: -Infinity once reached; undefined when no run-out is projected. */
  readonly runsOut: number | undefined;
  readonly minutes: number;
}

function closer(a: Candidate, b: Candidate): boolean {
  if (a.runsOut !== undefined || b.runsOut !== undefined) {
    if (a.runsOut === undefined) return false;
    if (b.runsOut === undefined) return true;
    if (a.runsOut !== b.runsOut) return a.runsOut < b.runsOut;
  } else if (a.window.period.usedPercent !== b.window.period.usedPercent) {
    return a.window.period.usedPercent > b.window.period.usedPercent;
  }
  return a.minutes < b.minutes;
}

/**
 * The window closest to running out, among those whose newest reading is in
 * the current period (not reset since): a reached limit first, then the
 * earliest run-out time; with no run-out at all, the highest percent; ties go
 * to the shorter window. Null when no window qualifies.
 */
export function pickTodayWindow(windows: readonly LimitWindow[], now: Date): TodayWindow | null {
  let best: Candidate | null = null;
  for (const w of windows) {
    const period = w.periods[w.periods.length - 1];
    if (!period) continue;
    const projection = projectRunOut(period, now);
    if (projection.kind === "reset-since") continue;
    const runsOut =
      projection.kind === "reached"
        ? Number.NEGATIVE_INFINITY
        : projection.kind === "runs-out"
          ? projection.at
          : undefined;
    const c: Candidate = { window: { label: windowLabel(w.windowMinutes), period, projection }, runsOut, minutes: w.windowMinutes };
    if (!best || closer(c, best)) best = c;
  }
  return best ? best.window : null;
}
