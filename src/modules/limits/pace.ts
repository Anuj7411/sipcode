/**
 * When a limit period runs out at its current pace. Pure.
 *
 * The percent is as of the newest reading, but the period has run until now:
 * pace = percent used ÷ (latest − period start), where latest = the later of
 * now and the newest reading (a clock behind the logs never shortens it).
 * Run-out = latest + (100 − percent) ÷ pace; "lasts" when that is after the
 * reset. Checked in this order: the reset already passed (`now` is at or past
 * the newest reading's reset time), the limit is reached (100%), less than an
 * hour from the period start to latest (too early for a pace).
 */
import type { LimitPeriod } from "./periods.js";

export type Projection =
  | { readonly kind: "runs-out"; readonly at: number }
  | { readonly kind: "lasts" }
  | { readonly kind: "reached" }
  | { readonly kind: "reset-since" }
  | { readonly kind: "too-early" };

/** Least time from the period start to now (or the newest reading, if later) before a pace is shown. */
export const MIN_PACE_MS = 60 * 60 * 1000;

export function projectRunOut(period: LimitPeriod, now: Date): Projection {
  if (period.resetsAt <= now.getTime()) return { kind: "reset-since" };
  if (period.usedPercent >= 100) return { kind: "reached" };
  const latest = Math.max(now.getTime(), period.newestAt);
  const elapsed = latest - period.startedAt;
  if (elapsed < MIN_PACE_MS) return { kind: "too-early" };
  if (period.usedPercent <= 0) return { kind: "lasts" };
  // (100 − percent) ÷ pace, with pace = percent ÷ elapsed.
  const at = latest + ((100 - period.usedPercent) * elapsed) / period.usedPercent;
  return at > period.resetsAt ? { kind: "lasts" } : { kind: "runs-out", at };
}
