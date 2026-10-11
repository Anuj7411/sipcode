/**
 * Codex limit readings grouped into windows and periods. Pure.
 *
 * A window is one limit: limit id + window length. A period is the stretch
 * between two resets of that window. Readings from every session are sorted
 * by time, then reset time, then percent (compareReadings), so the result
 * never depends on which file was read first. A reading starts a new period
 * when:
 *   - its reset time differs from the period's by more than the drift
 *     tolerance (the larger of 15 minutes and 1% of the window), or
 *   - its time is past the period's reset time, or
 *   - its reset time is more than 15 minutes later than the period's and its
 *     percent is below the period's running maximum: the limit reset early.
 *     On the maintainer's 30-day window a limit that reached 100% started
 *     again at 5% with a reset time 76 and 129 minutes later, inside the
 *     7.2-hour tolerance; real drift between readings was at most 66 seconds.
 * Within a period the percent is the running maximum, so a lower value from a
 * concurrent session never lowers it. A period's reset time is its newest
 * reading's; it started one window length before that, or at its first reading
 * when reset-time drift would put the start after it (a request made after
 * the first reading must belong to the period).
 * A reading logged after its own reset time is stale and skipped: older Codex
 * repeats the turn-start reading on every line of a turn, so a turn that runs
 * past the reset logs the old reset time and percent after the reset. Kept, it
 * would open a period that had already ended and count its rise twice.
 */
import type { LimitReading } from "../agents/codex/rateLimits.js";

const MINUTE_MS = 60_000;
const EARLY_RESET_MS = 15 * MINUTE_MS;

/** Largest reset-time change still read as drift within one period. */
export function driftToleranceMs(windowMinutes: number): number {
  return Math.max(15 * MINUTE_MS, windowMinutes * MINUTE_MS * 0.01);
}

/** Reading order: time, then reset time, then percent. */
export function compareReadings(a: LimitReading, b: LimitReading): number {
  return a.at - b.at || a.resetsAt - b.resetsAt || a.usedPercent - b.usedPercent;
}

export interface PeriodPoint {
  /** Reading time, epoch ms. */
  readonly at: number;
  /** The period's running maximum at this reading. */
  readonly usedPercent: number;
}

export interface LimitPeriod {
  readonly limitId: string;
  readonly windowMinutes: number;
  /** resetsAt minus the window length, but never after the first reading; epoch ms. */
  readonly startedAt: number;
  /** Reset time of the period's newest reading, epoch ms. */
  readonly resetsAt: number;
  /** Running maximum at the newest reading. */
  readonly usedPercent: number;
  /** Time of the newest reading, epoch ms. */
  readonly newestAt: number;
  /** One point per reading, oldest first. */
  readonly points: readonly PeriodPoint[];
}

export interface LimitWindow {
  readonly limitId: string;
  readonly windowMinutes: number;
  /** Oldest first; never empty. */
  readonly periods: readonly LimitPeriod[];
}

interface OpenPeriod {
  resetsAt: number;
  usedPercent: number;
  newestAt: number;
  readonly points: PeriodPoint[];
}

function startsNewPeriod(cur: OpenPeriod, r: LimitReading): boolean {
  const shift = r.resetsAt - cur.resetsAt;
  return (
    Math.abs(shift) > driftToleranceMs(r.windowMinutes) ||
    r.at > cur.resetsAt ||
    (shift > EARLY_RESET_MS && r.usedPercent < cur.usedPercent)
  );
}

/** Windows ordered by length (shortest first), then limit id. */
export function buildPeriods(readings: readonly LimitReading[]): LimitWindow[] {
  const sorted = [...readings].sort(compareReadings);
  const open = new Map<string, { limitId: string; windowMinutes: number; periods: OpenPeriod[] }>();
  for (const r of sorted) {
    if (r.at > r.resetsAt) continue;
    const key =`${r.limitId}\u0000${r.windowMinutes}`;
    let w = open.get(key);
    if (!w) {
      w = { limitId: r.limitId, windowMinutes: r.windowMinutes, periods: [] };
      open.set(key, w);
    }
    const cur = w.periods[w.periods.length - 1];
    if (!cur || startsNewPeriod(cur, r)) {
      w.periods.push({
        resetsAt: r.resetsAt,
        usedPercent: r.usedPercent,
        newestAt: r.at,
        points: [{ at: r.at, usedPercent: r.usedPercent }],
      });
      continue;
    }
    cur.usedPercent = Math.max(cur.usedPercent, r.usedPercent);
    cur.resetsAt = r.resetsAt;
    cur.newestAt = r.at;
    cur.points.push({ at: r.at, usedPercent: cur.usedPercent });
  }
  return [...open.values()]
    .sort((a, b) => a.windowMinutes - b.windowMinutes || (a.limitId < b.limitId ? -1 : a.limitId > b.limitId ? 1 : 0))
    .map((w) => ({
      limitId: w.limitId,
      windowMinutes: w.windowMinutes,
      periods: w.periods.map((p) => ({
        limitId: w.limitId,
        windowMinutes: w.windowMinutes,
        startedAt: Math.min(p.resetsAt - w.windowMinutes * MINUTE_MS, p.points[0]!.at),
        resetsAt: p.resetsAt,
        usedPercent: p.usedPercent,
        newestAt: p.newestAt,
        points: p.points,
      })),
    }));
}
