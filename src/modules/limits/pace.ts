/**
 * When a limit period runs out at its current pace. Pure.
 *
 * Pace = percent used ÷ (newest reading time − period start). Run-out =
 * newest reading time + (100 − percent) ÷ pace; "lasts" when that is after the
 * reset. Checked in this order: the reset already passed (`now` is at or past
 * the newest reading's reset time), the limit is reached (100%), the period
 * started less than an hour before its newest reading (too early for a pace).
 */
import type { LimitPeriod } from "./periods.js";

export type Projection =
  | { readonly kind: "runs-out"; readonly at: number }
  | { readonly kind: "lasts" }
  | { readonly kind: "reached" }
  | { readonly kind: "reset-since" }
  | { readonly kind: "too-early" };

/** Least time between period start and newest reading before a pace is shown. */
export const MIN_PACE_MS = 60 * 60 * 1000;

export function projectRunOut(period: LimitPeriod, now: Date): Projection {
  if (period.resetsAt <= now.getTime()) return { kind: "reset-since" };
  if (period.usedPercent >= 100) return { kind: "reached" };
  const elapsed = period.newestAt - period.startedAt;
  if (elapsed < MIN_PACE_MS) return { kind: "too-early" };
  if (period.usedPercent <= 0) return { kind: "lasts" };
  const pace = period.usedPercent / elapsed;
  const at = period.newestAt + (100 - period.usedPercent) / pace;
  return at > period.resetsAt ? { kind: "lasts" } : { kind: "runs-out", at };
}
